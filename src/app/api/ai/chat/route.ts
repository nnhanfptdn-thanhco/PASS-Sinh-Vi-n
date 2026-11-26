import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { todayVN } from "@/lib/utils/date";
import { retrievePublicContextForAI } from "@/lib/ai/retrieval";
import {
  buildRetrievalContextBlock,
  checkPrivateOrSecretRequest,
  createRollingSecretRedactor,
  NNHANAI_SYSTEM_PROMPT,
  redactSecretsFromOutput,
} from "@/lib/ai/prompt";
import { getAIProvider } from "@/lib/ai/provider";
import { timestampToMs, withNoStore } from "@/lib/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AI_DAILY_REQUEST_LIMIT = 60;
const AI_DAILY_TOKEN_LIMIT = 40_000;

const aiChatSchema = z
  .object({
    conversationId: FIRESTORE_ID_SCHEMA.optional(),
    message: z
      .string()
      .trim()
      .min(1, "Vui lòng nhập câu hỏi cho NnhanAI")
      .max(1500, "Câu hỏi tối đa 1500 ký tự"),
    listingId: FIRESTORE_ID_SCHEMA.optional(),
    stream: z.boolean().optional().default(true),
  })
  .strict();

async function consumeDailyAIQuota(uid: string, estimatedInputTokens: number): Promise<void> {
  const dateStr = todayVN();
  const quotaRef = adminDb.collection("userAiQuotas").doc(`${uid}_${dateStr}`);

  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(quotaRef);
      const data = snap.exists ? snap.data() || {} : {};
      const usedReq = Number(data.requestCount || 0);
      const usedTokens = Number(data.tokensUsed || 0);

      if (usedReq >= AI_DAILY_REQUEST_LIMIT) {
        throw new ApiError(
          429,
          "AI_DAILY_QUOTA_EXCEEDED",
          `Bạn đã dùng hết ${AI_DAILY_REQUEST_LIMIT} lượt hỏi NnhanAI trong ngày hôm nay.`
        );
      }
      if (usedTokens + estimatedInputTokens > AI_DAILY_TOKEN_LIMIT) {
        throw new ApiError(
          429,
          "AI_TOKEN_BUDGET_EXCEEDED",
          "Bạn đã chạm ngưỡng hạn mức xử lý NnhanAI trong ngày hôm nay."
        );
      }

      tx.set(
        quotaRef,
        {
          uid,
          date: dateStr,
          requestCount: usedReq + 1,
          tokensUsed: usedTokens + estimatedInputTokens,
          expiresAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      503,
      "AI_QUOTA_UNAVAILABLE",
      "Hệ thống kiểm soát hạn mức NnhanAI tạm thời gián đoạn."
    );
  }
}

async function addTokenUsage(uid: string, outputTokens: number): Promise<void> {
  if (outputTokens <= 0) return;
  const dateStr = todayVN();
  const quotaRef = adminDb.collection("userAiQuotas").doc(`${uid}_${dateStr}`);
  await quotaRef
    .set(
      {
        tokensUsed: FieldValue.increment(outputTokens),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    .catch(() => undefined);
}

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);
  const uid = auth.uid;

  const body = await readJson(req, 16 * 1024);
  const data = aiChatSchema.parse(body);

  // 1. Burst rate limit fail-closed trước mọi truy vấn nặng
  await consumeRateLimit({
    scope: "ai_chat_burst",
    key: uid,
    limit: 12,
    windowSec: 60,
    customMessage: "Bạn gửi câu hỏi cho NnhanAI quá nhanh. Vui lòng đợi vài giây.",
  });

  // 2. Xác định / kiểm tra quyền sở hữu aiConversation TRƯỚC khi tiêu quota ngày
  // (tuyệt đối không đọc/ghi buyer-seller conversations)
  const isNewConv = !data.conversationId;
  const convId =
    data.conversationId || `ai_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const convRef = adminDb.collection("aiConversations").doc(convId);

  let history: Array<{ role: "user" | "assistant"; text: string }> = [];
  if (!isNewConv) {
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      throw new ApiError(404, "AI_CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại NnhanAI.");
    }
    if (convSnap.data()?.ownerUid !== uid) {
      throw new ApiError(403, "FORBIDDEN_AI_CONVERSATION", "Bạn không sở hữu hội thoại NnhanAI này.");
    }
    const histSnap = await convRef
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(8)
      .get();
    history = histSnap.docs
      .map((d) => ({
        role: (d.data().role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        text: String(d.data().text || ""),
      }))
      .reverse();
  }

  // 3. Daily AI quota (chỉ trừ sau khi conversationId hợp lệ)
  const estPromptTokens = Math.ceil(data.message.length / 3);
  await consumeDailyAIQuota(uid, estPromptTokens);

  // 4. Pre-guardrail: từ chối ngay yêu cầu đọc SĐT/Zalo/exactAddress/MSSV/keys/chat riêng tư
  const guardrail = checkPrivateOrSecretRequest(data.message);

  let finalReplyText = "";
  let citations: Array<{ kind: "listing" | "help"; id: string; title: string; url: string }> = [];
  let providerMeta = {
    providerName: "guardrail",
    modelName: "policy-v1",
    outputTokensEstimate: 0,
  };

  if (guardrail.blocked && guardrail.replyText) {
    finalReplyText = guardrail.replyText;
  } else {
    const retrieved = await retrievePublicContextForAI({
      query: data.message,
      listingId: data.listingId,
    });
    citations = retrieved.citations;
    const contextBlock = buildRetrievalContextBlock({
      listings: retrieved.listings,
      helpDocs: retrieved.helpDocs,
    });

    if (!data.stream) {
      const provider = getAIProvider();
      const result = await provider.generate({
        systemPrompt: NNHANAI_SYSTEM_PROMPT,
        contextBlock,
        history,
        userMessage: data.message,
        listings: retrieved.listings,
        helpDocs: retrieved.helpDocs,
        signal: req.signal,
      });
      finalReplyText = redactSecretsFromOutput(result.text);
      providerMeta = {
        providerName: result.providerName,
        modelName: result.modelName,
        outputTokensEstimate:
          result.outputTokensEstimate ?? Math.ceil(finalReplyText.length / 3),
      };
    } else {
      // Streaming SSE branch với rolling redaction và bảo vệ đóng stream an toàn
      const encoder = new TextEncoder();
      const provider = getAIProvider();
      const streamAbort = new AbortController();
      const onReqAbort = () => streamAbort.abort(req.signal.reason);
      if (req.signal.aborted) {
        streamAbort.abort(req.signal.reason);
      } else {
        req.signal.addEventListener("abort", onReqAbort, { once: true });
      }

      let closed = false;

      const sseStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const safeEnqueue = (event: string, payload: unknown) => {
            if (closed || streamAbort.signal.aborted) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
              );
            } catch {
              closed = true;
            }
          };

          const redactor = createRollingSecretRedactor(48);

          try {
            safeEnqueue("meta", { conversationId: convId, citations, persisted: !isNewConv });

            let streamedBuffer = "";
            const result = await provider.generate({
              systemPrompt: NNHANAI_SYSTEM_PROMPT,
              contextBlock,
              history,
              userMessage: data.message,
              listings: retrieved.listings,
              helpDocs: retrieved.helpDocs,
              signal: streamAbort.signal,
              onToken: (delta) => {
                const safePiece = redactor.push(delta);
                if (safePiece) {
                  streamedBuffer += safePiece;
                  safeEnqueue("delta", { text: safePiece });
                }
              },
            });

            const tailPiece = redactor.flush();
            if (tailPiece) {
              streamedBuffer += tailPiece;
              safeEnqueue("delta", { text: tailPiece });
            }

            if (streamAbort.signal.aborted || closed) {
              return;
            }

            const safeFull = redactSecretsFromOutput(result.text || streamedBuffer);
            const titleSnippet = redactSecretsFromOutput(data.message).slice(0, 60);
            const userTs = new Date();
            const aiTs = new Date(userTs.getTime() + 5);
            const userMsgId = `u_${userTs.getTime()}_${crypto.randomUUID().slice(0, 6)}`;
            const aiMsgId = `a_${aiTs.getTime()}_${crypto.randomUUID().slice(0, 6)}`;

            const batch = adminDb.batch();
            batch.set(
              convRef,
              {
                id: convId,
                ownerUid: uid,
                status: "active",
                ...(isNewConv ? { title: titleSnippet, createdAt: userTs } : {}),
                updatedAt: aiTs,
              },
              { merge: true }
            );
            batch.set(convRef.collection("messages").doc(userMsgId), {
              id: userMsgId,
              role: "user",
              text: redactSecretsFromOutput(data.message),
              createdAt: userTs,
            });
            batch.set(convRef.collection("messages").doc(aiMsgId), {
              id: aiMsgId,
              role: "assistant",
              text: safeFull,
              citations,
              provider: result.providerName,
              feedback: null,
              createdAt: aiTs,
            });
            await batch.commit();

            const outTokens = result.outputTokensEstimate ?? Math.ceil(safeFull.length / 3);
            await addTokenUsage(uid, outTokens);

            safeEnqueue("done", {
              conversationId: convId,
              messageId: aiMsgId,
              text: safeFull,
              citations,
              createdAtMs: timestampToMs(aiTs),
            });
          } catch (err: unknown) {
            if (!closed && !streamAbort.signal.aborted) {
              const safeMsg =
                err instanceof ApiError
                  ? err.message
                  : "NnhanAI gặp gián đoạn khi phản hồi. Vui lòng thử lại.";
              safeEnqueue("error", { error: safeMsg, code: "AI_STREAM_ERROR" });
            }
          } finally {
            req.signal.removeEventListener("abort", onReqAbort);
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                // Controller đã đóng trước đó
              }
            }
          }
        },
        cancel() {
          closed = true;
          streamAbort.abort(new Error("CLIENT_DISCONNECTED"));
          req.signal.removeEventListener("abort", onReqAbort);
        },
      });

      return new NextResponse(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, private, no-cache, must-revalidate",
          Connection: "keep-alive",
        },
      });
    }
  }

  // Non-streaming JSON persistence (hoặc Pre-guardrail refusal) với thứ tự timestamp đơn điệu userTs < aiTs
  const titleSnippet = redactSecretsFromOutput(data.message).slice(0, 60);
  const userTs = new Date();
  const aiTs = new Date(userTs.getTime() + 5);
  const userMsgId = `u_${userTs.getTime()}_${crypto.randomUUID().slice(0, 6)}`;
  const aiMsgId = `a_${aiTs.getTime()}_${crypto.randomUUID().slice(0, 6)}`;

  const batch = adminDb.batch();
  batch.set(
    convRef,
    {
      id: convId,
      ownerUid: uid,
      status: "active",
      ...(isNewConv ? { title: titleSnippet, createdAt: userTs } : {}),
      updatedAt: aiTs,
    },
    { merge: true }
  );
  batch.set(convRef.collection("messages").doc(userMsgId), {
    id: userMsgId,
    role: "user",
    text: redactSecretsFromOutput(data.message),
    createdAt: userTs,
  });
  batch.set(convRef.collection("messages").doc(aiMsgId), {
    id: aiMsgId,
    role: "assistant",
    text: finalReplyText,
    citations,
    provider: providerMeta.providerName,
    blockedByGuardrail: guardrail.blocked,
    feedback: null,
    createdAt: aiTs,
  });
  await batch.commit();
  await addTokenUsage(uid, providerMeta.outputTokensEstimate);

  return withNoStore(
    NextResponse.json({
      success: true,
      conversationId: convId,
      messageId: aiMsgId,
      reply: finalReplyText,
      citations,
      blockedByGuardrail: guardrail.blocked,
    })
  );
});
