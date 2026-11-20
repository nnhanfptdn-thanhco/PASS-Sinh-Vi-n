import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { adminAuth, adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z
  .object({
    userId: z.string().min(1, "Thiếu userId"),
    action: z.enum(["approve", "reject"]),
    reason: z.string().max(300).optional(),
    note: z.string().max(300).optional(),
  })
  .strict();

// GET: Lấy danh sách hồ sơ xác minh cần duyệt (Chỉ Admin)
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req);
  const status = new URL(req.url).searchParams.get("status") || "pending";
  if (!["pending", "approved", "rejected", "expired"].includes(status)) {
    throw new ApiError(400, "INVALID_STATUS", "Trạng thái lọc không hợp lệ.");
  }

  const snap = await adminDb
    .collection("verifications")
    .where("status", "==", status)
    .orderBy("createdAt", "asc")
    .limit(50)
    .get();

  const bucket = adminStorage.bucket();

  const items = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      let signedCardUrl: string | null = null;
      const p = data.cardStoragePath as string | null;

      if (p && !data.cardDeleted && p.startsWith("private/cards/")) {
        try {
          const [url] = await bucket.file(p).getSignedUrl({
            action: "read",
            expires: Date.now() + 5 * 60 * 1000, // 5 phút
          });
          signedCardUrl = url;
        } catch {
          /* file đã bị xóa hoặc không đọc được */
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cardImagePreviewUrl, cardStoragePath, cardImagePath, studentIdHash, ...safe } = data;
      return { id: doc.id, userId: doc.id, ...safe, cardImagePreviewUrl: signedCardUrl };
    })
  );

  items.sort(
    (a, b) =>
      Number(Boolean((b as Record<string, unknown>).isEduEmail)) -
      Number(Boolean((a as Record<string, unknown>).isEduEmail))
  );

  return NextResponse.json({ items });
});

// POST: Xử lý Duyệt hoặc Từ chối thẻ sinh viên (Chỉ Admin)
export const POST = withApi(async (req: NextRequest) => {
  const adminToken = await requireAdmin(req);
  const body = await readJson(req);
  const parsed = actionSchema.parse(body);

  const { userId, action, reason, note } = parsed;
  const adminEmail = adminToken.email || "admin";

  if (action === "reject" && !reason) {
    throw new ApiError(
      400,
      "MISSING_REJECT_REASON",
      "Từ chối bắt buộc phải chọn lý do (ảnh mờ, thẻ hết hạn, tên không khớp, thẻ không hợp lệ)"
    );
  }

  const verificationRef = adminDb.collection("verifications").doc(userId);
  const userRef = adminDb.collection("users").doc(userId);

  if (action === "approve") {
    await adminDb.runTransaction(async (tx) => {
      const vSnap = await tx.get(verificationRef);
      if (!vSnap.exists) {
        throw new ApiError(404, "VERIFICATION_NOT_FOUND", "Không tìm thấy hồ sơ xác minh");
      }
      const v = vSnap.data()!;
      if (v.status !== "pending") {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          `Hồ sơ đang ở trạng thái "${v.status}", không thể duyệt.`
        );
      }

      const lockRef = adminDb.collection("studentIdHashes").doc(v.studentIdHash);
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists && lockSnap.data()?.userId !== userId) {
        throw new ApiError(
          409,
          "STUDENT_ID_CONFLICT",
          "MSSV này đã được dùng để xác minh cho tài khoản khác."
        );
      }

      tx.set(lockRef, {
        studentIdHash: v.studentIdHash,
        userId,
        schoolCode: v.schoolCode,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.update(verificationRef, {
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        decidedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        approvedBy: adminEmail,
        rejectReason: null,
        rejectNote: null,
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

    try {
      const rec = await adminAuth.getUser(userId);
      await adminAuth.setCustomUserClaims(userId, {
        ...(rec.customClaims || {}),
        verified: true,
        role: rec.customClaims?.admin ? "admin" : "verified",
      });
    } catch (e) {
      console.warn("[APPROVE] setCustomUserClaims failed", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({
      success: true,
      message: "Đã duyệt thẻ sinh viên và cấp quyền thành công.",
    });
  }

  // Từ chối (Reject)
  const verifSnap = await verificationRef.get();
  if (!verifSnap.exists) {
    throw new ApiError(404, "VERIFICATION_NOT_FOUND", "Không tìm thấy hồ sơ xác minh");
  }
  const verifData = verifSnap.data()!;
  if (verifData.status !== "pending") {
    throw new ApiError(
      409,
      "INVALID_STATUS",
      `Hồ sơ đang ở trạng thái "${verifData.status}", không thể từ chối.`
    );
  }

  await verificationRef.update({
    status: "rejected",
    rejectedAt: FieldValue.serverTimestamp(),
    decidedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    rejectedBy: adminEmail,
    rejectReason: reason,
    rejectNote: note || null,
  });

  // Xóa ảnh thẻ sớm khi reject (PDP)
  const p = verifData.cardStoragePath as string | undefined;
  if (p && p.startsWith("private/cards/")) {
    try {
      await adminStorage.bucket().file(p).delete({ ignoreNotFound: true });
      await verificationRef.update({
        cardDeleted: true,
        cardStoragePath: null,
        cardAutoDeletedAt: FieldValue.serverTimestamp(),
      });
    } catch {
      /* ignore storage delete error */
    }
  }

  const userRecord = await adminAuth.getUser(userId);
  const existingClaims = userRecord.customClaims || {};
  if (existingClaims.verified) {
    await adminAuth.setCustomUserClaims(userId, {
      ...existingClaims,
      verified: false,
      role: existingClaims.admin ? "admin" : "pending",
    });
  }

  await userRef.set(
    {
      verified: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await adminDb.collection("notifications").add({
    userId,
    type: "verification_result",
    title: "Hồ sơ thẻ sinh viên cần bổ sung / bị từ chối ⚠️",
    body: `Lý do: ${reason}. ${note ? `Ghi chú: ${note}` : ""}. Vui lòng chụp lại ảnh thẻ rõ nét và gửi lại.`,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await adminDb.collection("adminLogs").add({
    adminEmail,
    adminUid: adminToken.uid,
    action: "REJECT_STUDENT_CARD",
    targetUserId: userId,
    reason,
    note: note || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    success: true,
    message: "Đã từ chối hồ sơ xác minh.",
  });
});
