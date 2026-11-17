import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const { reservationId, reviewerId, reviewerName, rating, comment } =
      await req.json();

    if (!reservationId || !reviewerId || !rating) {
      return NextResponse.json({ error: "Thiếu thông tin đánh giá" }, { status: 400 });
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Số sao đánh giá phải từ 1 đến 5" }, { status: 400 });
    }

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
      reviewerName: reviewerName || "Sinh viên",
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
    console.error("Lỗi gửi đánh giá:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
