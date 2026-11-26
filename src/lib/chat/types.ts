export const MAX_MESSAGE_LENGTH = 1000;

export const CHAT_SAFETY_BANNER =
  "An toàn giao dịch: Không chuyển khoản đặt cọc ngoài hệ thống, không chia sẻ mã OTP/mật khẩu và không bấm vào liên kết lạ. Số điện thoại & địa chỉ chi tiết chỉ mở sau khi người bán xác nhận giữ chỗ (Option A).";

export type ConversationStatus = "active" | "blocked" | "closed";

export interface ChatPartnerSummary {
  uid: string;
  displayName: string;
  photoURL: string | null;
  schoolCode: string | null;
  verified: boolean;
}

export interface ConversationDTO {
  id: string;
  participantIds: string[];
  listingId: string | null;
  listingTitle: string | null;
  listingPrice: number | null;
  listingCoverImage: string | null;
  partner: ChatPartnerSummary | null;
  lastMessage: string | null;
  lastMessageAtMs: number | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
  status: ConversationStatus;
  blockedBy: Record<string, boolean>;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  schemaVersion: 1;
}

export interface ChatMessageDTO {
  id: string;
  senderId: string;
  type: "text" | "image" | "system";
  text: string | null;
  attachmentPath: string | null;
  attachmentUrl?: string | null;
  attachmentMimeType: string | null;
  attachmentSize: number | null;
  createdAtMs: number | null;
  clientMessageId: string;
  moderationStatus: "normal" | "flagged" | "removed";
}

/**
 * Phát hiện dấu hiệu SĐT/Zalo/liên kết ngoài trong nội dung chat để hiển thị cảnh báo an toàn (non-blocking theo D8).
 */
export function detectChatContactWarning(text: string): string | null {
  const normalized = text.normalize("NFKC");
  const hasPhone = /(?:\+84|84|0)[35789][\d\s.-]{7,11}\d/.test(normalized);
  const hasExternalLink = /(?:zalo\.me|facebook\.com|fb\.com|t\.me|https?:\/\/)/i.test(normalized);
  if (hasPhone || hasExternalLink) {
    return "Lưu ý: Không chia sẻ thông tin nhạy cảm hay giao dịch cọc qua kênh ngoài trước khi xác nhận giữ chỗ trên Chợ Pass.";
  }
  return null;
}

export function sanitizeLastMessagePreview(type: "text" | "image" | "system", text: string | null): string {
  if (type === "image") return "[Đã gửi một hình ảnh]";
  const clean = (text || "")
    .normalize("NFKC")
    .replace(/(?:\+84|84|0)[35789][\d\s.-]{7,11}\d/g, "[SĐT đã ẩn trong xem trước]")
    .trim();
  return clean.slice(0, 120);
}
