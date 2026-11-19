import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/auth/server";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";
import { containsContactInfo } from "@/lib/utils/contact-filter";
import { isPastDeadline } from "@/lib/utils/date";
import {
  MAX_PENDING_RESERVATIONS_PER_LISTING,
  MAX_PENDING_RESERVATIONS_PER_BUYER,
  PREFERRED_SCHEDULE_MAX_LENGTH,
} from "@/lib/constants/listing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createReservationSchema = z
  .object({
    listingId: z.string().min(1, "Thiếu listingId"),
    deliveryMethod: z.enum(["pickup", "sellerDelivery", "carrierShipping", "campusDelivery"], {
      message: "Phương thức nhận hàng không hợp lệ.",
    }),
    preferredSchedule: z
      .string()
      .max(
        PREFERRED_SCHEDULE_MAX_LENGTH,
        `Ghi chú thời gian tối đa ${PREFERRED_SCHEDULE_MAX_LENGTH} ký tự`
      )
      .optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const { token, userDoc } = await requireApprovedStudent(req);
  const buyerId = token.uid;
  const buyerName =
    (userDoc?.displayName as string) || (token.name as string) || "Sinh viên";

  const body = await readJson(req);
  const { listingId, deliveryMethod, preferredSchedule } = createReservationSchema.parse(body);

  // 1. Kiểm tra bộ lọc thông tin liên hệ trong ghi chú hẹn gặp
  if (preferredSchedule && containsContactInfo(preferredSchedule)) {
    throw new ApiError(
      400,
      "CONTAINS_CONTACT_INFO",
      "Ghi chú hẹn xem đồ không được chứa số điện thoại, Zalo hoặc liên kết mạng xã hội. Thông tin liên hệ sẽ được mở sau khi người bán xác nhận giữ chỗ."
    );
  }

  const reservationRef = adminDb.collection("reservations").doc();
  const listingRef = adminDb.collection("listings").doc(listingId);

  const result = await adminDb.runTransaction(async (transaction) => {
    // 2. Đọc tin đăng
    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Món đồ này không tồn tại.");
    }

    const listingData = listingSnap.data() as Record<string, unknown>;
    const sellerId = listingData.sellerId as string;
    const listingStatus = listingData.status as string;
    const passDeadline = (listingData.passDeadline as string) || "";

    // Kiểm tra tính khả dụng của tin đăng
    if (listingStatus !== "active" || isPastDeadline(passDeadline)) {
      throw new ApiError(
        400,
        "LISTING_NOT_AVAILABLE",
        "Món đồ này hiện không mở để giữ chỗ hoặc đã hết hạn đăng."
      );
    }

    // Không cho tự giữ chỗ đồ của chính mình
    if (buyerId === sellerId) {
      throw new ApiError(
        400,
        "CANNOT_RESERVE_OWN_LISTING",
        "Bạn không thể tự gửi yêu cầu giữ chỗ món đồ của chính mình."
      );
    }

    // Kiểm tra phương thức nhận hàng có được người bán hỗ trợ không
    const shippingMethods = (listingData.shippingMethods as Record<string, boolean>) || {};
    if (!shippingMethods[deliveryMethod]) {
      throw new ApiError(
        400,
        "UNSUPPORTED_DELIVERY_METHOD",
        "Người bán không hỗ trợ phương thức nhận hàng này."
      );
    }

    // 3. Kiểm tra xem người mua đã có yêu cầu chưa kết thúc trên tin này chưa
    const existingActiveSnap = await transaction.get(
      adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("buyerId", "==", buyerId)
        .where("status", "in", ["pending", "waitlisted", "confirmed"])
    );

    if (!existingActiveSnap.empty) {
      throw new ApiError(
        409,
        "ALREADY_RESERVED",
        "Bạn đã có một yêu cầu giữ chỗ đang được xử lý cho món đồ này rồi."
      );
    }

    // 4. Kiểm tra số lượng pending trên tin này (tối đa 3)
    const currentPendingSnap = await transaction.get(
      adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("status", "==", "pending")
    );

    if (currentPendingSnap.size >= MAX_PENDING_RESERVATIONS_PER_LISTING) {
      throw new ApiError(
        429,
        "LISTING_PENDING_LIMIT_REACHED",
        `Món đồ này hiện đã có đủ ${MAX_PENDING_RESERVATIONS_PER_LISTING} bạn sinh viên chờ duyệt giữ chỗ.`
      );
    }

    // 5. Kiểm tra số lượng pending toàn hệ thống của người mua (tối đa 5)
    const buyerPendingSnap = await transaction.get(
      adminDb
        .collection("reservations")
        .where("buyerId", "==", buyerId)
        .where("status", "==", "pending")
    );

    if (buyerPendingSnap.size >= MAX_PENDING_RESERVATIONS_PER_BUYER) {
      throw new ApiError(
        429,
        "BUYER_PENDING_LIMIT_REACHED",
        `Bạn đang có ${MAX_PENDING_RESERVATIONS_PER_BUYER} yêu cầu giữ chỗ chờ người bán duyệt. Vui lòng chờ phản hồi trước khi gửi thêm.`
      );
    }

    // 6. Tạo reservation với hạn 24 giờ
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const newReservation = {
      id: reservationRef.id,
      listingId,
      listingTitle: (listingData.title as string) || "Món đồ pass",
      listingPrice: Number(listingData.price) || 0,
      listingImage:
        (listingData.coverThumb as string) || (listingData.coverImage as string) || "",
      sellerId,
      sellerSchool: (listingData.schoolName as string) || "",
      buyerId,
      buyerName,
      deliveryMethod,
      preferredSchedule: preferredSchedule?.trim() || "",
      status: "pending",
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(reservationRef, newReservation);

    // 7. Tạo thông báo cho người bán
    const notifRef = adminDb.collection("notifications").doc();
    transaction.set(notifRef, {
      userId: sellerId,
      type: "new_reservation",
      title: "Yêu cầu giữ chỗ mới! 📦",
      body: `Bạn ${buyerName} vừa gửi yêu cầu giữ chỗ món đồ "${listingData.title}". Hãy vào xem và phản hồi trong 24 giờ nhé.`,
      targetId: reservationRef.id,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      reservationId: reservationRef.id,
      expiresAt,
    };
  });

  return NextResponse.json({
    success: true,
    message: "Đã gửi yêu cầu giữ chỗ thành công! Người bán có 24 giờ để xác nhận.",
    ...result,
  });
});
