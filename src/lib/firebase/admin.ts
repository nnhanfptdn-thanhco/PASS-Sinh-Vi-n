import "server-only";
import { getApps, initializeApp, cert, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";

const isProduction = process.env.NODE_ENV === "production";
const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

// Cấu hình môi trường Emulator cho Firebase Admin nếu được kích hoạt
if (isEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST
      ? `${process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST || "127.0.0.1"}:${process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT || "8080"}`
      : "127.0.0.1:8080";

  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    (process.env.NEXT_PUBLIC_EMULATOR_AUTH_URL
      ? process.env.NEXT_PUBLIC_EMULATOR_AUTH_URL.replace(/^https?:\/\//, "")
      : "127.0.0.1:9099");

  process.env.FIREBASE_STORAGE_EMULATOR_HOST =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    (process.env.NEXT_PUBLIC_EMULATOR_STORAGE_HOST
      ? `${process.env.NEXT_PUBLIC_EMULATOR_STORAGE_HOST}:${process.env.NEXT_PUBLIC_EMULATOR_STORAGE_PORT || "9199"}`
      : "127.0.0.1:9199");
}

function initAdminApp(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "cho-pass-sv-build";

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  // Khi kết nối Emulator hoặc trong quá trình build tĩnh trên hosting
  if (isEmulator || (!clientEmail && !privateKey)) {
    return initializeApp({ projectId });
  }

  const serviceAccount: ServiceAccount = {
    projectId,
    clientEmail,
    privateKey,
  };

  return initializeApp({
    credential: cert(serviceAccount),
    projectId,
    storageBucket:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      `${projectId}.appspot.com`,
  });
}

const app = initAdminApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const adminStorage = getStorage(app);
export { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Tính mã băm HMAC-SHA256 cho mã số sinh viên kết hợp mã trường.
 * BẢO MẬT: Chỉ chạy phía Server, dùng khóa bí mật trong Secret Manager / Biến môi trường.
 * Tuyệt đối không gửi mã gốc hay tính ở Client để chống đảo ngược.
 */
export function computeStudentIdHash(schoolCode: string, studentId: string): string {
  const secret = process.env.STUDENT_ID_HMAC_SECRET;

  if (!secret) {
    if (isProduction) {
      throw new Error(
        "[Bảo Mật Nghiêm Ngặt]: Thiếu biến môi trường STUDENT_ID_HMAC_SECRET trong Production."
      );
    }
    if (!isEmulator) {
      throw new Error(
        "[Cảnh Báo Bảo Mật]: Thiếu STUDENT_ID_HMAC_SECRET. Vui lòng thiết lập biến môi trường này hoặc bật emulator."
      );
    }
    // Chỉ dev emulator mới dùng tạm secret này
    return crypto
      .createHmac("sha256", "dev-emulator-secret-key-32-chars-minimum!!")
      .update(`${schoolCode.trim().toUpperCase()}:${studentId.trim().toUpperCase()}`)
      .digest("hex");
  }

  if (isProduction && secret.includes("demo-secret-key")) {
    throw new Error(
      "[Bảo Mật Nghiêm Ngặt]: STUDENT_ID_HMAC_SECRET không được dùng khóa mẫu 'demo-secret-key' trên Production."
    );
  }

  const normalizedInput = `${schoolCode.trim().toUpperCase()}:${studentId.trim().toUpperCase()}`;
  return crypto.createHmac("sha256", secret).update(normalizedInput).digest("hex");
}
