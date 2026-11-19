import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/server/http";
import { verifyCronRequest } from "@/lib/server/cron";
import { adminStorage, adminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FILES_PER_RUN = 500;

export const GET = withApi(async (request: NextRequest) => {
  verifyCronRequest(request);

  const bucket = adminStorage.bucket();
  let purgedCount = 0;
  let orphanPurgedCount = 0;

  try {
    const [files] = await bucket.getFiles({
      prefix: "private/cards/",
      maxResults: MAX_FILES_PER_RUN,
    });

    const now = Date.now();

    for (const file of files) {
      // Bỏ qua placeholder directory nếu có
      if (file.name.endsWith("/")) continue;

      const timeCreated = file.metadata.timeCreated
        ? new Date(file.metadata.timeCreated).getTime()
        : now;
      const age = now - timeCreated;

      // Trích xuất userId từ pattern private/cards/{userId}/fileName
      const parts = file.name.split("/");
      const userId = parts[2];

      if (!userId) continue;

      // Kiểm tra hồ sơ verification trong Firestore
      const verifSnap = await adminDb.collection("verifications").doc(userId).get();

      if (!verifSnap.exists) {
        // Ảnh thẻ mồ côi (không có hồ sơ) > 24 giờ -> Xóa
        if (age > ONE_DAY_MS) {
          await file.delete();
          orphanPurgedCount++;
        }
      } else {
        // Hồ sơ tồn tại nhưng ảnh đã quá 30 ngày theo chính sách bảo mật -> Xóa
        if (age > THIRTY_DAYS_MS) {
          await file.delete();
          await adminDb.collection("verifications").doc(userId).update({
            cardImagePurgedAt: FieldValue.serverTimestamp(),
          });
          purgedCount++;
        }
      }
    }
  } catch (error) {
    console.error("[CRON_PURGE_CARDS_ERROR] Lỗi khi dọn dẹp ảnh thẻ định kỳ:", error);
    throw error;
  }

  // Ghi log số lượng (TUYỆT ĐỐI không ghi PII, đường dẫn hay userId)
  console.info(
    `[CRON_PURGE_CARDS_DONE] Đã xóa ${purgedCount} ảnh thẻ quá hạn 30 ngày và ${orphanPurgedCount} ảnh mồ côi.`
  );

  return NextResponse.json({
    success: true,
    purgedCount,
    orphanPurgedCount,
  });
});
