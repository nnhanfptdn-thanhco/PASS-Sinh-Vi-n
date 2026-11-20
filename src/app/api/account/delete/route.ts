import { NextRequest, NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth/server";
import { adminAuth, adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

/**
 * Helper xóa danh sách DocumentReference theo từng lô <= 400 thao tác (F12)
 */
async function deleteRefsInChunks(refs: FirebaseFirestore.DocumentReference[]) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = adminDb.batch();
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
}

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

    // 1. Chặn xóa nếu còn giao dịch confirmed hoặc tin đang reserved (F12)
    const [buyerConfirmedSnap, sellerConfirmedSnap, reservedListingsSnap] = await Promise.all([
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
      adminDb
        .collection("listings")
        .where("sellerId", "==", userId)
        .where("status", "==", "reserved")
        .get(),
    ]);

    if (!buyerConfirmedSnap.empty || !sellerConfirmedSnap.empty || !reservedListingsSnap.empty) {
      return NextResponse.json(
        {
          error:
            "Bạn vẫn còn món đồ hoặc giao dịch đang ở trạng thái 'Đã xác nhận giữ chỗ'. Vui lòng hoàn tất hoặc hủy giao dịch với đối tác trước khi xóa tài khoản.",
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

    // 3. Đọc studentIdHash TRƯỚC KHI xóa verifications để giải phóng khóa MSSV (F12)
    const verifRef = adminDb.collection("verifications").doc(userId);
    const verifSnap = await verifRef.get();
    const studentIdHash = verifSnap.data()?.studentIdHash as string | undefined;

    // 4. Thu thập toàn bộ các DocumentReference cần xóa theo đợt
    const refsToDelete: FirebaseFirestore.DocumentReference[] = [
      adminDb.collection("users").doc(userId),
      adminDb.collection("usersPrivate").doc(userId),
      verifRef,
    ];

    if (studentIdHash) {
      refsToDelete.push(adminDb.collection("studentIdHashes").doc(studentIdHash));
    }

    // Listings và listingsPrivate
    const listingsSnap = await adminDb
      .collection("listings")
      .where("sellerId", "==", userId)
      .get();
    for (const doc of listingsSnap.docs) {
      refsToDelete.push(doc.ref);
      refsToDelete.push(adminDb.collection("listingsPrivate").doc(doc.id));
    }

    // Favorites
    const favoritesSnap = await adminDb
      .collection("favorites")
      .where("userId", "==", userId)
      .get();
    favoritesSnap.docs.forEach((d) => refsToDelete.push(d.ref));

    // Notifications
    const notifSnap = await adminDb
      .collection("notifications")
      .where("userId", "==", userId)
      .get();
    notifSnap.docs.forEach((d) => refsToDelete.push(d.ref));

    // Contact view logs
    const viewLogsSnap = await adminDb
      .collection("contactViewLogs")
      .where("viewerId", "==", userId)
      .get();
    viewLogsSnap.docs.forEach((d) => refsToDelete.push(d.ref));

    // Reports do user tạo
    const userReportsSnap = await adminDb
      .collection("reports")
      .where("reporterId", "==", userId)
      .get();
    userReportsSnap.docs.forEach((d) => refsToDelete.push(d.ref));

    // Appeals do user tạo
    const userAppealsSnap = await adminDb
      .collection("appeals")
      .where("userId", "==", userId)
      .get();
    userAppealsSnap.docs.forEach((d) => refsToDelete.push(d.ref));

    // Đánh giá mà user nhận được (targetUserId == userId)
    const receivedReviewsSnap = await adminDb
      .collection("reviews")
      .where("targetUserId", "==", userId)
      .get();
    receivedReviewsSnap.docs.forEach((d) => refsToDelete.push(d.ref));

    // Thực hiện xóa theo từng lô <= 400 thao tác (chống lỗi batch > 500)
    await deleteRefsInChunks(refsToDelete);

    // 5. Xử lý các hội thoại và tin nhắn liên quan
    const convSnap = await adminDb
      .collection("conversations")
      .where("participantIds", "array-contains", userId)
      .get();

    const bucket = adminStorage.bucket();
    for (const doc of convSnap.docs) {
      const convId = doc.id;
      try {
        await adminDb.recursiveDelete(doc.ref);
      } catch (err) {
        console.warn(`Lỗi xóa conversation ${convId}:`, err);
      }
      try {
        await bucket.deleteFiles({ prefix: `private/chats/${convId}/`, force: true });
      } catch {
        /* Bỏ qua nếu không có file chat */
      }
    }

    // 6. Ẩn danh hóa các đánh giá đã gửi (reviewerId: null, reviewerName: 'Người dùng đã xóa')
    const sentReviewsSnap = await adminDb
      .collection("reviews")
      .where("reviewerId", "==", userId)
      .get();

    for (let i = 0; i < sentReviewsSnap.docs.length; i += 400) {
      const b = adminDb.batch();
      sentReviewsSnap.docs.slice(i, i + 400).forEach((d) => {
        b.update(d.ref, {
          reviewerName: "Người dùng đã xóa",
          reviewerId: null,
        });
      });
      await b.commit();
    }

    // 7. Xóa toàn bộ tệp Cloud Storage cá nhân
    try {
      await Promise.all([
        bucket.deleteFiles({ prefix: `private/cards/${userId}/`, force: true }).catch(() => {}),
        bucket.deleteFiles({ prefix: `public/listings/${userId}/`, force: true }).catch(() => {}),
        bucket.deleteFiles({ prefix: `public/avatars/${userId}/`, force: true }).catch(() => {}),
      ]);
    } catch {
      // Tiếp tục nếu thư mục storage trống
    }

    // 8. Xóa tài khoản Firebase Auth (F12: không nuốt lỗi trừ trường hợp user-not-found)
    try {
      await adminAuth.deleteUser(userId);
    } catch (authErr: unknown) {
      const errCode = (authErr as { code?: string })?.code;
      if (errCode !== "auth/user-not-found") {
        console.error("Lỗi xóa Auth user:", authErr);
        return NextResponse.json(
          { error: "Chưa xóa được tài khoản đăng nhập, vui lòng thử lại." },
          { status: 500 }
        );
      }
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
