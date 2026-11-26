import "dotenv/config";
/**
 * CLI Script: Gỡ quyền Quản trị viên (Admin), dọn hồ sơ ADMIN tổng hợp và thu hồi toàn bộ token đăng nhập.
 *
 * Cách dùng:
 *   npx tsx scripts/clear-admin.ts <email-hoac-uid>
 */

import { adminAuth, adminDb, FieldValue } from "../src/lib/firebase/admin";

async function main() {
  const target = process.argv[2]?.trim();
  if (!target || target === "--help" || target === "-h") {
    console.error("Vui lòng cung cấp UID hoặc Email của tài khoản cần gỡ quyền quản trị.");
    console.error("Cách dùng: npx tsx scripts/clear-admin.ts <email-hoac-uid>");
    process.exit(target ? 0 : 1);
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
    console.error(
      `Không tìm thấy tài khoản với thông tin: ${target}`,
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }

  const uid = userRecord.uid;
  const email = userRecord.email || "(không có email)";
  console.log(`Đã tìm thấy tài khoản: UID=${uid}, Email=${email}`);

  const currentClaims = { ...(userRecord.customClaims || {}) } as Record<string, unknown>;
  console.log("Custom claims hiện tại:", JSON.stringify(currentClaims));

  if (!currentClaims.admin && currentClaims.role !== "admin") {
    console.log("ℹ️  Tài khoản này hiện không có quyền Admin trong custom claims.");
  }

  // Kiểm tra hồ sơ verifications/{uid}: nếu là hồ sơ tổng hợp của system_bootstrap (ADMIN) thì xóa luôn
  let keepVerified = false;
  const verifRef = adminDb.collection("verifications").doc(uid);
  const verifSnap = await verifRef.get();
  if (verifSnap.exists) {
    const vData = verifSnap.data() || {};
    const isSyntheticAdmin =
      vData.schoolCode === "ADMIN" || vData.reviewerId === "system_bootstrap";
    if (isSyntheticAdmin) {
      await verifRef.delete();
      console.log("🧹 Đã xóa hồ sơ xác minh tổng hợp (schoolCode=ADMIN).");
    } else if (vData.status === "approved") {
      keepVerified = true;
    }
  }

  delete currentClaims.admin;
  delete currentClaims.studentVerified;
  currentClaims.verified = keepVerified;
  currentClaims.role = keepVerified ? "verified" : "pending";

  await adminAuth.setCustomUserClaims(uid, currentClaims);
  await adminAuth.revokeRefreshTokens(uid);
  await adminDb.collection("claimsSyncJobs").doc(uid).delete().catch(() => undefined);

  await adminDb.collection("users").doc(uid).set(
    {
      isAdmin: false,
      verified: keepVerified,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await adminDb.collection("adminLogs").add({
    action: "REVOKE_ADMIN",
    targetUid: uid,
    targetEmail: email,
    keptStudentVerification: keepVerified,
    performedAt: FieldValue.serverTimestamp(),
    performedBy: "CLI_SCRIPT_CLEAR_ADMIN",
  });

  console.log("✅ Đã gỡ bỏ thành công quyền Admin!");
  console.log("✅ Custom claim admin đã bị xóa và toàn bộ refresh token đã bị thu hồi.");
  console.log(
    "⚠️ LƯU Ý: Vui lòng xóa email này khỏi biến môi trường ADMIN_EMAILS trên Vercel/Firebase để tránh quyền quản trị bị tự động cấp lại khi đăng nhập!"
  );
}

main().catch((err) => {
  console.error("Lỗi thực thi script:", err);
  process.exit(1);
});
