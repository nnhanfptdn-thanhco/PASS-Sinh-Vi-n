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
    "cho-pass-sv";

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

  // Nếu có service account: khởi tạo với cert. Ở production nếu lỗi cert -> throw lỗi (F18)
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
      if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
        throw new Error(
          `Lỗi khởi tạo Firebase Admin với Service Account: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      console.warn("Lỗi khởi tạo Firebase Admin cert:", err);
    }
  }

  // Fallback khi build hoặc chạy dev/test mà chưa nạp private key
  return initializeApp({ projectId, storageBucket });
}

let appInstance: App;
try {
  appInstance = initAdminApp();
} catch (e) {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
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
  if (!secret && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("LỖI BẢO MẬT: STUDENT_ID_HMAC_SECRET chưa được cấu hình ở môi trường production.");
  }
  const effectiveSecret = secret || "dev-fallback-cho-pass-sv-secret-key-32-chars!!";
  // Chuẩn hóa NFKC triệt để: chống ký tự full-width, homoglyph, loại bỏ toàn bộ khoảng trắng và ký tự đặc biệt
  const norm = (s: string) => (s || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cleanSchool = norm(schoolCode);
  const cleanId = norm(studentId);
  const normalizedInput = `${cleanSchool}:${cleanId}`;
  return crypto.createHmac("sha256", effectiveSecret).update(normalizedInput).digest("hex");
}
