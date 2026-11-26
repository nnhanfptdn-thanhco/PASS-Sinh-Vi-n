/**
 * SCRIPT KHỞI TẠO DANH MỤC - CHỢ PASS SINH VIÊN
 * Hỗ trợ chunk <= 400 writes mỗi batch (không bao giờ vượt giới hạn 500 writes của Firestore).
 * Mặc định chạy --dry-run (chỉ mô phỏng & đếm); bắt buộc truyền --apply để ghi vào DB/Emulator.
 */

import "dotenv/config";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

const BATCH_LIMIT = 400;
const applyChanges = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

if (isEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  console.log("⚡ Đang kết nối tới Firebase Emulator tại 127.0.0.1:8080...");
}

const projectId =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  "cho-pass-sv";

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim()?.replace(/\\n/g, "\n");

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp(
        clientEmail && privateKey && privateKey.includes("PRIVATE KEY") && !isEmulator
          ? {
              credential: cert({ projectId, clientEmail, privateKey }),
              projectId,
            }
          : { projectId }
      );

const db = getFirestore(app);
const auth = getAuth(app);

async function commitSetInChunks(
  items: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>,
  label: string
) {
  let batches = 0;
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const chunk = items.slice(i, i + BATCH_LIMIT);
    batches++;
    if (applyChanges) {
      const batch = db.batch();
      for (const item of chunk) {
        batch.set(item.ref, item.data, { merge: true });
      }
      await batch.commit();
    }
  }
  console.log(
    `✓ [${label}] ${applyChanges ? "Đã nạp" : "[DRY-RUN] Sẽ nạp"} ${items.length} docs (${batches} batch <= ${BATCH_LIMIT} writes).`
  );
}

async function initCatalogs() {
  console.log("==========================================================");
  console.log(`   KHỞI TẠO DANH MỤC (${applyChanges ? "APPLY" : "DRY-RUN"})   `);
  console.log("==========================================================");

  const dataDir = path.join(process.cwd(), "data");

  const provinces = JSON.parse(fs.readFileSync(path.join(dataDir, "provinces_34.json"), "utf-8"));
  await commitSetInChunks(
    provinces.map((p: Record<string, unknown>) => ({
      ref: db.collection("regions").doc(`province_${p.code}`),
      data: { ...p, level: "province", updatedAt: FieldValue.serverTimestamp() },
    })),
    "1/4 Provinces"
  );

  const wards = JSON.parse(fs.readFileSync(path.join(dataDir, "communes_wards.json"), "utf-8"));
  await commitSetInChunks(
    wards.map((w: Record<string, unknown>) => ({
      ref: db.collection("regions").doc(`ward_${w.code}`),
      data: { ...w, level: "ward", updatedAt: FieldValue.serverTimestamp() },
    })),
    "2/4 Wards"
  );

  const universities = JSON.parse(
    fs.readFileSync(path.join(dataDir, "universities_vietnam.json"), "utf-8")
  );
  await commitSetInChunks(
    universities.map((u: Record<string, unknown>) => ({
      ref: db.collection("schools").doc(String(u.code)),
      data: { ...u, updatedAt: FieldValue.serverTimestamp() },
    })),
    "3/4 Schools"
  );

  const categories = JSON.parse(fs.readFileSync(path.join(dataDir, "categories.json"), "utf-8"));
  await commitSetInChunks(
    categories.map((c: Record<string, unknown>) => ({
      ref: db.collection("categories").doc(String(c.id)),
      data: { ...c, updatedAt: FieldValue.serverTimestamp() },
    })),
    "4/4 Categories"
  );

  const adminEmail = (
    process.env.ADMIN_EMAIL ||
    (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim() ||
    ""
  ).trim();

  if (applyChanges && adminEmail) {
    try {
      const user = await auth.getUserByEmail(adminEmail);
      const mergedClaims = { ...(user.customClaims || {}) } as Record<string, unknown>;
      delete mergedClaims.studentVerified;
      await auth.setCustomUserClaims(user.uid, {
        ...mergedClaims,
        admin: true,
        verified: true,
        role: "admin",
      });
      console.log(`✓ Đã cấp quyền Admin cho: ${adminEmail} (giữ nguyên các custom claims khác)`);
    } catch {
      console.log(`ℹ Chưa có user Auth cho ${adminEmail}; bỏ qua bước claim initial admin.`);
    }
  } else if (!applyChanges) {
    console.log("ℹ [DRY-RUN] Không sửa dữ liệu thực. Truyền --apply để thực thi.");
  }
}

initCatalogs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Lỗi khởi tạo danh mục:", err);
    process.exit(1);
  });
