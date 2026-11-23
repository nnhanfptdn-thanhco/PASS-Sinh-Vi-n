import { adminAuth, adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";

/**
 * Helper xóa danh sách DocumentReference theo từng lô <= 400 thao tác (F12)
 */
export async function deleteRefsInChunks(refs: FirebaseFirestore.DocumentReference[]) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = adminDb.batch();
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
}

/**
 * Hàm dọn dẹp toàn bộ dữ liệu người dùng (Idempotent, fail-closed, chunked batches).
 * Có thể chạy từ API account/delete hoặc từ Cron Sweeper dọn dẹp các tài khoản treo quá 10 phút.
 */
export async function purgeUserData(userId: string, initialStudentIdHash?: string | null): Promise<void> {
  const bucket = adminStorage.bucket();

  // 1. Lấy studentIdHash từ tham số truyền vào, hoặc từ marker pendingDeletions, hoặc từ doc verifications
  let studentIdHash = initialStudentIdHash;
  if (!studentIdHash) {
    const pendingMarker = await adminDb.collection("pendingDeletions").doc(userId).get();
    studentIdHash = (pendingMarker.data()?.studentIdHash as string | undefined) || undefined;
  }
  const verifRef = adminDb.collection("verifications").doc(userId);
  if (!studentIdHash) {
    const verifSnap = await verifRef.get();
    studentIdHash = (verifSnap.data()?.studentIdHash as string | undefined) || undefined;
  }

  // 2. Hủy các yêu cầu giữ chỗ còn mở (pending / waitlisted) theo từng lô <= 200 doc
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

  for (let i = 0; i < buyerOpenSnap.docs.length; i += 200) {
    const chunk = buyerOpenSnap.docs.slice(i, i + 200);
    const resCancelBatch = adminDb.batch();
    for (const doc of chunk) {
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
    await resCancelBatch.commit();
  }

  for (let i = 0; i < sellerOpenSnap.docs.length; i += 200) {
    const chunk = sellerOpenSnap.docs.slice(i, i + 200);
    const resCancelBatch = adminDb.batch();
    for (const doc of chunk) {
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
  }

  // 3. Xóa toàn bộ tệp Cloud Storage cá nhân TRƯỚC KHI xóa doc verifications (tránh file mồ côi)
  // Nếu lỗi Storage: ném lỗi để không xóa Firestore doc, sweeper sẽ thử lại sau
  await Promise.all([
    bucket.deleteFiles({ prefix: `private/cards/${userId}/`, force: true }),
    bucket.deleteFiles({ prefix: `public/listings/${userId}/`, force: true }),
    bucket.deleteFiles({ prefix: `public/avatars/${userId}/`, force: true }),
  ]);

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

  // 5. Xử lý các hội thoại và tin nhắn liên quan (không nuốt lỗi để đảm bảo fail-closed)
  const convSnap = await adminDb
    .collection("conversations")
    .where("participantIds", "array-contains", userId)
    .get();

  for (const doc of convSnap.docs) {
    const convId = doc.id;
    await adminDb.recursiveDelete(doc.ref);
    await bucket.deleteFiles({ prefix: `private/chats/${convId}/`, force: true });
  }

  // 6. Ẩn danh hóa các đánh giá đã gửi
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

  // 7. Xóa tài khoản Firebase Auth
  try {
    await adminAuth.deleteUser(userId);
  } catch (authErr: unknown) {
    const errCode = (authErr as { code?: string })?.code;
    if (errCode !== "auth/user-not-found") {
      throw authErr;
    }
  }

  // 8. Xóa marker pendingDeletions sau khi hoàn tất toàn bộ mọi bước
  await adminDb.collection("pendingDeletions").doc(userId).delete();
}
