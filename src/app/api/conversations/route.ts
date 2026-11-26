import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { isValidFirestoreId, rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import {
  toConversationDTO,
  toPublicPartnerSummary,
  withNoStore,
} from "@/lib/server/chat";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);
  const uid = auth.uid;

  await consumeRateLimit({
    scope: "list_conversations",
    key: uid,
    limit: 60,
    windowSec: 600,
  });

  const sp = new URL(req.url).searchParams;
  rejectDuplicateQueryParams(sp, ["cursor", "limit"]);

  const cursor = sp.get("cursor") || undefined;
  const limitRaw = Number.parseInt(sp.get("limit") || "20", 10);
  const pageLimit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;

  if (cursor && !isValidFirestoreId(cursor)) {
    throw new ApiError(400, "INVALID_CURSOR", "Con trỏ phân trang hội thoại không hợp lệ.");
  }

  let docs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
  let hasMore = false;
  let nextCursor: string | null = null;

  try {
    let q = adminDb
      .collection("conversations")
      .where("participantIds", "array-contains", uid)
      .orderBy("updatedAt", "desc");

    if (cursor) {
      const cursorSnap = await adminDb.collection("conversations").doc(cursor).get();
      const cursorParticipants = cursorSnap.exists
        ? (cursorSnap.data()?.participantIds as unknown)
        : null;
      if (
        !cursorSnap.exists ||
        !Array.isArray(cursorParticipants) ||
        !cursorParticipants.includes(uid)
      ) {
        throw new ApiError(400, "INVALID_CURSOR", "Con trỏ phân trang không tồn tại.");
      }
      q = q.startAfter(cursorSnap);
    }

    const snap = await q.limit(pageLimit + 1).get();
    hasMore = snap.docs.length > pageLimit;
    docs = hasMore ? snap.docs.slice(0, pageLimit) : snap.docs;
    nextCursor = hasMore ? docs[docs.length - 1]?.id || null : null;
  } catch (err: unknown) {
    const errStr = String(err);
    if (err instanceof ApiError) throw err;
    if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
      const fallbackSnap = await adminDb
        .collection("conversations")
        .where("participantIds", "array-contains", uid)
        .limit(pageLimit)
        .get();
      docs = fallbackSnap.docs;
    } else {
      throw err;
    }
  }

  // Batch fetch partner public profiles ONLY via allowlist DTO
  const partnerUids = Array.from(
    new Set(
      docs
        .map((d) => {
          const p = (d.data()?.participantIds as string[]) || [];
          return p.find((id) => id !== uid);
        })
        .filter((id): id is string => Boolean(id))
    )
  );

  const partnerMap = new Map<string, ReturnType<typeof toPublicPartnerSummary>>();
  if (partnerUids.length > 0) {
    const snaps = await Promise.all(
      partnerUids.map((pUid) => adminDb.collection("users").doc(pUid).get())
    );
    partnerUids.forEach((pUid, i) => {
      const snap = snaps[i];
      partnerMap.set(
        pUid,
        toPublicPartnerSummary(pUid, snap?.exists ? (snap.data() as Record<string, unknown>) : null)
      );
    });
  }

  const items = docs.map((d) => {
    const raw = (d.data() || {}) as Record<string, unknown>;
    const pIds = (raw.participantIds as string[]) || [];
    const partnerUid = pIds.find((id) => id !== uid);
    const partner = partnerUid ? partnerMap.get(partnerUid) || null : null;
    return toConversationDTO(d.id, raw, uid, partner);
  });

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
});
