"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatCurrencyVND } from "@/lib/utils";
import {
  CheckCircle2,
  MapPin,
  Star,
  MessageSquare,
} from "lucide-react";

interface ReservationItem {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPrice: number;
  listingImage: string;
  partnerName: string;
  deliveryMethod: string;
  preferredSchedule: string;
  exactAddress?: string;
  status: "pending" | "confirmed" | "waitlisted" | "completed" | "rejected";
  role: "buyer" | "seller";
  timeRemaining?: string;
}

export default function ReservationsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = React.useState<"all" | "buyer" | "seller">("all");
  const [reviewModalItem, setReviewModalItem] = React.useState<ReservationItem | null>(null);
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState("");
  const [isSubmittingReview, setIsSubmittingReview] = React.useState(false);

  const [reservations, setReservations] = React.useState<ReservationItem[]>([
    {
      id: "res-1",
      listingId: "l1",
      listingTitle: "Quạt đứng Senko công suất lớn lồng sóc",
      listingPrice: 180000,
      listingImage: "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=600&auto=format&fit=crop&q=80",
      partnerName: "Tuấn Anh (K21 Bách Khoa)",
      deliveryMethod: "Tự đến lấy",
      preferredSchedule: "Chiều nay 17h30",
      exactAddress: "Phòng 402, Nhà B3, KTX Bách Khoa",
      status: "confirmed",
      role: "buyer",
      timeRemaining: "Còn 18 giờ",
    },
    {
      id: "res-2",
      listingId: "l2",
      listingTitle: "Nồi cơm điện Sharp 1.8L",
      listingPrice: 250000,
      listingImage: "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80",
      partnerName: "Hương Ly (NEU)",
      deliveryMethod: "Người bán tự giao",
      preferredSchedule: "Tối mai 19h00",
      status: "pending",
      role: "seller",
      timeRemaining: "Còn 12 giờ để phản hồi",
    },
    {
      id: "res-3",
      listingId: "l3",
      listingTitle: "Bàn học gấp kèm ghế xoay",
      listingPrice: 120000,
      listingImage: "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600&auto=format&fit=crop&q=80",
      partnerName: "Minh Quân (Sư Phạm)",
      deliveryMethod: "Tự đến lấy",
      preferredSchedule: "Đã hoàn tất",
      status: "completed",
      role: "buyer",
    },
  ]);

  const handleAction = async (id: string, action: "confirm" | "reject" | "complete") => {
    try {
      const res = await fetch("/api/reservations/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: id,
          userId: user?.uid || "demo-seller-id",
          action,
        }),
      });

      if (res.ok) {
        setReservations((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status:
                    action === "confirm"
                      ? "confirmed"
                      : action === "reject"
                      ? "rejected"
                      : "completed",
                }
              : item
          )
        );
      }
    } catch {
      alert("Đã xảy ra lỗi kết nối");
    }
  };

  const handleSendReview = async () => {
    if (!reviewModalItem) return;
    setIsSubmittingReview(true);
    try {
      await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: reviewModalItem.id,
          reviewerId: user?.uid || "demo-reviewer",
          rating,
          comment,
        }),
      });
      alert("Gửi đánh giá thành công! Cảm ơn bạn.");
      setReviewModalItem(null);
    } catch {
      alert("Đã xảy ra lỗi");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const filtered = reservations.filter((r) => {
    if (activeTab === "all") return true;
    return r.role === activeTab;
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="border-b border-surface-border pb-5">
        <h1 className="text-2xl font-heading font-extrabold text-text-main">
          Quản Lý Giữ Chỗ Mua Bán
        </h1>
        <p className="text-xs text-text-secondary mt-0.5">
          Quy trình giữ chỗ 24h đảm bảo đồ đạc không bị cướp lượt hoặc bỏ bom.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 text-xs font-semibold">
        {[
          { key: "all", label: "Tất cả giao dịch" },
          { key: "buyer", label: "Tôi đi mua" },
          { key: "seller", label: "Yêu cầu tôi nhận được" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key as "all" | "buyer" | "seller")}
            className={`px-3 py-1.5 rounded-lg border transition-all ${
              activeTab === t.key
                ? "bg-primary text-white border-primary shadow-sm"
                : "bg-surface border-surface-border text-text-secondary hover:text-text-main"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Danh sách giữ chỗ */}
      <div className="space-y-4">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="p-5 bg-surface border border-surface-border rounded-2xl shadow-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-muted shrink-0 border border-surface-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.listingImage}
                  alt={item.listingTitle}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-primary">
                    {formatCurrencyVND(item.listingPrice)}
                  </span>
                  <Badge
                    variant={
                      item.status === "confirmed"
                        ? "verified"
                        : item.status === "pending"
                        ? "urgent"
                        : "default"
                    }
                    className="text-[10px] py-0"
                  >
                    {item.status === "confirmed"
                      ? "Đã xác nhận"
                      : item.status === "pending"
                      ? "Chờ xác nhận (24h)"
                      : item.status === "completed"
                      ? "Đã hoàn tất"
                      : "Bị từ chối"}
                  </Badge>
                  <span className="text-[10px] text-text-muted">
                    {item.role === "buyer" ? "• Bạn mua" : "• Bạn bán"}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-text-main line-clamp-1">
                  {item.listingTitle}
                </h3>

                <p className="text-xs text-text-secondary">
                  Đối tác: <strong>{item.partnerName}</strong> · Hẹn: {item.preferredSchedule}
                </p>

                {/* Nếu đã confirmed: hiện địa chỉ chính xác */}
                {item.status === "confirmed" && item.exactAddress && (
                  <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-1.5 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      Địa chỉ nhận hàng: <strong>{item.exactAddress}</strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Nút hành động */}
            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              <Link href="/messages">
                <Button variant="secondary" size="sm" leftIcon={<MessageSquare className="w-3.5 h-3.5" />}>
                  Nhắn tin
                </Button>
              </Link>

              {item.status === "pending" && item.role === "seller" && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => handleAction(item.id, "reject")}
                  >
                    Từ chối
                  </Button>
                  <Button
                    variant="urgent"
                    size="sm"
                    onClick={() => handleAction(item.id, "confirm")}
                  >
                    Xác Nhận Giữ Chỗ
                  </Button>
                </>
              )}

              {item.status === "confirmed" && item.role === "seller" && (
                <Button
                  variant="verified"
                  size="sm"
                  leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                  onClick={() => handleAction(item.id, "complete")}
                >
                  Đã Giao Xong
                </Button>
              )}

              {item.status === "completed" && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Star className="w-3.5 h-3.5 text-amber-500 fill-current" />}
                  onClick={() => setReviewModalItem(item)}
                >
                  Đánh giá
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Modal gửi đánh giá sao */}
      <Modal
        isOpen={Boolean(reviewModalItem)}
        onClose={() => setReviewModalItem(null)}
        title="Đánh Giá Giao Dịch Sinh Viên"
        description="Đánh giá trung thực giúp loại bỏ kẻ xấu và tôn vinh sinh viên uy tín."
      >
        <div className="space-y-4 text-xs">
          <div className="space-y-1.5 text-center py-2">
            <span className="font-bold text-text-main text-sm block">
              Mức độ hài lòng của bạn
            </span>
            <div className="flex items-center justify-center gap-2 pt-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setRating(s)}
                  className="p-1.5 rounded-lg hover:scale-125 transition-transform"
                >
                  <Star
                    className={`w-7 h-7 ${
                      rating >= s
                        ? "text-amber-500 fill-current"
                        : "text-slate-300"
                    }`}
                  />
                </button>
              ))}
            </div>
            <span className="text-xs font-semibold text-amber-600 block mt-1">
              {rating === 5
                ? "Rất tuyệt vời (5 sao)"
                : rating === 4
                ? "Tốt (4 sao)"
                : rating === 3
                ? "Bình thường (3 sao)"
                : "Chưa hài lòng"}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-text-main block">
              Nhận xét ngắn về món đồ và người bán (tùy chọn)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Món đồ đúng mô tả, bạn bán nhiệt tình và đúng hẹn..."
              rows={3}
              className="w-full p-2.5 bg-surface border border-surface-border rounded-xl text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReviewModalItem(null)}
            >
              Đóng
            </Button>
            <Button
              variant="primary"
              size="sm"
              isLoading={isSubmittingReview}
              onClick={handleSendReview}
            >
              Gửi Đánh Giá
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
