"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import {
  Send,
  Search,
  ShieldAlert,
  Flag,
  ChevronLeft,
  Image as ImageIcon,
  ExternalLink,
  RotateCw,
  Ban,
  Unlock,
  Loader2,
  AlertTriangle,
  WifiOff,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { RequireVerified } from "@/components/auth/RequireVerified";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { db, authFetch } from "@/lib/firebase/client";
import { uploadMediaBlobWithTimeout, type IssuedIntentFile } from "@/lib/client/upload-media";
import { compressListingImage } from "@/lib/image/compress";
import { formatCurrencyVND, safeRandomId } from "@/lib/utils";
import {
  CHAT_SAFETY_BANNER,
  MAX_MESSAGE_LENGTH,
  type ChatMessageDTO,
  type ConversationDTO,
} from "@/lib/chat/types";

interface UIMessage extends ChatMessageDTO {
  localState?: "sending" | "sent" | "failed";
  localError?: string;
  uploadSessionId?: string;
}

function mergeOrderedMessages(existing: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  const byId = new Map<string, UIMessage>();
  for (const m of existing) {
    byId.set(m.id, m);
  }
  for (const m of incoming) {
    byId.set(m.id, m);
  }
  return Array.from(byId.values()).sort(
    (a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0)
  );
}

function toMsClient(val: unknown): number | null {
  if (!val) return null;
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof (val as Timestamp).toMillis === "function") {
    return (val as Timestamp).toMillis();
  }
  return null;
}

function formatShortTime(ms: number | null): string {
  if (!ms) return "";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function MessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedConvId = searchParams.get("conversationId");
  const { user } = useAuth();
  const uid = user?.uid || "";

  const [conversations, setConversations] = React.useState<ConversationDTO[]>([]);
  const [loadingInbox, setLoadingInbox] = React.useState(true);
  const [inboxError, setInboxError] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");

  const [selectedId, setSelectedId] = React.useState<string | null>(requestedConvId);
  const [mobileShowDetail, setMobileShowDetail] = React.useState(Boolean(requestedConvId));

  const [olderMessages, setOlderMessages] = React.useState<UIMessage[]>([]);
  const [liveMessages, setLiveMessages] = React.useState<UIMessage[]>([]);
  const [pendingMessages, setPendingMessages] = React.useState<UIMessage[]>([]);
  const [olderCursor, setOlderCursor] = React.useState<string | null>(null);
  const [hasOlder, setHasOlder] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [loadingMessages, setLoadingMessages] = React.useState(false);
  const [streamDisconnected, setStreamDisconnected] = React.useState(false);

  const [inputText, setInputText] = React.useState("");
  const [uploadingImage, setUploadingImage] = React.useState(false);
  const [contactWarning, setContactWarning] = React.useState<string | null>(null);
  const [chatActionError, setChatActionError] = React.useState<string | null>(null);

  // Cache signed URLs trong RAM phiên hiện tại (tuyệt đối không lưu localStorage)
  const [signedUrlMap, setSignedUrlMap] = React.useState<Record<string, string>>({});
  const requestedSignedPaths = React.useRef<Set<string>>(new Set());
  const retriedSignedPaths = React.useRef<Set<string>>(new Set());
  const hydratedMissingPartnerRef = React.useRef<Set<string>>(new Set());
  const requestedConvIdRef = React.useRef<string | null>(requestedConvId);
  const selectedIdRef = React.useRef<string | null>(selectedId);

  React.useEffect(() => {
    requestedConvIdRef.current = requestedConvId;
  }, [requestedConvId]);

  React.useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Modal Report / Block
  const [isModerationOpen, setIsModerationOpen] = React.useState(false);
  const [reportReason, setReportReason] = React.useState<"scam" | "harassment" | "spam" | "other">("scam");
  const [reportDetails, setReportDetails] = React.useState("");
  const [moderationBusy, setModerationBusy] = React.useState(false);
  const [moderationFeedback, setModerationFeedback] = React.useState<string | null>(null);

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const readDebounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedConv = React.useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  // Sync URL query param
  React.useEffect(() => {
    if (requestedConvId) {
      setSelectedId(requestedConvId);
      setMobileShowDetail(true);
    }
  }, [requestedConvId]);

  const fetchInbox = React.useCallback(async () => {
    if (!uid) return;
    setLoadingInbox(true);
    setInboxError(null);
    try {
      const res = await authFetch("/api/conversations?limit=30");
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Không thể tải danh sách hội thoại.");
      }
      const list = (json?.items || []) as ConversationDTO[];
      setConversations(list);
      const reqId = requestedConvIdRef.current;
      setSelectedId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        if (reqId && list.some((c) => c.id === reqId)) return reqId;
        return list[0]?.id || null;
      });
    } catch (err: unknown) {
      setInboxError(err instanceof Error ? err.message : "Lỗi kết nối hộp thư.");
    } finally {
      setLoadingInbox(false);
    }
  }, [uid]);

  // 1. Tải danh sách từ API + lắng nghe cập nhật realtime scoped theo participantIds array-contains uid
  React.useEffect(() => {
    if (!uid) {
      setConversations([]);
      setLiveMessages([]);
      setOlderMessages([]);
      setPendingMessages([]);
      hydratedMissingPartnerRef.current.clear();
      return;
    }

    void fetchInbox();

    const qInbox = query(
      collection(db, "conversations"),
      where("participantIds", "array-contains", uid),
      orderBy("updatedAt", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      qInbox,
      (snap) => {
        setStreamDisconnected(false);
        let needsHydrate = false;
        setConversations((prev) => {
          const prevMap = new Map(prev.map((c) => [c.id, c]));
          const nextList: ConversationDTO[] = snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            const existing = prevMap.get(d.id);
            const unreadMap = (raw.unreadCountByUser || {}) as Record<string, unknown>;
            const unreadCount = Number(unreadMap[uid] ?? 0);
            const blockedBy = (raw.blockedBy || {}) as Record<string, boolean>;
            const partner = existing?.partner || null;
            if (partner === null && !hydratedMissingPartnerRef.current.has(d.id)) {
              hydratedMissingPartnerRef.current.add(d.id);
              needsHydrate = true;
            }
            return {
              id: d.id,
              participantIds: Array.isArray(raw.participantIds) ? (raw.participantIds as string[]) : [],
              listingId: typeof raw.listingId === "string" ? raw.listingId : existing?.listingId || null,
              listingTitle:
                typeof raw.listingTitle === "string" ? raw.listingTitle : existing?.listingTitle || null,
              listingPrice:
                typeof raw.listingPrice === "number" ? raw.listingPrice : existing?.listingPrice || null,
              listingCoverImage:
                typeof raw.listingCoverImage === "string"
                  ? raw.listingCoverImage
                  : existing?.listingCoverImage || null,
              partner,
              lastMessage: typeof raw.lastMessage === "string" ? raw.lastMessage : null,
              lastMessageAtMs: toMsClient(raw.lastMessageAt) ?? toMsClient(raw.updatedAt),
              lastMessageSenderId:
                typeof raw.lastMessageSenderId === "string" ? raw.lastMessageSenderId : null,
              unreadCount: Number.isFinite(unreadCount) && unreadCount > 0 ? unreadCount : 0,
              status:
                raw.status === "blocked" || raw.status === "closed" ? raw.status : "active",
              blockedBy,
              createdAtMs: toMsClient(raw.createdAt) ?? existing?.createdAtMs ?? null,
              updatedAtMs: toMsClient(raw.updatedAt) ?? existing?.updatedAtMs ?? null,
              schemaVersion: 1,
            };
          });
          return nextList;
        });
        // Nạp partner DTO ngoài state updater để tránh side-effect trong render/updater
        if (needsHydrate) {
          queueMicrotask(() => {
            void fetchInbox();
          });
        }
      },
      () => {
        setStreamDisconnected(true);
      }
    );

    return () => unsub();
  }, [uid, fetchInbox]);

  // 2. Đăng ký tin nhắn realtime cho hội thoại đang chọn + tải trang đầu từ API (có signed URL)
  React.useEffect(() => {
    if (!uid || !selectedId) {
      setLiveMessages([]);
      setOlderMessages([]);
      setPendingMessages([]);
      setOlderCursor(null);
      setHasOlder(false);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);
    setChatActionError(null);
    setContactWarning(null);
    setLiveMessages([]);
    setOlderMessages([]);
    setPendingMessages([]);
    setOlderCursor(null);
    setHasOlder(false);

    (async () => {
      try {
        const res = await authFetch(`/api/conversations/${encodeURIComponent(selectedId)}/messages?limit=30`);
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok) {
          const initialItems = (json?.items || []) as UIMessage[];
          setLiveMessages((prev) => mergeOrderedMessages(prev, initialItems));
          setOlderCursor(json?.pagination?.nextCursor || null);
          setHasOlder(Boolean(json?.pagination?.hasMore));
          const initialSigned: Record<string, string> = {};
          for (const it of initialItems) {
            if (it.attachmentPath && it.attachmentUrl) {
              initialSigned[it.attachmentPath] = it.attachmentUrl;
            }
          }
          if (Object.keys(initialSigned).length > 0) {
            setSignedUrlMap((prev) => ({ ...prev, ...initialSigned }));
          }
        }
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();

    const qMsgs = query(
      collection(db, "conversations", selectedId, "messages"),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    const unsub = onSnapshot(
      qMsgs,
      (snap) => {
        setStreamDisconnected(false);
        const mapped: UIMessage[] = snap.docs
          .map((d) => {
            const raw = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              senderId: String(raw.senderId || ""),
              type: (raw.type === "image" ? "image" : raw.type === "system" ? "system" : "text") as UIMessage["type"],
              text: typeof raw.text === "string" ? raw.text : null,
              attachmentPath: typeof raw.attachmentPath === "string" ? raw.attachmentPath : null,
              attachmentMimeType:
                typeof raw.attachmentMimeType === "string" ? raw.attachmentMimeType : null,
              attachmentSize:
                typeof raw.attachmentSize === "number" ? raw.attachmentSize : null,
              createdAtMs: toMsClient(raw.createdAt) ?? Date.now(),
              clientMessageId: String(raw.clientMessageId || d.id),
              moderationStatus: (raw.moderationStatus === "flagged" || raw.moderationStatus === "removed"
                ? raw.moderationStatus
                : "normal") as UIMessage["moderationStatus"],
            };
          })
          .reverse();

        // Hợp nhất theo ID để không bao giờ tạo khoảng trống khi cửa sổ realtime trượt quá 30 tin
        setLiveMessages((prev) => mergeOrderedMessages(prev, mapped));

        // Xoá pending optimistic đã về từ Firestore
        const confirmedClientIds = new Set(mapped.map((m) => m.clientMessageId));
        setPendingMessages((prev) =>
          prev.filter((p) => !confirmedClientIds.has(p.clientMessageId))
        );
      },
      () => {
        setStreamDisconnected(true);
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [uid, selectedId]);

  const requestSignedAttachmentUrl = React.useCallback(
    (convId: string, attachmentPath: string, forceRefresh = false) => {
      if (!forceRefresh && requestedSignedPaths.current.has(attachmentPath)) return;
      requestedSignedPaths.current.add(attachmentPath);
      authFetch(`/api/conversations/${encodeURIComponent(convId)}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentPath }),
      })
        .then(async (r) => {
          if (!r.ok) {
            requestedSignedPaths.current.delete(attachmentPath);
            return null;
          }
          return r.json().catch(() => null);
        })
        .then((json) => {
          if (json?.url) {
            setSignedUrlMap((prev) => ({ ...prev, [attachmentPath]: json.url }));
          } else {
            requestedSignedPaths.current.delete(attachmentPath);
          }
        })
        .catch(() => {
          requestedSignedPaths.current.delete(attachmentPath);
        });
    },
    []
  );

  // 3. Ký URL đọc ảnh đính kèm mới phát sinh qua realtime listener (không public URL)
  React.useEffect(() => {
    if (!selectedId) return;
    const all = [...olderMessages, ...liveMessages];
    for (const msg of all) {
      const p = msg.attachmentPath;
      if (p && !msg.attachmentUrl && !signedUrlMap[p] && !requestedSignedPaths.current.has(p)) {
        requestSignedAttachmentUrl(selectedId, p, false);
      }
    }
  }, [selectedId, olderMessages, liveMessages, signedUrlMap, requestSignedAttachmentUrl]);

  // 4. Debounced read receipt khi mở hoặc có tin nhắn mới ở hội thoại đang chọn
  React.useEffect(() => {
    if (!selectedId || !selectedConv || selectedConv.unreadCount <= 0) return;

    if (readDebounceTimer.current) clearTimeout(readDebounceTimer.current);
    readDebounceTimer.current = setTimeout(() => {
      authFetch(`/api/conversations/${encodeURIComponent(selectedId)}/read`, {
        method: "POST",
      }).catch(() => undefined);
    }, 350);

    return () => {
      if (readDebounceTimer.current) clearTimeout(readDebounceTimer.current);
    };
  }, [selectedId, selectedConv, liveMessages.length]);

  // Hợp nhất older + live + optimistic (dedupe by id/clientMessageId)
  const mergedMessages = React.useMemo(() => {
    const seenIds = new Set<string>();
    const seenClientIds = new Set<string>();
    const combined: UIMessage[] = [];

    for (const m of [...olderMessages, ...liveMessages, ...pendingMessages]) {
      if (seenIds.has(m.id) || seenClientIds.has(m.clientMessageId)) continue;
      seenIds.add(m.id);
      seenClientIds.add(m.clientMessageId);
      combined.push(m);
    }
    return combined;
  }, [olderMessages, liveMessages, pendingMessages]);

  // Tự cuộn xuống cuối khi vừa đổi phòng hoặc gửi tin mới
  const prevCountRef = React.useRef(0);
  React.useEffect(() => {
    if (mergedMessages.length > prevCountRef.current && !loadingOlder) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = mergedMessages.length;
  }, [mergedMessages.length, loadingOlder]);

  // Tải tin cũ hơn giữ nguyên vị trí cuộn
  const handleLoadOlder = async () => {
    if (!selectedId || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollContainerRef.current;
    const prevScrollHeight = el?.scrollHeight || 0;

    try {
      const res = await authFetch(
        `/api/conversations/${encodeURIComponent(selectedId)}/messages?cursor=${encodeURIComponent(olderCursor)}&limit=30`
      );
      const json = await res.json().catch(() => null);
      if (res.ok && Array.isArray(json?.items)) {
        const items = json.items as UIMessage[];
        setOlderMessages((prev) => [...items, ...prev]);
        setOlderCursor(json?.pagination?.nextCursor || null);
        setHasOlder(Boolean(json?.pagination?.hasMore));

        requestAnimationFrame(() => {
          if (el) {
            const delta = el.scrollHeight - prevScrollHeight;
            el.scrollTop += delta;
          }
        });
      }
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendMessagePayload = async (
    targetConvId: string,
    payload: {
      clientMessageId: string;
      type: "text" | "image";
      text?: string;
      attachmentPath?: string;
      attachmentMimeType?: "image/webp" | "image/jpeg";
      attachmentSize?: number;
      uploadSessionId?: string;
    },
    optimisticItem: UIMessage
  ) => {
    setChatActionError(null);
    if (selectedIdRef.current === targetConvId) {
      setPendingMessages((prev) => [
        ...prev.filter((p) => p.clientMessageId !== optimisticItem.clientMessageId),
        optimisticItem,
      ]);
    }

    try {
      const res = await authFetch(
        `/api/conversations/${encodeURIComponent(targetConvId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Không thể gửi tin nhắn.");
      }

      if (json?.contactWarning && selectedIdRef.current === targetConvId) {
        setContactWarning(String(json.contactWarning));
      }
      if (json?.message?.attachmentPath && json?.message?.attachmentUrl) {
        setSignedUrlMap((prev) => ({
          ...prev,
          [json.message.attachmentPath]: json.message.attachmentUrl,
        }));
      }

      if (selectedIdRef.current === targetConvId) {
        setPendingMessages((prev) =>
          prev.map((p) =>
            p.clientMessageId === payload.clientMessageId
              ? { ...(json.message as UIMessage), localState: "sent" }
              : p
          )
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gửi tin thất bại";
      if (selectedIdRef.current === targetConvId) {
        setPendingMessages((prev) =>
          prev.map((p) =>
            p.clientMessageId === payload.clientMessageId
              ? { ...p, localState: "failed", localError: msg }
              : p
          )
        );
      }
    }
  };

  const handleSendText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || !uid) return;
    const text = inputText.trim();
    if (!text) return;

    const clientMessageId = `cm_${Date.now()}_${safeRandomId().slice(0, 8)}`;
    setInputText("");

    await sendMessagePayload(
      selectedId,
      { clientMessageId, type: "text", text },
      {
        id: clientMessageId,
        senderId: uid,
        type: "text",
        text,
        attachmentPath: null,
        attachmentMimeType: null,
        attachmentSize: null,
        createdAtMs: Date.now(),
        clientMessageId,
        moderationStatus: "normal",
        localState: "sending",
      }
    );
  };

  const handleRetryFailed = async (failedMsg: UIMessage) => {
    if (!selectedId) return;
    if (failedMsg.type === "image" && failedMsg.attachmentPath) {
      const mimeType: "image/webp" | "image/jpeg" =
        failedMsg.attachmentMimeType === "image/jpeg" ? "image/jpeg" : "image/webp";
      await sendMessagePayload(
        selectedId,
        {
          clientMessageId: failedMsg.clientMessageId,
          type: "image",
          attachmentPath: failedMsg.attachmentPath,
          attachmentMimeType: mimeType,
          attachmentSize: failedMsg.attachmentSize || undefined,
          uploadSessionId: failedMsg.uploadSessionId,
        },
        { ...failedMsg, localState: "sending", localError: undefined }
      );
      return;
    }

    await sendMessagePayload(
      selectedId,
      {
        clientMessageId: failedMsg.clientMessageId,
        type: "text",
        text: failedMsg.text || "",
      },
      { ...failedMsg, localState: "sending", localError: undefined }
    );
  };

  const handleAttachImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const targetConvId = selectedId;
    if (!file || !targetConvId || !uid) return;

    setUploadingImage(true);
    setChatActionError(null);
    let sessionId = "";
    let issuedPath = "";

    try {
      const compressed = await compressListingImage(file);
      const mimeType: "image/webp" | "image/jpeg" =
        compressed.mimeType === "image/jpeg" ? "image/jpeg" : "image/webp";

      const intentRes = await authFetch("/api/uploads/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "chat",
          targetId: targetConvId,
          files: [{ contentType: mimeType, sizeBytes: compressed.blob.size }],
        }),
      });
      const intentJson = await intentRes.json().catch(() => null);
      if (!intentRes.ok || !intentJson?.sessionId || !intentJson?.files?.[0]?.path) {
        throw new Error(intentJson?.error || "Không thể cấp quyền tải ảnh chat.");
      }

      sessionId = String(intentJson.sessionId);
      const issuedChatFile = intentJson.files[0] as IssuedIntentFile;
      issuedPath = String(issuedChatFile.path);

      await uploadMediaBlobWithTimeout({
        file: issuedChatFile,
        blob: compressed.blob,
        contentType: mimeType,
        sessionId,
        timeoutMs: 20_000,
      });

      const finalizeRes = await authFetch("/api/uploads/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, paths: [issuedPath] }),
      });
      if (!finalizeRes.ok) {
        const fJson = await finalizeRes.json().catch(() => null);
        throw new Error(fJson?.error || "Xác nhận ảnh đính kèm thất bại.");
      }

      const clientMessageId = `img_${Date.now()}_${safeRandomId().slice(0, 8)}`;
      await sendMessagePayload(
        targetConvId,
        {
          clientMessageId,
          type: "image",
          attachmentPath: issuedPath,
          attachmentMimeType: mimeType,
          attachmentSize: compressed.blob.size,
          uploadSessionId: sessionId,
        },
        {
          id: clientMessageId,
          senderId: uid,
          type: "image",
          text: null,
          attachmentPath: issuedPath,
          attachmentMimeType: mimeType,
          attachmentSize: compressed.blob.size,
          uploadSessionId: sessionId,
          createdAtMs: Date.now(),
          clientMessageId,
          moderationStatus: "normal",
          localState: "sending",
        }
      );
    } catch (err: unknown) {
      if (sessionId && issuedPath) {
        await authFetch("/api/uploads/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, paths: [issuedPath] }),
        }).catch(() => undefined);
      }
      if (selectedIdRef.current === targetConvId) {
        setChatActionError(err instanceof Error ? err.message : "Không thể gửi ảnh đính kèm.");
      }
    } finally {
      setUploadingImage(false);
    }
  };

  const handleModerationAction = async (action: "block" | "unblock" | "report") => {
    if (!selectedId) return;
    setModerationBusy(true);
    setModerationFeedback(null);
    try {
      const res = await authFetch(`/api/conversations/${encodeURIComponent(selectedId)}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "report"
            ? { action: "report", reason: reportReason, details: reportDetails.trim() }
            : { action }
        ),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Không thể xử lý yêu cầu an toàn.");
      }
      setModerationFeedback(json?.message || "Đã cập nhật.");
      if (action === "report") {
        setReportDetails("");
      }
      await fetchInbox();
    } catch (err: unknown) {
      setModerationFeedback(err instanceof Error ? err.message : "Lỗi xử lý.");
    } finally {
      setModerationBusy(false);
    }
  };

  const filteredConvs = React.useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        (c.partner?.displayName || "").toLowerCase().includes(q) ||
        (c.listingTitle || "").toLowerCase().includes(q) ||
        (c.lastMessage || "").toLowerCase().includes(q)
    );
  }, [conversations, searchTerm]);

  const isBlocked = Boolean(
    selectedConv &&
      (selectedConv.status !== "active" ||
        Object.values(selectedConv.blockedBy || {}).some(Boolean))
  );
  const blockedByMe = Boolean(selectedConv?.blockedBy?.[uid]);

  return (
    <RequireVerified>
      <div className="max-w-6xl mx-auto px-2 sm:px-4 py-3 sm:py-4">
        <div className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden flex h-[calc(100dvh-148px)] md:h-[calc(100dvh-104px)] min-h-[460px]">
          {/* CỘT TRÁI: DANH SÁCH HỘI THOẠI */}
          <aside
            className={`w-full md:w-80 lg:w-96 border-r border-surface-border flex flex-col bg-surface ${
              mobileShowDetail ? "hidden md:flex" : "flex"
            }`}
          >
            <div className="p-4 border-b border-surface-border space-y-3">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-heading font-bold text-text-main">Tin nhắn</h1>
                <Link
                  href="/ai"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Hỏi NnhanAI →
                </Link>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Tìm theo tên hoặc món đồ..."
                  className="w-full h-9 pl-9 pr-3 bg-surface-muted border border-surface-border rounded-xl text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-surface-border">
              {loadingInbox ? (
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-surface-muted rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : inboxError ? (
                <div className="p-6 text-center space-y-3">
                  <p className="text-xs text-red-600">{inboxError}</p>
                  <Button size="sm" variant="outline" onClick={fetchInbox}>
                    Thử lại
                  </Button>
                </div>
              ) : filteredConvs.length === 0 ? (
                <div className="p-6 text-center space-y-2 text-xs text-text-muted">
                  <p className="font-semibold text-text-main">Chưa có cuộc trò chuyện nào</p>
                  <p>Nhấn &quot;Nhắn tin người bán&quot; trên trang chi tiết món đồ để bắt đầu trao đổi an toàn.</p>
                </div>
              ) : (
                filteredConvs.map((conv) => {
                  const isActive = conv.id === selectedId;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(conv.id);
                        setMobileShowDetail(true);
                        router.replace(`/messages?conversationId=${encodeURIComponent(conv.id)}`, {
                          scroll: false,
                        });
                      }}
                      className={`w-full p-3.5 text-left flex gap-3 hover:bg-surface-muted/70 transition-colors ${
                        isActive ? "bg-primary-light/40 border-l-4 border-l-primary" : ""
                      }`}
                    >
                      <div className="w-11 h-11 rounded-full bg-primary-light shrink-0 overflow-hidden border border-surface-border flex items-center justify-center font-bold text-primary text-sm">
                        {conv.partner?.photoURL ? (
                          <Image
                            src={conv.partner.photoURL}
                            alt={conv.partner.displayName}
                            width={44}
                            height={44}
                            unoptimized
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          (conv.partner?.displayName || "S").charAt(0).toUpperCase()
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-text-main truncate">
                            {conv.partner?.displayName || "Sinh viên Chợ Pass"}
                          </span>
                          <span className="text-[11px] text-text-muted shrink-0">
                            {formatShortTime(conv.lastMessageAtMs)}
                          </span>
                        </div>
                        {conv.listingTitle && (
                          <p className="text-[11px] font-medium text-primary truncate">
                            {conv.listingTitle}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p className="text-xs text-text-secondary truncate">
                            {conv.lastMessage || "Bắt đầu cuộc trò chuyện"}
                          </p>
                          {conv.unreadCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold shrink-0">
                              {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* CỘT PHẢI: CHI TIẾT PHÒNG CHAT */}
          <section
            className={`flex-1 flex flex-col bg-background/40 ${
              !mobileShowDetail ? "hidden md:flex" : "flex"
            }`}
          >
            {!selectedConv ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2 text-text-muted">
                <p className="text-sm font-semibold text-text-main">Chọn một hội thoại để trò chuyện</p>
                <p className="text-xs max-w-sm">
                  Lịch sử tin nhắn được đồng bộ bảo mật qua tài khoản sinh viên Chợ Pass của bạn.
                </p>
              </div>
            ) : (
              <>
                {/* Header đối tác + Context listing */}
                <div className="p-3 sm:p-4 bg-surface border-b border-surface-border space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => setMobileShowDetail(false)}
                        className="md:hidden p-1.5 rounded-lg hover:bg-surface-muted"
                        aria-label="Quay lại danh sách"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h2 className="text-sm font-bold text-text-main truncate">
                            {selectedConv.partner?.displayName || "Sinh viên Chợ Pass"}
                          </h2>
                          {selectedConv.partner?.verified && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-verified-border shrink-0" />
                          )}
                        </div>
                        {selectedConv.partner?.schoolCode && (
                          <span className="text-[11px] text-text-muted">
                            Trường {selectedConv.partner.schoolCode}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isBlocked && <Badge variant="urgent">Đã chặn</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        leftIcon={<Flag className="w-3.5 h-3.5 text-urgent" />}
                        onClick={() => {
                          setModerationFeedback(null);
                          setIsModerationOpen(true);
                        }}
                      >
                        An toàn
                      </Button>
                    </div>
                  </div>

                  {selectedConv.listingId && (
                    <Link
                      href={`/listings/${selectedConv.listingId}`}
                      className="flex items-center justify-between gap-3 p-2 rounded-xl bg-surface-muted/70 border border-surface-border hover:border-primary/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {selectedConv.listingCoverImage && (
                          <Image
                            src={selectedConv.listingCoverImage}
                            alt={selectedConv.listingTitle || "Tin đăng"}
                            width={40}
                            height={40}
                            unoptimized
                            className="w-10 h-10 rounded-lg object-cover shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-text-main truncate">
                            {selectedConv.listingTitle || "Tin đăng liên quan"}
                          </p>
                          {typeof selectedConv.listingPrice === "number" && (
                            <p className="text-xs font-bold text-primary">
                              {formatCurrencyVND(selectedConv.listingPrice)}
                            </p>
                          )}
                        </div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-text-muted shrink-0" />
                    </Link>
                  )}

                  {/* Banner an toàn marketplace */}
                  <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{CHAT_SAFETY_BANNER}</span>
                  </div>

                  {streamDisconnected && (
                    <div className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-[11px] flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <WifiOff className="w-3.5 h-3.5" />
                        Kết nối realtime tạm gián đoạn
                      </span>
                      <button
                        type="button"
                        onClick={fetchInbox}
                        className="font-semibold underline"
                      >
                        Đồng bộ lại
                      </button>
                    </div>
                  )}
                </div>

                {/* Vùng tin nhắn */}
                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                  {hasOlder && (
                    <div className="text-center">
                      <Button
                        size="sm"
                        variant="secondary"
                        isLoading={loadingOlder}
                        disabled={loadingOlder}
                        onClick={handleLoadOlder}
                      >
                        Tải tin nhắn cũ hơn
                      </Button>
                    </div>
                  )}

                  {loadingMessages ? (
                    <div className="flex items-center justify-center py-8 text-text-muted gap-2 text-xs">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Đang tải tin nhắn...</span>
                    </div>
                  ) : mergedMessages.length === 0 ? (
                    <div className="text-center py-8 text-xs text-text-muted">
                      Hãy gửi lời chào để hỏi thêm thông tin hoặc hẹn xem đồ tại cổng trường!
                    </div>
                  ) : (
                    mergedMessages.map((msg) => {
                      const isMine = msg.senderId === uid;
                      const imgUrl =
                        msg.attachmentUrl ||
                        (msg.attachmentPath ? signedUrlMap[msg.attachmentPath] : undefined);

                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}
                        >
                          <div
                            className={`max-w-[78%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words shadow-sm ${
                              isMine
                                ? "bg-primary text-white rounded-br-sm"
                                : "bg-surface border border-surface-border text-text-main rounded-bl-sm"
                            }`}
                          >
                            {msg.type === "image" && (
                              <div className="space-y-1">
                                {imgUrl ? (
                                  <Image
                                    src={imgUrl}
                                    alt="Ảnh đính kèm"
                                    width={280}
                                    height={240}
                                    unoptimized
                                    onError={() => {
                                      const p = msg.attachmentPath;
                                      if (p && selectedId && !retriedSignedPaths.current.has(p)) {
                                        retriedSignedPaths.current.add(p);
                                        setSignedUrlMap((prev) => {
                                          const copy = { ...prev };
                                          delete copy[p];
                                          return copy;
                                        });
                                        requestSignedAttachmentUrl(selectedId, p, true);
                                      }
                                    }}
                                    className="max-h-64 w-auto rounded-lg object-contain bg-black/5"
                                  />
                                ) : (
                                  <div className="text-xs italic opacity-80">
                                    [Đang tải ảnh bảo mật...]
                                  </div>
                                )}
                              </div>
                            )}
                            {msg.text && <p>{msg.text}</p>}
                          </div>

                          <div className="flex items-center gap-2 mt-1 px-1 text-[10px] text-text-muted">
                            <span>{formatShortTime(msg.createdAtMs)}</span>
                            {msg.localState === "sending" && <span>Đang gửi...</span>}
                            {msg.localState === "failed" && (
                              <button
                                type="button"
                                onClick={() => handleRetryFailed(msg)}
                                className="text-red-600 font-semibold flex items-center gap-0.5 hover:underline"
                              >
                                <RotateCw className="w-3 h-3" />
                                Thử lại
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Cảnh báo / lỗi non-blocking */}
                {(contactWarning || chatActionError) && (
                  <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{chatActionError || contactWarning}</span>
                  </div>
                )}

                {/* Thanh nhập tin */}
                {isBlocked ? (
                  <div className="p-3 bg-surface border-t border-surface-border text-center text-xs text-text-muted space-y-1">
                    <p>Cuộc trò chuyện đang ở trạng thái khóa/chặn và không thể gửi tin nhắn mới.</p>
                    {blockedByMe && (
                      <button
                        type="button"
                        onClick={() => handleModerationAction("unblock")}
                        className="text-primary font-semibold hover:underline"
                      >
                        Mở chặn cuộc trò chuyện
                      </button>
                    )}
                  </div>
                ) : (
                  <form
                    onSubmit={handleSendText}
                    className="p-3 bg-surface border-t border-surface-border flex items-center gap-2"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                      onChange={handleAttachImage}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={uploadingImage}
                      isLoading={uploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Gửi ảnh"
                    >
                      <ImageIcon className="w-5 h-5 text-text-secondary" />
                    </Button>
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      maxLength={MAX_MESSAGE_LENGTH}
                      placeholder="Nhập tin nhắn trao đổi với người bán/mua..."
                      className="flex-1 h-10 px-3.5 bg-surface-muted border border-surface-border rounded-xl text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={!inputText.trim()}
                      leftIcon={<Send className="w-4 h-4" />}
                    >
                      Gửi
                    </Button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>

        {/* Modal Báo cáo & Chặn */}
        <Modal
          isOpen={isModerationOpen}
          onClose={() => setIsModerationOpen(false)}
          title="An toàn & Báo cáo hội thoại"
          description="Mọi lịch sử tin nhắn vẫn được bảo toàn để Ban Quản Trị đối chiếu."
        >
          <div className="space-y-4 text-xs">
            {moderationFeedback && (
              <div className="p-2.5 rounded-lg bg-primary-light/40 text-text-main font-medium">
                {moderationFeedback}
              </div>
            )}

            <div className="space-y-2 border-b border-surface-border pb-4">
              <p className="font-bold text-text-main">Chặn / Mở chặn gửi tin nhắn</p>
              {blockedByMe ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={moderationBusy}
                  leftIcon={<Unlock className="w-4 h-4" />}
                  onClick={() => handleModerationAction("unblock")}
                >
                  Gỡ chặn người dùng này
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  disabled={moderationBusy}
                  leftIcon={<Ban className="w-4 h-4" />}
                  onClick={() => handleModerationAction("block")}
                >
                  Chặn tin nhắn mới
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <p className="font-bold text-text-main">Báo cáo vi phạm tới Ban Quản Trị</p>
              <select
                value={reportReason}
                onChange={(e) =>
                  setReportReason(e.target.value as "scam" | "harassment" | "spam" | "other")
                }
                className="w-full h-9 px-3 rounded-lg bg-surface border border-surface-border text-text-main"
              >
                <option value="scam">Dấu hiệu lừa đảo / đòi cọc</option>
                <option value="harassment">Quấy rối / ngôn từ không phù hợp</option>
                <option value="spam">Spam / quảng cáo</option>
                <option value="other">Lý do khác</option>
              </select>
              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Mô tả ngắn vấn đề gặp phải..."
                className="w-full p-2.5 rounded-lg bg-surface border border-surface-border text-text-main"
              />
              <Button
                variant="urgent"
                size="sm"
                isLoading={moderationBusy}
                disabled={moderationBusy}
                onClick={() => handleModerationAction("report")}
              >
                Gửi Báo Cáo Vi Phạm
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </RequireVerified>
  );
}

export default function MessagesPage() {
  return (
    <React.Suspense
      fallback={
        <div className="max-w-6xl mx-auto p-6 text-center text-sm text-text-muted">
          Đang tải hộp thư tin nhắn...
        </div>
      }
    >
      <MessagesContent />
    </React.Suspense>
  );
}
