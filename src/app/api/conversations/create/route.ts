import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApprovedStudent } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import {
  buildCanonicalConversationId,
  toConversationDTO,
  toPublicPartnerSummary,
  withNoStore,
} from "@/lib/server/chat";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { isPastDeadline } from "@/lib/utils/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createConversationSchema = z
  .object({
    otherUserId: FIRESTORE_ID_SCHEMA,
    listingId: FIRESTORE_ID_SCHEMA.optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  // 1. Chỉ tài khoản active + sinh viên đã duyệt thẻ trên Firestore mới được mở hội thoại
  const user = await requireApprovedStudent(req);
  const uid = user.uid;

  const body = await readJson(req);
  const { otherUserId, listingId } = createConversationSchema.parse(body);

  if (otherUserId === uid) {
    throw new ApiError(400, "CANNOT_CHAT_WITH_SELF", "Bạn không thể tự nhắn tin cho chính mình.");
  }

  // 2. Kiểm tra đối tác tồn tại và đang active (không deleting / banned / disabled / deleted)
  const [otherUserSnap, otherPendingDelSnap] = await Promise.all([
    adminDb.collection("users").doc(otherUserId).get(),
    adminDb.collection("pendingDeletions").doc(otherUserId).get(),
  ]);

  if (!otherUserSnap.exists) {
    throw new ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng này trên hệ thống.");
  }

  const otherUserData = (otherUserSnap.data() || {}) as Record<string, unknown>;
  const otherAccountStatus = String(otherUserData.accountStatus || "active");
  const otherDeletionState = String(otherUserData.deletionState || "");
  if (
    otherPendingDelSnap.exists ||
    otherAccountStatus !== "active" ||
    otherUserData.deleted === true ||
    otherUserData.disabled === true ||
    otherUserData.status === "banned" ||
    otherUserData.status === "disabled" ||
    otherDeletionState === "pending" ||
    otherDeletionState === "deleting" ||
    otherDeletionState === "deleted"
  ) {
    throw new ApiError(403, "USER_INACTIVE", "Tài khoản đối phương hiện không thể nhận tin nhắn.");
  }

  // 3. Kiểm tra context listing hoặc reservation hợp lệ (không mở DM tự do)
  let listingTitle: string | null = null;
  let listingPrice: number | null = null;
  let listingCoverImage: string | null = null;

  if (listingId) {
    const listingSnap = await adminDb.collection("listings").doc(listingId).get();
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Món đồ liên kết không tồn tại.");
    }
    const listingData = (listingSnap.data() || {}) as Record<string, unknown>;
    const passDeadline = String(listingData.passDeadline || "");
    if (
      (listingData.status !== "active" && listingData.status !== "reserved") ||
      Boolean(listingData.operationStatus) ||
      (passDeadline && isPastDeadline(passDeadline))
    ) {
      throw new ApiError(400, "LISTING_NOT_ACTIVE", "Món đồ này đã đóng, hết hạn hoặc đã bán.");
    }

    const isBuyerInitiating = listingData.sellerId === otherUserId;
    let isSellerReplyToBuyer = false;

    if (!isBuyerInitiating && listingData.sellerId === uid) {
      const resSnap = await adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("buyerId", "==", otherUserId)
        .limit(1)
        .get();
      isSellerReplyToBuyer = !resSnap.empty;
    }

    if (!isBuyerInitiating && !isSellerReplyToBuyer) {
      throw new ApiError(
        403,
        "NOT_SELLER",
        "Bạn không thể mở hội thoại về món đồ này với người dùng đó."
      );
    }

    listingTitle = typeof listingData.title === "string" ? listingData.title : null;
    listingPrice = typeof listingData.price === "number" ? listingData.price : null;
    listingCoverImage =
      typeof listingData.coverImage === "string" ? listingData.coverImage : null;
  } else {
    const [resAsBuyer, resAsSeller] = await Promise.all([
      adminDb
        .collection("reservations")
        .where("buyerId", "==", uid)
        .where("sellerId", "==", otherUserId)
        .limit(1)
        .get(),
      adminDb
        .collection("reservations")
        .where("sellerId", "==", uid)
        .where("buyerId", "==", otherUserId)
        .limit(1)
        .get(),
    ]);

    if (resAsBuyer.empty && resAsSeller.empty) {
      throw new ApiError(
        400,
        "LISTING_OR_RESERVATION_REQUIRED",
        "Chỉ được mở hội thoại gắn liền với món đồ hoặc khi hai bên đã có giữ chỗ."
      );
    }
  }

  // 4. ID canonical xác định chống va chạm
  const sortedUids = [uid, otherUserId].sort();
  const convId = buildCanonicalConversationId(sortedUids[0], sortedUids[1], listingId);
  const convRef = adminDb.collection("conversations").doc(convId);
  const partnerSummary = toPublicPartnerSummary(otherUserId, otherUserData);

  // Kiểm tra tồn tại trước khi tiêu quota rate limit (F21)
  const existingConvSnap = await convRef.get();
  if (existingConvSnap.exists) {
    const dto = toConversationDTO(
      convId,
      (existingConvSnap.data() || {}) as Record<string, unknown>,
      uid,
      partnerSummary
    );
    return withNoStore(
      NextResponse.json(
        {
          success: true,
          conversationId: convId,
          isNew: false,
          conversation: dto,
        },
        { status: 200 }
      )
    );
  }

  // 5. Rate limit: 20 hội thoại mới / ngày / uid
  await consumeRateLimit({
    scope: "create_conversation",
    key: uid,
    limit: 20,
    windowSec: 24 * 3600,
    customMessage: "Bạn đã mở 20 cuộc trò chuyện mới hôm nay. Vui lòng quay lại vào ngày mai.",
  });

  // 6. Transaction: Tạo hội thoại mới theo schema chuẩn D4
  const txResult = await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(convRef);
    if (snap.exists) {
      return {
        isNew: false,
        raw: (snap.data() || {}) as Record<string, unknown>,
      };
    }

    const newConv: Record<string, unknown> = {
      id: convId,
      participantIds: sortedUids,
      listingId: listingId || null,
      listingTitle,
      listingPrice,
      listingCoverImage,
      lastMessage: null,
      lastMessageAt: null,
      lastMessageSenderId: null,
      unreadCountByUser: {
        [sortedUids[0]]: 0,
        [sortedUids[1]]: 0,
      },
      readAtByUser: {
        [uid]: FieldValue.serverTimestamp(),
        [otherUserId]: null,
      },
      status: "active",
      blockedBy: {},
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    transaction.set(convRef, newConv);
    return { isNew: true, raw: newConv };
  });

  const dto = toConversationDTO(convId, txResult.raw, uid, partnerSummary);

  return withNoStore(
    NextResponse.json(
      {
        success: true,
        conversationId: convId,
        isNew: txResult.isNew,
        conversation: dto,
      },
      { status: txResult.isNew ? 201 : 200 }
    )
  );
});
