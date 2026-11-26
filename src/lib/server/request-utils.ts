import "server-only";
import { NextRequest } from "next/server";
import { ApiError } from "./http";

export const FIRESTORE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidFirestoreId(id: string | null | undefined): id is string {
  return typeof id === "string" && FIRESTORE_ID_RE.test(id);
}

/**
 * Từ chối các query parameter quan trọng nếu bị truyền lặp lại (chống HTTP Parameter Pollution).
 */
export function rejectDuplicateQueryParams(
  searchParams: URLSearchParams,
  keys: readonly string[]
): void {
  for (const key of keys) {
    if (searchParams.getAll(key).length > 1) {
      throw new ApiError(
        400,
        "DUPLICATE_QUERY_PARAM",
        `Tham số truy vấn "${key}" không được phép truyền lặp lại.`
      );
    }
  }
}

/**
 * Lấy IP nguồn tin cậy từ hosting/proxy ingress thay vì tin mù header X-Forwarded-For đầu tiên do client tự chèn.
 */
export function getTrustedClientIp(req: NextRequest): string {
  const rawCandidate =
    (req as NextRequest & { ip?: string }).ip ||
    req.headers.get("x-vercel-forwarded-for")?.split(",").pop()?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "anonymous";

  const sanitized = rawCandidate.replace(/[^a-zA-Z0-9:._-]/g, "").slice(0, 64);
  return sanitized || "anonymous";
}

/**
 * Redact token, secret, email, SĐT và đường dẫn lưu trữ chứa UID trước khi ghi log hoặc lưu lastError.
 */
export function redactErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "unknown_error");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/private\/(cards|chats)\/[^/\s]+\/[^\s"']+/gi, "private/$1/[REDACTED]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
    .replace(/(?:\+84|84|0)[35789]\d{8}/g, "[PHONE_REDACTED]")
    .slice(0, 300);
}
