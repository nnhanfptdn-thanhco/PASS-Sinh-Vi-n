/**
 * SCRIPT MIGRATION / BACKFILL: BỔ SUNG cardPurgeAt CHO HỒ SƠ THẺ SINH VIÊN LỊCH SỬ
 * Mặc định --dry-run. Chỉ ghi dữ liệu khi truyền tường minh --apply.
 *
 * Cách chạy:
 *   npx tsx scripts/backfill-card-purge-at.ts [--apply]
 */

import "dotenv/config";
import { adminDb, FieldValue } from "../src/lib/firebase/admin";

const shouldApply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

function parseTimestampMs(val: unknown): number | null {
  if (!val) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (val instanceof Date && Number.isFinite(val.getTime())) return val.getTime();
  if (typeof val === "string" && val.trim()) {
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? ms : null;
  }
  const ts = val as { toMillis?: () => number };
  if (typeof ts?.toMillis === "function") {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

async function main() {
  console.log("==========================================================");
  console.log(`   BACKFILL cardPurgeAt CHO VERIFICATIONS [${shouldApply ? "APPLY" : "DRY-RUN"}]   `);
  console.log("==========================================================");

  const snap = await adminDb
    .collection("verifications")
    .where("status", "in", ["approved", "rejected", "expired"])
    .get();

  console.log(`Tổng số hồ sơ đã quyết định tìm thấy: ${snap.docs.length}`);

  let updatedCount = 0;
  let skippedCount = 0;
  const missingTimestampIds: string[] = [];
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  for (const doc of snap.docs) {
    const data = doc.data();
    const hasCardPath = Boolean(data.cardStoragePath || data.cardImagePath);
    if (data.cardPurgeAt || data.cardDeleted || !hasCardPath) {
      skippedCount++;
      continue;
    }

    const decidedMs =
      parseTimestampMs(data.decidedAt) ??
      parseTimestampMs(data.approvedAt) ??
      parseTimestampMs(data.rejectedAt) ??
      parseTimestampMs(data.createdAt);

    // Không tự suy ra deadline mới từ Date.now() nếu thiếu mọi timestamp gốc
    if (decidedMs === null) {
      missingTimestampIds.push(doc.id);
      skippedCount++;
      continue;
    }

    const cardPurgeAt = new Date(decidedMs + THIRTY_DAYS_MS);
    console.log(`[Hồ sơ ${doc.id}] cardPurgeAt = ${cardPurgeAt.toISOString()}`);

    if (shouldApply) {
      await doc.ref.update({
        cardPurgeAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    updatedCount++;
  }

  console.log("----------------------------------------------------------");
  console.log(
    `Hoàn tất (${shouldApply ? "APPLY" : "DRY-RUN"}): ${updatedCount} hồ sơ đủ điều kiện, bỏ qua ${skippedCount} hồ sơ.`
  );
  if (missingTimestampIds.length > 0) {
    console.warn(
      `⚠️ ${missingTimestampIds.length} hồ sơ thiếu hoàn toàn timestamp (cần rà soát thủ công):`,
      missingTimestampIds
    );
  }
}

main().catch((err) => {
  console.error("Lỗi khi chạy backfill-card-purge-at:", err);
  process.exit(1);
});
