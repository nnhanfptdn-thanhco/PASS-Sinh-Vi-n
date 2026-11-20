import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const favoriteToggleSchema = z
  .object({
    listingId: z.string().min(1, "Thiếu listingId"),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const userId = auth.uid;

  const body = await readJson(req);
  const { listingId } = favoriteToggleSchema.parse(body);

  await consumeRateLimit({
    scope: "favorite_toggle",
    key: userId,
    limit: 60,
    windowSec: 60,
    customMessage: "Thao tác quá nhanh, vui lòng chờ trong giây lát.",
  });

  const favDocId = `${userId}_${listingId}`;
  const favRef = adminDb.collection("favorites").doc(favDocId);
  const listingRef = adminDb.collection("listings").doc(listingId);

  const result = await adminDb.runTransaction(async (transaction) => {
    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Tin đăng không tồn tại.");
    }

    const listingData = listingSnap.data() || {};
    const favSnap = await transaction.get(favRef);
    const isCurrentlyFavorited = favSnap.exists;

    if (isCurrentlyFavorited) {
      // Luôn cho phép hủy yêu thích kể cả khi tin đã hết hạn hay bị ẩn
      transaction.delete(favRef);
      const currentCount = Number(listingData.favoritesCount) || 0;
      if (currentCount > 0) {
        transaction.update(listingRef, {
          favoritesCount: FieldValue.increment(-1),
        });
      }
      return { favorited: false, message: "Đã xóa khỏi danh sách yêu thích." };
    } else {
      // Chỉ cho yêu thích tin active hoặc reserved
      if (listingData.status !== "active" && listingData.status !== "reserved") {
        throw new ApiError(
          400,
          "LISTING_NOT_AVAILABLE",
          "Chỉ có thể lưu yêu thích tin đăng đang hiển thị hoặc đang giữ chỗ."
        );
      }

      transaction.set(favRef, {
        id: favDocId,
        userId,
        listingId,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(listingRef, {
        favoritesCount: FieldValue.increment(1),
      });
      return { favorited: true, message: "Đã lưu vào danh sách yêu thích!" };
    }
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
});
