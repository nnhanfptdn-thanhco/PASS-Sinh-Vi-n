import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";

// GET: Lấy danh sách hồ sơ xác minh cần duyệt
export async function GET() {
  try {
    const snap = await adminDb
      .collection("verifications")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const items = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Ưu tiên xếp email trường (.edu.vn) lên đầu hàng đợi
    items.sort((a, b) => {
      // @ts-expect-error dynamic field
      if (a.isEduEmail && !b.isEduEmail) return -1;
      // @ts-expect-error dynamic field
      if (!a.isEduEmail && b.isEduEmail) return 1;
      return 0;
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("Lỗi lấy danh sách duyệt:", err);
    return NextResponse.json({ error: "Không thể lấy danh sách" }, { status: 500 });
  }
}

// POST: Xử lý Duyệt hoặc Từ chối thẻ sinh viên
export async function POST(req: NextRequest) {
  try {
    const { userId, action, reason, note, adminEmail } = await req.json();

    if (!userId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Tham số không hợp lệ" }, { status: 400 });
    }

    if (action === "reject" && !reason) {
      return NextResponse.json(
        { error: "Từ chối bắt buộc phải chọn lý do (ảnh mờ, thẻ hết hạn, tên không khớp, thẻ không hợp lệ)" },
        { status: 400 }
      );
    }

    const verificationRef = adminDb.collection("verifications").doc(userId);
    const userRef = adminDb.collection("users").doc(userId);

    if (action === "approve") {
      // 1. Cấp Custom Claims: verified = true
      try {
        await adminAuth.setCustomUserClaims(userId, {
          verified: true,
          role: "verified",
        });
      } catch (authErr) {
        console.warn("Lỗi gán claim auth:", authErr);
      }

      // 2. Cập nhật hồ sơ
      await verificationRef.update({
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: adminEmail || "admin",
        rejectReason: null,
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
        message: "Chúc mừng bạn! Tài khoản đã được cấp nhãn 'Đã xác minh sinh viên'. Bạn hiện có thể đăng tin và xem liên hệ mua bán.",
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      // 4. Ghi nhật ký quản trị
      await adminDb.collection("adminLogs").add({
        adminEmail: adminEmail || "admin",
        action: "approve_student_card",
        targetUserId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        success: true,
        message: "Đã duyệt thẻ sinh viên và cấp quyền thành công.",
      });
    } else {
      // Từ chối (Reject)
      await verificationRef.update({
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: adminEmail || "admin",
        rejectReason: reason,
        rejectNote: note || "",
      });

      await userRef.update({
        verified: false,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Tạo thông báo trong app kèm lý do
      await adminDb.collection("notifications").add({
        userId,
        type: "verification_result",
        title: "Hồ sơ xác minh thẻ chưa được duyệt",
        message: `Lý do: ${reason}. ${note ? `Ghi chú: ${note}` : ""}. Bạn có thể kiểm tra và nộp lại ảnh thẻ rõ nét hơn.`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Ghi nhật ký quản trị
      await adminDb.collection("adminLogs").add({
        adminEmail: adminEmail || "admin",
        action: "reject_student_card",
        targetUserId: userId,
        reason,
        note: note || "",
        timestamp: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        success: true,
        message: "Đã từ chối hồ sơ xác minh kèm lý do.",
      });
    }
  } catch (err) {
    console.error("Lỗi xử lý duyệt thẻ:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
