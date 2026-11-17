import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Thiếu userId" }, { status: 400 });
    }

    // 1. Kiểm tra xem người dùng còn giao dịch confirmed nào chưa hoàn tất không
    const activeConfirmedSnap = await adminDb
      .collection("reservations")
      .where("status", "==", "confirmed")
      .get();

    const hasActiveDeal = activeConfirmedSnap.docs.some(
      (doc) => doc.data().buyerId === userId || doc.data().sellerId === userId
    );

    if (hasActiveDeal) {
      return NextResponse.json(
        {
          error:
            "Bạn vẫn còn giao dịch đang ở trạng thái 'Đã xác nhận giữ chỗ'. Vui lòng hoàn tất hoặc hủy giao dịch với đối tác trước khi xóa tài khoản.",
        },
        { status: 400 }
      );
    }

    // 2. Xóa các tin đăng của người dùng
    const listingsSnap = await adminDb
      .collection("listings")
      .where("sellerId", "==", userId)
      .get();

    const batch = adminDb.batch();
    for (const doc of listingsSnap.docs) {
      batch.delete(doc.ref);
      batch.delete(adminDb.collection("listingsPrivate").doc(doc.id));
    }

    // 3. Xóa hồ sơ công khai và riêng tư
    batch.delete(adminDb.collection("users").doc(userId));
    batch.delete(adminDb.collection("usersPrivate").doc(userId));

    // 4. Xóa bản ghi xác minh và studentIdHash (theo đúng SPEC để sinh viên có thể đăng ký lại sau này nếu muốn)
    batch.delete(adminDb.collection("verifications").doc(userId));

    await batch.commit();

    // 5. Ẩn danh hóa các đánh giá đã gửi
    const reviewsSnap = await adminDb
      .collection("reviews")
      .where("reviewerId", "==", userId)
      .get();

    const reviewBatch = adminDb.batch();
    for (const doc of reviewsSnap.docs) {
      reviewBatch.update(doc.ref, {
        reviewerName: "Người dùng đã xóa",
      });
    }
    await reviewBatch.commit();

    // 6. Xóa người dùng trong Firebase Auth
    try {
      await adminAuth.deleteUser(userId);
    } catch (authErr) {
      console.warn("Lưu ý xóa Auth user:", authErr);
    }

    return NextResponse.json({
      success: true,
      message:
        "Tài khoản và toàn bộ dữ liệu cá nhân của bạn đã được xóa hoàn toàn khỏi hệ thống.",
    });
  } catch (err) {
    console.error("Lỗi xóa tài khoản:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ khi xóa tài khoản" }, { status: 500 });
  }
}
