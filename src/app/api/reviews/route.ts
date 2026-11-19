import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z
  .object({
    reservationId: z.string().min(1, "Thiếu reservationId"),
    rating: z.number().min(1, "Đánh giá tối thiểu 1 sao").max(5, "Đánh giá tối đa 5 sao"),
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

  const isBuyer = resData?.buyerId === reviewerId;
  const isSeller = resData?.sellerId === reviewerId;

  if (!isBuyer && !isSeller) {
    throw new ApiError(403, "FORBIDDEN_NOT_PARTICIPANT", "Bạn không tham gia vào giao dịch này.");
  }

  const targetUserId = isBuyer ? resData?.sellerId : resData?.buyerId;

  // 2. Chống đánh giá trùng: mỗi giao dịch mỗi bên chỉ gửi 1 lần
  const existingReviewSnap = await adminDb
    .collection("reviews")
    .where("reservationId", "==", reservationId)
    .where("reviewerId", "==", reviewerId)
    .get();

  if (!existingReviewSnap.empty) {
    throw new ApiError(409, "ALREADY_REVIEWED", "Bạn đã gửi đánh giá cho giao dịch này rồi.");
  }

  // 3. Tạo bản ghi review
  await adminDb.collection("reviews").add({
    reservationId,
    listingId: resData?.listingId,
    reviewerId,
    reviewerName,
    targetUserId,
    rating: Math.round(rating),
    comment: comment?.trim() || "",
    createdAt: FieldValue.serverTimestamp(),
  });

  // 4. Cập nhật lại điểm đánh giá trung bình của người nhận
  const allReviewsSnap = await adminDb
    .collection("reviews")
    .where("targetUserId", "==", targetUserId)
    .get();

  let totalScore = 0;
  allReviewsSnap.forEach((doc) => {
    totalScore += (doc.data().rating as number) || 5;
  });
  const avgRating =
    allReviewsSnap.size > 0 ? Number((totalScore / allReviewsSnap.size).toFixed(1)) : 5.0;

  await adminDb.collection("users").doc(targetUserId).update({
    rating: avgRating,
    reviewsCount: allReviewsSnap.size,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    success: true,
    message: "Cảm ơn bạn đã gửi đánh giá! Nhận xét của bạn giúp cộng đồng sinh viên an tâm hơn.",
  });
});
