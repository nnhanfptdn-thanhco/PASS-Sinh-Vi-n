"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyVND } from "@/lib/utils";
import {
  Send,
  MessageSquare,
  ShieldAlert,
  ArrowLeft,
  GraduationCap,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { EmptyState } from "@/components/ui/EmptyState";
import Image from "next/image";

interface ConversationItem {
  id: string;
  listingId?: string;
  listingTitle?: string;
  listingPrice?: number;
  listingCoverImage?: string;
  partnerName: string;
  partnerAvatar?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  isMe: boolean;
}

export default function MessagesPage() {
  const { user, profile } = useAuth();
  const [conversations, setConversations] = React.useState<ConversationItem[]>([]);
  const [activeChat, setActiveChat] = React.useState<ConversationItem | null>(null);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [inputText, setInputText] = React.useState("");

  // Tải danh sách hội thoại ban đầu
  React.useEffect(() => {
    // Không dùng localStorage giả lập tin nhắn
    setConversations([]);
  }, []);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || !activeChat) return;

    if (trimmed.length > 1000) {
      alert("Tin nhắn tối đa 1000 ký tự.");
      return;
    }

    const newMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      senderId: user?.uid || "me",
      text: trimmed,
      timestamp: "Vừa xong",
      isMe: true,
    };

    setChatMessages((prev) => [...prev, newMsg]);
    setInputText("");

    // Cập nhật lastMessage
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeChat.id ? { ...c, lastMessage: trimmed, lastMessageTime: "Vừa xong" } : c
      )
    );
  };

  // Người dùng chưa verified thấy hộp thoại dẫn tới onboarding
  if (profile && !profile.verified) {
    return (
      <RequireAuth>
        <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 mx-auto flex items-center justify-center">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold font-heading text-text-main">
            Cần Xác Minh Thẻ Sinh Viên
          </h2>
          <p className="text-sm text-text-secondary">
            Để bảo vệ cộng đồng sinh viên khỏi spam và lừa đảo cọc, tính năng nhắn tin chỉ mở cho sinh viên đã được duyệt thẻ.
          </p>
          <div className="pt-2">
            <Link href="/auth/onboarding">
              <Button variant="primary" size="md" className="w-full">
                Gửi Hồ Sơ Xác Minh Ngay
              </Button>
            </Link>
          </div>
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div className="max-w-6xl mx-auto px-4 py-6">
        {conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-12 h-12 text-primary" />}
            title="Bạn chưa có cuộc trò chuyện nào"
            description="Khi bạn liên hệ với người bán hoặc có sinh viên nhắn tin hỏi mua đồ, danh sách tin nhắn sẽ hiển thị tại đây."
            actionText="Tìm kiếm món đồ cần mua"
            actionHref="/search"
          />
        ) : (
          <div className="bg-surface border border-surface-border rounded-2xl shadow-card overflow-hidden h-[80vh] flex flex-col md:flex-row">
            {/* CỘT DANH SÁCH HỘI THOẠI BÊN TRÁI */}
            <div className="w-full md:w-80 border-r border-surface-border flex flex-col shrink-0">
              <div className="p-4 border-b border-surface-border flex items-center justify-between">
                <h2 className="text-base font-bold font-heading text-text-main">
                  Tin Nhắn Mua Bán
                </h2>
                <Badge variant="verified">1-1 An toàn</Badge>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-surface-border">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setActiveChat(conv);
                      setConversations((prev) =>
                        prev.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c))
                      );
                    }}
                    className={`w-full p-3.5 text-left flex items-start gap-3 transition-colors ${
                      activeChat?.id === conv.id
                        ? "bg-primary-light/40 border-l-4 border-l-primary"
                        : "hover:bg-surface-muted/50"
                    }`}
                  >
                    <div className="relative w-11 h-11 rounded-full overflow-hidden bg-primary-light shrink-0">
                      {conv.partnerAvatar ? (
                        <Image
                          src={conv.partnerAvatar}
                          alt={conv.partnerName}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center font-bold text-primary text-sm">
                          {conv.partnerName.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-text-main truncate">
                          {conv.partnerName}
                        </h4>
                        <span className="text-[10px] text-text-muted">
                          {conv.lastMessageTime || "Gần đây"}
                        </span>
                      </div>
                      {conv.listingTitle && (
                        <p className="text-[11px] text-primary truncate mt-0.5">
                          {conv.listingTitle}
                        </p>
                      )}
                      <p className="text-xs text-text-secondary truncate mt-0.5">
                        {conv.lastMessage || "Bắt đầu cuộc trò chuyện..."}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* KHUNG NỘI DUNG CHAT BÊN PHẢI */}
            <div className="flex-1 flex flex-col min-w-0 bg-surface">
              {activeChat ? (
                <>
                  {/* Header cuộc trò chuyện */}
                  <div className="p-3.5 border-b border-surface-border flex items-center justify-between gap-3 bg-surface-muted/30">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => setActiveChat(null)}
                        className="md:hidden p-1 text-text-secondary hover:text-text-main"
                      >
                        <ArrowLeft className="w-5 h-5" />
                      </button>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-text-main truncate">
                          {activeChat.partnerName}
                        </h3>
                        {activeChat.listingTitle && (
                          <p className="text-xs text-text-secondary truncate">
                            Món đồ: {activeChat.listingTitle} ·{" "}
                            {formatCurrencyVND(activeChat.listingPrice || 0)}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant="verified">Đã duyệt thẻ SV</Badge>
                  </div>

                  {/* Banner an toàn cố định đầu khung chat */}
                  <div className="bg-amber-500/10 border-b border-amber-500/20 px-3.5 py-2 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>
                      <strong>Cảnh báo an toàn:</strong> Không chuyển khoản đặt cọc trước. Luôn hẹn gặp ở nơi công cộng như cổng trường, thư viện hoặc KTX.
                    </span>
                  </div>

                  {/* Vùng tin nhắn */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {chatMessages.length === 0 ? (
                      <div className="text-center py-12 text-xs text-text-muted">
                        Chưa có tin nhắn nào. Hãy gửi lời chào hoặc hẹn địa điểm xem đồ!
                      </div>
                    ) : (
                      chatMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex ${msg.isMe ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-xs ${
                              msg.isMe
                                ? "bg-primary text-white rounded-br-none"
                                : "bg-surface-muted text-text-main border border-surface-border rounded-bl-none"
                            }`}
                          >
                            <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            <span
                              className={`text-[9px] block text-right mt-1 ${
                                msg.isMe ? "text-white/70" : "text-text-muted"
                              }`}
                            >
                              {msg.timestamp}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Vùng nhập tin nhắn */}
                  <form
                    onSubmit={handleSendMessage}
                    className="p-3 border-t border-surface-border flex items-center gap-2 bg-surface"
                  >
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Nhập tin nhắn (hẹn xem đồ, địa điểm...)"
                      maxLength={1000}
                      className="flex-1 bg-surface-muted border border-surface-border rounded-xl px-3.5 py-2 text-xs text-text-main placeholder:text-text-muted focus:outline-none focus:border-primary"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={!inputText.trim()}
                      className="rounded-xl shrink-0"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
                  Chọn một cuộc trò chuyện để bắt đầu
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
