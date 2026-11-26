import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";
import { containsContactInfo } from "@/lib/utils/contact-filter";
import { isPastDeadline } from "@/lib/utils/date";
import {
  activeReservationLockRef,
  listingReservationStatsRef,
  userReservationStatsRef,
} from "@/lib/server/stats";
import {
  MAX_PENDING_RESERVATIONS_PER_LISTING,
  MAX_PENDING_RESERVATIONS_PER_BUYER,
  PREFERRED_SCHEDULE_MAX_LENGTH,
} from "@/lib/constants/listing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createReservationSchema = z
  .object({
    listingId: FIRESTORE_ID_SCHEMA,
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

  // 1. Kiểm tra bộ lọc thông tin liên hệ trong ghi chú hẹn gặp (trước khi trừ rate limit)
  if (preferredSchedule && containsContactInfo(preferredSchedule)) {
    throw new ApiError(
      400,
      "CONTAINS_CONTACT_INFO",
      "Ghi chú hẹn xem đồ không được chứa số điện thoại, Zalo hoặc liên kết mạng xã hội. Thông tin liên hệ sẽ được mở sau khi người bán xác nhận giữ chỗ."
    );
  }

  // 2. Rate limiting per-UID fail-closed
  await consumeRateLimit({
    scope: "create_reservation",
    key: buyerId,
    limit: 20,
    windowSec: 3600,
    customMessage: "Bạn đã gửi quá nhiều yêu cầu giữ chỗ trong 1 giờ qua. Vui lòng thử lại sau.",
  });

  const reservationRef = adminDb.collection("reservations").doc();
  const listingRef = adminDb.collection("listings").doc(listingId);
  const activeLockRef = activeReservationLockRef(listingId, buyerId);
  const listingStatsRef = listingReservationStatsRef(listingId);
  const buyerStatsRef = userReservationStatsRef(buyerId);

  const result = await adminDb.runTransaction(async (transaction) => {
    // ===== READ PHASE: ĐỌC TẤT CẢ LOCK, AGGREGATE STATS VÀ DỮ LIỆU GỐC TRONG CÙNG TRANSACTION =====
    const [
      listingSnap,
      activeLockSnap,
      listingStatsSnap,
      buyerStatsSnap,
      existingActiveSnap,
      currentPendingSnap,
      buyerPendingSnap,
    ] = await Promise.all([
      transaction.get(listingRef),
      transaction.get(activeLockRef),
      transaction.get(listingStatsRef),
      transaction.get(buyerStatsRef),
      transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("buyerId", "==", buyerId)
          .where("status", "in", ["pending", "waitlisted", "confirmed"])
      ),
      transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "==", "pending")
      ),
      transaction.get(
        adminDb
          .collection("reservations")
          .where("buyerId", "==", buyerId)
          .where("status", "==", "pending")
      ),
    ]);

    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Món đồ này không tồn tại.");
    }

    const listingData = listingSnap.data() as Record<string, unknown>;
    if (listingData.operationStatus) {
      throw new ApiError(
        409,
        "LISTING_PROCESSING",
        "Món đồ này đang được xử lý đóng hoặc kiểm duyệt."
      );
    }

    const sellerId = listingData.sellerId as string;
    const listingStatus = listingData.status as string;
    const passDeadline = (listingData.passDeadline as string) || "";

    if (listingStatus !== "active" || isPastDeadline(passDeadline)) {
      throw new ApiError(
        400,
        "LISTING_NOT_AVAILABLE",
        "Món đồ này hiện không mở để giữ chỗ hoặc đã hết hạn đăng."
      );
    }

    if (buyerId === sellerId) {
      throw new ApiError(
        400,
        "CANNOT_RESERVE_OWN_LISTING",
        "Bạn không thể tự gửi yêu cầu giữ chỗ món đồ của chính mình."
      );
    }

    const shippingMethods = (listingData.shippingMethods as Record<string, boolean>) || {};
    if (!shippingMethods[deliveryMethod]) {
      throw new ApiError(
        400,
        "UNSUPPORTED_DELIVERY_METHOD",
        "Người bán không hỗ trợ phương thức nhận hàng này."
      );
    }

    // Kiểm tra unique lock đồng thời và fallback query nếu legacy chưa có lock
    if ((activeLockSnap.exists && activeLockSnap.data()?.active === true) || !existingActiveSnap.empty) {
      throw new ApiError(
        409,
        "ALREADY_RESERVED",
        "Bạn đã có một yêu cầu giữ chỗ đang được xử lý cho món đồ này rồi."
      );
    }

    const storedListingPending = listingStatsSnap.exists
      ? Math.max(0, Number(listingStatsSnap.data()?.pendingCount ?? 0))
      : 0;
    const effectiveListingPending = Math.max(storedListingPending, currentPendingSnap.size);

    if (effectiveListingPending >= MAX_PENDING_RESERVATIONS_PER_LISTING) {
      throw new ApiError(
        429,
        "LISTING_PENDING_LIMIT_REACHED",
        `Món đồ này hiện đã có đủ ${MAX_PENDING_RESERVATIONS_PER_LISTING} bạn sinh viên chờ duyệt giữ chỗ.`
      );
    }

    const storedBuyerPending = buyerStatsSnap.exists
      ? Math.max(0, Number(buyerStatsSnap.data()?.pendingCount ?? 0))
      : 0;
    const effectiveBuyerPending = Math.max(storedBuyerPending, buyerPendingSnap.size);

    if (effectiveBuyerPending >= MAX_PENDING_RESERVATIONS_PER_BUYER) {
      throw new ApiError(
        429,
        "BUYER_PENDING_LIMIT_REACHED",
        `Bạn đang có ${MAX_PENDING_RESERVATIONS_PER_BUYER} yêu cầu giữ chỗ chờ người bán duyệt. Vui lòng chờ phản hồi trước khi gửi thêm.`
      );
    }

    // ===== WRITE PHASE =====
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
    transaction.set(activeLockRef, {
      active: true,
      reservationId: reservationRef.id,
      listingId,
      buyerId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      listingStatsRef,
      {
        pendingCount: effectiveListingPending + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.set(
      buyerStatsRef,
      {
        pendingCount: effectiveBuyerPending + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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
