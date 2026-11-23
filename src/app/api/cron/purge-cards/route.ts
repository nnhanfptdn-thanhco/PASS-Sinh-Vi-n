import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/server/http";
import { verifyCronRequest } from "@/lib/server/cron";
import { adminStorage, adminDb, FieldValue, Timestamp } from "@/lib/firebase/admin";

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
  let errorsCount = 0;

  try {
    const now = Date.now();
    const cursorRef = adminDb.collection("systemMeta").doc("purgeCardsCursor");
    const cursorSnap = await cursorRef.get();
    const cursorData = cursorSnap.data() || {};
    const storagePageToken = (cursorData.storagePageToken as string | undefined) || undefined;

    // 1. Thử lại việc xóa ảnh cho các hồ sơ có cờ cardDeletePending = true
    const pendingDeleteSnap = await adminDb
      .collection("verifications")
      .where("cardDeletePending", "==", true)
      .limit(50)
      .get();

    for (const doc of pendingDeleteSnap.docs) {
      const data = doc.data();
      const p = typeof data.cardStoragePath === "string" ? data.cardStoragePath : null;
      let deleteOk = true;
      if (p && p.startsWith("private/cards/")) {
        try {
          await bucket.file(p).delete({ ignoreNotFound: true });
        } catch (fileErr) {
          deleteOk = false;
          errorsCount++;
          console.error(`[CRON_PURGE_CARDS] Lỗi xóa file pending ${p}:`, fileErr);
        }
      }
      if (deleteOk) {
        await doc.ref.update({
          cardDeleted: true,
          cardStoragePath: null,
          cardPurgeAt: FieldValue.delete(),
          cardDeletePending: FieldValue.delete(),
          cardAutoDeletedAt: FieldValue.serverTimestamp(),
        });
        purgedCount++;
      }
    }

    // 2. Dọn dẹp ảnh thẻ theo cardPurgeAt (cardPurgeAt <= now). Sau khi xóa file thì FieldValue.delete(cardPurgeAt)
    // Document tự động rời khỏi index, loại bỏ hoàn toàn tình trạng quét lặp lại hồ sơ cũ và không cần con trỏ cursor
    const nowTs = Timestamp.fromMillis(now);
    let purgeDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
    try {
      const snap = await adminDb
        .collection("verifications")
        .where("cardPurgeAt", "<=", nowTs)
        .orderBy("cardPurgeAt", "asc")
        .limit(100)
        .get();
      purgeDocs = snap.docs;
    } catch (idxErr: unknown) {
      console.warn("[CRON_PURGE_CARDS] Fallback quét lọc theo hạn 30 ngày:", idxErr);
      const fallbackSnap = await adminDb
        .collection("verifications")
        .where("status", "in", ["approved", "rejected", "expired"])
        .limit(100)
        .get();
      purgeDocs = fallbackSnap.docs.filter((d) => {
        const v = d.data();
        if (!v.cardStoragePath) return false;
        const purgeMs = v.cardPurgeAt?.toMillis?.() || (v.decidedAt?.toMillis?.() ? v.decidedAt.toMillis() + THIRTY_DAYS_MS : 0);
        return purgeMs > 0 && purgeMs <= now;
      });
    }

    for (const doc of purgeDocs) {
      const vData = doc.data();
      const p = typeof vData.cardStoragePath === "string" ? vData.cardStoragePath : null;
      let deleteOk = true;

      if (p && p.startsWith("private/cards/")) {
        try {
          await bucket.file(p).delete({ ignoreNotFound: true });
        } catch (storageErr) {
          deleteOk = false;
          errorsCount++;
          console.error(`[CRON_PURGE_CARDS] Lỗi xóa file ${p} của hồ sơ ${doc.id}:`, storageErr);
          await doc.ref.update({ cardDeletePending: true });
        }
      }

      if (deleteOk) {
        await doc.ref.update({
          cardDeleted: true,
          cardStoragePath: null,
          cardImagePath: null,
          cardImagePreviewUrl: null,
          cardPurgeAt: FieldValue.delete(),
          cardDeletePending: FieldValue.delete(),
          cardImagePurgedAt: FieldValue.serverTimestamp(),
          cardAutoDeletedAt: FieldValue.serverTimestamp(),
        });
        purgedCount++;
      }
    }

    // 3. Quét Storage bucket dọn ảnh mồ côi > 24 giờ có lưu token trang liên tục qua các lần chạy
    let currentStorageToken = storagePageToken;
    let nextStorageToken: string | undefined = undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const listQuery: { prefix: string; maxResults: number; pageToken?: string } = {
        prefix: "private/cards/",
        maxResults: PAGE_SIZE,
      };
      if (currentStorageToken) {
        listQuery.pageToken = currentStorageToken;
      }

      const [files, nextQuery] = await bucket.getFiles(listQuery);
      if (!files || files.length === 0) {
        nextStorageToken = undefined;
        break;
      }

      for (const file of files) {
        if (file.name.endsWith("/")) continue;

        const timeCreated = file.metadata.timeCreated
          ? new Date(file.metadata.timeCreated).getTime()
          : now;
        const age = now - timeCreated;

        const parts = file.name.split("/");
        const userId = parts[2];
        if (!userId) continue;

        try {
          const verifSnap = await adminDb.collection("verifications").doc(userId).get();

          if (!verifSnap.exists) {
            // Ảnh thẻ mồ côi (không có hồ sơ người dùng) > 24 giờ -> Xóa
            if (age > ONE_DAY_MS) {
              await file.delete({ ignoreNotFound: true });
              orphanPurgedCount++;
            }
          } else {
            const vData = verifSnap.data() || {};

            // Nếu hồ sơ không còn trỏ đến file này nữa (file cũ sau khi người dùng tải lại ảnh) > 24h
            if (vData.cardStoragePath !== file.name && age > ONE_DAY_MS) {
              await file.delete({ ignoreNotFound: true });
              orphanPurgedCount++;
              continue;
            }

            // Nếu hồ sơ đã quyết định và quá 30 ngày nhưng doc chưa cập nhật
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
        } catch (itemErr) {
          errorsCount++;
          console.error(`[CRON_PURGE_CARDS] Lỗi kiểm tra file Storage ${file.name}:`, itemErr);
        }
      }

      if (nextQuery && typeof nextQuery.pageToken === "string") {
        currentStorageToken = nextQuery.pageToken;
        nextStorageToken = nextQuery.pageToken;
      } else {
        nextStorageToken = undefined;
        break;
      }
    }

    // Lưu state cursor vào Firestore doc
    await cursorRef.set(
      {
        storagePageToken: nextStorageToken || null,
        lastRunAt: FieldValue.serverTimestamp(),
        lastPurgedCount: purgedCount,
        lastOrphanPurgedCount: orphanPurgedCount,
        lastErrorsCount: errorsCount,
      },
      { merge: true }
    );
  } catch (error) {
    console.error("[CRON_PURGE_CARDS_ERROR] Lỗi khi dọn dẹp ảnh thẻ định kỳ:", error);
    throw error;
  }

  console.info(
    `[CRON_PURGE_CARDS_DONE] Đã xóa ${purgedCount} ảnh thẻ quá hạn 30 ngày, ${orphanPurgedCount} ảnh mồ côi (lỗi: ${errorsCount}).`
  );

  return NextResponse.json({
    success: true,
    purgedCount,
    orphanPurgedCount,
    errorsCount,
  });
});
