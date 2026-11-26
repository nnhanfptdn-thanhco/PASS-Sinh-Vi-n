import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { isValidFirestoreId, rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import {
  assertParticipantConversation,
  deterministicMessageId,
  isValidChatAttachmentPath,
  signChatAttachmentReadUrl,
  timestampToMs,
  withNoStore,
} from "@/lib/server/chat";
import {
  detectChatContactWarning,
  MAX_MESSAGE_LENGTH,
  sanitizeLastMessagePreview,
  type ChatMessageDTO,
} from "@/lib/chat/types";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORBIDDEN_KEYS = new Set([
  "senderId",
  "participantIds",
  "listingId",
  "admin",
  "role",
  "verified",
  "createdAt",
]);

const sendMessageSchema = z
  .object({
    clientMessageId: z
      .string()
      .min(6, "Thiếu clientMessageId")
      .max(100)
      .regex(/^[A-Za-z0-9_-]{6,100}$/, "clientMessageId không hợp lệ"),
    type: z.enum(["text", "image"]),
    text: z.string().trim().max(MAX_MESSAGE_LENGTH, `Tin nhắn tối đa ${MAX_MESSAGE_LENGTH} ký tự`).optional().nullable(),
    attachmentPath: z.string().max(300).optional().nullable(),
    attachmentMimeType: z.enum(["image/webp", "image/jpeg"]).optional().nullable(),
    attachmentSize: z.number().int().positive().max(3 * 1024 * 1024).optional().nullable(),
    uploadSessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional().nullable(),
  })
  .strict();

function toMessageDTO(
  id: string,
  raw: Record<string, unknown>,
  signedUrl: string | null = null,
  fallbackCreatedAtMs: number | null = null
): ChatMessageDTO {
  return {
    id,
    senderId: String(raw.senderId || ""),
    type: raw.type === "image" ? "image" : raw.type === "system" ? "system" : "text",
    text: typeof raw.text === "string" ? raw.text : null,
    attachmentPath: typeof raw.attachmentPath === "string" ? raw.attachmentPath : null,
    attachmentUrl: signedUrl,
    attachmentMimeType:
      typeof raw.attachmentMimeType === "string" ? raw.attachmentMimeType : null,
    attachmentSize: typeof raw.attachmentSize === "number" ? raw.attachmentSize : null,
    createdAtMs: timestampToMs(raw.createdAt) ?? fallbackCreatedAtMs,
    clientMessageId: String(raw.clientMessageId || id),
    moderationStatus:
      raw.moderationStatus === "flagged" || raw.moderationStatus === "removed"
        ? raw.moderationStatus
        : "normal",
  };
}

export async function GET(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const conversationId = context.params?.conversationId || "";
    const { auth, convRef } = await assertParticipantConversation(req, conversationId, false);

    await consumeRateLimit({
      scope: "chat_read_messages",
      key: `${auth.uid}_${conversationId}`,
      limit: 120,
      windowSec: 60,
    });

    const sp = new URL(req.url).searchParams;
    rejectDuplicateQueryParams(sp, ["cursor", "limit"]);
    const cursor = sp.get("cursor") || undefined;
    const limitRaw = Number.parseInt(sp.get("limit") || "30", 10);
    const pageLimit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 30;

    if (cursor && !isValidFirestoreId(cursor)) {
      throw new ApiError(400, "INVALID_CURSOR", "Con trỏ tin nhắn không hợp lệ.");
    }

    const msgsCol = convRef.collection("messages");
    let q = msgsCol.orderBy("createdAt", "desc");

    if (cursor) {
      const cursorSnap = await msgsCol.doc(cursor).get();
      if (!cursorSnap.exists) {
        throw new ApiError(400, "INVALID_CURSOR", "Tin nhắn mốc phân trang không tồn tại.");
      }
      q = q.startAfter(cursorSnap);
    }

    const snap = await q.limit(pageLimit + 1).get();
    const hasMore = snap.docs.length > pageLimit;
    const pageDocs = hasMore ? snap.docs.slice(0, pageLimit) : snap.docs;
    const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]?.id || null : null;

    const items = await Promise.all(
      pageDocs.map(async (d) => {
        const raw = (d.data() || {}) as Record<string, unknown>;
        const attPath = typeof raw.attachmentPath === "string" ? raw.attachmentPath : null;
        const signedUrl = attPath ? await signChatAttachmentReadUrl(attPath) : null;
        return toMessageDTO(d.id, raw, signedUrl);
      })
    );

    // Đảo về thứ tự cũ -> mới cho UI dễ ghép
    items.reverse();

    return withNoStore(
      NextResponse.json({
        success: true,
        items,
        pagination: {
          limit: pageLimit,
          hasMore,
          nextCursor,
        },
      })
    );
  })(req);
}

export async function POST(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const conversationId = context.params?.conversationId || "";
    const { auth, convRef, otherUid } = await assertParticipantConversation(
      req,
      conversationId,
      true
    );

    const rawBody = await readJson<Record<string, unknown>>(req, 16 * 1024);
    if (rawBody && typeof rawBody === "object") {
      for (const forbidden of Array.from(FORBIDDEN_KEYS)) {
        if (forbidden in rawBody) {
          throw new ApiError(
            400,
            "FORBIDDEN_BODY_FIELDS",
            `Trường "${forbidden}" do máy chủ quản lý và không được gửi từ client.`
          );
        }
      }
    }

    const data = sendMessageSchema.parse(rawBody);

    if (data.type === "text" && (!data.text || data.text.length === 0)) {
      throw new ApiError(400, "EMPTY_MESSAGE", "Nội dung tin nhắn không được để trống.");
    }
    if (data.type === "image") {
      if (!data.attachmentPath || !isValidChatAttachmentPath(conversationId, data.attachmentPath)) {
        throw new ApiError(
          400,
          "INVALID_ATTACHMENT_PATH",
          "Đường dẫn ảnh đính kèm không hợp lệ hoặc không thuộc hội thoại này."
        );
      }
      if (!data.uploadSessionId) {
        throw new ApiError(400, "MISSING_UPLOAD_SESSION", "Thiếu uploadSessionId cho ảnh đính kèm.");
      }
    }

    const msgId = deterministicMessageId(auth.uid, data.clientMessageId);
    const msgRef = convRef.collection("messages").doc(msgId);
    const uploadSessionRef =
      data.type === "image" && data.uploadSessionId
        ? adminDb.collection("uploadSessions").doc(data.uploadSessionId)
        : null;

    // Kiểm tra trùng clientMessageId trước khi trừ lượt rate-limit (chống đốt quota khi retry mạng)
    if (typeof msgRef.get === "function") {
      const preExisting = await msgRef.get();
      if (preExisting.exists) {
        const rawExisting = (preExisting.data() || {}) as Record<string, unknown>;
        const existingSignedUrl =
          typeof rawExisting.attachmentPath === "string"
            ? await signChatAttachmentReadUrl(rawExisting.attachmentPath)
            : null;
        return withNoStore(
          NextResponse.json(
            {
              success: true,
              duplicate: true,
              message: toMessageDTO(msgId, rawExisting, existingSignedUrl),
              contactWarning: data.text ? detectChatContactWarning(data.text) : null,
            },
            { status: 200 }
          )
        );
      }
    }

    await consumeRateLimit({
      scope: "chat_msg_uid",
      key: auth.uid,
      limit: 40,
      windowSec: 60,
      customMessage: "Bạn gửi tin nhắn quá nhanh. Vui lòng chậm lại giây lát.",
    });
    await consumeRateLimit({
      scope: "chat_msg_conv",
      key: `${auth.uid}_${conversationId}`,
      limit: 20,
      windowSec: 60,
      customMessage: "Bạn gửi quá nhiều tin nhắn liên tiếp trong hội thoại này.",
    });

    const contactWarning = data.text ? detectChatContactWarning(data.text) : null;
    const moderationStatus: "normal" | "flagged" = contactWarning ? "flagged" : "normal";
    const sendNowMs = Date.now();

    const txResult = await adminDb.runTransaction(async (tx) => {
      const [convSnap, existingMsgSnap, sessionSnap] = await Promise.all([
        tx.get(convRef),
        tx.get(msgRef),
        uploadSessionRef ? tx.get(uploadSessionRef) : Promise.resolve(null),
      ]);

      if (!convSnap.exists) {
        throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
      }
      const cData = (convSnap.data() || {}) as Record<string, unknown>;
      const participants = Array.isArray(cData.participantIds)
        ? (cData.participantIds as string[])
        : [];
      if (!participants.includes(auth.uid)) {
        throw new ApiError(403, "FORBIDDEN_CONVERSATION", "Bạn không thuộc hội thoại này.");
      }

      if (existingMsgSnap.exists) {
        return {
          duplicate: true,
          raw: (existingMsgSnap.data() || {}) as Record<string, unknown>,
        };
      }

      const blockedBy = (cData.blockedBy || {}) as Record<string, boolean>;
      if (cData.status !== "active" || Object.values(blockedBy).some(Boolean)) {
        throw new ApiError(
          403,
          "CONVERSATION_BLOCKED",
          "Hội thoại này đang bị khóa hoặc một trong hai bên đã chặn tin nhắn."
        );
      }

      if (data.type === "image") {
        if (!sessionSnap?.exists) {
          throw new ApiError(400, "UPLOAD_SESSION_NOT_FOUND", "Phiên upload ảnh không tồn tại.");
        }
        const sData = sessionSnap.data() || {};
        const allowed = Array.isArray(sData.allowedPaths) ? (sData.allowedPaths as string[]) : [];
        const uploaded = Array.isArray(sData.uploadedPaths) ? (sData.uploadedPaths as string[]) : [];
        const expiryMs = timestampToMs(sData.expiresAt);
        if (
          sData.ownerUid !== auth.uid ||
          sData.kind !== "chat" ||
          sData.targetId !== conversationId ||
          !allowed.includes(data.attachmentPath!)
        ) {
          throw new ApiError(403, "UPLOAD_SESSION_FORBIDDEN", "Ảnh đính kèm không khớp phiên upload của bạn.");
        }
        if (sData.claimed === true || sData.status === "claimed" || sData.status === "cleaned") {
          throw new ApiError(409, "UPLOAD_SESSION_CLOSED", "Phiên upload ảnh này đã được sử dụng hoặc đã đóng.");
        }
        if (expiryMs !== null && expiryMs <= sendNowMs) {
          throw new ApiError(409, "UPLOAD_SESSION_EXPIRED", "Phiên upload ảnh đã hết hạn. Vui lòng chọn lại ảnh.");
        }
        if (sData.status !== "finalized" || !uploaded.includes(data.attachmentPath!)) {
          throw new ApiError(
            400,
            "UPLOAD_NOT_FINALIZED",
            "Ảnh đính kèm chưa được xác minh hoàn tất trên Storage."
          );
        }
        tx.update(uploadSessionRef!, {
          claimed: true,
          status: "claimed",
          messageId: msgId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      const newMsg: Record<string, unknown> = {
        senderId: auth.uid,
        type: data.type,
        text: data.text || null,
        attachmentPath: data.type === "image" ? data.attachmentPath || null : null,
        attachmentMimeType: data.type === "image" ? data.attachmentMimeType || "image/webp" : null,
        attachmentSize: data.type === "image" ? data.attachmentSize || null : null,
        createdAt: FieldValue.serverTimestamp(),
        editedAt: null,
        deletedAt: null,
        clientMessageId: data.clientMessageId,
        moderationStatus,
      };

      const preview = sanitizeLastMessagePreview(data.type, data.text || null);
      const convUpdate: Record<string, unknown> = {
        lastMessage: preview,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageSenderId: auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (otherUid) {
        convUpdate[`unreadCountByUser.${otherUid}`] = FieldValue.increment(1);
      }

      tx.set(msgRef, newMsg);
      tx.update(convRef, convUpdate);

      return { duplicate: false, raw: newMsg };
    });

    const signedUrl =
      txResult.raw.attachmentPath && typeof txResult.raw.attachmentPath === "string"
        ? await signChatAttachmentReadUrl(txResult.raw.attachmentPath)
        : null;

    return withNoStore(
      NextResponse.json(
        {
          success: true,
          duplicate: txResult.duplicate,
          message: toMessageDTO(msgId, txResult.raw, signedUrl, txResult.duplicate ? null : sendNowMs),
          contactWarning,
        },
        { status: txResult.duplicate ? 200 : 201 }
      )
    );
  })(req);
}
