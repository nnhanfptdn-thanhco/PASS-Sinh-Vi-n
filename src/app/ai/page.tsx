"use client";

import * as React from "react";
import Link from "next/link";
import {
  Sparkles,
  Send,
  Square,
  RotateCw,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Trash2,
  Plus,
  ExternalLink,
  ShieldCheck,
  MessageSquare,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { authFetch } from "@/lib/firebase/client";

interface AICitation {
  kind: "listing" | "help";
  id: string;
  title: string;
  url: string;
}

interface AIMessageUI {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: AICitation[];
  feedback?: "helpful" | "not_helpful" | null;
  error?: string;
}

interface AIConversationSummary {
  id: string;
  title: string;
  updatedAtMs: number | null;
}

const PROMPT_STARTERS = [
  "Hướng dẫn đăng tin",
  "Cách giữ chỗ và xác nhận",
  "Tìm món đồ theo ngân sách",
  "Làm sao tránh lừa đảo khi mua bán?",
] as const;

function NnhanAIContent() {
  const { user } = useAuth();
  const [conversations, setConversations] = React.useState<AIConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<AIMessageUI[]>([]);
  const [input, setInput] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(true);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);
  const [clearingAll, setClearingAll] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement>(null);

  const loadConversations = React.useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    try {
      const res = await authFetch("/api/ai/conversations?limit=30");
      const json = await res.json().catch(() => null);
      if (res.ok && Array.isArray(json?.items)) {
        setConversations(json.items);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [user]);

  React.useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setActiveConvId(null);
      return;
    }
    loadConversations();
  }, [user, loadConversations]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  // Hủy stream nếu người dùng rời trang
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const handleSelectConversation = async (convId: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setGlobalError(null);
    setActiveConvId(convId);
    setSidebarOpen(false);
    try {
      const res = await authFetch(`/api/ai/conversations/${encodeURIComponent(convId)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || "Không thể tải hội thoại NnhanAI.");
      }
      setMessages(Array.isArray(json?.messages) ? json.messages : []);
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : "Lỗi tải hội thoại.");
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  };

  const sendPrompt = async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt || isStreaming) return;

    setGlobalError(null);
    setInput("");
    setIsStreaming(true);

    const tempUserId = `u_tmp_${Date.now()}`;
    const tempAiId = `a_tmp_${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: tempUserId, role: "user", text: prompt },
      { id: tempAiId, role: "assistant", text: "", citations: [] },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await authFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeConvId ? { conversationId: activeConvId } : {}),
          message: prompt,
          stream: true,
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Lỗi máy chủ (${res.status}). Vui lòng thử lại.`);
      }

      if (!contentType.includes("text/event-stream") || !res.body) {
        const json = await res.json();
        if (json?.conversationId) setActiveConvId(json.conversationId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempAiId
              ? {
                  id: json?.messageId || tempAiId,
                  role: "assistant",
                  text: String(json?.reply || ""),
                  citations: Array.isArray(json?.citations) ? json.citations : [],
                  feedback: null,
                }
              : m
          )
        );
        await loadConversations();
        return;
      }

      // Đọc SSE stream (kèm xả phần buffer cuối khi EOF)
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let currentEvent = "message";

      const processLines = (lines: string[]) => {
        for (const rawLine of lines) {
          const line = rawLine.trimEnd();
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const payloadText = line.slice(5).trim();
            if (!payloadText) continue;
            try {
              const payload = JSON.parse(payloadText);
              if (currentEvent === "meta") {
                // Chỉ khóa activeConvId nếu hội thoại đã tồn tại trong Firestore
                if (payload.conversationId && payload.persisted === true) {
                  setActiveConvId(payload.conversationId);
                }
                if (Array.isArray(payload.citations)) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === tempAiId ? { ...m, citations: payload.citations } : m
                    )
                  );
                }
              } else if (currentEvent === "delta") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAiId ? { ...m, text: `${m.text}${payload.text || ""}` } : m
                  )
                );
              } else if (currentEvent === "done") {
                if (payload.conversationId) setActiveConvId(payload.conversationId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAiId
                      ? {
                          ...m,
                          id: payload.messageId || tempAiId,
                          text: payload.text || m.text,
                          citations: payload.citations || m.citations,
                          feedback: null,
                        }
                      : m
                  )
                );
              } else if (currentEvent === "error") {
                throw new Error(payload.error || "NnhanAI gặp gián đoạn phản hồi.");
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && currentEvent === "error") {
                throw parseErr;
              }
            }
          }
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        processLines(lines);
      }

      // Xả nốt dòng cuối chưa kết thúc bằng newline
      buffer += decoder.decode();
      if (buffer.trim()) {
        processLines(buffer.split("\n"));
      }

      await loadConversations();
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAiId
            ? {
                ...m,
                text: m.text || (aborted ? "[Đã dừng tạo câu trả lời]" : ""),
                error: aborted
                  ? undefined
                  : err instanceof Error
                  ? err.message
                  : "Không thể kết nối với NnhanAI.",
              }
            : m
        )
      );
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleFeedback = async (messageId: string, rating: "helpful" | "not_helpful") => {
    if (!activeConvId || messageId.startsWith("a_tmp_")) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, feedback: rating } : m))
    );
    await authFetch(`/api/ai/conversations/${encodeURIComponent(activeConvId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, rating }),
    }).catch(() => undefined);
  };

  const handleClearAllHistory = async () => {
    if (!window.confirm("Xóa toàn bộ lịch sử trò chuyện NnhanAI? (Hội thoại với người mua/người bán vẫn được giữ nguyên.)")) {
      return;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setClearingAll(true);
    try {
      const res = await authFetch("/api/ai/conversations", { method: "DELETE" });
      if (res.ok) {
        setConversations([]);
        setActiveConvId(null);
        setMessages([]);
      }
    } finally {
      setClearingAll(false);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Clipboard bị trình duyệt hạn chế
    }
  };

  const handleRetryLast = () => {
    if (isStreaming) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx >= 0) {
      const promptText = messages[lastUserIdx].text;
      // Gỡ cả tin nhắn user cuối cùng lẫn bóng assistant lỗi để không bị trùng tin nhắn
      setMessages((prev) => prev.slice(0, lastUserIdx));
      void sendPrompt(promptText);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-2 sm:px-4 py-3 sm:py-4">
      <div className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden flex h-[calc(100dvh-148px)] md:h-[calc(100dvh-104px)] min-h-[460px] relative">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-10 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* SIDEBAR LỊCH SỬ NNHANAI */}
        <aside
          className={`w-72 border-r border-surface-border flex flex-col bg-surface z-20 ${
            sidebarOpen ? "fixed inset-y-0 left-0 shadow-2xl pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]" : "hidden md:flex"
          }`}
        >
          <div className="p-4 border-b border-surface-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-text-main">NnhanAI</h2>
                <p className="text-[10px] text-text-muted">Trợ lý Chợ Pass SV</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="md:hidden p-1 rounded-lg hover:bg-surface-muted"
              aria-label="Đóng thanh bên"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 border-b border-surface-border">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={() => {
                abortRef.current?.abort();
                abortRef.current = null;
                setIsStreaming(false);
                setActiveConvId(null);
                setMessages([]);
                setSidebarOpen(false);
              }}
            >
              Cuộc trò chuyện mới
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingHistory ? (
              <div className="p-3 text-xs text-text-muted">Đang tải lịch sử NnhanAI...</div>
            ) : conversations.length === 0 ? (
              <div className="p-3 text-xs text-text-muted">Chưa có lịch sử hỏi NnhanAI.</div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectConversation(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs truncate transition-colors ${
                    activeConvId === c.id
                      ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold"
                      : "text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  {c.title}
                </button>
              ))
            )}
          </div>

          <div className="p-3 border-t border-surface-border space-y-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              leftIcon={<Trash2 className="w-4 h-4" />}
              disabled={clearingAll || conversations.length === 0}
              isLoading={clearingAll}
              onClick={handleClearAllHistory}
            >
              Xóa lịch sử NnhanAI
            </Button>
            <Link
              href="/messages"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-text-muted hover:text-primary"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chuyển sang Chat Người mua/bán →</span>
            </Link>
          </div>
        </aside>

        {/* KHUNG HỘI THOẠI CHÍNH */}
        <section className="flex-1 flex flex-col bg-background/40">
          {/* Header */}
          <div className="p-3 sm:p-4 bg-surface border-b border-surface-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="md:hidden p-1.5 rounded-lg hover:bg-surface-muted"
                aria-label="Mở lịch sử NnhanAI"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-heading font-bold text-text-main">NnhanAI Assistant</h1>
                <Badge variant="default" className="bg-indigo-600 text-white text-[10px]">
                  Public RAG Safe
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" />
              <span className="hidden sm:inline">Chỉ đọc dữ liệu công khai • Không truy cập SĐT/Chat riêng tư</span>
            </div>
          </div>

          {/* Nội dung */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="max-w-xl mx-auto my-8 text-center space-y-6">
                <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 mx-auto flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-xl font-heading font-bold text-text-main">
                    Xin chào! Mình là NnhanAI
                  </h2>
                  <p className="text-xs text-text-secondary">
                    Trợ lý Chợ Pass Sinh Viên giúp bạn tìm món đồ công khai, viết mô tả bán nhanh, hiểu quy trình giữ chỗ 24h/72h và phòng tránh lừa đảo.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                  {PROMPT_STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => sendPrompt(starter)}
                      className="p-3.5 rounded-xl bg-surface border border-surface-border hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 text-xs font-semibold text-text-main transition-colors"
                    >
                      {starter} →
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words shadow-sm ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-sm"
                        : "bg-surface border border-surface-border text-text-main rounded-bl-sm"
                    }`}
                  >
                    {m.text || (isStreaming && m.role === "assistant" && !m.error ? "NnhanAI đang suy nghĩ..." : "")}
                    {m.error && (
                      <div className="mt-2 p-2 rounded-lg bg-red-50 text-red-700 text-xs space-y-1">
                        <p>{m.error}</p>
                        <button
                          type="button"
                          onClick={handleRetryLast}
                          className="font-semibold underline inline-flex items-center gap-1"
                        >
                          <RotateCw className="w-3 h-3" /> Thử lại
                        </button>
                      </div>
                    )}

                    {/* Nguồn trích dẫn công khai thực tế */}
                    {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-surface-border space-y-1.5">
                        <p className="text-[11px] font-bold text-text-muted uppercase">
                          Nguồn tham chiếu công khai:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {m.citations.map((cit) => (
                            <Link
                              key={`${cit.kind}_${cit.id}`}
                              href={cit.url}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-muted border border-surface-border text-[11px] text-primary hover:underline"
                            >
                              <span className="truncate max-w-[200px]">{cit.title}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {m.role === "assistant" && m.text && (
                    <div className="flex items-center gap-2 mt-1.5 px-1 text-text-muted">
                      <button
                        type="button"
                        onClick={() => handleCopy(m.id, m.text)}
                        className="p-1 rounded hover:bg-surface-muted text-[11px] inline-flex items-center gap-1"
                        aria-label="Sao chép"
                      >
                        {copiedId === m.id ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {activeConvId && !m.id.startsWith("a_tmp_") && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleFeedback(m.id, "helpful")}
                            className={`p-1 rounded hover:bg-surface-muted ${
                              m.feedback === "helpful" ? "text-green-600" : ""
                            }`}
                            aria-label="Hữu ích"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(m.id, "not_helpful")}
                            className={`p-1 rounded hover:bg-surface-muted ${
                              m.feedback === "not_helpful" ? "text-red-600" : ""
                            }`}
                            aria-label="Chưa hữu ích"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={endRef} />
          </div>

          {globalError && (
            <div className="mx-4 mb-2 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs">
              {globalError}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendPrompt(input);
            }}
            className="p-3 bg-surface border-t border-surface-border flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={1500}
              disabled={isStreaming}
              placeholder="Hỏi NnhanAI về tìm đồ, đăng tin, giữ chỗ hoặc an toàn mua bán..."
              className="flex-1 h-10 px-3.5 bg-surface-muted border border-surface-border rounded-xl text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {isStreaming ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                leftIcon={<Square className="w-3.5 h-3.5" />}
                onClick={handleStop}
              >
                Dừng
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={!input.trim()}
                leftIcon={<Send className="w-4 h-4" />}
              >
                Hỏi NnhanAI
              </Button>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}

export default function NnhanAIPage() {
  return (
    <RequireAuth>
      <NnhanAIContent />
    </RequireAuth>
  );
}
