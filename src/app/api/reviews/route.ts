import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

const reviewSchema = z.object({
  reservationId: z.string().min(1, "Thiếu reservationId"),
  rating: z.number().min(1, "Đánh giá tối thiểu 1 sao").max(5, "Đánh giá tối đa 5 sao"),
  comment: z.string().max(500, "Bình luận tối đa 500 ký tự").optional(),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const reviewerId = token.uid;
    const reviewerName = token.name || "Sinh viên";

    const body = await req.json();
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { reservationId, rating, comment } = parsed.data;

    // 1. Kiểm tra giao dịch đã hoàn tất chưa
    const resSnap = await adminDb.collection("reservations").doc(reservationId).get();
    if (!resSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy giao dịch" }, { status: 404 });
    }

    const resData = resSnap.data();
    if (resData?.status !== "completed") {
      return NextResponse.json(
        { error: "Chỉ được gửi đánh giá sau khi giao dịch đã hoàn tất thành công" },
        { status: 403 }
      );
    }

    const isBuyer = resData?.buyerId === reviewerId;
    const isSeller = resData?.sellerId === reviewerId;

    if (!isBuyer && !isSeller) {
      return NextResponse.json(
        { error: "Bạn không tham gia vào giao dịch này" },
        { status: 403 }
      );
    }

    const targetUserId = isBuyer ? resData?.sellerId : resData?.buyerId;

    // 2. Chống đánh giá trùng: mỗi giao dịch mỗi bên chỉ gửi 1 lần
    const existingReviewSnap = await adminDb
      .collection("reviews")
      .where("reservationId", "==", reservationId)
      .where("reviewerId", "==", reviewerId)
      .get();

    if (!existingReviewSnap.empty) {
      return NextResponse.json(
        { error: "Bạn đã gửi đánh giá cho giao dịch này rồi." },
        { status: 409 }
      );
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
      totalScore += doc.data().rating || 5;
    });
    const avgRating =
      allReviewsSnap.size > 0
        ? Number((totalScore / allReviewsSnap.size).toFixed(1))
        : 5.0;

    await adminDb.collection("users").doc(targetUserId).update({
      rating: avgRating,
      reviewsCount: allReviewsSnap.size,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: "Cảm ơn bạn đã gửi đánh giá! Nhận xét của bạn giúp cộng đồng sinh viên an tâm hơn.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
