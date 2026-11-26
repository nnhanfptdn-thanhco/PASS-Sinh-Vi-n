/**
 * SCRIPT MIGRATION / BACKFILL: CHUẨN HÓA holdExpiresAt & listingsPrivate.confirmedUntil CHO GIỮ CHỖ 72H
 * Mặc định --dry-run. Chỉ ghi DB khi truyền tường minh --apply.
 *
 * Cách chạy:
 *   npx tsx scripts/backfill-confirmed-hold-expires-at.ts [--apply]
 */

import "dotenv/config";
import { adminDb, FieldValue } from "../src/lib/firebase/admin";

const shouldApply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

function parseIsoMs(val: unknown): number | null {
  if (typeof val === "string" && val.trim()) {
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? ms : null;
  }
  const ts = val as { toMillis?: () => number } | null | undefined;
  if (typeof ts?.toMillis === "function") {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

async function main() {
  console.log("==========================================================");
  console.log(` BACKFILL holdExpiresAt CHO CONFIRMED RESERVATIONS [${shouldApply ? "APPLY" : "DRY-RUN"}] `);
  console.log("==========================================================");

  const snap = await adminDb
    .collection("reservations")
    .where("status", "==", "confirmed")
    .get();

  let updatedCount = 0;
  let skippedCount = 0;
  const missingExpiryIds: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const currentHoldMs = parseIsoMs(data.holdExpiresAt);
    const legacyExpiresMs = parseIsoMs(data.expiresAt);

    if (currentHoldMs !== null) {
      skippedCount++;
      continue;
    }

    // Không tự bịa hạn mới nếu thiếu cả holdExpiresAt lẫn expiresAt
    if (legacyExpiresMs === null) {
      missingExpiryIds.push(doc.id);
      skippedCount++;
      continue;
    }

    const holdExpiresAt = new Date(legacyExpiresMs).toISOString();
    console.log(`[Reservation ${doc.id}] backfill holdExpiresAt = ${holdExpiresAt}`);

    if (shouldApply) {
      const batch = adminDb.batch();
      batch.update(doc.ref, {
        holdExpiresAt,
        expiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (typeof data.listingId === "string" && data.listingId) {
        batch.set(
          adminDb.collection("listingsPrivate").doc(data.listingId),
          {
            ...(typeof data.buyerId === "string" && data.buyerId
              ? { confirmedBuyerId: data.buyerId }
              : {}),
            confirmedReservationId: doc.id,
            confirmedUntil: holdExpiresAt,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      await batch.commit();
    }
    updatedCount++;
  }

  console.log("----------------------------------------------------------");
  console.log(`Hoàn tất (${shouldApply ? "APPLY" : "DRY-RUN"}): ${updatedCount} giữ chỗ sẽ/đã backfill, ${skippedCount} bỏ qua.`);
  if (missingExpiryIds.length > 0) {
    console.warn(
      `⚠️ ${missingExpiryIds.length} giữ chỗ confirmed thiếu cả holdExpiresAt & expiresAt (giữ fail-closed ở contact API, cần review):`,
      missingExpiryIds
    );
  }
}

main().catch((err) => {
  console.error("Lỗi backfill holdExpiresAt:", err);
  process.exit(1);
});
