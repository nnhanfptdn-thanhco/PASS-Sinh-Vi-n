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
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { EmptyState } from "@/components/ui/EmptyState";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  timeAgo: string;
  createdAtMs: number;
  href?: string;
}

function toTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const t = Date.parse(val);
    return Number.isNaN(t) ? 0 : t;
  }
  const maybeTs = val as { toMillis?: () => number; toDate?: () => Date };
  if (typeof maybeTs.toMillis === "function") return maybeTs.toMillis();
  if (typeof maybeTs.toDate === "function") return maybeTs.toDate().getTime();
  return 0;
}

function formatRelativeTimeVN(ms: number): string {
  if (!ms) return "Gần đây";
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "Vừa xong";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} ngày trước`;
  return new Date(ms).toLocaleDateString("vi-VN");
}

function mapNotificationDoc(id: string, data: Record<string, unknown>): NotificationItem {
  const type = typeof data.type === "string" ? data.type : "general";
  const title = typeof data.title === "string" ? data.title : "Thông báo";
  const message =
    typeof data.body === "string"
      ? data.body
      : typeof data.message === "string"
      ? data.message
      : "";

  let href = "/my-listings";
  if (
    type.includes("reservation") ||
    type === "review_request" ||
    type === "waitlist_promoted"
  ) {
    href = "/reservations";
  } else if (type === "new_message") {
    href = "/messages";
  } else if (type === "verification_result") {
    const titleLower = title.toLowerCase();
    const isApproved =
      data.status === "approved" ||
      (titleLower.includes("duyệt") && !titleLower.includes("từ chối"));
    href = isApproved ? "/listings/new" : "/auth/onboarding";
  }

  const createdAtMs = toTimestampMs(data.createdAt);
  return {
    id,
    type,
    title,
    message,
    read: Boolean(data.read),
    createdAtMs,
    timeAgo: formatRelativeTimeVN(createdAtMs),
    href,
  };
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isMarkingAll, setIsMarkingAll] = React.useState(false);

  React.useEffect(() => {
    if (!user) {
      setNotifications([]);
      setIsLoading(false);
      return;
    }

    let fallbackUnsub: Unsubscribe | null = null;

    try {
      const q = query(
        collection(db, "notifications"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc"),
        limit(50)
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const items = snapshot.docs.map((docSnap) =>
            mapNotificationDoc(docSnap.id, docSnap.data() as Record<string, unknown>)
          );
          setNotifications(items);
          setIsLoading(false);
        },
        (err) => {
          console.warn("Lỗi tải thông báo có orderBy, chuyển sang truy vấn dự phòng:", err);
          const fallbackQ = query(
            collection(db, "notifications"),
            where("userId", "==", user.uid),
            limit(50)
          );
          fallbackUnsub = onSnapshot(
            fallbackQ,
            (fallbackSnap) => {
              const fallbackItems = fallbackSnap.docs
                .map((docSnap) =>
                  mapNotificationDoc(docSnap.id, docSnap.data() as Record<string, unknown>)
                )
                .sort((a, b) => b.createdAtMs - a.createdAtMs);
              setNotifications(fallbackItems);
              setIsLoading(false);
            },
            () => {
              setNotifications([]);
              setIsLoading(false);
            }
          );
        }
      );

      return () => {
        unsubscribe();
        fallbackUnsub?.();
      };
    } catch {
      setNotifications([]);
      setIsLoading(false);
    }
  }, [user]);

  const markAllAsRead = async () => {
    const unreadItems = notifications.filter((n) => !n.read);
    if (unreadItems.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setIsMarkingAll(true);
    try {
      const batch = writeBatch(db);
      for (const item of unreadItems) {
        batch.update(doc(db, "notifications", item.id), {
          read: true,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    } catch (err) {
      console.warn("Không thể lưu trạng thái đã đọc tất cả:", err);
    } finally {
      setIsMarkingAll(false);
    }
  };

  const markSingleAsRead = (item: NotificationItem) => {
    if (item.read) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, read: true } : n))
    );
    updateDoc(doc(db, "notifications", item.id), {
      read: true,
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
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
              isLoading={isMarkingAll}
              disabled={isMarkingAll}
              leftIcon={<CheckCheck className="w-3.5 h-3.5" />}
              onClick={() => void markAllAsRead()}
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
            {notifications.map((item) => {
              const isReservation =
                item.type === "new_reservation" ||
                item.type.includes("reservation") ||
                item.type === "waitlist_promoted";
              return (
              <Link
                key={item.id}
                href={item.href || "#"}
                onClick={() => markSingleAsRead(item)}
                className={`block p-4 rounded-2xl border transition-all ${
                  item.read
                    ? "bg-surface border-surface-border hover:bg-surface-muted/60"
                    : "bg-primary-light/30 border-primary/20 hover:bg-primary-light/50"
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isReservation
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        : item.type === "verification_result"
                        ? "bg-verified-bg text-verified-border"
                        : item.type === "review_request"
                        ? "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
                        : "bg-surface-muted text-text-secondary"
                    }`}
                  >
                    {isReservation && (
                      <Zap className="w-5 h-5 fill-current" />
                    )}
                    {item.type === "verification_result" && (
                      <ShieldCheck className="w-5 h-5" />
                    )}
                    {item.type === "review_request" && (
                      <Star className="w-5 h-5 text-amber-500 fill-current" />
                    )}
                    {!isReservation &&
                      item.type !== "verification_result" &&
                      item.type !== "review_request" && (
                        <Package className="w-5 h-5" />
                      )}
                  </div>

                  <div className="space-y-1 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-text-main">
                        {item.title}
                      </h3>
                      <span className="text-[11px] text-text-muted shrink-0">
                        {item.timeAgo}
                      </span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
