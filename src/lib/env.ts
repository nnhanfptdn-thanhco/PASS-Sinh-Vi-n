import { z } from "zod";

const isProduction = process.env.NODE_ENV === "production";
const isEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";

const clientEnvSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1, "Thiếu biến môi trường NEXT_PUBLIC_FIREBASE_API_KEY"),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1, "Thiếu biến môi trường NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1, "Thiếu biến môi trường NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1, "Thiếu biến môi trường NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1, "Thiếu biến môi trường NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1, "Thiếu biến môi trường NEXT_PUBLIC_FIREBASE_APP_ID"),
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: z.enum(["true", "false"]).optional(),
  NEXT_PUBLIC_EMULATOR_AUTH_URL: z.string().optional(),
  NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST: z.string().optional(),
  NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT: z.string().optional(),
  NEXT_PUBLIC_EMULATOR_STORAGE_HOST: z.string().optional(),
  NEXT_PUBLIC_EMULATOR_STORAGE_PORT: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function getClientEnv(): ClientEnv {
  // Tránh crash trong các build script trên CI (như Vercel) nếu build chưa được cấu hình biến môi trường
  const isServerBuild = typeof window === "undefined";

  const rawEnv = {
    NEXT_PUBLIC_FIREBASE_API_KEY:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      (isServerBuild ? "build-placeholder-api-key" : ""),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
      (isServerBuild ? "cho-pass-sv-build.firebaseapp.com" : ""),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      (isServerBuild ? "cho-pass-sv-build" : ""),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      (isServerBuild ? "cho-pass-sv-build.appspot.com" : ""),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
      (isServerBuild ? "1234567890" : ""),
    NEXT_PUBLIC_FIREBASE_APP_ID:
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
      (isServerBuild ? "1:1234567890:web:build" : ""),
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR,
    NEXT_PUBLIC_EMULATOR_AUTH_URL: process.env.NEXT_PUBLIC_EMULATOR_AUTH_URL,
    NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST: process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_HOST,
    NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT: process.env.NEXT_PUBLIC_EMULATOR_FIRESTORE_PORT,
    NEXT_PUBLIC_EMULATOR_STORAGE_HOST: process.env.NEXT_PUBLIC_EMULATOR_STORAGE_HOST,
    NEXT_PUBLIC_EMULATOR_STORAGE_PORT: process.env.NEXT_PUBLIC_EMULATOR_STORAGE_PORT,
  };

  const result = clientEnvSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.issues.map((e) => e.message).join("; ");
    throw new Error(
      `[Lỗi Cấu Hình Môi Trường]: Không tìm thấy biến môi trường bắt buộc cho Firebase Client. Chi tiết: ${errorDetails}. Vui lòng kiểm tra lại file .env.local hoặc cấu hình Environment Variables trên Vercel/Hosting.`
    );
  }

  // Chặn nghiêm ngặt: Tuyệt đối không cho phép apiKey demo khi ở production thật (không bật emulator)
  if (isProduction && !isEmulator && result.data.NEXT_PUBLIC_FIREBASE_API_KEY.includes("demo-api-key")) {
    throw new Error(
      "[Bảo Mật Nghiêm Ngặt]: Phát hiện biến NEXT_PUBLIC_FIREBASE_API_KEY chứa mã demo trong môi trường Production. Vui lòng cung cấp API Key Firebase hợp lệ từ Firebase Console."
    );
  }

  // Chỉ cho phép key demo nếu chạy emulator
  if (
    result.data.NEXT_PUBLIC_FIREBASE_API_KEY.includes("demo-api-key") &&
    !isEmulator
  ) {
    throw new Error(
      "[Lỗi Cấu Hình]: Khóa demo chỉ được phép sử dụng khi NEXT_PUBLIC_USE_FIREBASE_EMULATOR='true'."
    );
  }

  return result.data;
}
