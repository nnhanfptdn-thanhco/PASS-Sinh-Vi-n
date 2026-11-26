import { NextRequest, NextResponse } from "next/server";
import type { QueryDocumentSnapshot, DocumentData } from "firebase-admin/firestore";
import { requireAdmin } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { assertAdminSdkReady } from "@/lib/server/admin-ready";
import { setVerifiedClaim } from "@/lib/server/claims";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STATUSES = ["pending", "approved", "rejected", "expired"] as const;
type VerificationStatus = (typeof STATUSES)[number];

const actionSchema = z
  .object({
    userId: FIRESTORE_ID_SCHEMA,
    action: z.enum(["approve", "reject"]),
    reason: z.string().max(300).optional(),
    note: z.string().max(300).optional(),
  })
  .strict();

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}

// GET: danh sách hồ sơ (chỉ Admin). KHÔNG trả ảnh thẻ — ảnh lấy riêng qua /card.
export const GET = withApi(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  assertAdminSdkReady();

  await consumeRateLimit({
    scope: "admin_verifications_read",
    key: admin.uid,
    limit: 60,
    windowSec: 600,
  });

  const sp = new URL(req.url).searchParams;
  rejectDuplicateQueryParams(sp, ["status", "limit"]);
  const status = (sp.get("status") || "pending") as VerificationStatus;
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, "INVALID_STATUS", "Trạng thái lọc không hợp lệ.");
  }
  const limit = Math.min(Math.max(Number.parseInt(sp.get("limit") || "30", 10) || 30, 1), 50);

  const base = adminDb.collection("verifications").where("status", "==", status);
  let docs: QueryDocumentSnapshot<DocumentData>[];

  try {
    if (status === "pending") {
      // Ưu tiên email .edu.vn ĐÚNG NGHĨA: lấy riêng từng nhóm theo thứ tự nộp rồi ghép
      const [edu, others] = await Promise.all([
        base.where("isEduEmail", "==", true).orderBy("createdAt", "asc").limit(limit).get(),
        base.where("isEduEmail", "==", false).orderBy("createdAt", "asc").limit(limit).get(),
      ]);
      docs = [...edu.docs, ...others.docs].slice(0, limit);
    } else {
      docs = (await base.orderBy("updatedAt", "desc").limit(limit).get()).docs;
    }
  } catch (err: unknown) {
    const errStr = String(err);
    if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
      console.warn("[AdminVerifications] Missing Firestore index, falling back to in-memory sort:", errStr);
      const snap = await base.limit(100).get();
      const allDocs = [...snap.docs];
      if (status === "pending") {
        allDocs.sort((a, b) => {
          const dataA = a.data();
          const dataB = b.data();
          const isEduA = Boolean(dataA.isEduEmail);
          const isEduB = Boolean(dataB.isEduEmail);
          if (isEduA && !isEduB) return -1;
          if (!isEduA && isEduB) return 1;
          const timeA = dataA.createdAt?.toMillis?.() ?? 0;
          const timeB = dataB.createdAt?.toMillis?.() ?? 0;
          return timeA - timeB;
        });
      } else {
        allDocs.sort((a, b) => {
          const dataA = a.data();
          const dataB = b.data();
          const timeA = dataA.updatedAt?.toMillis?.() ?? dataA.createdAt?.toMillis?.() ?? 0;
          const timeB = dataB.updatedAt?.toMillis?.() ?? dataB.createdAt?.toMillis?.() ?? 0;
          return timeB - timeA;
        });
      }
      docs = allDocs.slice(0, limit);
    } else {
      throw err;
    }
  }

  const items = docs.map((d) => {
    const data = d.data();
    const {
      cardStoragePath,
      cardImagePath,
      cardImagePreviewUrl,
      studentIdHash,
      createdAt,
      updatedAt,
      ...safe
    } = data;
    void cardImagePath;
    void cardImagePreviewUrl;
    void studentIdHash; // tuyệt đối không trả hash MSSV ra client
    return {
      id: d.id,
      userId: d.id,
      ...safe,
      hasCard: Boolean(cardStoragePath) && !data.cardDeleted,
      createdAtMs: createdAt?.toMillis?.() ?? null,
      updatedAtMs: updatedAt?.toMillis?.() ?? null,
    };
  });

  return noStore(NextResponse.json({ items }));
});

// POST: Duyệt / Từ chối (chỉ Admin)
export const POST = withApi(async (req: NextRequest) => {
  const adminToken = await requireAdmin(req);
  assertAdminSdkReady();

  await consumeRateLimit({
    scope: "admin_verifications_action",
    key: adminToken.uid,
    limit: 60,
    windowSec: 600,
  });

  const { userId, action, reason, note } = actionSchema.parse(await readJson(req));
  const adminEmail = adminToken.email || "admin";
  const cleanReason = reason?.trim() || "";
  const cleanNote = note?.trim() || null;

  if (action === "reject" && cleanReason.length < 3) {
    throw new ApiError(
      400,
      "MISSING_REJECT_REASON",
      "Từ chối bắt buộc phải chọn lý do (ảnh mờ, thẻ hết hạn, tên không khớp, thẻ không hợp lệ)."
    );
  }

  const verificationRef = adminDb.collection("verifications").doc(userId);
  const userRef = adminDb.collection("users").doc(userId);

  // ===================== DUYỆT =====================
  if (action === "approve") {
    await adminDb.runTransaction(async (tx) => {
      // ----- READ PHASE: mọi tx.get trước mọi lệnh ghi -----
      const vSnap = await tx.get(verificationRef);
      if (!vSnap.exists) {
        throw new ApiError(404, "VERIFICATION_NOT_FOUND", "Không tìm thấy hồ sơ xác minh");
      }
      const v = vSnap.data()!;
      if (v.status !== "pending") {
        throw new ApiError(409, "INVALID_STATUS", `Hồ sơ đang ở trạng thái "${v.status}", không thể duyệt.`);
      }
      const hash = v.studentIdHash;
      if (typeof hash !== "string" || hash.length === 0) {
        throw new ApiError(
          422,
          "MISSING_STUDENT_ID_HASH",
          "Hồ sơ thiếu mã băm MSSV. Hãy từ chối và yêu cầu sinh viên nộp lại."
        );
      }
      const lockRef = adminDb.collection("studentIdHashes").doc(hash);
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists && lockSnap.data()?.userId !== userId) {
        throw new ApiError(409, "STUDENT_ID_CONFLICT", "MSSV này đã được dùng để xác minh cho tài khoản khác.");
      }

      // ----- WRITE PHASE -----
      if (!lockSnap.exists) {
        tx.set(lockRef, {
          studentIdHash: hash,
          userId,
          schoolCode: v.schoolCode ?? null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      const purgeDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      tx.update(verificationRef, {
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        decidedAt: FieldValue.serverTimestamp(),
        cardPurgeAt: purgeDate,
        updatedAt: FieldValue.serverTimestamp(),
        approvedBy: adminEmail,
        rejectReason: null,
        rejectNote: null,
        claimsSyncPending: true, // bootstrap/cron sẽ đồng bộ lại nếu bước claims phía dưới thất bại
      });
      tx.set(
        userRef,
        {
          verified: true,
          schoolCode: v.schoolCode ?? null,
          schoolName: v.schoolName ?? null,
          campusId: v.campusId ?? null,
          isGraduating: Boolean(v.isGraduating),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(adminDb.collection("notifications").doc(), {
        userId,
        type: "verification_result",
        title: "Thẻ sinh viên đã được phê duyệt! 🎉",
        body: "Chúc mừng bạn! Tài khoản đã được cấp nhãn 'Đã xác minh sinh viên'.",
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(adminDb.collection("adminLogs").doc(), {
        adminEmail,
        adminUid: adminToken.uid,
        action: "APPROVE_STUDENT_CARD",
        targetUserId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
    });

    const claimsSynced = await setVerifiedClaim(userId, true);
    if (claimsSynced) {
      await verificationRef.update({ claimsSyncPending: FieldValue.delete() }).catch(() => undefined);
    }
    return noStore(
      NextResponse.json({
        success: true,
        claimsSynced,
        message: claimsSynced
          ? "Đã duyệt thẻ sinh viên và cấp quyền thành công."
          : "Đã duyệt thẻ, nhưng chưa đồng bộ được quyền (claims). Hệ thống sẽ đồng bộ khi người dùng đăng nhập lại.",
      })
    );
  }

  // ===================== TỪ CHỐI =====================
  // Ghi nguyên tử: đổi trạng thái + thông báo + log + đặt cardPurgeAt = now + 30 ngày trong cùng transaction
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(verificationRef);
    if (!snap.exists) {
      throw new ApiError(404, "VERIFICATION_NOT_FOUND", "Không tìm thấy hồ sơ xác minh");
    }
    const v = snap.data()!;
    if (v.status !== "pending") {
      throw new ApiError(409, "INVALID_STATUS", `Hồ sơ đang ở trạng thái "${v.status}", không thể từ chối.`);
    }
    const p = typeof v.cardStoragePath === "string" ? v.cardStoragePath : null;
    const isDataUrl = !!p && p.startsWith("data:image/");

    const purgeDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    tx.update(verificationRef, {
      status: "rejected",
      rejectedAt: FieldValue.serverTimestamp(),
      decidedAt: FieldValue.serverTimestamp(),
      cardPurgeAt: purgeDate,
      updatedAt: FieldValue.serverTimestamp(),
      rejectedBy: adminEmail,
      rejectReason: cleanReason,
      rejectNote: cleanNote,
      ...(isDataUrl
        ? {
            cardStoragePath: null, // xóa NGAY ảnh Data URL cũ để không làm phình Firestore doc
            cardDeleted: true,
            cardAutoDeletedAt: FieldValue.serverTimestamp(),
            cardPurgeAt: FieldValue.delete(),
          }
        : {}),
    });
    tx.set(
      userRef,
      {
        verified: false,
        schoolCode: FieldValue.delete(),
        schoolName: FieldValue.delete(),
        campusId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(adminDb.collection("notifications").doc(), {
      userId,
      type: "verification_result",
      title: "Hồ sơ thẻ sinh viên cần bổ sung / bị từ chối ⚠️",
      body: `Lý do: ${cleanReason}.${cleanNote ? ` Ghi chú: ${cleanNote}.` : ""} Vui lòng chụp lại ảnh thẻ rõ nét và gửi lại.`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(adminDb.collection("adminLogs").doc(), {
      adminEmail,
      adminUid: adminToken.uid,
      action: "REJECT_STUDENT_CARD",
      targetUserId: userId,
      reason: cleanReason,
      note: cleanNote,
      timestamp: FieldValue.serverTimestamp(),
    });
  });

  // Bước 2 (best-effort): gỡ claim verified nếu có, không bao giờ làm rớt quyền admin
  const claimsSynced = await setVerifiedClaim(userId, false);

  return noStore(
    NextResponse.json({
      success: true,
      claimsSynced,
      cardDeleted: false,
      cardPurgeAtScheduled: true,
      message: "Đã từ chối hồ sơ xác minh. Ảnh thẻ được lên lịch xóa tự động sau 30 ngày (hoặc qua cron).",
    })
  );
});
