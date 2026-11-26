/**
 * SCRIPT MIGRATION: DỌN DẸP DỮ LIỆU BASE64 CŨ TRONG FIRESTORE
 *
 * AN TOÀN: Mặc định chạy DRY-RUN (không ghi DB). Chỉ ghi dữ liệu khi truyền tường minh --apply.
 *
 * Cách dùng:
 *   npx tsx scripts/cleanup-base64.ts          # Dry-run
 *   npx tsx scripts/cleanup-base64.ts --apply  # Thực thi thực tế
 */

import "dotenv/config";
import * as crypto from "crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const applyChanges = process.argv.includes("--apply") && !process.argv.includes("--dry-run");

console.log("==========================================================");
console.log(`   DỌN DẸP BASE64 LEGACY ${applyChanges ? "[APPLY MODE]" : "[DRY-RUN MODE]"}   `);
console.log("==========================================================");

const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
if (isEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  console.log("⚡ Kết nối Firebase Emulator tại 127.0.0.1:8080...");
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp(
        process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && !isEmulator
          ? {
              credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID || "cho-pass-sv",
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
              }),
            }
          : {
              projectId: process.env.FIREBASE_PROJECT_ID || "cho-pass-sv-dev",
            }
      );

const db = getFirestore(app);

function computeTitleHash(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

async function runCleanup() {
  let scannedVerifications = 0;
  let affectedVerifications = 0;
  let scannedListings = 0;
  let affectedListings = 0;

  console.log("\n[1/2] Đang quét verifications...");
  const verifSnap = await db.collection("verifications").get();
  scannedVerifications = verifSnap.size;

  const verifUpdates: Array<{
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }> = [];

  for (const doc of verifSnap.docs) {
    const data = doc.data();
    const cardStoragePath = data.cardStoragePath as string | undefined;
    const cardImagePath = data.cardImagePath as string | undefined;
    const isBase64 =
      (typeof cardStoragePath === "string" && cardStoragePath.startsWith("data:")) ||
      (typeof cardImagePath === "string" && cardImagePath.startsWith("data:"));

    if (isBase64) {
      affectedVerifications++;
      const updatePayload: Record<string, unknown> = {
        cardStoragePath: null,
        cardImagePath: null,
        cardImagePreviewUrl: null,
        cardDeleted: true,
        cardAutoDeletedAt: FieldValue.serverTimestamp(),
      };
      if (data.status === "pending") {
        updatePayload.status = "expired";
        updatePayload.rejectReason =
          "Ảnh thẻ sinh viên cũ không hợp lệ (Base64). Vui lòng gửi lại ảnh.";
        updatePayload.decidedAt = FieldValue.serverTimestamp();
      }
      verifUpdates.push({ ref: doc.ref, data: updatePayload });
    }
  }

  console.log(
    `-> Verifications: Đã quét ${scannedVerifications} tài liệu, phát hiện ${affectedVerifications} chứa Base64.`
  );

  console.log("\n[2/2] Đang quét listings...");
  const listingsSnap = await db.collection("listings").get();
  scannedListings = listingsSnap.size;

  const listingUpdates: Array<{
    ref: FirebaseFirestore.DocumentReference;
    id: string;
    data: Record<string, unknown>;
    wasActiveOrReserved: boolean;
    sellerId: string;
    listingTitle: string;
    titleHash: string;
  }> = [];

  for (const doc of listingsSnap.docs) {
    const data = doc.data();
    const images = Array.isArray(data.images) ? (data.images as string[]) : [];
    const thumbs = Array.isArray(data.thumbs) ? (data.thumbs as string[]) : [];
    const coverImage = typeof data.coverImage === "string" ? data.coverImage : "";
    const coverThumb = typeof data.coverThumb === "string" ? data.coverThumb : "";

    const hasBase64 =
      images.some((url) => typeof url === "string" && url.startsWith("data:")) ||
      thumbs.some((url) => typeof url === "string" && url.startsWith("data:")) ||
      coverImage.startsWith("data:") ||
      coverThumb.startsWith("data:");

    if (hasBase64 && data.status !== "hidden_by_admin") {
      affectedListings++;
      const title = (data.title as string) || "Món đồ";
      listingUpdates.push({
        ref: doc.ref,
        id: doc.id,
        wasActiveOrReserved: data.status === "active" || data.status === "reserved",
        data: {
          status: "hidden_by_admin",
          images: images.filter((u) => typeof u === "string" && !u.startsWith("data:")),
          thumbs: thumbs.filter((u) => typeof u === "string" && !u.startsWith("data:")),
          coverImage: coverImage.startsWith("data:") ? "" : coverImage,
          coverThumb: coverThumb.startsWith("data:") ? "" : coverThumb,
          updatedAt: FieldValue.serverTimestamp(),
          adminHiddenReason:
            "Ảnh tin đăng dạng Base64 legacy không được hỗ trợ. Vui lòng cập nhật lại ảnh tin đăng.",
        },
        sellerId: (data.sellerId as string) || "",
        listingTitle: title,
        titleHash: computeTitleHash(title),
      });
    }
  }

  console.log(
    `-> Listings: Đã quét ${scannedListings} tin đăng, phát hiện ${affectedListings} chứa Base64 cần ẩn.`
  );

  if (!applyChanges) {
    console.log("\n[DRY RUN HOÀN TẤT] Không có thay đổi nào được ghi vào DB. Truyền --apply để thực thi.");
    return;
  }

  console.log("\n-> Đang thực hiện cập nhật đồng bộ...");
  let batch = db.batch();
  let count = 0;

  for (const update of verifUpdates) {
    batch.update(update.ref, update.data);
    count++;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) {
    await batch.commit();
  }

  // Cập nhật từng listing qua transaction để giữ đồng bộ sellerListingStats & sellerTitleLocks
  for (const update of listingUpdates) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(update.ref);
      if (!snap.exists) return;
      const cur = snap.data() || {};
      const stillLive = cur.status === "active" || cur.status === "reserved";

      let statsSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      let lockSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      const statsRef = update.sellerId ? db.collection("sellerListingStats").doc(update.sellerId) : null;
      const lockRef =
        update.sellerId && update.titleHash
          ? db.collection("sellerTitleLocks").doc(`${update.sellerId}_${update.titleHash}`)
          : null;

      if (stillLive && statsRef) {
        statsSnap = await tx.get(statsRef);
      }
      if (stillLive && lockRef) {
        lockSnap = await tx.get(lockRef);
      }

      tx.update(update.ref, update.data);

      if (stillLive && statsRef && statsSnap?.exists) {
        const curActive = Number(statsSnap.data()?.activeCount || 0);
        tx.set(
          statsRef,
          { activeCount: Math.max(0, curActive - 1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      if (stillLive && lockRef && lockSnap?.exists && lockSnap.data()?.listingId === update.id) {
        tx.delete(lockRef);
      }
      if (update.sellerId) {
        const notifRef = db.collection("notifications").doc();
        tx.set(notifRef, {
          userId: update.sellerId,
          type: "listing_hidden",
          title: "Tin đăng tạm ẩn để nâng cấp ảnh",
          body: `Tin đăng "${update.listingTitle}" tạm thời bị ẩn do ảnh dạng cũ. Bạn vui lòng đăng lại ảnh thực tế nhé!`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });
  }

  console.log("-> Hoàn tất ghi dữ liệu thành công!");
}

runCleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Lỗi trong quá trình dọn dẹp Base64:", err);
    process.exit(1);
  });
