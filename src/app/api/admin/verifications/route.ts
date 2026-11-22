import { NextRequest, NextResponse } from "next/server";
import type { QueryDocumentSnapshot, DocumentData } from "firebase-admin/firestore";
import { requireAdmin } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { assertAdminSdkReady } from "@/lib/server/admin-ready";
import { setVerifiedClaim } from "@/lib/server/claims";
import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STATUSES = ["pending", "approved", "rejected", "expired"] as const;
type VerificationStatus = (typeof STATUSES)[number];

const actionSchema = z
  .object({
    userId: z
      .string()
      .min(1, "Thiếu userId")
      .max(128)
      .refine((v) => !v.includes("/"), "userId không hợp lệ"),
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
  await requireAdmin(req);
  assertAdminSdkReady();

  const sp = new URL(req.url).searchParams;
  const status = (sp.get("status") || "pending") as VerificationStatus;
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, "INVALID_STATUS", "Trạng thái lọc không hợp lệ.");
  }
  const limit = Math.min(Math.max(Number.parseInt(sp.get("limit") || "30", 10) || 30, 1), 50);

  const base = adminDb.collection("verifications").where("status", "==", status);
  let docs: QueryDocumentSnapshot<DocumentData>[];

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
      tx.update(verificationRef, {
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        decidedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        approvedBy: adminEmail,
        rejectReason: null,
        rejectNote: null,
        claimsSyncPending: true, // bootstrap/cron sẽ đồng bộ lại nếu bước claims phía dưới thất bại
      });
      tx.set(userRef, { verified: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
  // Bước 1 (nguyên tử): đổi trạng thái + thông báo + log + xóa ảnh Data URL ngay trong document
  const { storagePath } = await adminDb.runTransaction(async (tx) => {
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
    const isStoragePath = !!p && p.startsWith(`private/cards/${userId}/`);

    tx.update(verificationRef, {
      status: "rejected",
      rejectedAt: FieldValue.serverTimestamp(),
      decidedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      rejectedBy: adminEmail,
      rejectReason: cleanReason,
      rejectNote: cleanNote,
      ...(isDataUrl
        ? {
            cardStoragePath: null, // xóa NGAY ảnh Data URL (PDP 2025)
            cardDeleted: true,
            cardAutoDeletedAt: FieldValue.serverTimestamp(),
          }
        : {}),
      ...(isStoragePath ? { cardDeletePending: true } : {}), // đánh dấu để cron thử lại nếu xóa Storage lỗi
    });
    tx.set(userRef, { verified: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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
    return { storagePath: isStoragePath ? p : null };
  });

  // Bước 2 (best-effort, không làm hỏng kết quả): xóa file trong Storage
  let cardDeleted = true;
  if (storagePath) {
    try {
      await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
      await verificationRef.update({
        cardDeleted: true,
        cardStoragePath: null,
        cardDeletePending: FieldValue.delete(),
        cardAutoDeletedAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      cardDeleted = false;
      console.error("[REJECT] delete card failed (cardDeletePending=true, cron phải thử lại)", e instanceof Error ? e.message : "unknown");
    }
  }

  // Bước 3 (best-effort): gỡ claim verified nếu có, không bao giờ làm rớt quyền admin
  const claimsSynced = await setVerifiedClaim(userId, false);

  return noStore(
    NextResponse.json({
      success: true,
      claimsSynced,
      cardDeleted,
      message: "Đã từ chối hồ sơ xác minh.",
    })
  );
});
