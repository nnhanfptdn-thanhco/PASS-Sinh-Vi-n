import { adminDb } from "@/lib/firebase/admin";
import { ApiError } from "./http";

export interface RateLimitOptions {
  scope: "contact_view" | "create_listing" | "submit_verification" | "create_conversation" | "auth_bootstrap";
  key: string;
  limit: number;
  windowSec: number;
  customMessage?: string;
}

/**
 * Giới hạn tần suất lưu bền bằng Firestore Transaction (An toàn 100% trên Vercel Serverless)
 * Tránh hoàn toàn việc mất cache in-memory khi cold-start.
 */
export async function consumeRateLimit({
  scope,
  key,
  limit,
  windowSec,
  customMessage,
}: RateLimitOptions): Promise<{ count: number; remaining: number; resetAt: number }> {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const docId = `${scope}_${key}_${windowIndex}`;
  const rateLimitRef = adminDb.collection("rateLimits").doc(docId);

  const windowExpiresAt = new Date((windowIndex + 1) * windowMs);
  const retryAfter = Math.max(1, Math.ceil(((windowIndex + 1) * windowMs - now) / 1000));

  return await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(rateLimitRef);

    let count = 0;
    if (snap.exists) {
      count = (snap.data()?.count as number) || 0;
    }

    if (count >= limit) {
      const msg =
        customMessage ||
        `Bạn đã thao tác quá nhanh. Giới hạn tối đa ${limit} lần mỗi chu kỳ. Vui lòng thử lại sau ${retryAfter} giây.`;
      throw new ApiError(429, "RATE_LIMIT_EXCEEDED", msg, { retryAfter });
    }

    const nextCount = count + 1;
    transaction.set(
      rateLimitRef,
      {
        scope,
        key,
        count: nextCount,
        expiresAt: windowExpiresAt,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    return {
      count: nextCount,
      remaining: Math.max(0, limit - nextCount),
      resetAt: windowExpiresAt.getTime(),
    };
  });
}
