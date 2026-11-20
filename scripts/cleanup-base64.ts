/**
 * SCRIPT MIGRATION: DỌN DẸP DỮ LIỆU BASE64 CŨ TRONG FIRESTORE
 * 
 * Hỗ trợ cờ --dry-run để chạy kiểm tra số lượng mà không ghi đè dữ liệu.
 * 
 * Thực hiện:
 * 1. verifications: Nếu cardStoragePath bắt đầu bằng 'data:', xoá cardStoragePath,
 *    đánh dấu cardDeleted = true, chuyển status: 'expired' nếu đang pending.
 * 2. listings: Nếu images, thumbs, coverImage, hoặc coverThumb chứa chuỗi Base64 'data:',
 *    chuyển status: 'hidden_by_admin' và gửi notification yêu cầu người bán đăng lại ảnh qua Storage.
 */

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const isDryRun = process.argv.includes("--dry-run");

console.log("==========================================================");
console.log(`   DỌN DẸP BASE64 LEGACY ${isDryRun ? "[DRY-RUN MODE]" : "[LIVE RUN]"}   `);
console.log("==========================================================");

const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR !== "false";
if (isEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  console.log("⚡ Kết nối Firebase Emulator tại 127.0.0.1:8080...");
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp(
        process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL
          ? {
              credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID || "cho-pass-sv-dev",
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
              }),
            }
          : {
              projectId: process.env.FIREBASE_PROJECT_ID || "cho-pass-sv-dev",
            }
      );

const db = getFirestore(app);

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
        updatePayload.rejectReason = "Ảnh thẻ sinh viên cũ không hợp lệ (Base64). Vui lòng gửi lại ảnh.";
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
    data: Record<string, unknown>;
    sellerId: string;
    listingTitle: string;
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

    if (hasBase64) {
      affectedListings++;
      listingUpdates.push({
        ref: doc.ref,
        data: {
          status: "hidden_by_admin",
          updatedAt: FieldValue.serverTimestamp(),
          adminHiddenReason: "Ảnh tin đăng dạng Base64 legacy không được hỗ trợ. Vui lòng cập nhật lại ảnh tin đăng.",
        },
        sellerId: data.sellerId as string,
        listingTitle: (data.title as string) || "Món đồ",
      });
    }
  }

  console.log(
    `-> Listings: Đã quét ${scannedListings} tin đăng, phát hiện ${affectedListings} chứa Base64.`
  );

  if (isDryRun) {
    console.log("\n[DRY RUN HOÀN TẤT] Không có thay đổi nào được ghi vào cơ sở dữ liệu.");
    return;
  }

  // Thực hiện ghi dữ liệu nếu không phải dry-run (theo batch <= 400)
  console.log("\n-> Đang commit các thay đổi...");
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

  for (const update of listingUpdates) {
    batch.update(update.ref, update.data);
    count++;
    // Tạo notification cho người bán
    if (update.sellerId) {
      const notifRef = db.collection("notifications").doc();
      batch.set(notifRef, {
        userId: update.sellerId,
        type: "listing_hidden",
        title: "Tin đăng tạm ẩn để nâng cấp ảnh",
        body: `Tin đăng "${update.listingTitle}" tạm thời bị ẩn do ảnh dạng cũ. Bạn vui lòng tải lại ảnh thực tế để tiếp tục hiển thị nhé!`,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      count++;
    }

    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log("-> Hoàn tất ghi dữ liệu thành công!");
}

runCleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Lỗi trong quá trình dọn dẹp Base64:", err);
    process.exit(1);
  });
