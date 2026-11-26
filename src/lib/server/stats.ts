import "server-only";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase/admin";

export function sellerListingStatsRef(uid: string) {
  return adminDb.collection("sellerListingStats").doc(uid);
}

export function computeTitleLockId(uid: string, titleNormalized: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(titleNormalized.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
  return `${uid}_${hash}`;
}

export function sellerTitleLockRef(uid: string, titleNormalized: string) {
  return adminDb.collection("sellerTitleLocks").doc(computeTitleLockId(uid, titleNormalized));
}

export function listingReservationStatsRef(listingId: string) {
  return adminDb.collection("listingReservationStats").doc(listingId);
}

export function userReservationStatsRef(uid: string) {
  return adminDb.collection("userReservationStats").doc(uid);
}

export function activeReservationLockRef(listingId: string, buyerId: string) {
  return adminDb.collection("activeReservationLocks").doc(`${listingId}_${buyerId}`);
}

export function appealPendingLockRef(userId: string, targetType: string, targetId: string) {
  const key = crypto
    .createHash("sha256")
    .update(`${userId}|${targetType}|${targetId}`)
    .digest("hex")
    .slice(0, 40);
  return adminDb.collection("appealPendingLocks").doc(key);
}

export interface ReconcileReport {
  sellerListingMismatches: Array<{ uid: string; stored: number; actual: number }>;
  listingReservationMismatches: Array<{ listingId: string; stored: number; actual: number }>;
  userReservationMismatches: Array<{ uid: string; stored: number; actual: number }>;
}

/**
 * Đối chiếu và hiệu chỉnh các bộ đếm aggregate so với dữ liệu gốc (chạy qua ops/cron hoặc kiểm thử).
 */
export async function reconcileReservationAndListingStats(
  applyFix = false,
  maxDocs = 5000
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    sellerListingMismatches: [],
    listingReservationMismatches: [],
    userReservationMismatches: [],
  };

  const [activeListingsSnap, pendingResSnap, sellerStatsSnap, listingResStatsSnap, userResStatsSnap] =
    await Promise.all([
      adminDb.collection("listings").where("status", "in", ["active", "reserved"]).limit(maxDocs).get(),
      adminDb.collection("reservations").where("status", "==", "pending").limit(maxDocs).get(),
      adminDb.collection("sellerListingStats").limit(maxDocs).get(),
      adminDb.collection("listingReservationStats").limit(maxDocs).get(),
      adminDb.collection("userReservationStats").limit(maxDocs).get(),
    ]);

  const actualSellerCounts = new Map<string, number>();
  for (const doc of activeListingsSnap.docs) {
    const sellerId = doc.data().sellerId as string;
    if (sellerId) actualSellerCounts.set(sellerId, (actualSellerCounts.get(sellerId) || 0) + 1);
  }

  const storedSellerMap = new Map<string, number>();
  for (const d of sellerStatsSnap.docs) {
    storedSellerMap.set(d.id, Number(d.data()?.activeCount ?? 0));
  }

  const allSellerIds = new Set<string>([
    ...Array.from(actualSellerCounts.keys()),
    ...Array.from(storedSellerMap.keys()),
  ]);
  for (const uid of Array.from(allSellerIds)) {
    const stored = storedSellerMap.get(uid) ?? 0;
    const actual = actualSellerCounts.get(uid) ?? 0;
    if (stored !== actual) {
      report.sellerListingMismatches.push({ uid, stored, actual });
      if (applyFix) {
        await sellerListingStatsRef(uid).set({ activeCount: actual, reconciledAt: new Date() }, { merge: true });
      }
    }
  }

  const actualListingPending = new Map<string, number>();
  const actualUserPending = new Map<string, number>();
  for (const doc of pendingResSnap.docs) {
    const data = doc.data();
    if (data.listingId) {
      actualListingPending.set(data.listingId, (actualListingPending.get(data.listingId) || 0) + 1);
    }
    if (data.buyerId) {
      actualUserPending.set(data.buyerId, (actualUserPending.get(data.buyerId) || 0) + 1);
    }
  }

  const storedListingMap = new Map<string, number>();
  for (const d of listingResStatsSnap.docs) {
    storedListingMap.set(d.id, Number(d.data()?.pendingCount ?? 0));
  }
  const allListingIds = new Set<string>([
    ...Array.from(actualListingPending.keys()),
    ...Array.from(storedListingMap.keys()),
  ]);
  for (const listingId of Array.from(allListingIds)) {
    const stored = storedListingMap.get(listingId) ?? 0;
    const actual = actualListingPending.get(listingId) ?? 0;
    if (stored !== actual) {
      report.listingReservationMismatches.push({ listingId, stored, actual });
      if (applyFix) {
        await listingReservationStatsRef(listingId).set(
          { pendingCount: actual, reconciledAt: new Date() },
          { merge: true }
        );
      }
    }
  }

  const storedUserMap = new Map<string, number>();
  for (const d of userResStatsSnap.docs) {
    storedUserMap.set(d.id, Number(d.data()?.pendingCount ?? 0));
  }
  const allBuyerIds = new Set<string>([
    ...Array.from(actualUserPending.keys()),
    ...Array.from(storedUserMap.keys()),
  ]);
  for (const uid of Array.from(allBuyerIds)) {
    const stored = storedUserMap.get(uid) ?? 0;
    const actual = actualUserPending.get(uid) ?? 0;
    if (stored !== actual) {
      report.userReservationMismatches.push({ uid, stored, actual });
      if (applyFix) {
        await userReservationStatsRef(uid).set(
          { pendingCount: actual, reconciledAt: new Date() },
          { merge: true }
        );
      }
    }
  }

  return report;
}
