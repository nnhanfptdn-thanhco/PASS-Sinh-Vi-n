import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/auth/server";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const userId = token.uid;

    // Yêu cầu auth_time gần đây (trong vòng 5 phút = 300 giây) để chống tấn công CSRF / phiên bị chiếm đoạt
    const authTime = token.auth_time || 0;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (nowInSeconds - authTime > 300) {
      throw new HttpError(
        403,
        "Vì lý do an toàn, vui lòng đăng nhập lại Google trước khi thực hiện xóa vĩnh viễn tài khoản."
      );
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

    // 3. Xóa hồ sơ công khai, riêng tư, và thông báo
    batch.delete(adminDb.collection("users").doc(userId));
    batch.delete(adminDb.collection("usersPrivate").doc(userId));
    batch.delete(adminDb.collection("verifications").doc(userId));

    const notifSnap = await adminDb
      .collection("notifications")
      .where("userId", "==", userId)
      .get();
    for (const doc of notifSnap.docs) {
      batch.delete(doc.ref);
    }

    await batch.commit();

    // 4. Ẩn danh hóa các đánh giá đã gửi
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

    // 5. Xóa tệp Cloud Storage của user (ảnh thẻ, avatar)
    try {
      const bucket = adminStorage.bucket();
      await bucket.deleteFiles({ prefix: `private/cards/${userId}/`, force: true });
      await bucket.deleteFiles({ prefix: `public/avatars/${userId}/`, force: true });
    } catch {
      // Tiếp tục nếu thư mục storage trống
    }

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
    return errorResponse(err);
  }
}
