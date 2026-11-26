import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { assertParticipantConversation, withNoStore } from "@/lib/server/chat";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const blockReportSchema = z
  .object({
    action: z.enum(["block", "unblock", "report"]),
    reason: z.enum(["scam", "harassment", "spam", "other"]).optional(),
    details: z.string().trim().max(500).optional(),
    messageId: FIRESTORE_ID_SCHEMA.optional(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const conversationId = context.params?.conversationId || "";
    const { auth, convRef, otherUid } = await assertParticipantConversation(
      req,
      conversationId,
      false
    );

    const body = await readJson(req, 16 * 1024);
    const data = blockReportSchema.parse(body);

    await consumeRateLimit({
      scope: "chat_moderation",
      key: auth.uid,
      limit: 20,
      windowSec: 3600,
    });

    if (data.action === "block") {
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(convRef);
        if (!snap.exists) {
          throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
        }
        const cur = snap.data() || {};
        tx.update(convRef, {
          status: cur.status === "closed" ? "closed" : "blocked",
          [`blockedBy.${auth.uid}`]: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return withNoStore(
        NextResponse.json({
          success: true,
          status: "blocked",
          message:
            "Đã chặn cuộc trò chuyện này. Lịch sử tin nhắn vẫn được bảo toàn nguyên vẹn để làm bằng chứng đối chiếu nếu cần.",
        })
      );
    }

    if (data.action === "unblock") {
      const nextStatus = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(convRef);
        if (!snap.exists) {
          throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
        }
        const cur = snap.data() || {};
        const blockedBy = (cur.blockedBy || {}) as Record<string, boolean>;
        if (!blockedBy[auth.uid]) {
          throw new ApiError(
            403,
            "CANNOT_UNBLOCK",
            "Chỉ người đã thực hiện chặn mới có thể mở khóa cuộc trò chuyện này."
          );
        }

        const stillBlockedByOther = Object.entries(blockedBy).some(
          ([k, v]) => k !== auth.uid && v === true
        );
        const computedStatus =
          cur.status === "closed" ? "closed" : stillBlockedByOther ? "blocked" : "active";

        tx.update(convRef, {
          status: computedStatus,
          [`blockedBy.${auth.uid}`]: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return computedStatus;
      });

      return withNoStore(
        NextResponse.json({
          success: true,
          status: nextStatus,
          message: "Đã gỡ chặn cuộc trò chuyện.",
        })
      );
    }

    // action === "report": trích xuất tối đa 20 tin gần nhất phía server làm bằng chứng chỉ Admin xem
    const recentMsgs = await convRef
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const evidence = recentMsgs.docs.map((m) => {
      const d = m.data();
      return {
        id: m.id,
        senderId: String(d.senderId || ""),
        type: String(d.type || "text"),
        text: typeof d.text === "string" ? d.text : null,
        attachmentPath: typeof d.attachmentPath === "string" ? d.attachmentPath : null,
      };
    });

    const reportRef = await adminDb.collection("reports").add({
      reporterId: auth.uid,
      reportedUserId: otherUid,
      targetType: "conversation",
      targetId: conversationId,
      focusMessageId: data.messageId || null,
      reason: data.reason || "scam",
      details: data.details || "",
      evidence,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    return withNoStore(
      NextResponse.json({
        success: true,
        reportId: reportRef.id,
        message: "Đã ghi nhận báo cáo an toàn kèm bằng chứng hội thoại cho Ban Quản Trị.",
      })
    );
  })(req);
}
