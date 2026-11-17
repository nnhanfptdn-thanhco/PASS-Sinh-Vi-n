import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

const MAX_PENDING_RESERVATIONS_PER_LISTING = 3;

export async function POST(req: NextRequest) {
  try {
    const {
      listingId,
      buyerId,
      buyerName,
      sellerId,
      deliveryMethod,
      preferredSchedule,
    } = await req.json();

    if (!listingId || !buyerId || !sellerId) {
      return NextResponse.json({ error: "Thiếu thông tin giữ chỗ" }, { status: 400 });
    }

    if (buyerId === sellerId) {
      return NextResponse.json(
        { error: "Bạn không thể tự giữ chỗ món đồ của chính mình" },
        { status: 400 }
      );
    }

    // 1. Kiểm tra xem người mua đã có yêu cầu pending trên tin này chưa
    const existingSnap = await adminDb
      .collection("reservations")
      .where("listingId", "==", listingId)
      .where("buyerId", "==", buyerId)
      .where("status", "==", "pending")
      .get();

    if (!existingSnap.empty) {
      return NextResponse.json(
        {
          error:
            "Bạn đã gửi yêu cầu giữ chỗ cho món đồ này rồi. Vui lòng chờ người bán phản hồi trong vòng 24 giờ.",
        },
        { status: 409 }
      );
    }

    // 2. Kiểm tra số lượng yêu cầu pending hiện tại trên tin (tối đa 3 để tránh khóa ảo)
    const currentPendingSnap = await adminDb
      .collection("reservations")
      .where("listingId", "==", listingId)
      .where("status", "==", "pending")
      .get();

    if (currentPendingSnap.size >= MAX_PENDING_RESERVATIONS_PER_LISTING) {
      return NextResponse.json(
        {
          error:
            "Món đồ này hiện đang có 3 bạn sinh viên khác gửi yêu cầu giữ chỗ chờ người bán duyệt. Bạn có thể lưu tin để nhận thông báo nếu các bạn trước không nhận đồ.",
        },
        { status: 429 }
      );
    }

    // 3. Thời hạn 24 giờ tính theo múi giờ Việt Nam
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const reservationRef = adminDb.collection("reservations").doc();
    await reservationRef.set({
      id: reservationRef.id,
      listingId,
      buyerId,
      buyerName: buyerName || "Sinh viên",
      sellerId,
      deliveryMethod: deliveryMethod || "pickup",
      preferredSchedule: preferredSchedule || "Thỏa thuận",
      status: "pending", // "pending" | "confirmed" | "waitlisted" | "completed" | "cancelled" | "expired" | "rejected" | "no_show"
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 4. Tạo thông báo trong app cho người bán
    await adminDb.collection("notifications").add({
      userId: sellerId,
      type: "reservation_request",
      title: "Có sinh viên vừa gửi yêu cầu Giữ Chỗ! ⚡",
      message: `${buyerName || "Một bạn sinh viên"} muốn giữ chỗ món đồ của bạn. Bạn có 24 giờ để bấm Xác nhận hoặc Từ chối.`,
      targetId: reservationRef.id,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      reservationId: reservationRef.id,
      message: "Yêu cầu giữ chỗ đã được gửi thành công đến người bán.",
    });
  } catch (err) {
    console.error("Lỗi tạo yêu cầu giữ chỗ:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
