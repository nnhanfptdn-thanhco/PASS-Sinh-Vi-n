import "server-only";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { redactErrorMessage } from "./request-utils";
import { recordDeadLetterAlert } from "./dlq";
import {
  activeReservationLockRef,
  listingReservationStatsRef,
  sellerListingStatsRef,
  sellerTitleLockRef,
  userReservationStatsRef,
} from "./stats";

export type ListingOpJobType = "complete" | "mark_sold" | "hide";

export interface ListingOperationJobData {
  id: string;
  type: ListingOpJobType;
  listingId: string;
  listingTitle: string;
  titleNormalized: string;
  sellerId: string;
  previousStatus: string;
  finalStatus: "sold" | "hidden_by_seller" | "hidden_by_admin";
  initiatorUid: string;
  initiatorEmail: string;
  isModeration: boolean;
  excludeReservationId: string | null;
  targetStatuses: string[];
  cancelledBy: string;
  cancelReason: string;
  buyerNotifTitle: string;
  buyerNotifBody: string;
  status: "pending" | "processing" | "completed" | "dead_letter";
  attempts: number;
  deadLetter: boolean;
  leaseUntil: Date | null;
  nextAttemptAt: Date | null;
  lastError: string | null;
  processedReservations: number;
  processedReports: number;
}

export const MAX_BATCH_WRITES = 400;
const RESERVATION_PAGE_SIZE = 80; // <= 80 * 4 writes + overhead <= 360 <= 400
const REPORT_PAGE_SIZE = 200; // <= 200 writes + 1 progress update <= 201 <= 400
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;

export interface ProcessJobResult {
  completed: boolean;
  deadLetter: boolean;
  processedReservations: number;
  processedReports: number;
  batchesCommitted: number;
  error?: string;
}

/**
 * Xử lý bền vững (idempotent, chunked <= 400 writes/batch) cho thao tác complete / mark_sold / hide trên tin đăng.
 * Đảm bảo không bao giờ chạm trần 500 writes của Firestore Transaction/Batch.
 */
export async function processListingOperationJob(jobId: string): Promise<ProcessJobResult> {
  const jobRef = adminDb.collection("listingOperationJobs").doc(jobId);
  const now = new Date();

  // 1. Lấy lease nguyên tử để tránh hai worker chạy trùng nhau
  const jobData = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    if (d.status === "completed" || d.deadLetter === true) return null;

    const leaseUntilRaw = d.leaseUntil as { toMillis?: () => number } | Date | null | undefined;
    const leaseMs =
      leaseUntilRaw instanceof Date
        ? leaseUntilRaw.getTime()
        : typeof leaseUntilRaw?.toMillis === "function"
        ? leaseUntilRaw.toMillis()
        : 0;

    if (leaseMs > now.getTime()) {
      return null; // Đang có worker khác giữ lease
    }

    tx.update(jobRef, {
      status: "processing",
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return d as unknown as ListingOperationJobData;
  });

  if (!jobData) {
    return {
      completed: false,
      deadLetter: false,
      processedReservations: 0,
      processedReports: 0,
      batchesCommitted: 0,
    };
  }

  let processedReservations = Number(jobData.processedReservations || 0);
  let processedReports = Number(jobData.processedReports || 0);
  let batchesCommitted = 0;

  try {
    // 2. Hủy các reservation mở theo từng trang <= 80 bản ghi (~<= 360 writes/batch)
    while (true) {
      const resSnap = await adminDb
        .collection("reservations")
        .where("listingId", "==", jobData.listingId)
        .where("status", "in", jobData.targetStatuses)
        .limit(RESERVATION_PAGE_SIZE)
        .get();

      const docsToProcess = resSnap.docs.filter((d) => d.id !== jobData.excludeReservationId);
      if (docsToProcess.length === 0) {
        break;
      }

      const batch = adminDb.batch();
      let ops = 0;
      let pendingDecremented = 0;
      const buyerPendingDec = new Map<string, number>();

      for (const doc of docsToProcess) {
        const r = doc.data();
        const buyerId = r.buyerId as string | undefined;

        batch.update(doc.ref, {
          status: "cancelled",
          cancelledBy: jobData.cancelledBy,
          cancelReason: jobData.cancelReason,
          cancelledAt: FieldValue.serverTimestamp(),
          expiresAt: FieldValue.delete(),
          holdExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        ops++;

        if (buyerId) {
          // Deterministic notification doc ID để retry KHÔNG gửi trùng thông báo
          const notifRef = adminDb.collection("notifications").doc(`job_${jobId}_res_${doc.id}`);
          batch.set(notifRef, {
            userId: buyerId,
            type: "reservation_cancelled",
            title: jobData.buyerNotifTitle,
            body: jobData.buyerNotifBody,
            targetId: jobData.type === "complete" ? doc.id : jobData.listingId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
          ops++;

          batch.delete(activeReservationLockRef(jobData.listingId, buyerId));
          ops++;

          if (r.status === "pending") {
            pendingDecremented++;
            buyerPendingDec.set(buyerId, (buyerPendingDec.get(buyerId) || 0) + 1);
          }
        }
      }

      if (pendingDecremented > 0) {
        batch.set(
          listingReservationStatsRef(jobData.listingId),
          {
            pendingCount: FieldValue.increment(-pendingDecremented),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        ops++;
      }

      for (const [bUid, dec] of Array.from(buyerPendingDec.entries())) {
        if (ops + 2 > MAX_BATCH_WRITES) {
          break;
        }
        batch.set(
          userReservationStatsRef(bUid),
          {
            pendingCount: FieldValue.increment(-dec),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        ops++;
      }

      processedReservations += docsToProcess.length;
      batch.update(jobRef, {
        processedReservations,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        updatedAt: FieldValue.serverTimestamp(),
      });
      ops++;

      if (ops > MAX_BATCH_WRITES) {
        throw new Error(`Batch write limit exceeded: ${ops} > ${MAX_BATCH_WRITES}`);
      }

      await batch.commit();
      batchesCommitted++;
    }

    // 3. Nếu là Admin hide (moderation): resolve toàn bộ reports pending theo trang <= 200 writes
    if (jobData.isModeration) {
      while (true) {
        const repSnap = await adminDb
          .collection("reports")
          .where("targetType", "==", "listing")
          .where("targetId", "==", jobData.listingId)
          .where("status", "==", "pending")
          .limit(REPORT_PAGE_SIZE)
          .get();

        if (repSnap.empty) break;

        const batch = adminDb.batch();
        let ops = 0;
        for (const doc of repSnap.docs) {
          batch.update(doc.ref, {
            status: "resolved",
            resolution: "listing_hidden_by_admin",
            resolvedBy: jobData.initiatorUid,
            resolvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          ops++;
        }

        processedReports += repSnap.docs.length;
        batch.update(jobRef, {
          processedReports,
          leaseUntil: new Date(Date.now() + LEASE_MS),
          updatedAt: FieldValue.serverTimestamp(),
        });
        ops++;

        if (ops > MAX_BATCH_WRITES) {
          throw new Error(`Batch write limit exceeded: ${ops} > ${MAX_BATCH_WRITES}`);
        }

        await batch.commit();
        batchesCommitted++;
      }
    }

    // 4. Chốt trạng thái cuối của tin đăng + dọn dữ liệu private + cập nhật aggregate stats
    await adminDb.runTransaction(async (tx) => {
      const listingRef = adminDb.collection("listings").doc(jobData.listingId);
      const privateRef = adminDb.collection("listingsPrivate").doc(jobData.listingId);
      const statsRef = sellerListingStatsRef(jobData.sellerId);
      const titleLockRef = jobData.titleNormalized
        ? sellerTitleLockRef(jobData.sellerId, jobData.titleNormalized)
        : null;

      const [listingSnap, statsSnap, titleLockSnap] = await Promise.all([
        tx.get(listingRef),
        tx.get(statsRef),
        titleLockRef ? tx.get(titleLockRef) : Promise.resolve(null),
      ]);
      if (listingSnap.exists) {
        const lstUpdate: Record<string, unknown> = {
          status: jobData.finalStatus,
          operationStatus: FieldValue.delete(),
          activeJobId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (jobData.finalStatus === "sold") {
          lstUpdate.soldAt = FieldValue.serverTimestamp();
        }
        if (jobData.isModeration) {
          lstUpdate.moderatedAt = FieldValue.serverTimestamp();
          lstUpdate.moderatedBy = jobData.initiatorUid;
        }
        tx.update(listingRef, lstUpdate);
      }

      tx.set(
        privateRef,
        {
          confirmedBuyerId: FieldValue.delete(),
          confirmedReservationId: FieldValue.delete(),
          confirmedUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (jobData.previousStatus === "active" || jobData.previousStatus === "reserved") {
        const curActive = Math.max(0, Number(statsSnap.data()?.activeCount ?? 0));
        tx.set(
          statsRef,
          {
            activeCount: Math.max(0, curActive - 1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (titleLockRef && titleLockSnap?.exists && titleLockSnap.data()?.listingId === jobData.listingId) {
        tx.delete(titleLockRef);
      }

      if (jobData.isModeration) {
        tx.set(adminDb.collection("notifications").doc(`job_${jobId}_seller_mod`), {
          userId: jobData.sellerId,
          title: "Tin đăng của bạn đã bị ẩn",
          body: "Tin đăng đã bị Quản trị viên ẩn vì có dấu hiệu vi phạm. Bạn có thể gửi khiếu nại nếu cho rằng đây là nhầm lẫn.",
          type: "listing_moderated",
          targetId: jobData.listingId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(adminDb.collection("adminLogs").doc(`job_${jobId}_audit`), {
          adminUid: jobData.initiatorUid,
          adminEmail: jobData.initiatorEmail || "admin",
          action: "HIDE_LISTING_BY_ADMIN",
          targetListingId: jobData.listingId,
          targetUserId: jobData.sellerId,
          cancelledReservations: processedReservations,
          resolvedReports: processedReports,
          timestamp: FieldValue.serverTimestamp(),
        });
      }

      tx.update(jobRef, {
        status: "completed",
        leaseUntil: null,
        nextAttemptAt: null,
        processedReservations,
        processedReports,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return {
      completed: true,
      deadLetter: false,
      processedReservations,
      processedReports,
      batchesCommitted,
    };
  } catch (err: unknown) {
    const nextAttempts = Number(jobData.attempts || 0) + 1;
    const isDeadLetter = nextAttempts >= MAX_ATTEMPTS;
    const redactedErr = redactErrorMessage(err);
    const backoffMs =
      Math.min(3600_000, Math.pow(2, nextAttempts) * 60_000) + Math.floor(Math.random() * 15_000);

    await jobRef
      .update({
        status: isDeadLetter ? "dead_letter" : "pending",
        attempts: nextAttempts,
        deadLetter: isDeadLetter,
        leaseUntil: null,
        nextAttemptAt: isDeadLetter ? null : new Date(Date.now() + backoffMs),
        lastError: redactedErr,
        processedReservations,
        processedReports,
        updatedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);

    if (isDeadLetter) {
      await recordDeadLetterAlert({
        sourceCollection: "listingOperationJobs",
        sourceDocId: jobId,
        step: "processListingOperationJob",
        error: err,
        attempts: nextAttempts,
        dataToResume: {
          listingId: jobData.listingId,
          type: jobData.type,
          processedReservations,
          processedReports,
        },
      });
    }

    return {
      completed: false,
      deadLetter: isDeadLetter,
      processedReservations,
      processedReports,
      batchesCommitted,
      error: redactedErr,
    };
  }
}

/**
 * Quét và xử lý tiếp các `listingOperationJobs` đang pending (không deadLetter) theo cursor an toàn.
 */
export async function processPendingListingOperationJobs(now: Date = new Date()): Promise<{
  completedCount: number;
  failedCount: number;
}> {
  let completedCount = 0;
  let failedCount = 0;

  let docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
  try {
    const snap = await adminDb
      .collection("listingOperationJobs")
      .where("deadLetter", "==", false)
      .where("nextAttemptAt", "<=", now)
      .orderBy("nextAttemptAt", "asc")
      .limit(20)
      .get();
    docs = snap.docs;
  } catch (err: unknown) {
    const errStr = String(err);
    if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
      const snap = await adminDb
        .collection("listingOperationJobs")
        .where("deadLetter", "==", false)
        .limit(20)
        .get();
      docs = snap.docs.filter((d) => d.data().status === "pending");
    } else {
      throw err;
    }
  }

  for (const doc of docs) {
    if (doc.data()?.status === "completed") continue;
    const res = await processListingOperationJob(doc.id);
    if (res.completed) completedCount++;
    else if (res.error) failedCount++;
  }

  return { completedCount, failedCount };
}
