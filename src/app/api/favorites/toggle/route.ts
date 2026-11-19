import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
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

  const favDocId = `${userId}_${listingId}`;
  const favRef = adminDb.collection("favorites").doc(favDocId);
  const listingRef = adminDb.collection("listings").doc(listingId);

  const result = await adminDb.runTransaction(async (transaction) => {
    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Tin đăng không tồn tại.");
    }

    const favSnap = await transaction.get(favRef);
    const isCurrentlyFavorited = favSnap.exists;

    if (isCurrentlyFavorited) {
      // Hủy yêu thích
      transaction.delete(favRef);
      transaction.update(listingRef, {
        favoritesCount: FieldValue.increment(-1),
      });
      return { favorited: false, message: "Đã xóa khỏi danh sách yêu thích." };
    } else {
      // Thêm yêu thích
      transaction.set(favRef, {
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
