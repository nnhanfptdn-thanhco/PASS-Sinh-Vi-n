"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Bell,
  CheckCircle2,
  Zap,
  Star,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  timeAgo: string;
  href?: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([
    {
      id: "n1",
      type: "reservation_request",
      title: "Có sinh viên vừa gửi yêu cầu Giữ Chỗ! ⚡",
      message:
        "Nguyễn Văn Tuấn muốn giữ chỗ món 'Quạt đứng Senko'. Bạn có 24 giờ để bấm Xác nhận hoặc Từ chối.",
      read: false,
      timeAgo: "15 phút trước",
      href: "/reservations",
    },
    {
      id: "n2",
      type: "verification_result",
      title: "Thẻ sinh viên đã được phê duyệt! 🎉",
      message:
        "Chúc mừng bạn! Tài khoản đã được cấp nhãn 'Đã xác minh sinh viên'. Bạn hiện có thể đăng tin bán và xem số liên hệ.",
      read: true,
      timeAgo: "Hôm qua",
      href: "/listings/new",
    },
    {
      id: "n3",
      type: "review_request",
      title: "Mời bạn đánh giá người bán ⭐",
      message:
        "Giao dịch bàn học gỗ đã hoàn tất. Hãy dành 30 giây gửi nhận xét để giúp các bạn sinh viên khác an tâm hơn nhé.",
      read: true,
      timeAgo: "2 ngày trước",
      href: "/reservations",
    },
  ]);

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-heading font-extrabold text-text-main">
              Thông Báo
            </h1>
            {unreadCount > 0 && (
              <Badge variant="urgent" className="text-xs">
                {unreadCount} mới
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-0.5">
            Cập nhật về giữ chỗ, duyệt thẻ sinh viên và tin nhắn mua bán.
          </p>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<CheckCheck className="w-4 h-4" />}
            onClick={markAllAsRead}
          >
            Đánh dấu đã đọc
          </Button>
        )}
      </div>

      {/* Danh sách thông báo */}
      {notifications.length === 0 ? (
        <div className="p-12 text-center bg-surface border border-dashed border-surface-border rounded-2xl space-y-3">
          <Bell className="w-10 h-10 text-text-muted mx-auto" />
          <p className="text-sm font-semibold text-text-main">
            Bạn chưa có thông báo nào.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((item) => (
            <Link
              key={item.id}
              href={item.href || "#"}
              className={`block p-4 rounded-2xl border transition-all ${
                item.read
                  ? "bg-surface border-surface-border hover:bg-surface-muted/50"
                  : "bg-primary-light/40 border-primary/30 shadow-subtle hover:bg-primary-light/60"
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    item.type === "reservation_request"
                      ? "bg-urgent-bg text-urgent-solid"
                      : item.type === "verification_result"
                      ? "bg-verified-bg text-verified-border"
                      : "bg-surface-muted text-text-secondary"
                  }`}
                >
                  {item.type === "reservation_request" && (
                    <Zap className="w-5 h-5 fill-current" />
                  )}
                  {item.type === "verification_result" && (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                  {item.type === "review_request" && (
                    <Star className="w-5 h-5 text-amber-500 fill-current" />
                  )}
                </div>

                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-text-main">
                      {item.title}
                    </h3>
                    <span className="text-[11px] text-text-muted">
                      {item.timeAgo}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {item.message}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
