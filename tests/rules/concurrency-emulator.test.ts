import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { setupTestEnvironment } from "./helpers";
import { doc, getDoc, runTransaction, setDoc } from "firebase/firestore";

describe("Firestore Emulator Concurrency Invariants (C4/C5)", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await setupTestEnvironment();
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  beforeEach(async () => {
    await env.clearFirestore();
  });

  it("Race 2 transaction tạo listing cùng slot tối đa -> không vượt MAX_ACTIVE_LISTINGS (sellerListingStats)", async () => {
    const sellerId = "seller_race";
    const MAX_SLOTS = 2;

    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "sellerListingStats", sellerId), { activeCount: 1 });

      const attemptCreate = async (listingId: string) => {
        return runTransaction(db, async (tx) => {
          const statsRef = doc(db, "sellerListingStats", sellerId);
          const listingRef = doc(db, "listings", listingId);
          const statsSnap = await tx.get(statsRef);
          const current = Number(statsSnap.data()?.activeCount ?? 0);
          if (current >= MAX_SLOTS) {
            throw new Error("MAX_SLOTS_REACHED");
          }
          tx.set(listingRef, { sellerId, status: "active" });
          tx.set(statsRef, { activeCount: current + 1 }, { merge: true });
          return listingId;
        });
      };

      const results = await Promise.allSettled([
        attemptCreate("l_race_1"),
        attemptCreate("l_race_2"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const finalStats = await getDoc(doc(db, "sellerListingStats", sellerId));
      expect(finalStats.data()?.activeCount).toBe(2);
    });
  });

  it("Race 2 transaction tạo giữ chỗ cùng (listing, buyer) -> activeReservationLocks chặn trùng 100%", async () => {
    const listingId = "listing_race";
    const buyerId = "buyer_race";

    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "listingReservationStats", listingId), { pendingCount: 0 });

      const attemptReserve = async (resId: string) => {
        return runTransaction(db, async (tx) => {
          const lockRef = doc(db, "activeReservationLocks", `${listingId}_${buyerId}`);
          const statsRef = doc(db, "listingReservationStats", listingId);
          const [lockSnap, statsSnap] = await Promise.all([tx.get(lockRef), tx.get(statsRef)]);
          if (lockSnap.exists() && lockSnap.data()?.active === true) {
            throw new Error("ALREADY_RESERVED");
          }
          tx.set(lockRef, { active: true, reservationId: resId });
          tx.set(doc(db, "reservations", resId), { listingId, buyerId, status: "pending" });
          tx.set(statsRef, { pendingCount: Number(statsSnap.data()?.pendingCount ?? 0) + 1 }, { merge: true });
          return resId;
        });
      };

      const results = await Promise.allSettled([
        attemptReserve("res_1"),
        attemptReserve("res_2"),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

      const finalStats = await getDoc(doc(db, "listingReservationStats", listingId));
      expect(finalStats.data()?.pendingCount).toBe(1);
    });
  });
});
