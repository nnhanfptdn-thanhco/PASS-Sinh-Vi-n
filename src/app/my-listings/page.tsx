"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyVND } from "@/lib/utils";
import {
  Eye,
  Heart,
  MessageSquare,
  Clock,
  CheckCircle,
  EyeOff,
  RefreshCw,
  PlusCircle,
  AlertTriangle,
} from "lucide-react";

interface MyListingItem {
  id: string;
  title: string;
  price: number;
  coverImage: string;
  status: "active" | "reserved" | "sold" | "hidden_by_seller" | "hidden_by_admin" | "expired";
  viewsCount: number;
  favoritesCount: number;
  chatsCount: number;
  passDeadline: string;
  urgentPass: boolean;
  createdAt: string;
}

export default function MyListingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = React.useState<"active" | "reserved" | "sold" | "hidden">("active");
  const [listings, setListings] = React.useState<MyListingItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Tải danh sách tin mẫu hoặc thực tế
    setListings([
      {
        id: "l1",
        title: "Quạt đứng Senko lồng sóc màu xám còn rất mới",
        price: 180000,
        coverImage: "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=600&auto=format&fit=crop&q=80",
        status: "active",
        viewsCount: 42,
        favoritesCount: 7,
        chatsCount: 3,
        passDeadline: "2026-11-20",
        urgentPass: true,
        createdAt: "17/11/2026",
      },
      {
        id: "l2",
        title: "Nồi cơm điện Sharp 1.8L nấu ngon chống dính tốt",
        price: 250000,
        coverImage: "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80",
        status: "reserved",
        viewsCount: 88,
        favoritesCount: 15,
        chatsCount: 8,
        passDeadline: "2026-11-22",
        urgentPass: false,
        createdAt: "16/11/2026",
      },
      {
        id: "l3",
        title: "Bàn học gấp chân sắt kèm ghế xoay nỉ",
        price: 120000,
        coverImage: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600&auto=format&fit=crop&q=80",
        status: "sold",
        viewsCount: 120,
        favoritesCount: 22,
        chatsCount: 12,
        passDeadline: "2026-11-15",
        urgentPass: false,
        createdAt: "14/11/2026",
      },
    ]);
  }, []);

  const handleStatusChange = async (
    id: string,
    action: "change_status" | "renew",
    newStatus?: MyListingItem["status"]
  ) => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/listings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: id,
          sellerId: user?.uid || "demo-seller-id",
          action,
          newStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Thao tác không thành công");
        return;
      }

      setActionMessage(data.message);
      setListings((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: action === "renew" ? "active" : newStatus || item.status,
              }
            : item
        )
      );
      setTimeout(() => setActionMessage(null), 3000);
    } catch {
      alert("Đã xảy ra lỗi kết nối");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredListings = listings.filter((item) => {
    if (activeTab === "active") return item.status === "active";
    if (activeTab === "reserved") return item.status === "reserved";
    if (activeTab === "sold") return item.status === "sold";
    if (activeTab === "hidden")
      return (
        item.status === "hidden_by_seller" ||
        item.status === "hidden_by_admin" ||
        item.status === "expired"
      );
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Tiêu đề & Nút đăng tin nhanh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-border pb-5">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-text-main">
            Quản Lý Tin Của Tôi
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Theo dõi trạng thái, lượt xem, lượt liên hệ và cập nhật nhanh bằng 1 chạm.
          </p>
        </div>

        <Link
          href="/listings/new"
          className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-primary text-white hover:bg-primary-hover shadow-subtle gap-1.5 cursor-pointer shrink-0"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Đăng Món Đồ Mới</span>
        </Link>
      </div>

      {actionMessage && (
        <div className="p-3 bg-green-50 border border-green-200 text-xs text-green-800 rounded-xl flex items-center gap-2 dark:bg-green-950/50 dark:border-green-800 dark:text-green-200">
          <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Tabs trạng thái */}
      <div className="flex items-center gap-2 border-b border-surface-border overflow-x-auto pb-1 no-scrollbar text-xs font-semibold">
        {[
          { key: "active", label: "Đang bán" },
          { key: "reserved", label: "Đã có người giữ" },
          { key: "sold", label: "Đã bán thành công" },
          { key: "hidden", label: "Đã ẩn / Hết hạn" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() =>
              setActiveTab(
                tab.key as "active" | "reserved" | "sold" | "hidden"
              )
            }
            className={`px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? "border-primary text-primary font-bold"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Danh sách tin */}
      {filteredListings.length === 0 ? (
        <div className="p-12 text-center bg-surface border border-dashed border-surface-border rounded-2xl space-y-3">
          <p className="text-sm font-semibold text-text-main">
            Bạn chưa có tin nào trong mục này.
          </p>
          <Link
            href="/listings/new"
            className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs border border-primary text-primary hover:bg-primary-light gap-1.5 cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Đăng tin ngay</span>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredListings.map((item) => (
            <div
              key={item.id}
              className="bg-surface border border-surface-border rounded-2xl p-4 sm:p-5 shadow-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              {/* Ảnh và thông tin */}
              <div className="flex items-start gap-3.5">
                <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-surface-muted shrink-0 border border-surface-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.coverImage}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                  {item.urgentPass && (
                    <span className="absolute top-1 left-1 px-1 py-0.2 rounded bg-urgent-solid text-[9px] font-bold text-white">
                      Pass gấp
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-primary">
                      {formatCurrencyVND(item.price)}
                    </span>
                    <Badge
                      variant={
                        item.status === "active"
                          ? "verified"
                          : item.status === "reserved"
                          ? "urgent"
                          : "default"
                      }
                      className="text-[10px] py-0"
                    >
                      {item.status === "active"
                        ? "Đang bán"
                        : item.status === "reserved"
                        ? "Đã giữ chỗ"
                        : item.status === "sold"
                        ? "Đã bán"
                        : "Đã ẩn"}
                    </Badge>
                  </div>

                  <h3 className="text-sm font-semibold text-text-main line-clamp-1 max-w-md">
                    {item.title}
                  </h3>

                  {/* Thống kê tương tác */}
                  <div className="flex items-center gap-3 text-xs text-text-muted pt-1">
                    <span className="flex items-center gap-1" title="Lượt xem">
                      <Eye className="w-3.5 h-3.5" />
                      <span>{item.viewsCount}</span>
                    </span>
                    <span className="flex items-center gap-1" title="Lượt lưu">
                      <Heart className="w-3.5 h-3.5" />
                      <span>{item.favoritesCount}</span>
                    </span>
                    <span className="flex items-center gap-1" title="Lượt nhắn tin">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{item.chatsCount}</span>
                    </span>
                    <span className="flex items-center gap-1" title="Hạn pass">
                      <Clock className="w-3.5 h-3.5" />
                      <span>Hạn: {item.passDeadline}</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Nút hành động 1 chạm */}
              <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                {item.status === "active" && (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<EyeOff className="w-3.5 h-3.5" />}
                      onClick={() =>
                        handleStatusChange(item.id, "change_status", "hidden_by_seller")
                      }
                      disabled={isLoading}
                    >
                      Ẩn tin
                    </Button>
                    <Button
                      variant="verified"
                      size="sm"
                      leftIcon={<CheckCircle className="w-3.5 h-3.5" />}
                      onClick={() =>
                        handleStatusChange(item.id, "change_status", "sold")
                      }
                      disabled={isLoading}
                    >
                      Đã bán
                    </Button>
                  </>
                )}

                {item.status === "hidden_by_seller" && (
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                    onClick={() =>
                      handleStatusChange(item.id, "change_status", "active")
                    }
                    disabled={isLoading}
                  >
                    Hiện lại tin
                  </Button>
                )}

                {item.status === "hidden_by_admin" && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 p-2 rounded-lg dark:bg-red-950/50">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Bị Admin ẩn do vi phạm</span>
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                  onClick={() => handleStatusChange(item.id, "renew")}
                  disabled={isLoading}
                >
                  Gia hạn +7 ngày
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
