import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireVerified } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createConversationSchema = z
  .object({
    otherUserId: z.string().min(1, "Thiếu otherUserId"),
    listingId: z.string().optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  // 1. Chỉ sinh viên đã duyệt thẻ mới được mở hội thoại
  const user = await requireVerified(req);
  const uid = user.uid;

  const body = await readJson(req);
  const { otherUserId, listingId } = createConversationSchema.parse(body);

  if (otherUserId === uid) {
    throw new ApiError(400, "CANNOT_CHAT_WITH_SELF", "Bạn không thể tự nhắn tin cho chính mình.");
  }

  // 2. Kiểm tra người dùng đối tác tồn tại và không bị khóa
  const otherUserSnap = await adminDb.collection("users").doc(otherUserId).get();
  if (!otherUserSnap.exists) {
    throw new ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng này trên hệ thống.");
  }

  const otherUserData = otherUserSnap.data() || {};
  if (otherUserData.deleted || otherUserData.status === "banned") {
    throw new ApiError(403, "USER_INACTIVE", "Tài khoản đối phương hiện không thể nhận tin nhắn.");
  }

  // 3. Nếu có listingId: Kiểm tra tin đăng tồn tại, active và sellerId === otherUserId
  let listingTitle = "";
  let listingPrice = 0;
  let listingCoverImage = "";

  if (listingId) {
    const listingSnap = await adminDb.collection("listings").doc(listingId).get();
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Món đồ liên kết không tồn tại.");
    }
    const listingData = listingSnap.data() || {};
    if (listingData.status !== "active" && listingData.status !== "reserved") {
      throw new ApiError(400, "LISTING_NOT_ACTIVE", "Món đồ này đã đóng hoặc đã bán.");
    }
    if (listingData.sellerId !== otherUserId && listingData.sellerId !== uid) {
      throw new ApiError(403, "NOT_SELLER", "Người dùng này không phải người bán món đồ.");
    }
    listingTitle = listingData.title || "";
    listingPrice = listingData.price || 0;
    listingCoverImage = listingData.coverImage || "";
  }

  // 4. Rate limit: 20 hội thoại mới/ngày/uid
  await consumeRateLimit({
    scope: "create_conversation",
    key: uid,
    limit: 20,
    windowSec: 24 * 3600,
    customMessage: "Bạn đã mở 20 cuộc trò chuyện mới hôm nay. Vui lòng quay lại vào ngày mai.",
  });

  // 5. Id hội thoại xác định: sorted([uidA, uidB]).join('_') + (listingId ? '_' + listingId : '')
  const sortedUids = [uid, otherUserId].sort();
  const convId = sortedUids.join("_") + (listingId ? `_${listingId}` : "");
  const convRef = adminDb.collection("conversations").doc(convId);

  // 6. Transaction: Tạo nếu chưa có, hoặc trả hội thoại cũ
  const convData = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(convRef);
    if (snap.exists) {
      return { id: convId, ...snap.data(), isNew: false };
    }

    const newConv = {
      id: convId,
      participantIds: sortedUids,
      listingId: listingId || null,
      listingTitle: listingTitle || null,
      listingPrice: listingPrice || null,
      listingCoverImage: listingCoverImage || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessage: null,
      readBy: [uid],
    };

    transaction.set(convRef, newConv);
    return { ...newConv, isNew: true };
  });

  return NextResponse.json(
    {
      success: true,
      conversationId: convId,
      conversation: convData,
    },
    { status: convData.isNew ? 201 : 200 }
  );
});
