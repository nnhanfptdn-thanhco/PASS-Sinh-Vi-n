import { NextRequest, NextResponse } from "next/server";
import { requireVerified, errorResponse } from "@/lib/auth/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

const MAX_PENDING_RESERVATIONS_PER_LISTING = 3;

const createReservationSchema = z.object({
  listingId: z.string().min(1, "Thiếu listingId"),
  deliveryMethod: z.string().optional(),
  preferredSchedule: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireVerified(req);
    const buyerId = token.uid;
    const buyerName = token.name || "Sinh viên";

    const body = await req.json();
    const parsed = createReservationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { listingId, deliveryMethod, preferredSchedule } = parsed.data;

    // 1. Kiểm tra tin đăng tồn tại và còn active
    const listingDoc = await adminDb.collection("listings").doc(listingId).get();
    if (!listingDoc.exists) {
      return NextResponse.json({ error: "Tin đăng không tồn tại" }, { status: 404 });
    }

    const listingData = listingDoc.data() || {};
    const sellerId = listingData.sellerId;

    if (listingData.status !== "active") {
      return NextResponse.json(
        { error: "Món đồ này hiện không mở để giữ chỗ hoặc đã có giao dịch hoàn tất." },
        { status: 400 }
      );
    }

    if (buyerId === sellerId) {
      return NextResponse.json(
        { error: "Bạn không thể tự giữ chỗ món đồ của chính mình" },
        { status: 400 }
      );
    }

    // 2. Kiểm tra xem người mua đã có yêu cầu pending trên tin này chưa
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

    // 3. Kiểm tra số lượng yêu cầu pending hiện tại trên tin (tối đa 3 để tránh khóa ảo)
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

    // 4. Thời hạn 24 giờ
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const reservationRef = adminDb.collection("reservations").doc();
    await reservationRef.set({
      id: reservationRef.id,
      listingId,
      listingTitle: listingData.title || "Món đồ pass",
      listingPrice: listingData.price || 0,
      listingImage: listingData.coverImage || "",
      buyerId,
      buyerName,
      sellerId,
      deliveryMethod: deliveryMethod || "pickup",
      preferredSchedule: preferredSchedule || "Thỏa thuận",
      status: "pending",
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 5. Tạo thông báo trong app cho người bán
    await adminDb.collection("notifications").add({
      userId: sellerId,
      type: "reservation_request",
      title: "Có sinh viên vừa gửi yêu cầu Giữ Chỗ! ⚡",
      message: `${buyerName} muốn giữ chỗ món đồ '${listingData.title}'. Bạn có 24 giờ để bấm Xác nhận hoặc Từ chối.`,
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
    return errorResponse(err);
  }
}
