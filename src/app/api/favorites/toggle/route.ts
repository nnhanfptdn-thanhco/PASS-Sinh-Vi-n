import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { isPastDeadline } from "@/lib/utils/date";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const favoriteToggleSchema = z
  .object({
    listingId: FIRESTORE_ID_SCHEMA,
  })
  .strict();

export const GET = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const snap = await adminDb
    .collection("favorites")
    .where("userId", "==", auth.uid)
    .limit(200)
    .get();

  const listingIds = snap.docs
    .map((d) => String(d.data()?.listingId || ""))
    .filter(Boolean);

  return NextResponse.json({
    success: true,
    listingIds,
  });
});

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
      // Chỉ cho yêu thích tin active hoặc reserved, còn hạn và không đang xử lý operationStatus
      const passDeadline = String(listingData.passDeadline || "");
      if (
        (listingData.status !== "active" && listingData.status !== "reserved") ||
        Boolean(listingData.operationStatus) ||
        (passDeadline && isPastDeadline(passDeadline))
      ) {
        throw new ApiError(
          400,
          "LISTING_NOT_AVAILABLE",
          "Chỉ có thể lưu yêu thích tin đăng đang hiển thị hoặc đang giữ chỗ còn hiệu lực."
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
