import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const { listingId, sellerId, action, newStatus } = await req.json();

    if (!listingId || !sellerId || !action) {
      return NextResponse.json({ error: "Thiếu thông tin yêu cầu" }, { status: 400 });
    }

    const listingRef = adminDb.collection("listings").doc(listingId);
    const snap = await listingRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Tin đăng không tồn tại" }, { status: 404 });
    }

    const data = snap.data();
    if (data?.sellerId !== sellerId) {
      return NextResponse.json(
        { error: "Bạn không có quyền chỉnh sửa tin đăng này" },
        { status: 403 }
      );
    }

    // Không cho phép người bán tự mở lại tin nếu bị Admin ẩn do vi phạm
    if (data?.status === "hidden_by_admin" && action === "change_status") {
      return NextResponse.json(
        {
          error:
            "Tin đăng này đã bị Quản trị viên ẩn do vi phạm quy định. Vui lòng gửi kháng nghị tại mục Hỗ trợ để được xem xét lại.",
        },
        { status: 403 }
      );
    }

    if (action === "change_status") {
      await listingRef.update({
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ success: true, message: "Đã cập nhật trạng thái tin" });
    }

    if (action === "renew") {
      // Gia hạn tin thêm 7 ngày
      const now = new Date();
      const newDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const deadlineStr = newDeadline.toISOString().split("T")[0];

      await listingRef.update({
        passDeadline: deadlineStr,
        status: "active",
        renewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({
        success: true,
        message: `Đã gia hạn tin thành công đến ngày ${deadlineStr}`,
      });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (err) {
    console.error("Lỗi quản lý tin:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
