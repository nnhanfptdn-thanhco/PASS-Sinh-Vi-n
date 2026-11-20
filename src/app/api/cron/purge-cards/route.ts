import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/server/http";
import { verifyCronRequest } from "@/lib/server/cron";
import { adminStorage, adminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

export const GET = withApi(async (request: NextRequest) => {
  verifyCronRequest(request);

  const bucket = adminStorage.bucket();
  let purgedCount = 0;
  let orphanPurgedCount = 0;
  let pageToken: string | undefined = undefined;

  try {
    const now = Date.now();

    for (let page = 0; page < MAX_PAGES; page++) {
      const query: { prefix: string; maxResults: number; pageToken?: string } = {
        prefix: "private/cards/",
        maxResults: PAGE_SIZE,
      };
      if (pageToken) {
        query.pageToken = pageToken;
      }

      const [files, nextQuery] = await bucket.getFiles(query);
      if (!files || files.length === 0) break;

      for (const file of files) {
        if (file.name.endsWith("/")) continue;

        const timeCreated = file.metadata.timeCreated
          ? new Date(file.metadata.timeCreated).getTime()
          : now;
        const age = now - timeCreated;

        const parts = file.name.split("/");
        const userId = parts[2];
        if (!userId) continue;

        const verifSnap = await adminDb.collection("verifications").doc(userId).get();

        if (!verifSnap.exists) {
          // Ảnh thẻ mồ côi (không có hồ sơ) > 24 giờ -> Xóa
          if (age > ONE_DAY_MS) {
            await file.delete({ ignoreNotFound: true });
            orphanPurgedCount++;
          }
        } else {
          const vData = verifSnap.data() || {};
          // CHỈ xóa khi hồ sơ đã quyết định (approved/rejected/expired) và quá 30 ngày từ decidedAt hoặc tạo file
          // TUYỆT ĐỐI không xóa hồ sơ đang pending
          if (["approved", "rejected", "expired"].includes(vData.status)) {
            const decidedAtMs = vData.decidedAt?.toMillis?.() || timeCreated;
            if (now - decidedAtMs > THIRTY_DAYS_MS) {
              await file.delete({ ignoreNotFound: true });
              await verifSnap.ref.update({
                cardDeleted: true,
                cardStoragePath: null,
                cardImagePath: null,
                cardImagePreviewUrl: null,
                cardImagePurgedAt: FieldValue.serverTimestamp(),
                cardAutoDeletedAt: FieldValue.serverTimestamp(),
              });
              purgedCount++;
            }
          }
        }
      }

      if (nextQuery && typeof nextQuery.pageToken === "string") {
        pageToken = nextQuery.pageToken;
      } else {
        break;
      }
    }
  } catch (error) {
    console.error("[CRON_PURGE_CARDS_ERROR] Lỗi khi dọn dẹp ảnh thẻ định kỳ:", error);
    throw error;
  }

  console.info(
    `[CRON_PURGE_CARDS_DONE] Đã xóa ${purgedCount} ảnh thẻ quá hạn 30 ngày và ${orphanPurgedCount} ảnh mồ côi.`
  );

  return NextResponse.json({
    success: true,
    purgedCount,
    orphanPurgedCount,
  });
});
