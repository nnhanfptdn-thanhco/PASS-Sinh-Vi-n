/**
 * SCRIPT KHỞI TẠO DANH MỤC - CHỢ PASS SINH VIÊN
 * Nguồn dữ liệu:
 * 1. Bảng danh mục hành chính 2 cấp (34 tỉnh/thành & xã/phường theo cấu trúc từ 01/07/2025)
 * 2. Danh mục các trường Đại học, Cao đẳng, Học viện toàn quốc (Bộ GD&ĐT)
 * 3. Danh mục các loại hàng hóa & phân loại món đồ
 *
 * Tính chất: Idempotent (Chạy nhiều lần không nhân đôi dữ liệu)
 * BẢO ĐẢM: Không tạo tin đăng giả hay tài khoản giả trên Production!
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

// Cấu hình kết nối Firebase Admin (Hỗ trợ Emulator lẫn Production)
const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR !== "false";
if (isEmulator && !process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  console.log("⚡ Đang kết nối tới Firebase Emulator tại 127.0.0.1:8080...");
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || "cho-pass-sv-dev",
      });

const db = getFirestore(app);
const auth = getAuth(app);

async function initCatalogs() {
  console.log("==========================================================");
  console.log("   KHỞI TẠO DANH MỤC TOÀN QUỐC CHO CHỢ PASS SINH VIÊN   ");
  console.log("==========================================================");

  const dataDir = path.join(process.cwd(), "data");

  // 1. Nạp Danh mục 34 Tỉnh / Thành phố
  const provincesFile = path.join(dataDir, "provinces_34.json");
  if (!fs.existsSync(provincesFile)) {
    throw new Error(`Không tìm thấy file nguồn: ${provincesFile}`);
  }
  const provinces = JSON.parse(fs.readFileSync(provincesFile, "utf-8"));
  console.log(`\n[1/4] Đang nạp danh mục Tỉnh/Thành phố (Nguồn: QĐ 19/2025/QĐ-TTg)...`);

  const provinceBatch = db.batch();
  for (const province of provinces) {
    const docRef = db.collection("regions").doc(`province_${province.code}`);
    provinceBatch.set(
      docRef,
      {
        ...province,
        level: "province",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await provinceBatch.commit();
  console.log(`✓ Đã nạp thành công: ${provinces.length} Tỉnh/Thành phố.`);

  // 2. Nạp Danh mục Xã / Phường / Đặc khu
  const wardsFile = path.join(dataDir, "communes_wards.json");
  if (!fs.existsSync(wardsFile)) {
    throw new Error(`Không tìm thấy file nguồn: ${wardsFile}`);
  }
  const wards = JSON.parse(fs.readFileSync(wardsFile, "utf-8"));
  console.log(`\n[2/4] Đang nạp danh mục Xã/Phường/Đặc khu trọng điểm sinh viên...`);

  const wardBatch = db.batch();
  for (const ward of wards) {
    const docRef = db.collection("regions").doc(`ward_${ward.code}`);
    wardBatch.set(
      docRef,
      {
        ...ward,
        level: "ward",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await wardBatch.commit();
  console.log(`✓ Đã nạp: ${wards.length} Xã/Phường đơn vị hành chính cấp xã.`);

  // 3. Nạp Danh mục Trường Đại học / Cao đẳng / Học viện
  const universitiesFile = path.join(dataDir, "universities_vietnam.json");
  if (!fs.existsSync(universitiesFile)) {
    throw new Error(`Không tìm thấy file nguồn: ${universitiesFile}`);
  }
  const universities = JSON.parse(fs.readFileSync(universitiesFile, "utf-8"));
  console.log(`\n[3/4] Đang nạp danh mục Trường ĐH, CĐ, Học viện (Nguồn: Bộ GD&ĐT)...`);

  const schoolBatch = db.batch();
  for (const school of universities) {
    const docRef = db.collection("schools").doc(school.code);
    schoolBatch.set(
      docRef,
      {
        ...school,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await schoolBatch.commit();
  console.log(`✓ Đã nạp: ${universities.length} Trường Đại học/Học viện tiêu biểu các miền.`);

  // 4. Nạp Danh mục Mặt hàng (Categories)
  const categoriesFile = path.join(dataDir, "categories.json");
  if (!fs.existsSync(categoriesFile)) {
    throw new Error(`Không tìm thấy file nguồn: ${categoriesFile}`);
  }
  const categories = JSON.parse(fs.readFileSync(categoriesFile, "utf-8"));
  console.log(`\n[4/4] Đang nạp danh mục Mặt hàng & Đồ dùng sinh viên...`);

  const catBatch = db.batch();
  for (const cat of categories) {
    const docRef = db.collection("categories").doc(cat.id);
    catBatch.set(
      docRef,
      {
        ...cat,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await catBatch.commit();
  console.log(`✓ Đã nạp: ${categories.length} Danh mục chính kèm phân loại chi tiết.`);

  // 5. Cấu hình Email Admin ban đầu
  const adminEmail = process.env.ADMIN_EMAIL || "admin@chopass.vn";
  console.log(`\n[5/5] Cấu hình Quản trị viên đầu tiên (${adminEmail})...`);
  try {
    const user = await auth.getUserByEmail(adminEmail);
    await auth.setCustomUserClaims(user.uid, {
      admin: true,
      verified: true,
      role: "admin",
    });
    console.log(`✓ Đã cấp quyền Quản trị viên (admin: true) cho tài khoản: ${adminEmail}`);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "auth/user-not-found") {
      console.log(`ℹ Tài khoản ${adminEmail} chưa đăng ký trên Auth.`);
      console.log(`  Hệ thống đã lưu cấu hình; quyền Quản trị viên sẽ tự động gán ngay khi email này đăng nhập Google lần đầu.`);
      await db.collection("systemConfigs").doc("roles").set(
        {
          initialAdminEmails: FieldValue.arrayUnion(adminEmail),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      console.warn("Lưu ý cấu hình admin:", err);
    }
  }

  // Đối chiếu và in tổng kết
  console.log("\n==========================================================");
  console.log("              BÁO CÁO ĐỐI CHIẾU DANH MỤC NẠP              ");
  console.log("==========================================================");
  console.log(`- Tỉnh/Thành phố:  ${provinces.length} / 34 tỉnh, thành phố mới`);
  console.log(`- Xã/Phường mẫu:    ${wards.length} đơn vị đại diện các Làng ĐH`);
  console.log(`- Trường ĐH/CĐ:     ${universities.length} trường tiêu biểu Bắc - Trung - Nam`);
  console.log(`- Danh mục hàng:   ${categories.length} danh mục 2 cấp`);
  console.log(`- Tin giả/User giả: 0 (ĐẢM BẢO KHÔNG TẠO DỮ LIỆU RÁC)`);
  console.log("==========================================================\n");
}

initCatalogs()
  .then(() => {
    console.log("🎉 Hoàn tất khởi tạo danh mục thành công!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Lỗi khởi tạo danh mục:", err);
    process.exit(1);
  });
