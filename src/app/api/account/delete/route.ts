import { NextRequest, NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth/server";
import { adminAuth, adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

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

    // 1. Kiểm tra hai truy vấn độc lập theo buyerId và sellerId (WP-6.4: không quét cả collection)
    const [buyerConfirmedSnap, sellerConfirmedSnap] = await Promise.all([
      adminDb
        .collection("reservations")
        .where("buyerId", "==", userId)
        .where("status", "==", "confirmed")
        .get(),
      adminDb
        .collection("reservations")
        .where("sellerId", "==", userId)
        .where("status", "==", "confirmed")
        .get(),
    ]);

    if (!buyerConfirmedSnap.empty || !sellerConfirmedSnap.empty) {
      return NextResponse.json(
        {
          error:
            "Bạn vẫn còn giao dịch đang ở trạng thái 'Đã xác nhận giữ chỗ'. Vui lòng hoàn tất hoặc hủy giao dịch với đối tác trước khi xóa tài khoản.",
        },
        { status: 400 }
      );
    }

    // 2. Hủy các yêu cầu giữ chỗ còn mở (pending / waitlisted) và thông báo đối tác
    const [buyerOpenSnap, sellerOpenSnap] = await Promise.all([
      adminDb
        .collection("reservations")
        .where("buyerId", "==", userId)
        .where("status", "in", ["pending", "waitlisted"])
        .get(),
      adminDb
        .collection("reservations")
        .where("sellerId", "==", userId)
        .where("status", "in", ["pending", "waitlisted"])
        .get(),
    ]);

    const resCancelBatch = adminDb.batch();
    for (const doc of buyerOpenSnap.docs) {
      resCancelBatch.update(doc.ref, {
        status: "cancelled",
        cancelledBy: "system",
        cancelReason: "Tài khoản người mua đã được xóa",
        cancelledAt: FieldValue.serverTimestamp(),
      });
      const notifRef = adminDb.collection("notifications").doc();
      resCancelBatch.set(notifRef, {
        userId: doc.data().sellerId,
        type: "reservation_cancelled",
        title: "Yêu cầu giữ chỗ đã bị hủy",
        body: "Người mua đã xóa tài khoản trên hệ thống.",
        targetId: doc.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    for (const doc of sellerOpenSnap.docs) {
      resCancelBatch.update(doc.ref, {
        status: "cancelled",
        cancelledBy: "system",
        cancelReason: "Tài khoản người bán đã được xóa",
        cancelledAt: FieldValue.serverTimestamp(),
      });
      const notifRef = adminDb.collection("notifications").doc();
      resCancelBatch.set(notifRef, {
        userId: doc.data().buyerId,
        type: "reservation_cancelled",
        title: "Yêu cầu giữ chỗ đã bị hủy",
        body: "Người bán đã xóa tài khoản trên hệ thống.",
        targetId: doc.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await resCancelBatch.commit();

    // 3. Xóa các tin đăng của người dùng
    const listingsSnap = await adminDb
      .collection("listings")
      .where("sellerId", "==", userId)
      .get();

    const batch = adminDb.batch();
    for (const doc of listingsSnap.docs) {
      batch.delete(doc.ref);
      batch.delete(adminDb.collection("listingsPrivate").doc(doc.id));
    }

    // 4. Xóa yêu thích (favorites) và thông báo
    const favoritesSnap = await adminDb
      .collection("favorites")
      .where("userId", "==", userId)
      .get();
    for (const doc of favoritesSnap.docs) {
      batch.delete(doc.ref);
    }

    const notifSnap = await adminDb
      .collection("notifications")
      .where("userId", "==", userId)
      .get();
    for (const doc of notifSnap.docs) {
      batch.delete(doc.ref);
    }

    // 5. Xóa hồ sơ công khai, riêng tư, và xác minh
    batch.delete(adminDb.collection("users").doc(userId));
    batch.delete(adminDb.collection("usersPrivate").doc(userId));
    batch.delete(adminDb.collection("verifications").doc(userId));

    await batch.commit();

    // 6. Ẩn danh hóa các đánh giá đã gửi
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

    // 7. Xóa toàn bộ tệp Cloud Storage (ảnh thẻ, ảnh tin đăng, avatar)
    try {
      const bucket = adminStorage.bucket();
      await Promise.all([
        bucket.deleteFiles({ prefix: `private/cards/${userId}/`, force: true }).catch(() => {}),
        bucket.deleteFiles({ prefix: `public/listings/${userId}/`, force: true }).catch(() => {}),
        bucket.deleteFiles({ prefix: `public/avatars/${userId}/`, force: true }).catch(() => {}),
      ]);
    } catch {
      // Tiếp tục nếu thư mục storage trống
    }

    // 8. Xóa tài khoản Firebase Auth
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
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Lỗi xóa tài khoản:", err);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi khi xóa tài khoản. Vui lòng thử lại sau." },
      { status: 500 }
    );
  }
}
