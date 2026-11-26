import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import { timestampToMs, withNoStore } from "@/lib/server/chat";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);

  await consumeRateLimit({
    scope: "ai_history_read",
    key: auth.uid,
    limit: 60,
    windowSec: 600,
  });

  const sp = new URL(req.url).searchParams;
  rejectDuplicateQueryParams(sp, ["limit"]);
  const limitRaw = Number.parseInt(sp.get("limit") || "30", 10);
  const limitCount = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 30;

  let docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
  try {
    const snap = await adminDb
      .collection("aiConversations")
      .where("ownerUid", "==", auth.uid)
      .orderBy("updatedAt", "desc")
      .limit(limitCount)
      .get();
    docs = snap.docs;
  } catch (err: unknown) {
    const errStr = String(err);
    if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
      const snap = await adminDb
        .collection("aiConversations")
        .where("ownerUid", "==", auth.uid)
        .limit(limitCount)
        .get();
      docs = snap.docs;
    } else {
      throw err;
    }
  }

  const items = docs.map((d) => {
    const raw = d.data() || {};
    return {
      id: d.id,
      title: typeof raw.title === "string" ? raw.title : "Cuộc trò chuyện NnhanAI",
      createdAtMs: timestampToMs(raw.createdAt),
      updatedAtMs: timestampToMs(raw.updatedAt),
    };
  });

  return withNoStore(
    NextResponse.json({
      success: true,
      items,
    })
  );
});

export const DELETE = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);

  await consumeRateLimit({
    scope: "ai_history_clear",
    key: auth.uid,
    limit: 20,
    windowSec: 3600,
  });

  // CHỈ xóa lịch sử aiConversations của chủ sở hữu; tuyệt đối KHÔNG chạm vào buyer-seller conversations
  const snap = await adminDb
    .collection("aiConversations")
    .where("ownerUid", "==", auth.uid)
    .get();

  let clearedCount = 0;
  for (const doc of snap.docs) {
    await adminDb.recursiveDelete(doc.ref);
    clearedCount++;
  }

  return withNoStore(
    NextResponse.json({
      success: true,
      clearedCount,
      message: "Đã xóa toàn bộ lịch sử trò chuyện với NnhanAI.",
    })
  );
});
