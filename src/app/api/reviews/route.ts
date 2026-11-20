import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z
  .object({
    reservationId: z.string().min(1, "Thiếu reservationId"),
    rating: z.number().int("Đánh giá phải là số sao nguyên").min(1, "Đánh giá tối thiểu 1 sao").max(5, "Đánh giá tối đa 5 sao"),
    comment: z.string().max(500, "Bình luận tối đa 500 ký tự").optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const reviewerId = auth.uid;
  const reviewerName = auth.name || "Sinh viên";

  const body = await readJson(req);
  const { reservationId, rating, comment } = reviewSchema.parse(body);

  // 1. Kiểm tra giao dịch đã hoàn tất chưa
  const resSnap = await adminDb.collection("reservations").doc(reservationId).get();
  if (!resSnap.exists) {
    throw new ApiError(404, "RESERVATION_NOT_FOUND", "Không tìm thấy giao dịch.");
  }

  const resData = resSnap.data();
  if (resData?.status !== "completed") {
    throw new ApiError(
      403,
      "FORBIDDEN_NOT_COMPLETED",
      "Chỉ được gửi đánh giá sau khi giao dịch đã hoàn tất thành công."
    );
  }

  // Cửa sổ đánh giá: Tối đa 30 ngày kể từ khi hoàn tất giao dịch (F14)
  const completedAtMs =
    (resData?.completedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ||
    (resData?.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ||
    0;
  if (completedAtMs && Date.now() - completedAtMs > 30 * 24 * 3600 * 1000) {
    throw new ApiError(
      400,
      "REVIEW_WINDOW_EXPIRED",
      "Đã quá thời hạn 30 ngày để gửi đánh giá cho giao dịch này."
    );
  }

  const isBuyer = resData?.buyerId === reviewerId;
  const isSeller = resData?.sellerId === reviewerId;

  if (!isBuyer && !isSeller) {
    throw new ApiError(403, "FORBIDDEN_NOT_PARTICIPANT", "Bạn không tham gia vào giao dịch này.");
  }

  const targetUserId = isBuyer ? resData?.sellerId : resData?.buyerId;
  if (!targetUserId) {
    throw new ApiError(400, "INVALID_TARGET_USER", "Không xác định được đối phương cần đánh giá.");
  }

  await consumeRateLimit({
    scope: "review",
    key: reviewerId,
    limit: 10,
    windowSec: 3600,
    customMessage: "Bạn gửi đánh giá quá nhanh. Vui lòng chờ một chút.",
  });

  // 2. Định danh duy nhất `${reservationId}_${reviewerId}` & cập nhật rating nguyên tử qua Transaction (F14)
  const reviewRef = adminDb.collection("reviews").doc(`${reservationId}_${reviewerId}`);
  const targetRef = adminDb.collection("users").doc(targetUserId);

  await adminDb.runTransaction(async (tx) => {
    const [rSnap, tSnap] = await Promise.all([tx.get(reviewRef), tx.get(targetRef)]);
    if (rSnap.exists) {
      throw new ApiError(409, "ALREADY_REVIEWED", "Bạn đã gửi đánh giá cho giao dịch này rồi.");
    }

    const t = tSnap.data() ?? {};
    const count = (Number(t.reviewsCount) || 0) + 1;
    const prevSum =
      Number(t.ratingSum) ||
      (Number(t.rating) || 0) * (Number(t.reviewsCount) || 0);
    const sum = prevSum + rating;

    tx.create(reviewRef, {
      reservationId,
      listingId: resData?.listingId,
      reviewerId,
      reviewerName,
      targetUserId,
      rating,
      comment: comment?.trim() || "",
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      targetRef,
      {
        ratingSum: sum,
        reviewsCount: count,
        rating: Number((sum / count).toFixed(1)),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return NextResponse.json({
    success: true,
    message: "Cảm ơn bạn đã gửi đánh giá! Nhận xét của bạn giúp cộng đồng sinh viên an tâm hơn.",
  });
});
