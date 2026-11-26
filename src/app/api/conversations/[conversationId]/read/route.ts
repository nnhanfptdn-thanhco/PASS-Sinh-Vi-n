import { NextRequest, NextResponse } from "next/server";
import { withApi } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { assertParticipantConversation, withNoStore } from "@/lib/server/chat";
import { FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: { conversationId: string } }
) {
  return withApi(async () => {
    const conversationId = context.params?.conversationId || "";
    const { auth, convRef } = await assertParticipantConversation(req, conversationId, false);

    await consumeRateLimit({
      scope: "chat_read_receipt",
      key: `${auth.uid}_${conversationId}`,
      limit: 60,
      windowSec: 60,
    });

    await convRef.update({
      [`unreadCountByUser.${auth.uid}`]: 0,
      [`readAtByUser.${auth.uid}`]: FieldValue.serverTimestamp(),
      readBy: FieldValue.arrayUnion(auth.uid),
    });

    return withNoStore(
      NextResponse.json({
        success: true,
        conversationId,
      })
    );
  })(req);
}
