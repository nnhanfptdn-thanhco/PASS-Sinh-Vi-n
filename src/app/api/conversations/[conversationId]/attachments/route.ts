import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import {
  assertParticipantConversation,
  isValidChatAttachmentPath,
  signChatAttachmentReadUrl,
  withNoStore,
} from "@/lib/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attachmentActionSchema = z
  .object({
    attachmentPath: z.string().min(10).max(300),
  })
  .strict();

export async function POST(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const conversationId = context.params?.conversationId || "";
    const { auth, convRef } = await assertParticipantConversation(req, conversationId, false);

    await consumeRateLimit({
      scope: "chat_attachment_sign",
      key: `${auth.uid}_${conversationId}`,
      limit: 60,
      windowSec: 60,
    });

    const body = await readJson(req, 8 * 1024);
    const { attachmentPath } = attachmentActionSchema.parse(body);

    if (!isValidChatAttachmentPath(conversationId, attachmentPath)) {
      throw new ApiError(
        403,
        "INVALID_ATTACHMENT_PATH",
        "Đường dẫn ảnh đính kèm không thuộc cuộc hội thoại này."
      );
    }

    // Xác minh tệp đính kèm thật sự thuộc một tin nhắn đã gửi trong hội thoại này
    const msgRefSnap = await convRef
      .collection("messages")
      .where("attachmentPath", "==", attachmentPath)
      .limit(1)
      .get();
    if (msgRefSnap.empty) {
      throw new ApiError(
        404,
        "ATTACHMENT_NOT_FOUND",
        "Không tìm thấy tệp ảnh đính kèm hợp lệ trong hội thoại này."
      );
    }

    const signedUrl = await signChatAttachmentReadUrl(attachmentPath);
    if (!signedUrl) {
      throw new ApiError(
        503,
        "STORAGE_SIGN_UNAVAILABLE",
        "Không thể cấp liên kết đọc tạm thời cho tệp đính kèm lúc này."
      );
    }

    return withNoStore(
      NextResponse.json({
        success: true,
        attachmentPath,
        url: signedUrl,
        expiresInSeconds: 300,
      })
    );
  })(req);
}
