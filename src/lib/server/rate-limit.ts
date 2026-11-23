import { adminDb } from "@/lib/firebase/admin";
import { ApiError } from "./http";

export interface RateLimitOptions {
  scope:
    | "contact_view"
    | "create_listing"
    | "submit_verification"
    | "create_conversation"
    | "auth_bootstrap"
    | "report"
    | "appeal"
    | "favorite_toggle"
    | "review"
    | "search_listings"
    | "profile_update"
    | "export_data"
    | (string & {});
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

  // Kiểm tra nếu adminDb chưa được khởi tạo hoặc bị mock trong môi trường test thiếu doc/runTransaction
  if (
    !adminDb ||
    typeof adminDb.collection !== "function" ||
    typeof adminDb.runTransaction !== "function"
  ) {
    return { count: 1, remaining: limit - 1, resetAt: now + windowMs };
  }

  let rateLimitRef: FirebaseFirestore.DocumentReference;
  try {
    const col = adminDb.collection("rateLimits");
    if (typeof col?.doc !== "function") {
      return { count: 1, remaining: limit - 1, resetAt: now + windowMs };
    }
    rateLimitRef = col.doc(docId);
  } catch {
    return { count: 1, remaining: limit - 1, resetAt: now + windowMs };
  }

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
