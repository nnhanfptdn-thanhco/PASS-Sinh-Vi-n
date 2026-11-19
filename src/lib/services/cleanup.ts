import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { todayVN, isPastDeadline } from "@/lib/utils/date";

export interface CleanupResult {
  deletedCardsCount: number;
  expiredListingsCount: number;
  expiredPendingReservationsCount: number;
  expiredConfirmedReservationsCount: number;
}

/**
 * Thực hiện dọn dẹp hệ thống theo lịch định kỳ (Idempotent & Chunked batches):
 * 1. Tự động xóa vĩnh viễn ảnh thẻ sinh viên quá 30 ngày sau khi duyệt hoặc từ chối (Tuân thủ PDP 2025).
 * 2. Tự động chuyển trạng thái tin hết hạn về 'expired' (tính theo múi giờ Asia/Ho_Chi_Minh).
 * 3. Tự động hủy các yêu cầu giữ chỗ pending quá 24 giờ và nâng waitlist sớm nhất lên với hạn mới 24 giờ.
 * 4. Tự động xử lý các giữ chỗ confirmed quá 72 giờ chưa hoàn tất (trả tin về active/expired, xóa confirmedBuyerId, đẩy waitlist).
 */
export async function runScheduledCleanup(now: Date = new Date()): Promise<CleanupResult> {
  const currentToday = todayVN(now);
  const nowIso = now.toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let deletedCardsCount = 0;
  let expiredListingsCount = 0;
  let expiredPendingReservationsCount = 0;
  let expiredConfirmedReservationsCount = 0;

  // --- 1. DỌN DẸP ẢNH THẺ SINH VIÊN QUÁ 30 NGÀY TỪ decidedAt ---
  try {
    const oldVerifsSnap = await adminDb
      .collection("verifications")
      .where("status", "in", ["approved", "rejected", "expired"])
      .where("decidedAt", "<=", thirtyDaysAgo)
      .get();

    for (const doc of oldVerifsSnap.docs) {
      const data = doc.data();
      const storagePath = data.cardStoragePath || data.cardImagePath;
      if (storagePath && !data.cardDeleted) {
        try {
          const fileRef = adminStorage.bucket().file(storagePath);
          await fileRef.delete({ ignoreNotFound: true });
          await doc.ref.update({
            cardDeleted: true,
            cardStoragePath: null,
            cardImagePath: null,
            cardImagePreviewUrl: null,
            cardAutoDeletedAt: FieldValue.serverTimestamp(),
          });
          deletedCardsCount++;
        } catch (err) {
          console.warn(`Lỗi xóa ảnh thẻ hồ sơ ${doc.id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("Lỗi khi quét ảnh thẻ quá hạn:", err);
  }

  // --- 2. HẾT HẠN CÁC TIN ĐĂNG ACTIVE QUÁ HẠN PASS (Asia/Ho_Chi_Minh) ---
  try {
    const overdueListingsSnap = await adminDb
      .collection("listings")
      .where("status", "==", "active")
      .where("passDeadline", "<", currentToday)
      .get();

    // Chia lô tối đa 400 thao tác cho mỗi batch (giới hạn Firestore là 500)
    const BATCH_SIZE = 400;
    const docs = overdueListingsSnap.docs;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();

      for (const doc of chunk) {
        batch.update(doc.ref, {
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Tạo thông báo cho chủ tin (idempotent)
        const sellerId = doc.data().sellerId;
        if (sellerId) {
          const notifRef = adminDb.collection("notifications").doc();
          batch.set(notifRef, {
            userId: sellerId,
            type: "listing_expired",
            title: "Tin đăng đã hết hạn",
            body: `Món đồ "${doc.data().title}" của bạn đã hết hạn hiển thị. Bạn có thể bấm Gia Hạn trong mục "Tin của tôi" để tiếp tục pass đồ nhé!`,
            targetId: doc.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        expiredListingsCount++;
      }

      await batch.commit();
    }
  } catch (err) {
    console.error("Lỗi khi quét tin đăng hết hạn:", err);
  }

  // --- 3. HẾT HẠN GIỮ CHỖ PENDING QUÁ 24 GIỜ VÀ NÂNG WAITLIST ---
  try {
    const expiredPendingSnap = await adminDb
      .collection("reservations")
      .where("status", "==", "pending")
      .where("expiresAt", "<=", nowIso)
      .get();

    for (const doc of expiredPendingSnap.docs) {
      const resData = doc.data();
      const listingId = resData.listingId;

      await doc.ref.update({
        status: "expired",
        cancelReason: "Hết hạn 24 giờ chờ người bán phản hồi",
        updatedAt: FieldValue.serverTimestamp(),
      });
      expiredPendingReservationsCount++;

      // Thông báo cho người mua
      await adminDb.collection("notifications").add({
        userId: resData.buyerId,
        type: "reservation_expired",
        title: "Yêu cầu giữ chỗ đã hết hạn",
        body: `Yêu cầu giữ chỗ món đồ "${resData.listingTitle}" của bạn đã quá hạn 24 giờ mà người bán chưa phản hồi.`,
        targetId: doc.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Kiểm tra và đẩy yêu cầu sớm nhất trong waitlist lên pending với HẠN MỚI 24H
      const waitlistedSnap = await adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("status", "==", "waitlisted")
        .orderBy("createdAt", "asc")
        .limit(1)
        .get();

      if (!waitlistedSnap.empty) {
        const nextDoc = waitlistedSnap.docs[0];
        const nextBuyerId = nextDoc.data().buyerId;
        const newExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

        await nextDoc.ref.update({
          status: "pending",
          expiresAt: newExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Báo cho người mua kế tiếp
        await adminDb.collection("notifications").add({
          userId: nextBuyerId,
          type: "waitlist_promoted",
          title: "Bạn đã được chuyển lên hàng đầu! 🎉",
          body: `Yêu cầu trước cho món đồ "${resData.listingTitle}" đã hết hạn. Yêu cầu của bạn đã được đưa lên cho người bán xác nhận trong 24 giờ tới.`,
          targetId: nextDoc.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
  } catch (err) {
    console.error("Lỗi khi xử lý giữ chỗ pending hết hạn:", err);
  }

  // --- 4. HẾT HẠN GIỮ CHỖ CONFIRMED QUÁ 72 GIỜ CHƯA HOÀN TẤT ---
  try {
    const expiredConfirmedSnap = await adminDb
      .collection("reservations")
      .where("status", "==", "confirmed")
      .where("holdExpiresAt", "<=", nowIso)
      .get();

    for (const doc of expiredConfirmedSnap.docs) {
      const resData = doc.data();
      const listingId = resData.listingId;

      await doc.ref.update({
        status: "expired",
        cancelReason: "Hết hạn giữ 72 giờ mà chưa hoàn tất giao dịch",
        updatedAt: FieldValue.serverTimestamp(),
      });
      expiredConfirmedReservationsCount++;

      // Kiểm tra tin đăng để mở lại active hoặc chuyển sang expired nếu quá hạn
      const listingRef = adminDb.collection("listings").doc(listingId);
      const listingSnap = await listingRef.get();
      if (listingSnap.exists) {
        const listingData = listingSnap.data() || {};
        const isOverdue = isPastDeadline((listingData.passDeadline as string) || "");

        await listingRef.update({
          status: isOverdue ? "expired" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // Khóa lại địa chỉ trong listingsPrivate
      const privateRef = adminDb.collection("listingsPrivate").doc(listingId);
      await privateRef.set(
        { confirmedBuyerId: FieldValue.delete() },
        { merge: true }
      );

      // Thông báo cho cả hai bên
      await adminDb.collection("notifications").add({
        userId: resData.buyerId,
        type: "reservation_expired",
        title: "Giao dịch giữ chỗ 72h đã hết hạn",
        body: `Thời gian giữ chỗ 72 giờ cho món đồ "${resData.listingTitle}" đã kết thúc.`,
        targetId: doc.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      await adminDb.collection("notifications").add({
        userId: resData.sellerId,
        type: "reservation_expired",
        title: "Hết hạn giữ chỗ 72h",
        body: `Món đồ "${resData.listingTitle}" đã hết hạn giữ 72 giờ và được mở lại để các bạn sinh viên khác tiếp tục xem.`,
        targetId: doc.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Đẩy waitlist lên pending
      const waitlistedSnap = await adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("status", "==", "waitlisted")
        .orderBy("createdAt", "asc")
        .limit(1)
        .get();

      if (!waitlistedSnap.empty) {
        const nextDoc = waitlistedSnap.docs[0];
        const newExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
        await nextDoc.ref.update({
          status: "pending",
          expiresAt: newExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  } catch (err) {
    console.error("Lỗi khi xử lý giữ chỗ confirmed hết hạn:", err);
  }

  return {
    deletedCardsCount,
    expiredListingsCount,
    expiredPendingReservationsCount,
    expiredConfirmedReservationsCount,
  };
}
