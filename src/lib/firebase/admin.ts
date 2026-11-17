import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";

// Cấu hình môi trường Emulator cho Firebase Admin
if (
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" &&
  !process.env.FIRESTORE_EMULATOR_HOST
) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
}

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || "cho-pass-sv-dev",
      });

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const adminStorage = getStorage(app);
export { FieldValue } from "firebase-admin/firestore";

/**
 * Tính mã băm HMAC-SHA256 cho mã số sinh viên kết hợp mã trường.
 * BẢO MẬT: Chỉ chạy phía Server, dùng khóa bí mật trong Secret Manager / Biến môi trường.
 * Tuyệt đối không gửi mã gốc hay tính ở Client để chống đảo ngược.
 */
export function computeStudentIdHash(schoolCode: string, studentId: string): string {
  const secret =
    process.env.STUDENT_ID_HMAC_SECRET ||
    "demo-secret-key-replace-in-production";

  const normalizedInput = `${schoolCode.trim().toUpperCase()}:${studentId.trim().toUpperCase()}`;
  return crypto.createHmac("sha256", secret).update(normalizedInput).digest("hex");
}
