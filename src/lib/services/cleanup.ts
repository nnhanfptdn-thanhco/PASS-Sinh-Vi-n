import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";

export interface CleanupResult {
  deletedCardsCount: number;
  expiredListingsCount: number;
  expiredReservationsCount: number;
}

/**
 * Thực hiện dọn dẹp hệ thống theo lịch định kỳ:
 * 1. Tự động xóa vĩnh viễn ảnh thẻ sinh viên quá 30 ngày sau khi duyệt hoặc từ chối (Tuân thủ PDP 2025).
 * 2. Tự động chuyển trạng thái tin hết hạn về 'expired' (tính theo múi giờ Asia/Ho_Chi_Minh).
 * 3. Tự động hủy các lời giữ chỗ pending quá 24 giờ và đẩy yêu cầu tiếp theo trong waitlist lên.
 */
export async function runScheduledCleanup(): Promise<CleanupResult> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let deletedCardsCount = 0;
  let expiredListingsCount = 0;
  let expiredReservationsCount = 0;

  // 1. DỌN DẸP ẢNH THẺ SINH VIÊN QUÁ 30 NGÀY
  const oldVerifsSnap = await adminDb
    .collection("verifications")
    .where("status", "in", ["approved", "rejected"])
    .where("updatedAt", "<=", thirtyDaysAgo)
    .get();

  for (const doc of oldVerifsSnap.docs) {
    const data = doc.data();
    if (data.cardImagePath || data.cardImagePreviewUrl) {
      try {
        if (data.cardImagePath) {
          const fileRef = adminStorage.bucket().file(data.cardImagePath);
          await fileRef.delete({ ignoreNotFound: true });
        }
        await doc.ref.update({
          cardImagePath: null,
          cardImagePreviewUrl: null,
          cardAutoDeletedAt: FieldValue.serverTimestamp(),
        });
        deletedCardsCount++;
      } catch (err) {
        console.warn(`Lỗi xóa ảnh thẻ của hồ sơ ${doc.id}:`, err);
      }
    }
  }

  // 2. ẨN CÁC TIN ĐĂNG ĐÃ HẾT HẠN PASS (Asia/Ho_Chi_Minh)
  const todayStr = now.toISOString().split("T")[0];
  const activeListingsSnap = await adminDb
    .collection("listings")
    .where("status", "==", "active")
    .get();

  const listingBatch = adminDb.batch();
  for (const doc of activeListingsSnap.docs) {
    const data = doc.data();
    if (data.passDeadline && data.passDeadline < todayStr) {
      listingBatch.update(doc.ref, {
        status: "expired",
        expiredAt: FieldValue.serverTimestamp(),
      });
      expiredListingsCount++;
    }
  }
  if (expiredListingsCount > 0) {
    await listingBatch.commit();
  }

  // 3. TỰ HỦY LỜI GIỮ CHỖ QUÁ 24 GIỜ VÀ NÂNG WAITLIST
  const expiredResSnap = await adminDb
    .collection("reservations")
    .where("status", "==", "pending")
    .where("createdAt", "<=", twentyFourHoursAgo)
    .get();

  for (const doc of expiredResSnap.docs) {
    const resData = doc.data();
    await doc.ref.update({
      status: "expired",
      updatedAt: FieldValue.serverTimestamp(),
    });
    expiredReservationsCount++;

    // Kiểm tra và đẩy yêu cầu sớm nhất trong waitlist lên
    const waitlistedSnap = await adminDb
      .collection("reservations")
      .where("listingId", "==", resData.listingId)
      .where("status", "==", "waitlisted")
      .orderBy("createdAt", "asc")
      .limit(1)
      .get();

    if (!waitlistedSnap.empty) {
      const nextDoc = waitlistedSnap.docs[0];
      await nextDoc.ref.update({
        status: "pending",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return {
    deletedCardsCount,
    expiredListingsCount,
    expiredReservationsCount,
  };
}
