import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi, ApiError } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { isValidFirestoreId, rejectDuplicateQueryParams } from "@/lib/server/request-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function noStoreDownloadHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, private, no-cache, must-revalidate",
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}

async function fetchPagedMessages(params: {
  collectionRef: FirebaseFirestore.DocumentReference;
  cursor?: string;
  limit: number;
}) {
  const { collectionRef, cursor, limit } = params;
  const msgsCol = collectionRef.collection("messages");
  let q = msgsCol.orderBy("createdAt", "asc");

  if (cursor) {
    const cursorSnap = await msgsCol.doc(cursor).get();
    if (!cursorSnap.exists) {
      throw new ApiError(400, "INVALID_CURSOR", "Con trỏ phân trang tin nhắn không tồn tại.");
    }
    q = q.startAfter(cursorSnap);
  }

  const snap = await q.limit(limit + 1).get();
  const hasMore = snap.docs.length > limit;
  const pageDocs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
  const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]?.id || null : null;

  return {
    messages: pageDocs.map((m) => ({ id: m.id, ...m.data() })),
    pagination: {
      limit,
      returnedCount: pageDocs.length,
      hasMore,
      nextCursor,
    },
  };
}

// Tải về dữ liệu cá nhân (Quyền của chủ thể dữ liệu theo Nghị định 13/2023/NĐ-CP)
export const GET = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);
  const userId = auth.uid;

  // Yêu cầu xác thực mới trong vòng 5 phút (300s)
  const authTime = typeof auth.token.auth_time === "number" ? auth.token.auth_time : 0;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (nowInSeconds - authTime > 300) {
    throw new ApiError(
      403,
      "REAUTH_REQUIRED",
      "Vì lý do an toàn bảo mật dữ liệu cá nhân, vui lòng đăng nhập lại Google trước khi thực hiện xuất dữ liệu."
    );
  }

  const sp = new URL(req.url).searchParams;
  rejectDuplicateQueryParams(sp, ["conversationId", "aiConversationId", "cursor", "limit"]);

  const conversationId = sp.get("conversationId");
  const aiConversationId = sp.get("aiConversationId");
  const cursor = sp.get("cursor") || undefined;
  const limitRaw = Number.parseInt(sp.get("limit") || "200", 10);
  const pageLimit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 200;

  if (conversationId && !isValidFirestoreId(conversationId)) {
    throw new ApiError(400, "INVALID_CONVERSATION_ID", "Mã hội thoại không hợp lệ.");
  }
  if (aiConversationId && !isValidFirestoreId(aiConversationId)) {
    throw new ApiError(400, "INVALID_AI_CONVERSATION_ID", "Mã hội thoại NnhanAI không hợp lệ.");
  }
  if (conversationId && aiConversationId) {
    throw new ApiError(400, "AMBIGUOUS_EXPORT_TARGET", "Chỉ chọn một loại hội thoại để phân trang.");
  }
  if (cursor && !isValidFirestoreId(cursor)) {
    throw new ApiError(400, "INVALID_CURSOR", "Con trỏ phân trang không hợp lệ.");
  }

  const isPagedRequest = Boolean(conversationId || aiConversationId);
  if (cursor && !isPagedRequest) {
    throw new ApiError(
      400,
      "INVALID_CURSOR",
      "Tham số cursor chỉ được sử dụng kèm với conversationId hoặc aiConversationId."
    );
  }

  if (isPagedRequest) {
    await consumeRateLimit({
      scope: "export_data_page",
      key: userId,
      limit: 30,
      windowSec: 3600,
      customMessage: "Bạn đã tải quá nhiều trang dữ liệu trong giờ này. Vui lòng thử lại sau.",
    });
  } else {
    await consumeRateLimit({
      scope: "export_data",
      key: userId,
      limit: 2,
      windowSec: 3600,
      customMessage: "Bạn chỉ được xuất gói dữ liệu tổng hợp tối đa 2 lần mỗi giờ.",
    });
  }

  // Ghi nhận audit log không lộ nội dung tin nhắn hay dữ liệu nhạy cảm
  await adminDb
    .collection("adminLogs")
    .add({
      action: "ACCOUNT_DATA_EXPORT",
      uid: userId,
      mode: conversationId ? "conversation_page" : aiConversationId ? "ai_page" : "full_bundle",
      timestamp: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined);

  if (conversationId) {
    const convRef = adminDb.collection("conversations").doc(conversationId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
    }
    const participants = Array.isArray(convSnap.data()?.participantIds)
      ? (convSnap.data()?.participantIds as string[])
      : [];
    if (!participants.includes(userId)) {
      throw new ApiError(403, "FORBIDDEN_CONVERSATION", "Bạn không thuộc hội thoại này.");
    }

    const page = await fetchPagedMessages({
      collectionRef: convRef,
      cursor,
      limit: pageLimit,
    });

    return new NextResponse(
      JSON.stringify(
        {
          exportDate: new Date().toISOString(),
          exportMode: "conversation_messages_page",
          userId,
          conversationId,
          messages: page.messages,
          pagination: page.pagination,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: noStoreDownloadHeaders(`chopass-chat-${conversationId}.json`),
      }
    );
  }

  if (aiConversationId) {
    const aiConvRef = adminDb.collection("aiConversations").doc(aiConversationId);
    const aiSnap = await aiConvRef.get();
    if (!aiSnap.exists) {
      throw new ApiError(404, "AI_CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại NnhanAI.");
    }
    if (aiSnap.data()?.ownerUid !== userId) {
      throw new ApiError(403, "FORBIDDEN_AI_CONVERSATION", "Bạn không sở hữu hội thoại NnhanAI này.");
    }

    const page = await fetchPagedMessages({
      collectionRef: aiConvRef,
      cursor,
      limit: pageLimit,
    });

    return new NextResponse(
      JSON.stringify(
        {
          exportDate: new Date().toISOString(),
          exportMode: "ai_conversation_messages_page",
          userId,
          aiConversationId,
          messages: page.messages,
          pagination: page.pagination,
        },
        null,
        2
      ),
      {
        status: 200,
        headers: noStoreDownloadHeaders(`chopass-ai-${aiConversationId}.json`),
      }
    );
  }

  // Full export root bundle (trả trang đầu <= pageLimit cho mỗi conversation + NnhanAI history tách biệt)
  const [
    userDoc,
    userPrivateDoc,
    verifDoc,
    listingsSnap,
    buyerResSnap,
    sellerResSnap,
    sentReviewsSnap,
    receivedReviewsSnap,
    favoritesSnap,
    conversationsSnap,
    aiConversationsSnap,
  ] = await Promise.all([
    adminDb.collection("users").doc(userId).get(),
    adminDb.collection("usersPrivate").doc(userId).get(),
    adminDb.collection("verifications").doc(userId).get(),
    adminDb.collection("listings").where("sellerId", "==", userId).get(),
    adminDb.collection("reservations").where("buyerId", "==", userId).get(),
    adminDb.collection("reservations").where("sellerId", "==", userId).get(),
    adminDb.collection("reviews").where("reviewerId", "==", userId).get(),
    adminDb.collection("reviews").where("targetUserId", "==", userId).get(),
    adminDb.collection("favorites").where("userId", "==", userId).get(),
    adminDb.collection("conversations").where("participantIds", "array-contains", userId).get(),
    adminDb.collection("aiConversations").where("ownerUid", "==", userId).get(),
  ]);

  const rawVerif = verifDoc.data() || {};
  const {
    cardImagePreviewUrl,
    cardStoragePath,
    cardImagePath,
    studentIdHash,
    ...safeVerif
  } = rawVerif;
  void cardImagePreviewUrl;
  void cardStoragePath;
  void cardImagePath;
  void studentIdHash;

  // Giới hạn số tin nhắn trả inline trong gói gốc và chạy theo đợt (chunk=10) để tránh quá tải bộ nhớ / trần 4.5MB
  const bundlePageLimit = Math.min(pageLimit, 50);
  async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const batchRes = await Promise.all(items.slice(i, i + concurrency).map(fn));
      out.push(...batchRes);
    }
    return out;
  }

  const conversationsWithMessages = await mapWithConcurrency(
    conversationsSnap.docs,
    10,
    async (cDoc) => {
      const page = await fetchPagedMessages({
        collectionRef: cDoc.ref,
        limit: bundlePageLimit,
      });
      return {
        id: cDoc.id,
        ...cDoc.data(),
        messages: page.messages,
        pagination: {
          ...page.pagination,
          nextPageEndpoint: page.pagination.nextCursor
            ? `/api/account/export?conversationId=${encodeURIComponent(cDoc.id)}&cursor=${encodeURIComponent(page.pagination.nextCursor)}&limit=${pageLimit}`
            : null,
        },
      };
    }
  );

  const aiHistory = await mapWithConcurrency(
    aiConversationsSnap.docs,
    10,
    async (aDoc) => {
      const page = await fetchPagedMessages({
        collectionRef: aDoc.ref,
        limit: bundlePageLimit,
      });
      return {
        id: aDoc.id,
        ...aDoc.data(),
        messages: page.messages,
        pagination: {
          ...page.pagination,
          nextPageEndpoint: page.pagination.nextCursor
            ? `/api/account/export?aiConversationId=${encodeURIComponent(aDoc.id)}&cursor=${encodeURIComponent(page.pagination.nextCursor)}&limit=${pageLimit}`
            : null,
        },
      };
    }
  );

  const hasTruncatedConversations =
    conversationsWithMessages.some((c) => c.pagination.hasMore) ||
    aiHistory.some((a) => a.pagination.hasMore);

  const exportData = {
    exportDate: new Date().toISOString(),
    exportMode: "full_bundle",
    userId,
    publicProfile: userDoc.data() || null,
    privateProfile: userPrivateDoc.data() || null,
    verificationRecord: verifDoc.exists
      ? {
          ...safeVerif,
          hasUploadedCardOnFile: Boolean(cardStoragePath) && !rawVerif.cardDeleted,
        }
      : null,
    myListings: listingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    myReservationsAsBuyer: buyerResSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    myReservationsAsSeller: sellerResSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    reviewsWritten: sentReviewsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    reviewsReceived: receivedReviewsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    favorites: favoritesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    conversations: conversationsWithMessages,
    aiAssistantHistory: aiHistory,
    pagination: {
      pageLimitPerConversation: pageLimit,
      hasMorePagesInConversations: hasTruncatedConversations,
      note: hasTruncatedConversations
        ? "Một số hội thoại có nhiều hơn giới hạn trang hiện tại. Hãy gọi `nextPageEndpoint` (với conversationId/aiConversationId và cursor) để lấy đầy đủ toàn bộ lịch sử tin nhắn."
        : "Tất cả hội thoại đã được bao gồm đầy đủ trong tệp này.",
    },
    retentionPolicy: {
      excludedSecretsAndSensitiveArtifacts: [
        "Raw student card images",
        "HMAC studentIdHash",
        "Auth tokens & session secrets",
      ],
      postAccountDeletionRetention:
        "Sau khi xóa tài khoản, hồ sơ cá nhân/chat/ảnh bị xóa; dữ liệu giao dịch và báo cáo đã ẩn danh (chống gian lận) được lưu tối đa 90 ngày trước khi tự hủy.",
    },
    legalNotice:
      "Dữ liệu được xuất căn cứ quyền của chủ thể dữ liệu tại Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.",
  };

  return new NextResponse(JSON.stringify(exportData), {
    status: 200,
    headers: noStoreDownloadHeaders(`chopass-data-${userId}.json`),
  });
});
