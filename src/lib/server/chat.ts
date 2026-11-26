import "server-only";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser, requireApprovedStudent, type AuthenticatedUser, type VerifiedUser } from "@/lib/server/auth-guard";
import { ApiError } from "@/lib/server/http";
import { isValidFirestoreId } from "@/lib/server/request-utils";
import { adminDb } from "@/lib/firebase/admin";
import { getSignedStorageReadUrl } from "@/lib/server/storage-provider";
import type { ChatPartnerSummary, ConversationDTO, ConversationStatus } from "@/lib/chat/types";

export function withNoStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, private, no-cache, must-revalidate");
  return res;
}

/**
 * Sinh ID hội thoại xác định không va chạm bằng SHA-256 trên tuple chuẩn hoá [uidA, uidB, listingId].
 */
export function buildCanonicalConversationId(
  uidA: string,
  uidB: string,
  listingId?: string | null
): string {
  const pair = [uidA, uidB].sort();
  const payload = JSON.stringify([pair[0], pair[1], listingId || ""]);
  const digest = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
  return `conv_${digest}`;
}

export function deterministicMessageId(uid: string, clientMessageId: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${uid}:${clientMessageId}`)
    .digest("hex")
    .slice(0, 28);
  return `m_${digest}`;
}

export function timestampToMs(val: unknown): number | null {
  if (!val) return null;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const ms = Date.parse(val);
    return Number.isFinite(ms) ? ms : null;
  }
  const ts = val as { toMillis?: () => number };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  return null;
}

export function toPublicPartnerSummary(
  uid: string,
  userData: Record<string, unknown> | undefined | null
): ChatPartnerSummary {
  return {
    uid,
    displayName:
      typeof userData?.displayName === "string" && userData.displayName.trim()
        ? userData.displayName.trim()
        : "Sinh viên Chợ Pass",
    photoURL: typeof userData?.photoURL === "string" ? userData.photoURL : null,
    schoolCode: typeof userData?.schoolCode === "string" ? userData.schoolCode : null,
    verified: Boolean(userData?.verified),
  };
}

export async function assertParticipantConversation(
  req: NextRequest,
  conversationId: string,
  requireVerifiedStudent = false
): Promise<{
  auth: AuthenticatedUser | VerifiedUser;
  convRef: FirebaseFirestore.DocumentReference;
  convData: Record<string, unknown>;
  participantIds: string[];
  otherUid: string | null;
}> {
  if (!isValidFirestoreId(conversationId)) {
    throw new ApiError(400, "INVALID_CONVERSATION_ID", "Mã hội thoại không hợp lệ.");
  }

  const auth = requireVerifiedStudent
    ? await requireApprovedStudent(req)
    : await requireActiveUser(req);

  const convRef = adminDb.collection("conversations").doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
  }

  const convData = (convSnap.data() || {}) as Record<string, unknown>;
  const participantIds = Array.isArray(convData.participantIds)
    ? (convData.participantIds as string[])
    : [];

  if (!participantIds.includes(auth.uid)) {
    throw new ApiError(
      403,
      "FORBIDDEN_CONVERSATION",
      "Bạn không phải thành viên của cuộc hội thoại này."
    );
  }

  const otherUid = participantIds.find((id) => id !== auth.uid) || null;
  return { auth, convRef, convData, participantIds, otherUid };
}

export function isValidChatAttachmentPath(conversationId: string, path: string): boolean {
  if (!path || path.includes("..") || path.includes("\\")) return false;
  const escapedConv = conversationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^private/chats/${escapedConv}/[A-Za-z0-9_-]{8,64}\\.(webp|jpg)$`).test(path);
}

export async function signChatAttachmentReadUrl(attachmentPath: string | null): Promise<string | null> {
  if (!attachmentPath || !attachmentPath.startsWith("private/chats/")) {
    return null;
  }
  try {
    return await getSignedStorageReadUrl(attachmentPath, 5 * 60 * 1000);
  } catch {
    return null;
  }
}

export function toConversationDTO(
  id: string,
  raw: Record<string, unknown>,
  viewerUid: string,
  partner: ChatPartnerSummary | null
): ConversationDTO {
  const unreadMap = (raw.unreadCountByUser || {}) as Record<string, unknown>;
  const rawUnread = Number(unreadMap[viewerUid] ?? 0);
  const participantIds = Array.isArray(raw.participantIds) ? (raw.participantIds as string[]) : [];
  const blockedBy = (raw.blockedBy || {}) as Record<string, boolean>;
  const statusRaw = String(raw.status || "active");
  const status: ConversationStatus =
    statusRaw === "blocked" || statusRaw === "closed" ? statusRaw : "active";

  return {
    id,
    participantIds,
    listingId: typeof raw.listingId === "string" ? raw.listingId : null,
    listingTitle: typeof raw.listingTitle === "string" ? raw.listingTitle : null,
    listingPrice: typeof raw.listingPrice === "number" ? raw.listingPrice : null,
    listingCoverImage: typeof raw.listingCoverImage === "string" ? raw.listingCoverImage : null,
    partner,
    lastMessage: typeof raw.lastMessage === "string" ? raw.lastMessage : null,
    lastMessageAtMs: timestampToMs(raw.lastMessageAt) ?? timestampToMs(raw.updatedAt),
    lastMessageSenderId: typeof raw.lastMessageSenderId === "string" ? raw.lastMessageSenderId : null,
    unreadCount: Number.isFinite(rawUnread) && rawUnread > 0 ? rawUnread : 0,
    status,
    blockedBy,
    createdAtMs: timestampToMs(raw.createdAt),
    updatedAtMs: timestampToMs(raw.updatedAt),
    schemaVersion: 1,
  };
}
