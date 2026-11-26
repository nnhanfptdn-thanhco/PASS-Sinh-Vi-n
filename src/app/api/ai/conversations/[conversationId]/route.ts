import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { isValidFirestoreId } from "@/lib/server/request-utils";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { timestampToMs, withNoStore } from "@/lib/server/chat";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const feedbackSchema = z
  .object({
    messageId: FIRESTORE_ID_SCHEMA,
    rating: z.enum(["helpful", "not_helpful"]),
  })
  .strict();

async function loadOwnedAIConversation(uid: string, conversationId: string) {
  if (!isValidFirestoreId(conversationId)) {
    throw new ApiError(400, "INVALID_CONVERSATION_ID", "Mã hội thoại NnhanAI không hợp lệ.");
  }
  const convRef = adminDb.collection("aiConversations").doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new ApiError(404, "AI_CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại NnhanAI.");
  }
  if (convSnap.data()?.ownerUid !== uid) {
    throw new ApiError(403, "FORBIDDEN_AI_CONVERSATION", "Bạn không có quyền truy cập hội thoại này.");
  }
  return { convRef, convData: convSnap.data() || {} };
}

export async function GET(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const auth = await requireActiveUser(req);
    await consumeRateLimit({
      scope: "ai_conv_read",
      key: auth.uid,
      limit: 60,
      windowSec: 600,
    });
    const convId = context.params?.conversationId || "";
    const { convRef, convData } = await loadOwnedAIConversation(auth.uid, convId);

    const msgsSnap = await convRef
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const messages = msgsSnap.docs
      .map((d) => {
        const m = d.data() || {};
        return {
          id: d.id,
          role: m.role === "assistant" ? "assistant" : "user",
          text: String(m.text || ""),
          citations: Array.isArray(m.citations) ? m.citations : [],
          feedback: m.feedback === "helpful" || m.feedback === "not_helpful" ? m.feedback : null,
          createdAtMs: timestampToMs(m.createdAt),
        };
      })
      .reverse();

    return withNoStore(
      NextResponse.json({
        success: true,
        conversation: {
          id: convId,
          title: typeof convData.title === "string" ? convData.title : "Hội thoại NnhanAI",
        },
        messages,
      })
    );
  })(req);
}

export async function DELETE(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const auth = await requireActiveUser(req);
    await consumeRateLimit({
      scope: "ai_conv_delete",
      key: auth.uid,
      limit: 30,
      windowSec: 600,
    });
    const convId = context.params?.conversationId || "";
    const { convRef } = await loadOwnedAIConversation(auth.uid, convId);

    await adminDb.recursiveDelete(convRef);
    return withNoStore(
      NextResponse.json({
        success: true,
        conversationId: convId,
      })
    );
  })(req);
}

export async function POST(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const auth = await requireActiveUser(req);
    const convId = context.params?.conversationId || "";
    const { convRef } = await loadOwnedAIConversation(auth.uid, convId);

    await consumeRateLimit({
      scope: "ai_feedback",
      key: auth.uid,
      limit: 60,
      windowSec: 600,
    });

    const data = feedbackSchema.parse(await readJson(req, 4096));
    const msgRef = convRef.collection("messages").doc(data.messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) {
      throw new ApiError(404, "AI_MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn NnhanAI.");
    }

    await msgRef.update({
      feedback: data.rating,
      feedbackAt: FieldValue.serverTimestamp(),
    });

    return withNoStore(
      NextResponse.json({
        success: true,
        messageId: data.messageId,
        feedback: data.rating,
      })
    );
  })(req);
}
