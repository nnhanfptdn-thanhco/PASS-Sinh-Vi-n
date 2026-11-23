import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { todayVN, isPastDeadline } from "@/lib/utils/date";
import { purgeUserData } from "@/lib/services/account-purge";

export interface CleanupResult {
  deletedCardsCount: number;
  expiredListingsCount: number;
  expiredPendingReservationsCount: number;
  expiredConfirmedReservationsCount: number;
  purgedPendingAccountsCount?: number;
}

/**
 * Helper xử lý hết hạn giữ chỗ theo transaction nguyên tử (F05)
 */
async function expireReservationTx(
  resId: string,
  kind: "pending" | "confirmed",
  now: Date
): Promise<boolean> {
  const resRef = adminDb.collection("reservations").doc(resId);

  return await adminDb.runTransaction(async (tx) => {
    // ===== READ PHASE =====
    const resSnap = await tx.get(resRef);
    if (!resSnap.exists) return false;
    const res = resSnap.data()!;
    if (res.status !== kind) return false; // Idempotent: đã bị xử lý ở nơi khác

    const listingRef = adminDb.collection("listings").doc(res.listingId);
    const privateRef = adminDb.collection("listingsPrivate").doc(res.listingId);
    const listingSnap = await tx.get(listingRef);

    const waitSnap = await tx.get(
      adminDb
        .collection("reservations")
        .where("listingId", "==", res.listingId)
        .where("status", "==", "waitlisted")
        .orderBy("createdAt", "asc")
        .limit(1)
    );

    // ===== WRITE PHASE =====
    tx.update(resRef, {
      status: "expired",
      cancelReason:
        kind === "pending"
          ? "Hết hạn 24 giờ chờ người bán phản hồi"
          : "Hết hạn giữ 72 giờ mà chưa hoàn tất giao dịch",
      updatedAt: FieldValue.serverTimestamp(),
    });

    const lst = listingSnap.exists ? listingSnap.data()! : {};

    if (kind === "confirmed") {
      // GUARD: Chỉ mở lại active/expired nếu tin đang thực sự là "reserved", không ghi đè "sold" hay "hidden_by_admin"
      if (listingSnap.exists && lst.status === "reserved") {
        tx.update(listingRef, {
          status: isPastDeadline((lst.passDeadline as string) || "", now) ? "expired" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(privateRef, { confirmedBuyerId: FieldValue.delete() }, { merge: true });
    }

    const notif = (userId: string, type: string, title: string, body: string, targetId: string) => {
      const nRef = adminDb.collection("notifications").doc();
      tx.set(nRef, {
        userId,
        type,
        title,
        body,
        targetId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    };

    notif(
      res.buyerId,
      "reservation_expired",
      kind === "pending" ? "Yêu cầu giữ chỗ đã hết hạn" : "Giao dịch giữ chỗ 72h đã hết hạn",
      `Yêu cầu/giữ chỗ món đồ "${res.listingTitle}" đã hết hạn.`,
      resId
    );

    if (kind === "confirmed") {
      notif(
        res.sellerId,
        "reservation_expired",
        "Hết hạn giữ chỗ 72h",
        `Món đồ "${res.listingTitle}" đã hết hạn giữ 72 giờ và được mở lại.`,
        resId
      );
    }

    // Đẩy người ở waitlist lên pending nếu tin vẫn khả dụng (active hoặc vừa mở lại từ reserved)
    const isListingAvailable =
      listingSnap.exists &&
      (lst.status === "active" || (kind === "confirmed" && lst.status === "reserved"));

    if (!waitSnap.empty && isListingAvailable) {
      const next = waitSnap.docs[0];
      tx.update(next.ref, {
        status: "pending",
        expiresAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      notif(
        next.data().buyerId,
        "waitlist_promoted",
        "Bạn đã được chuyển lên hàng đầu! 🎉",
        `Yêu cầu của bạn cho món đồ "${res.listingTitle}" đã được đưa lên cho người bán xác nhận trong 24 giờ tới.`,
        next.id
      );
    }

    return true;
  });
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

  // --- 1. DỌN DẸP ẢNH THẺ SINH VIÊN QUÁ 30 NGÀY DÙNG cardPurgeAt ---
  try {
    let oldVerifsSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
      oldVerifsSnap = await adminDb
        .collection("verifications")
        .where("cardPurgeAt", "<=", now)
        .orderBy("cardPurgeAt", "asc")
        .limit(200)
        .get();
    } catch {
      // Fallback quét cho hồ sơ cũ chưa có field cardPurgeAt
      oldVerifsSnap = await adminDb
        .collection("verifications")
        .where("status", "in", ["approved", "rejected", "expired"])
        .where("decidedAt", "<=", thirtyDaysAgo)
        .limit(200)
        .get();
    }

    for (const doc of oldVerifsSnap.docs) {
      const data = doc.data();
      const storagePath = data.cardStoragePath || data.cardImagePath;
      if (typeof storagePath === "string" && storagePath.length > 0) {
        try {
          if (storagePath.startsWith("private/cards/")) {
            await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
          }
          await doc.ref.update({
            cardDeleted: true,
            cardStoragePath: null,
            cardImagePath: null,
            cardImagePreviewUrl: null,
            cardPurgeAt: FieldValue.delete(),
            cardDeletePending: FieldValue.delete(),
            cardAutoDeletedAt: FieldValue.serverTimestamp(),
          });
          deletedCardsCount++;
        } catch (err) {
          console.warn(`Lỗi xóa ảnh thẻ hồ sơ ${doc.id}:`, err);
        }
      } else if (data.cardPurgeAt) {
        await doc.ref.update({ cardPurgeAt: FieldValue.delete() }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("Lỗi khi quét ảnh thẻ quá hạn:", err);
  }

  // --- 2. HẾT HẠN CÁC TIN ĐĂNG ACTIVE QUÁ HẠN PASS (Asia/Ho_Chi_Minh) ---
  try {
    let docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const overdueListingsSnap = await adminDb
        .collection("listings")
        .where("status", "==", "active")
        .where("passDeadline", "<", currentToday)
        .limit(1000)
        .get();
      docs = overdueListingsSnap.docs;
    } catch (idxErr: unknown) {
      const errStr = String(idxErr);
      if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
        const snap = await adminDb
          .collection("listings")
          .where("status", "==", "active")
          .limit(1000)
          .get();
        docs = snap.docs.filter((d) => {
          const dl = (d.data().passDeadline as string) || "";
          return dl && dl < currentToday;
        });
      } else {
        throw idxErr;
      }
    }

    // Mỗi doc có 2 ghi (update tin + insert notification) => BATCH_SIZE = 200 đảm bảo 400 <= 500 thao tác
    const BATCH_SIZE = 200;

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();

      for (const doc of chunk) {
        batch.update(doc.ref, {
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

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
    let pendingDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const expiredPendingSnap = await adminDb
        .collection("reservations")
        .where("status", "==", "pending")
        .where("expiresAt", "<=", nowIso)
        .limit(200)
        .get();
      pendingDocs = expiredPendingSnap.docs;
    } catch (idxErr: unknown) {
      const errStr = String(idxErr);
      if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
        const snap = await adminDb
          .collection("reservations")
          .where("status", "==", "pending")
          .limit(200)
          .get();
        pendingDocs = snap.docs.filter((d) => {
          const exp = (d.data().expiresAt as string) || "";
          return exp && exp <= nowIso;
        });
      } else {
        throw idxErr;
      }
    }

    for (const doc of pendingDocs) {
      try {
        const success = await expireReservationTx(doc.id, "pending", now);
        if (success) expiredPendingReservationsCount++;
      } catch (err) {
        console.warn(`Lỗi khi xử lý giữ chỗ pending ${doc.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Lỗi khi xử lý giữ chỗ pending hết hạn:", err);
  }

  // --- 4. HẾT HẠN GIỮ CHỖ CONFIRMED QUÁ 72 GIỜ CHƯA HOÀN TẤT ---
  try {
    let confirmedDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const expiredConfirmedSnap = await adminDb
        .collection("reservations")
        .where("status", "==", "confirmed")
        .where("holdExpiresAt", "<=", nowIso)
        .limit(200)
        .get();
      confirmedDocs = expiredConfirmedSnap.docs;
    } catch (idxErr: unknown) {
      const errStr = String(idxErr);
      if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
        const snap = await adminDb
          .collection("reservations")
          .where("status", "==", "confirmed")
          .limit(200)
          .get();
        confirmedDocs = snap.docs.filter((d) => {
          const holdExp = (d.data().holdExpiresAt as string) || "";
          return holdExp && holdExp <= nowIso;
        });
      } else {
        throw idxErr;
      }
    }

    for (const doc of confirmedDocs) {
      try {
        const success = await expireReservationTx(doc.id, "confirmed", now);
        if (success) expiredConfirmedReservationsCount++;
      } catch (err) {
        console.warn(`Lỗi khi xử lý giữ chỗ confirmed ${doc.id}:`, err);
      }
    }
  } catch (err) {
    console.error("Lỗi khi xử lý giữ chỗ confirmed hết hạn:", err);
  }

  // --- 5. SWEEPER: HOÀN TẤT XÓA TÀI KHOẢN TREO QUÁ 10 PHÚT (IDEMPOTENT & FAIL-CLOSED) ---
  let purgedPendingAccountsCount = 0;
  try {
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const pendingSnap = await adminDb
      .collection("pendingDeletions")
      .where("startedAt", "<=", tenMinAgo)
      .limit(50)
      .get();

    for (const doc of pendingSnap.docs) {
      const uid = doc.id;
      const hash = (doc.data()?.studentIdHash as string) || null;
      try {
        await purgeUserData(uid, hash);
        purgedPendingAccountsCount++;
      } catch (pErr) {
        console.error(`[CleanupSweeper] Lỗi khi dọn tài khoản treo ${uid}:`, pErr);
      }
    }
  } catch (err) {
    console.error("Lỗi sweeper pendingDeletions:", err);
  }

  return {
    deletedCardsCount,
    expiredListingsCount,
    expiredPendingReservationsCount,
    expiredConfirmedReservationsCount,
    purgedPendingAccountsCount,
  };
}
