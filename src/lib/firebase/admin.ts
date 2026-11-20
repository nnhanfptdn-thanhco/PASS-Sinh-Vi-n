import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";

const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

// Cấu hình môi trường Emulator cho Firebase Admin nếu được kích hoạt
if (isEmulator) {
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST ||
    `${process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST || "127.0.0.1"}:${process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT || "8080"}`;

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
  const existingApps = getApps();
  if (existingApps.length > 0) {
    return existingApps[0];
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    (process.env.NODE_ENV === "production" ? "" : "cho-pass-sv");

  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID chưa được cấu hình.");
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  const privateKey = rawKey ? rawKey.replace(/\\n/g, "\n") : undefined;

  const hasValidServiceAccount = Boolean(
    clientEmail && privateKey && privateKey.includes("PRIVATE KEY")
  );

  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    `${projectId}.appspot.com`;

  if (hasValidServiceAccount && !isEmulator) {
    try {
      return initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
        storageBucket,
      });
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `Lỗi khởi tạo Firebase Admin với Service Account: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      console.warn("Lỗi khởi tạo Firebase Admin cert:", err);
    }
  }

  if (process.env.NODE_ENV === "production" && !isEmulator) {
    throw new Error("Máy chủ production thiếu thông tin xác thực Firebase Admin Service Account.");
  }

  return initializeApp({ projectId, storageBucket });
}

let appInstance: App;
try {
  appInstance = initAdminApp();
} catch (e) {
  if (process.env.NODE_ENV === "production") {
    throw e;
  }
  appInstance = getApps()[0] || initializeApp({ projectId: "cho-pass-sv" });
}

export const app = appInstance;

export const hasAdminCredentials = Boolean(
  isEmulator ||
    (process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY.includes("PRIVATE KEY"))
);

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
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STUDENT_ID_HMAC_SECRET chưa cấu hình (>=32 ký tự).");
    }
  }
  const key = secret || "dev-only-insecure-secret-do-not-use-in-prod-0000";
  const normalizedInput = `${schoolCode.trim().toUpperCase()}:${studentId.trim().toUpperCase()}`;
  return crypto.createHmac("sha256", key).update(normalizedInput).digest("hex");
}
