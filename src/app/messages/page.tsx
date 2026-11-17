"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyVND } from "@/lib/utils";
import {
  Send,
  Image as ImageIcon,
  MessageSquare,
} from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { EmptyState } from "@/components/ui/EmptyState";
import Image from "next/image";

interface ConversationItem {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPrice: number;
  listingImage: string;
  partnerName: string;
  partnerAvatar: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  timestamp: string;
  isMe: boolean;
}

export default function MessagesPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = React.useState<ConversationItem[]>([]);
  const [activeChat, setActiveChat] = React.useState<ConversationItem | null>(null);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([]);
  const [inputText, setInputText] = React.useState("");

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChat) return;

    const newMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      senderId: user?.uid || "me",
      text: inputText.trim(),
      timestamp: "Vừa xong",
      isMe: true,
    };

    setChatMessages((prev) => [...prev, newMsg]);
    setInputText("");
  };

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
                      <Image
                        src={conv.partnerAvatar}
                        alt={conv.partnerName}
                        width={44}
                        height={44}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="font-bold text-xs text-text-main truncate">
                          {conv.partnerName}
                        </span>
                        <span className="text-[10px] text-text-muted shrink-0">
                          {conv.lastMessageTime}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary truncate">
                        {conv.lastMessage}
                      </p>
                    </div>

                    {conv.unreadCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* CỘT NỘI DUNG CHAT BÊN PHẢI */}
            {activeChat ? (
              <div className="flex-1 flex flex-col h-full bg-surface-muted/20">
                {/* Header người chat & món đồ */}
                <div className="p-3.5 px-4 bg-surface border-b border-surface-border flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-primary-light shrink-0">
                      <Image
                        src={activeChat.partnerAvatar}
                        alt={activeChat.partnerName}
                        width={36}
                        height={36}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="truncate">
                      <h3 className="font-bold text-xs sm:text-sm text-text-main truncate">
                        {activeChat.partnerName}
                      </h3>
                      <p className="text-[11px] text-text-muted truncate">
                        Quan tâm: {activeChat.listingTitle} ({formatCurrencyVND(activeChat.listingPrice)})
                      </p>
                    </div>
                  </div>
                </div>

                {/* Danh sách tin nhắn */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.isMe ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-xs sm:text-sm ${
                          msg.isMe
                            ? "bg-primary text-white rounded-br-xs shadow-subtle"
                            : "bg-surface border border-surface-border text-text-main rounded-bl-xs shadow-subtle"
                        }`}
                      >
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-text-muted mt-1 px-1">
                        {msg.timestamp}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Khung nhập tin nhắn */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 bg-surface border-t border-surface-border flex items-center gap-2"
                >
                  <button
                    type="button"
                    title="Gửi ảnh món đồ"
                    className="p-2 text-text-muted hover:text-primary transition-colors"
                  >
                    <ImageIcon className="w-5 h-5" />
                  </button>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Nhập tin nhắn hẹn giờ gặp, hỏi thêm chi tiết..."
                    className="flex-1 h-11 px-3.5 bg-surface-muted/40 border border-surface-border rounded-xl text-xs sm:text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="h-11 px-4 rounded-xl shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                Chọn một cuộc trò chuyện để bắt đầu nhắn tin
              </div>
            )}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
