import crypto from "crypto";
import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { todayVN, isPastDeadline } from "@/lib/utils/date";
import { purgeUserData } from "@/lib/services/account-purge";
import { setVerifiedClaim, clearAdminClaim } from "@/lib/server/claims";
import {
  acquireDocLease,
  computeBackoffWithJitter,
  extractErrorCode,
  recordDeadLetterAlert,
} from "@/lib/server/dlq";
import { processPendingListingOperationJobs } from "@/lib/server/listing-jobs";
import { redactErrorMessage } from "@/lib/server/request-utils";
import {
  activeReservationLockRef,
  listingReservationStatsRef,
  sellerListingStatsRef,
  sellerTitleLockRef,
  userReservationStatsRef,
} from "@/lib/server/stats";
import { normalizeVi } from "@/lib/search/normalize";

export interface CleanupPhaseError {
  phase: string;
  code: string;
  message: string;
}

export interface CleanupResult {
  deletedCardsCount: number;
  expiredListingsCount: number;
  expiredPendingReservationsCount: number;
  expiredConfirmedReservationsCount: number;
  purgedPendingAccountsCount: number;
  claimsSynced: number;
  storageJobsProcessed: number;
  listingJobsProcessed: number;
  orphanDraftsDeleted: number;
  orphanChatFilesDeleted: number;
  retentionRecordsPurged: number;
  errors: CleanupPhaseError[];
  partialFailure: boolean;
}

/**
 * Helper xử lý hết hạn giữ chỗ theo transaction nguyên tử (F05 + stats/locks)
 */
async function expireReservationTx(
  resId: string,
  kind: "pending" | "confirmed",
  now: Date
): Promise<boolean> {
  const resRef = adminDb.collection("reservations").doc(resId);

  return await adminDb.runTransaction(async (tx) => {
    const resSnap = await tx.get(resRef);
    if (!resSnap.exists) return false;
    const res = resSnap.data()!;
    if (res.status !== kind) return false;

    const listingId = String(res.listingId || "");
    const buyerId = String(res.buyerId || "");
    const sellerId = String(res.sellerId || "");
    const listingRef = adminDb.collection("listings").doc(listingId);
    const privateRef = adminDb.collection("listingsPrivate").doc(listingId);
    const listingResStatRef = listingReservationStatsRef(listingId);
    const buyerResStatRef = userReservationStatsRef(buyerId);
    const sellerStatRef = sellerId ? sellerListingStatsRef(sellerId) : null;

    const [listingSnap, waitSnap, listingResStatSnap, buyerResStatSnap, sellerStatSnap] =
      await Promise.all([
        tx.get(listingRef),
        tx.get(
          adminDb
            .collection("reservations")
            .where("listingId", "==", listingId)
            .where("status", "==", "waitlisted")
            .orderBy("createdAt", "asc")
            .limit(1)
        ),
        listingId ? tx.get(listingResStatRef) : Promise.resolve(null),
        buyerId ? tx.get(buyerResStatRef) : Promise.resolve(null),
        kind === "confirmed" && sellerStatRef ? tx.get(sellerStatRef) : Promise.resolve(null),
      ]);

    const lst = listingSnap.exists ? listingSnap.data()! : {};
    const titleNormalized = String(
      lst.titleNormalized || (lst.title ? normalizeVi(String(lst.title)) : "")
    );
    const titleLockRef =
      kind === "confirmed" && sellerId && titleNormalized
        ? sellerTitleLockRef(sellerId, titleNormalized)
        : null;
    const nextWaitBuyerId = !waitSnap.empty ? String(waitSnap.docs[0].data()?.buyerId || "") : "";

    const [titleLockSnap, nextWaitBuyerStatSnap] = await Promise.all([
      titleLockRef ? tx.get(titleLockRef) : Promise.resolve(null),
      nextWaitBuyerId && nextWaitBuyerId !== buyerId
        ? tx.get(userReservationStatsRef(nextWaitBuyerId))
        : Promise.resolve(null),
    ]);

    const curListingPending = listingResStatSnap?.exists
      ? Math.max(0, Number(listingResStatSnap.data()?.pendingCount ?? 0))
      : kind === "pending"
      ? 1
      : 0;
    const curBuyerPending = buyerResStatSnap?.exists
      ? Math.max(0, Number(buyerResStatSnap.data()?.pendingCount ?? 0))
      : kind === "pending"
      ? 1
      : 0;

    tx.update(resRef, {
      status: "expired",
      cancelReason:
        kind === "pending"
          ? "Hết hạn 24 giờ chờ người bán phản hồi"
          : "Hết hạn giữ 72 giờ mà chưa hoàn tất giao dịch",
      expiresAt: FieldValue.delete(),
      holdExpiresAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Luôn giải phóng activeReservationLock cho cả pending và confirmed hết hạn
    if (listingId && buyerId) {
      tx.delete(activeReservationLockRef(listingId, buyerId));
    }

    let nextListingPending = curListingPending;
    if (kind === "pending" && listingId && buyerId) {
      nextListingPending = Math.max(0, curListingPending - 1);
      tx.set(
        buyerResStatRef,
        { pendingCount: Math.max(0, curBuyerPending - 1), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    const listingPassExpired = isPastDeadline((lst.passDeadline as string) || "", now);

    if (kind === "confirmed") {
      if (listingSnap.exists && lst.status === "reserved") {
        tx.update(listingRef, {
          status: listingPassExpired ? "expired" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (listingPassExpired && sellerStatRef) {
          const curSellerActive = sellerStatSnap?.exists
            ? Math.max(0, Number(sellerStatSnap.data()?.activeCount ?? 0))
            : 0;
          tx.set(
            sellerStatRef,
            { activeCount: Math.max(0, curSellerActive - 1), updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          if (titleLockRef && titleLockSnap?.exists && titleLockSnap.data()?.listingId === listingId) {
            tx.delete(titleLockRef);
          }
        }
      }
      tx.set(
        privateRef,
        {
          confirmedBuyerId: FieldValue.delete(),
          confirmedReservationId: FieldValue.delete(),
          confirmedUntil: FieldValue.delete(),
        },
        { merge: true }
      );
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
        listingPassExpired
          ? `Món đồ "${res.listingTitle}" đã hết hạn giữ 72 giờ và chuyển sang hết hạn đăng.`
          : `Món đồ "${res.listingTitle}" đã hết hạn giữ 72 giờ và được mở lại.`,
        resId
      );
    }

    const isListingAvailable =
      listingSnap.exists &&
      !listingPassExpired &&
      (lst.status === "active" || (kind === "confirmed" && lst.status === "reserved"));

    if (!waitSnap.empty && isListingAvailable) {
      const next = waitSnap.docs[0];
      const nextBuyerId = nextWaitBuyerId;
      tx.update(next.ref, {
        status: "pending",
        expiresAt: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        holdExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      nextListingPending += 1;
      if (listingId && nextBuyerId) {
        tx.set(activeReservationLockRef(listingId, nextBuyerId), {
          active: true,
          reservationId: next.id,
          listingId,
          buyerId: nextBuyerId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        const nextPrevCount = nextWaitBuyerStatSnap?.exists
          ? Math.max(0, Number(nextWaitBuyerStatSnap.data()?.pendingCount ?? 0))
          : 0;
        tx.set(
          userReservationStatsRef(nextBuyerId),
          { pendingCount: nextPrevCount + 1, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      notif(
        nextBuyerId,
        "waitlist_promoted",
        "Bạn đã được chuyển lên hàng đầu! 🎉",
        `Yêu cầu của bạn cho món đồ "${res.listingTitle}" đã được đưa lên cho người bán xác nhận trong 24 giờ tới.`,
        next.id
      );
    } else if (!waitSnap.empty && listingPassExpired) {
      const next = waitSnap.docs[0];
      const nextBuyerId = nextWaitBuyerId;
      tx.update(next.ref, {
        status: "cancelled",
        cancelledBy: "system",
        cancelReason: "Tin đăng đã quá hạn pass đồ",
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (listingId && nextBuyerId) {
        tx.delete(activeReservationLockRef(listingId, nextBuyerId));
      }
    }

    if (listingId && nextListingPending !== curListingPending) {
      tx.set(
        listingResStatRef,
        { pendingCount: Math.max(0, nextListingPending), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    return true;
  });
}

function recordError(errors: CleanupPhaseError[], phase: string, err: unknown): void {
  errors.push({
    phase,
    code: extractErrorCode(err),
    message: redactErrorMessage(err),
  });
}

/**
 * Chu kỳ dọn dẹp hệ thống bền vững:
 * 1) Xóa ảnh thẻ quá 30 ngày (`cardPurgeAt <= now`)
 * 2) Hết hạn tin đăng quá `passDeadline` (<= 400 writes/batch)
 * 3) Hết hạn giữ chỗ `pending` (>24h) + nâng waitlist
 * 4) Hết hạn giữ chỗ `confirmed` (>72h)
 * 5) Sweeper `pendingDeletions` (`deadLetter == false && nextAttemptAt <= now` TRƯỚC `.limit()`, lease + DLQ alerts)
 * 6) Retry `claimsSyncJobs`
 * 7) Retry `storageCleanupJobs`
 * 8) Retry `listingOperationJobs`
 * 9) Xóa draft `uploadSessions` quá hạn không được claim
 * 10) Quét phân trang giới hạn tìm file mồ côi trong `private/chats/`
 * 11) Xóa bản ghi retention anonymize hết hạn 90 ngày (`retentionPurgeAt <= now`)
 */
export async function runScheduledCleanup(now: Date = new Date()): Promise<CleanupResult> {
  const currentToday = todayVN(now);
  const nowIso = now.toISOString();
  const leaseOwner = `cron_cleanup_${crypto.randomUUID().slice(0, 8)}`;

  let deletedCardsCount = 0;
  let expiredListingsCount = 0;
  let expiredPendingReservationsCount = 0;
  let expiredConfirmedReservationsCount = 0;
  let purgedPendingAccountsCount = 0;
  let claimsSynced = 0;
  let storageJobsProcessed = 0;
  let listingJobsProcessed = 0;
  let orphanDraftsDeleted = 0;
  let orphanChatFilesDeleted = 0;
  let retentionRecordsPurged = 0;
  const errors: CleanupPhaseError[] = [];

  // --- 1. DỌN ẢNH THẺ QUÁ HẠN 30 NGÀY ---
  try {
    const oldVerifsSnap = await adminDb
      .collection("verifications")
      .where("cardPurgeAt", "<=", now)
      .orderBy("cardPurgeAt", "asc")
      .limit(200)
      .get();

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
          recordError(errors, "card_purge_item", err);
          await doc.ref.update({ cardDeletePending: true }).catch(() => undefined);
        }
      } else if (data.cardPurgeAt) {
        await doc.ref.update({ cardPurgeAt: FieldValue.delete() }).catch(() => undefined);
      }
    }
  } catch (err) {
    recordError(errors, "card_purge", err);
  }

  // --- 2. HẾT HẠN TIN ĐĂNG QUÁ PASSDEADLINE ---
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

    // Tối đa 4 writes/doc -> BATCH_SIZE = 100 => <= 400 <= 500
    const BATCH_SIZE = 100;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const chunk = docs.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();

      for (const doc of chunk) {
        const lData = doc.data();
        batch.update(doc.ref, {
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const sellerId = lData.sellerId as string | undefined;
        if (sellerId) {
          batch.set(
            sellerListingStatsRef(sellerId),
            {
              activeCount: FieldValue.increment(-1),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          const titleStr = String(lData.titleNormalized || (lData.title ? normalizeVi(String(lData.title)) : ""));
          if (titleStr) {
            batch.delete(sellerTitleLockRef(sellerId, titleStr));
          }
          const notifRef = adminDb.collection("notifications").doc();
          batch.set(notifRef, {
            userId: sellerId,
            type: "listing_expired",
            title: "Tin đăng đã hết hạn",
            body: `Món đồ "${lData.title}" của bạn đã hết hạn hiển thị. Bạn có thể bấm Gia Hạn trong mục "Tin của tôi" để tiếp tục pass đồ nhé!`,
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
    recordError(errors, "expire_listings", err);
  }

  // --- 3. HẾT HẠN GIỮ CHỖ PENDING QUÁ 24H ---
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
        recordError(errors, "expire_pending_reservation_item", err);
      }
    }
  } catch (err) {
    recordError(errors, "expire_pending_reservations", err);
  }

  // --- 4. HẾT HẠN GIỮ CHỖ CONFIRMED QUÁ 72H ---
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
        recordError(errors, "expire_confirmed_reservation_item", err);
      }
    }
  } catch (err) {
    recordError(errors, "expire_confirmed_reservations", err);
  }

  // --- 5. SWEEPER XÓA TÀI KHOẢN TREO (deadLetter == false BEFORE limit + lease + backoff + DLQ) ---
  try {
    let pendingAccDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const pendingSnap = await adminDb
        .collection("pendingDeletions")
        .where("deadLetter", "==", false)
        .where("nextAttemptAt", "<=", now)
        .orderBy("nextAttemptAt", "asc")
        .limit(50)
        .get();
      pendingAccDocs = pendingSnap.docs;
    } catch (idxErr: unknown) {
      const errStr = String(idxErr);
      if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
        const snap = await adminDb
          .collection("pendingDeletions")
          .where("deadLetter", "==", false)
          .limit(50)
          .get();
        pendingAccDocs = snap.docs;
      } else {
        throw idxErr;
      }
    }

    for (const doc of pendingAccDocs) {
      const preData = doc.data() || {};
      if (preData.status === "freezing") {
        const startedRaw = preData.startedAt as { toMillis?: () => number } | Date | undefined;
        const startedMs =
          startedRaw instanceof Date
            ? startedRaw.getTime()
            : typeof startedRaw?.toMillis === "function"
            ? startedRaw.toMillis()
            : now.getTime();
        if (now.getTime() - startedMs < 2 * 60 * 1000) {
          continue; // Đang trong cổng kiểm tra freeze-gate của /api/account/delete
        }
      }

      const lease = await acquireDocLease(doc.ref, leaseOwner, 5 * 60 * 1000);
      if (!lease.acquired || !lease.data) continue;

      const data = lease.data;
      const uid = doc.id;
      const hash = (data.studentIdHash as string) || null;
      const currentAttempts = typeof data.attempts === "number" ? data.attempts : 0;
      const nextAttempts = currentAttempts + 1;

      try {
        await purgeUserData(uid, hash);
        purgedPendingAccountsCount++;
      } catch (pErr) {
        const isDeadLetter = nextAttempts >= 3;
        const errMsg = redactErrorMessage(pErr);
        recordError(errors, "purge_accounts_item", pErr);
        await doc.ref
          .update({
            attempts: nextAttempts,
            lastAttemptAt: new Date(),
            lastError: errMsg,
            errorCode: extractErrorCode(pErr),
            step: String(data.status || "purgeUserData"),
            deadLetter: isDeadLetter,
            status: isDeadLetter ? "dead_letter" : "pending_retry",
            nextAttemptAt: isDeadLetter ? null : computeBackoffWithJitter(nextAttempts, 60_000),
            leaseOwner: null,
            leaseUntil: null,
          })
          .catch(() => {});

        if (isDeadLetter) {
          await recordDeadLetterAlert({
            sourceCollection: "pendingDeletions",
            sourceDocId: uid,
            step: String(data.status || "purgeUserData"),
            error: pErr,
            attempts: nextAttempts,
            dataToResume: { userId: uid, hasStudentIdHash: Boolean(hash) },
          });
        }
      }
    }
  } catch (err) {
    recordError(errors, "purge_accounts", err);
  }

  // --- 6. RETRY CLAIMS SYNC JOBS ---
  try {
    let claimDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const snap = await adminDb
        .collection("claimsSyncJobs")
        .where("deadLetter", "==", false)
        .where("nextAttemptAt", "<=", now)
        .orderBy("nextAttemptAt", "asc")
        .limit(30)
        .get();
      claimDocs = snap.docs;
    } catch (idxErr: unknown) {
      const errStr = String(idxErr);
      if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
        const snap = await adminDb
          .collection("claimsSyncJobs")
          .where("deadLetter", "==", false)
          .limit(30)
          .get();
        claimDocs = snap.docs;
      } else {
        throw idxErr;
      }
    }

    for (const doc of claimDocs) {
      const d = doc.data() || {};
      const uid = String(d.uid || doc.id);
      const isClearAdmin = d.clearAdmin === true;
      const targetVerified = Boolean(d.targetVerified);
      const ok = isClearAdmin
        ? await clearAdminClaim(uid)
        : await setVerifiedClaim(uid, targetVerified);
      if (ok) {
        claimsSynced++;
      } else {
        const nextAttempts = (typeof d.attempts === "number" ? d.attempts : 0) + 1;
        if (nextAttempts >= 5) {
          await recordDeadLetterAlert({
            sourceCollection: "claimsSyncJobs",
            sourceDocId: doc.id,
            step: isClearAdmin ? "clearAdminClaim" : "setVerifiedClaim",
            error: new Error(String(d.lastError || "CLAIM_SYNC_FAILED")),
            attempts: nextAttempts,
            dataToResume: { uid, targetVerified, clearAdmin: isClearAdmin },
          });
        }
      }
    }
  } catch (err) {
    recordError(errors, "claims_sync", err);
  }

  // --- 7. RETRY STORAGE CLEANUP JOBS ---
  try {
    let storageDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const snap = await adminDb
        .collection("storageCleanupJobs")
        .where("deadLetter", "==", false)
        .where("nextAttemptAt", "<=", now)
        .orderBy("nextAttemptAt", "asc")
        .limit(30)
        .get();
      storageDocs = snap.docs;
    } catch (idxErr: unknown) {
      const errStr = String(idxErr);
      if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
        const snap = await adminDb
          .collection("storageCleanupJobs")
          .where("deadLetter", "==", false)
          .limit(30)
          .get();
        storageDocs = snap.docs;
      } else {
        throw idxErr;
      }
    }

    const bucket = adminStorage.bucket();
    for (const doc of storageDocs) {
      const lease = await acquireDocLease(doc.ref, leaseOwner, 5 * 60 * 1000);
      if (!lease.acquired || !lease.data) continue;
      const d = lease.data;
      const targetPath = String(d.targetPath || "");
      const kind = String(d.kind || "object");
      const nextAttempts = (typeof d.attempts === "number" ? d.attempts : 0) + 1;

      try {
        if (targetPath) {
          if (kind === "prefix") {
            await bucket.deleteFiles({ prefix: targetPath, force: true });
            const [remaining] = await bucket.getFiles({ prefix: targetPath, maxResults: 1 });
            if (remaining.length > 0) {
              throw new Error("STORAGE_PREFIX_NOT_EMPTY");
            }
          } else {
            await bucket.file(targetPath).delete({ ignoreNotFound: true });
          }
        }
        await doc.ref.delete();
        storageJobsProcessed++;
      } catch (sErr) {
        const isDeadLetter = nextAttempts >= 5;
        recordError(errors, "storage_cleanup_item", sErr);
        await doc.ref
          .update({
            attempts: nextAttempts,
            lastAttemptAt: new Date(),
            lastError: redactErrorMessage(sErr),
            errorCode: extractErrorCode(sErr),
            deadLetter: isDeadLetter,
            status: isDeadLetter ? "dead_letter" : "pending",
            nextAttemptAt: isDeadLetter ? null : computeBackoffWithJitter(nextAttempts, 120_000),
            leaseOwner: null,
            leaseUntil: null,
          })
          .catch(() => {});

        if (isDeadLetter) {
          await recordDeadLetterAlert({
            sourceCollection: "storageCleanupJobs",
            sourceDocId: doc.id,
            step: `storage_${kind}`,
            error: sErr,
            attempts: nextAttempts,
            dataToResume: { kind, targetPath },
          });
        }
      }
    }
  } catch (err) {
    recordError(errors, "storage_cleanup_jobs", err);
  }

  // --- 8. RETRY LISTING OPERATION JOBS ---
  try {
    const jobRes = await processPendingListingOperationJobs(now);
    listingJobsProcessed += jobRes.completedCount;
    if (jobRes.failedCount > 0) {
      errors.push({
        phase: "listing_operation_jobs",
        code: "LISTING_JOB_RETRY_FAILED",
        message: `${jobRes.failedCount} tác vụ tin đăng cần thử lại.`,
      });
    }
  } catch (err) {
    recordError(errors, "listing_operation_jobs", err);
  }

  // --- 9. DỌN UPLOAD SESSIONS QUÁ HẠN KHÔNG ĐƯỢC CLAIM (KHÔNG XÓA ẢNH ĐANG THAM CHIẾU) ---
  try {
    const expiredSessionsSnap = await adminDb
      .collection("uploadSessions")
      .where("status", "in", ["pending", "finalized"])
      .where("expiresAt", "<=", now)
      .limit(50)
      .get();

    const bucket = adminStorage.bucket();
    for (const sDoc of expiredSessionsSnap.docs) {
      const sData = sDoc.data() || {};
      if (sData.claimed === true) continue;

      const ownerUid = String(sData.ownerUid || "");
      const kind = String(sData.kind || "");
      const allowedPaths = Array.isArray(sData.allowedPaths) ? (sData.allowedPaths as string[]) : [];

      let referenced = false;
      if (kind === "listing" && ownerUid) {
        const listingDoc = await adminDb.collection("listings").doc(`${ownerUid}_${sDoc.id}`).get();
        if (listingDoc.exists) referenced = true;
      } else if (kind === "card" && ownerUid) {
        const vDoc = await adminDb.collection("verifications").doc(ownerUid).get();
        if (vDoc.exists && allowedPaths.includes(String(vDoc.data()?.cardStoragePath || ""))) {
          referenced = true;
        }
      } else if (kind === "avatar" && ownerUid) {
        const uDoc = await adminDb.collection("users").doc(ownerUid).get();
        const photoUrl = uDoc.exists ? String(uDoc.data()?.photoURL || "") : "";
        if (
          photoUrl &&
          allowedPaths.some(
            (p) => photoUrl.includes(encodeURIComponent(p)) || photoUrl.includes(p)
          )
        ) {
          referenced = true;
        }
      } else if (kind === "chat" && typeof sData.targetId === "string" && sData.targetId) {
        const convRef = adminDb.collection("conversations").doc(sData.targetId);
        for (const p of allowedPaths) {
          const msgMatch = await convRef
            .collection("messages")
            .where("attachmentPath", "==", p)
            .limit(1)
            .get();
          if (!msgMatch.empty) {
            referenced = true;
            break;
          }
        }
      }

      if (referenced) {
        await sDoc.ref.update({
          claimed: true,
          status: "claimed",
          updatedAt: FieldValue.serverTimestamp(),
        });
        continue;
      }

      for (const path of allowedPaths) {
        await bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined);
      }
      await sDoc.ref.delete();
      orphanDraftsDeleted++;
    }
  } catch (err) {
    // Non-critical if index not deployed yet or minimal test mock
    const errStr = String(err);
    if (!errStr.includes("requires an index") && !errStr.includes("FAILED_PRECONDITION")) {
      recordError(errors, "orphan_upload_sessions", err);
    }
  }

  // --- 10. SWEEPER GIỚI HẠN TRANG TÌM TỆP MỒ CÔI TRONG private/chats/ ---
  try {
    const bucket = adminStorage.bucket();
    if (typeof bucket.getFiles === "function") {
      const cursorRef = adminDb.collection("systemState").doc("chatOrphanCursor");
      const cursorSnap = await cursorRef.get();
      let pageToken = cursorSnap.exists
        ? (cursorSnap.data()?.pageToken as string | undefined)
        : undefined;

      const oneDayAgoMs = now.getTime() - 24 * 60 * 60 * 1000;
      let nextToken: string | undefined;

      for (let page = 0; page < 2; page++) {
        const [files, nextQuery] = await bucket.getFiles({
          prefix: "private/chats/",
          maxResults: 50,
          ...(pageToken ? { pageToken } : {}),
        });
        if (!files || files.length === 0) {
          nextToken = undefined;
          break;
        }

        for (const file of files) {
          if (file.name.endsWith("/")) continue;
          const createdMs = file.metadata?.timeCreated
            ? new Date(file.metadata.timeCreated).getTime()
            : now.getTime();
          if (createdMs > oneDayAgoMs) continue;

          const parts = file.name.split("/");
          const convId = parts[2];
          if (!convId) continue;

          const convSnap = await adminDb.collection("conversations").doc(convId).get();
          if (!convSnap.exists) {
            await file.delete({ ignoreNotFound: true }).catch(() => undefined);
            orphanChatFilesDeleted++;
          } else {
            const msgMatch = await convSnap.ref
              .collection("messages")
              .where("attachmentPath", "==", file.name)
              .limit(1)
              .get();
            if (msgMatch.empty) {
              await file.delete({ ignoreNotFound: true }).catch(() => undefined);
              orphanChatFilesDeleted++;
            }
          }
        }

        if (nextQuery && typeof nextQuery.pageToken === "string") {
          pageToken = nextQuery.pageToken;
          nextToken = nextQuery.pageToken;
        } else {
          nextToken = undefined;
          break;
        }
      }

      await cursorRef
        .set(
          {
            pageToken: nextToken || null,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        .catch(() => undefined);
    }
  } catch (err) {
    recordError(errors, "orphan_chat_files", err);
  }

  // --- 11. XÓA BẢN GHI ANONYMIZED ĐÃ HẾT HẠN RETENTION 90 NGÀY ---
  for (const colName of ["reservations", "reviews", "reports", "appeals"] as const) {
    try {
      const snap = await adminDb
        .collection(colName)
        .where("retentionPurgeAt", "<=", now)
        .limit(200)
        .get();
      if (!snap.empty) {
        const batch = adminDb.batch();
        for (const d of snap.docs) {
          batch.delete(d.ref);
          retentionRecordsPurged++;
        }
        await batch.commit();
      }
    } catch (err) {
      const errStr = String(err);
      if (!errStr.includes("requires an index") && !errStr.includes("FAILED_PRECONDITION")) {
        recordError(errors, `retention_purge_${colName}`, err);
      }
    }
  }

  const criticalPhases = new Set([
    "card_purge",
    "card_purge_item",
    "expire_listings",
    "expire_pending_reservations",
    "expire_pending_reservation_item",
    "expire_confirmed_reservations",
    "expire_confirmed_reservation_item",
    "purge_accounts",
    "purge_accounts_item",
    "claims_sync",
    "storage_cleanup_jobs",
    "storage_cleanup_item",
    "listing_operation_jobs",
  ]);

  const partialFailure = errors.some((e) => criticalPhases.has(e.phase));

  return {
    deletedCardsCount,
    expiredListingsCount,
    expiredPendingReservationsCount,
    expiredConfirmedReservationsCount,
    purgedPendingAccountsCount,
    claimsSynced,
    storageJobsProcessed,
    listingJobsProcessed,
    orphanDraftsDeleted,
    orphanChatFilesDeleted,
    retentionRecordsPurged,
    errors,
    partialFailure,
  };
}
