"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyVND } from "@/lib/utils";
import {
  Send,
  Image as ImageIcon,
} from "lucide-react";

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
  const [conversations, setConversations] = React.useState<ConversationItem[]>([
    {
      id: "c1",
      listingId: "l1",
      listingTitle: "Quạt đứng Senko công suất lớn lồng sóc",
      listingPrice: 180000,
      listingImage: "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=600&auto=format&fit=crop&q=80",
      partnerName: "Tuấn Anh (K21 Bách Khoa)",
      partnerAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80",
      lastMessage: "Oke bạn ơi, chiều nay 17h30 mình gặp ở Cổng 1 Bách Khoa nhé!",
      lastMessageTime: "10:45",
      unreadCount: 1,
    },
    {
      id: "c2",
      listingId: "l2",
      listingTitle: "Nồi cơm điện Sharp 1.8L",
      listingPrice: 250000,
      listingImage: "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80",
      partnerName: "Hương Ly (NEU)",
      partnerAvatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80",
      lastMessage: "Bạn có mang sang KTX Mễ Trì được không ạ?",
      lastMessageTime: "Hôm qua",
      unreadCount: 0,
    },
  ]);

  const [activeChat, setActiveChat] = React.useState<ConversationItem>(conversations[0]);
  const [chatMessages, setChatMessages] = React.useState<ChatMessage[]>([
    {
      id: "m1",
      senderId: "partner",
      text: "Chào bạn, quạt Senko bạn còn pass không ạ?",
      timestamp: "10:30",
      isMe: false,
    },
    {
      id: "m2",
      senderId: "me",
      text: "Chào bạn! Quạt vẫn còn nhé, bạn có thể qua xem trực tiếp tại KTX.",
      timestamp: "10:35",
      isMe: true,
    },
    {
      id: "m3",
      senderId: "partner",
      text: "Oke bạn ơi, chiều nay 17h30 mình gặp ở Cổng 1 Bách Khoa nhé!",
      timestamp: "10:45",
      isMe: false,
    },
  ]);

  const [inputText, setInputText] = React.useState("");

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

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
                  activeChat.id === conv.id
                    ? "bg-primary-light/40 border-l-4 border-l-primary"
                    : "hover:bg-surface-muted/50"
                }`}
              >
                <div className="relative w-11 h-11 rounded-full overflow-hidden bg-primary-light shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={conv.partnerAvatar}
                    alt={conv.partnerName}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-main truncate">
                      {conv.partnerName}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {conv.lastMessageTime}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-primary truncate mt-0.5">
                    {conv.listingTitle}
                  </p>
                  <p className="text-[11px] text-text-secondary truncate mt-0.5">
                    {conv.lastMessage}
                  </p>
                </div>

                {conv.unreadCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-urgent-solid text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                    {conv.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* CỘT NỘI DUNG CHAT BÊN PHẢI */}
        <div className="flex-1 flex flex-col h-full bg-surface">
          {/* Header chat: thông tin món đồ & người bán */}
          <div className="p-3.5 border-b border-surface-border flex items-center justify-between bg-surface-muted/30">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-surface-muted shrink-0 border border-surface-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeChat.listingImage}
                  alt={activeChat.listingTitle}
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <h3 className="text-xs font-bold text-text-main truncate max-w-xs sm:max-w-md">
                  {activeChat.listingTitle}
                </h3>
                <span className="text-xs font-extrabold text-primary">
                  {formatCurrencyVND(activeChat.listingPrice)}
                </span>
              </div>
            </div>

            <Badge variant="verified" className="text-[10px]">
              {activeChat.partnerName}
            </Badge>
          </div>

          {/* Dòng tin nhắn */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-surface-muted/10">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.isMe ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[75%] p-3 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                    msg.isMe
                      ? "bg-primary text-white rounded-br-none shadow-subtle"
                      : "bg-surface text-text-main border border-surface-border rounded-bl-none shadow-subtle"
                  }`}
                >
                  <p>{msg.text}</p>
                </div>
                <span className="text-[10px] text-text-muted mt-1 px-1">
                  {msg.timestamp}
                </span>
              </div>
            ))}
          </div>

          {/* Khung soạn tin nhắn */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-surface-border flex items-center gap-2 bg-surface"
          >
            <button
              type="button"
              title="Đính kèm ảnh"
              className="w-10 h-10 rounded-xl border border-surface-border flex items-center justify-center text-text-muted hover:text-text-main hover:bg-surface-muted transition-colors shrink-0"
            >
              <ImageIcon className="w-4 h-4" />
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
      </div>
    </div>
    </RequireAuth>
  );
}
