"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  Bell,
  Zap,
  Star,
  CheckCheck,
  ShieldCheck,
  Package,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { useAuth } from "@/lib/auth/AuthContext";
import { db } from "@/lib/firebase/client";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { EmptyState } from "@/components/ui/EmptyState";

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
  const { user } = useAuth();
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (!user) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    try {
      const q = query(
        collection(db, "notifications"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const items: NotificationItem[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            let href = "/my-listings";
            if (data.type === "reservation_request" || data.type === "reservation_confirmed") {
              href = "/reservations";
            } else if (data.type === "verification_result") {
              href = "/listings/new";
            }

            return {
              id: docSnap.id,
              type: data.type || "general",
              title: data.title || "Thông báo",
              message: data.message || "",
              read: Boolean(data.read),
              timeAgo: "Gần đây",
              href,
            };
          });
          setNotifications(items);
          setIsLoading(false);
        },
        () => {
          setNotifications([]);
          setIsLoading(false);
        }
      );

      return () => unsubscribe();
    } catch {
      setNotifications([]);
      setIsLoading(false);
    }
  }, [user]);

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <RequireAuth>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-border pb-5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-heading font-extrabold text-text-main">
                Thông Báo
              </h1>
              {unreadCount > 0 && (
                <Badge variant="urgent">{unreadCount} mới</Badge>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-0.5">
              Cập nhật tức thời về xác minh thẻ SV, yêu cầu giữ chỗ và phản hồi giao dịch.
            </p>
          </div>

          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={<CheckCheck className="w-3.5 h-3.5" />}
              onClick={markAllAsRead}
            >
              Đã đọc tất cả
            </Button>
          )}
        </div>

        {/* Nội dung danh sách */}
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center text-text-muted">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <span className="text-xs">Đang tải thông báo...</span>
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell className="w-10 h-10 text-primary" />}
            title="Bạn chưa có thông báo nào"
            description="Các thông báo về trạng thái duyệt thẻ sinh viên, lời mời giữ chỗ và đánh giá giao dịch sẽ xuất hiện tại đây."
            actionText="Khám phá chợ đồ cũ"
            actionHref="/"
          />
        ) : (
          <div className="space-y-3">
            {notifications.map((item) => (
              <Link
                key={item.id}
                href={item.href || "#"}
                className={`block p-4 rounded-2xl border transition-all ${
                  item.read
                    ? "bg-surface border-surface-border hover:bg-surface-muted/60"
                    : "bg-primary-light/30 border-primary/20 hover:bg-primary-light/50"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      item.type === "reservation_request"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        : item.type === "verification_result"
                        ? "bg-verified-bg text-verified-border"
                        : item.type === "review_request"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                        : "bg-surface-muted text-text-secondary"
                    }`}
                  >
                    {item.type === "reservation_request" && (
                      <Zap className="w-5 h-5 fill-current" />
                    )}
                    {item.type === "verification_result" && (
                      <ShieldCheck className="w-5 h-5" />
                    )}
                    {item.type === "review_request" && (
                      <Star className="w-5 h-5 text-amber-500 fill-current" />
                    )}
                    {item.type !== "reservation_request" &&
                      item.type !== "verification_result" &&
                      item.type !== "review_request" && (
                        <Package className="w-5 h-5" />
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
    </RequireAuth>
  );
}
