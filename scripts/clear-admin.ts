/**
 * CLI Script: Gỡ quyền Quản trị viên (Admin) và thu hồi toàn bộ token đăng nhập.
 *
 * Cách dùng:
 *   npx ts-node -r tsconfig-paths/register scripts/clear-admin.ts <email-hoac-uid>
 */

import { adminAuth, adminDb, FieldValue } from "../src/lib/firebase/admin";
import { clearAdminClaim } from "../src/lib/server/claims";

async function main() {
  const target = process.argv[2]?.trim();
  if (!target) {
    console.error("Vui lòng cung cấp UID hoặc Email của tài khoản cần gỡ quyền quản trị.");
    console.error("Cách dùng: npx ts-node -r tsconfig-paths/register scripts/clear-admin.ts <email-hoac-uid>");
    process.exit(1);
  }

  console.log(`Đang tìm tài khoản: ${target}...`);

  let userRecord;
  try {
    if (target.includes("@")) {
      userRecord = await adminAuth.getUserByEmail(target);
    } else {
      userRecord = await adminAuth.getUser(target);
    }
  } catch (err) {
    console.error(`Không tìm thấy tài khoản với thông tin: ${target}`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const uid = userRecord.uid;
  const email = userRecord.email || "(không có email)";
  console.log(`Đã tìm thấy tài khoản: UID=${uid}, Email=${email}`);

  const currentClaims = userRecord.customClaims || {};
  console.log("Custom claims hiện tại:", JSON.stringify(currentClaims));

  if (!currentClaims.admin && currentClaims.role !== "admin") {
    console.log("ℹ️  Tài khoản này hiện không có quyền Admin trong custom claims.");
  }

  console.log(`Đang thực hiện gỡ quyền Admin bằng clearAdminClaim...`);
  const success = await clearAdminClaim(uid);

  if (!success) {
    console.error("❌ Thất bại khi gỡ quyền Admin!");
    process.exit(1);
  }

  // Cập nhật collection users và ghi log kiểm toán adminLogs
  try {
    await adminDb.collection("users").doc(uid).set(
      {
        isAdmin: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await adminDb.collection("adminLogs").add({
      action: "REVOKE_ADMIN",
      targetUid: uid,
      targetEmail: email,
      performedAt: FieldValue.serverTimestamp(),
      performedBy: "CLI_SCRIPT_CLEAR_ADMIN",
    });
  } catch (dbErr) {
    console.warn("⚠️  Không thể cập nhật Firestore users/adminLogs:", dbErr);
  }

  console.log("✅ Đã gỡ bỏ thành công quyền Admin!");
  console.log("✅ Custom claim admin đã bị xóa.");
  console.log("✅ Toàn bộ phiên đăng nhập (refresh tokens) của tài khoản đã bị thu hồi.");
}

main().catch((err) => {
  console.error("Lỗi thực thi script:", err);
  process.exit(1);
});
