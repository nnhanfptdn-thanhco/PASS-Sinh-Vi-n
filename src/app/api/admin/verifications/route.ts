import "server-only";
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
    reason: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

// GET: Lấy danh sách hồ sơ xác minh cần duyệt (Chỉ Admin)
export const GET = withApi(async (req: NextRequest) => {
  await requireAdmin(req);

  const snap = await adminDb
    .collection("verifications")
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const bucket = adminStorage.bucket();

  const items = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data();
      let signedCardUrl: string | null = null;

      // Sinh Signed URL 5 phút nếu có ảnh thẻ trên Storage
      const storagePath =
        (data.cardStoragePath as string) || `private/cards/${doc.id}/front.webp`;

      try {
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (exists) {
          const [url] = await file.getSignedUrl({
            action: "read",
            expires: Date.now() + 5 * 60 * 1000, // 5 phút
          });
          signedCardUrl = url;
        }
      } catch {
        // Bỏ qua lỗi sinh signed url nếu file không tồn tại
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cardImagePreviewUrl, ...safeData } = data;

      return {
        id: doc.id,
        userId: doc.id,
        ...safeData,
        cardImagePreviewUrl: signedCardUrl || null,
      };
    })
  );

  // Ưu tiên xếp email trường (.edu.vn) lên đầu hàng đợi
  items.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    if (Boolean(a.isEduEmail) && !b.isEduEmail) return -1;
    if (!a.isEduEmail && Boolean(b.isEduEmail)) return 1;
    return 0;
  });

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

  const verifSnap = await verificationRef.get();
  if (!verifSnap.exists) {
    throw new ApiError(404, "VERIFICATION_NOT_FOUND", "Không tìm thấy hồ sơ xác minh của sinh viên này");
  }

  if (action === "approve") {
    // 1. Cấp Custom Claims: verified = true (Gộp claims)
    const userRecord = await adminAuth.getUser(userId);
    const existingClaims = userRecord.customClaims || {};

    await adminAuth.setCustomUserClaims(userId, {
      ...existingClaims,
      verified: true,
      role: existingClaims.admin ? "admin" : "verified",
    });

    // 2. Cập nhật hồ sơ
    await verificationRef.update({
      status: "approved",
      approvedAt: FieldValue.serverTimestamp(),
      decidedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      approvedBy: adminEmail,
      rejectReason: null,
      rejectNote: null,
    });

    await userRef.update({
      verified: true,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 3. Tạo thông báo trong app
    await adminDb.collection("notifications").add({
      userId,
      type: "verification_result",
      title: "Thẻ sinh viên đã được phê duyệt! 🎉",
      message:
        "Chúc mừng bạn! Tài khoản đã được cấp nhãn 'Đã xác minh sinh viên'. Bạn hiện có thể đăng tin và xem liên hệ mua bán.",
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 4. Ghi nhật ký quản trị
    await adminDb.collection("adminLogs").add({
      adminEmail,
      adminUid: adminToken.uid,
      action: "APPROVE_STUDENT_CARD",
      targetUserId: userId,
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: "Đã duyệt thẻ sinh viên và cấp quyền thành công.",
    });
  }

  // Từ chối (Reject)
  await verificationRef.update({
    status: "rejected",
    rejectedAt: FieldValue.serverTimestamp(),
    decidedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    rejectedBy: adminEmail,
    rejectReason: reason,
    rejectNote: note || null,
  });

  const userRecord = await adminAuth.getUser(userId);
  const existingClaims = userRecord.customClaims || {};
  if (existingClaims.verified) {
    await adminAuth.setCustomUserClaims(userId, {
      ...existingClaims,
      verified: false,
      role: existingClaims.admin ? "admin" : "pending",
    });
  }

  await userRef.update({
    verified: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await adminDb.collection("notifications").add({
    userId,
    type: "verification_result",
    title: "Hồ sơ thẻ sinh viên cần bổ sung / bị từ chối ⚠️",
    message: `Lý do: ${reason}. ${note ? `Ghi chú: ${note}` : ""}. Vui lòng chụp lại ảnh thẻ rõ nét và gửi lại.`,
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
    message: "Đã từ chối hồ sơ thẻ sinh viên.",
  });
});
