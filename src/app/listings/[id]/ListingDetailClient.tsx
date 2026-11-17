"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { authFetch } from "@/lib/firebase/client";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatCurrencyVND } from "@/lib/utils";
import {
  Share2,
  Heart,
  MapPin,
  Clock,
  Truck,
  Building,
  AlertTriangle,
  Phone,
  Check,
  CheckCircle2,
} from "lucide-react";

export interface ListingDetailData {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  urgentPass?: boolean;
  condition: string;
  brandModel?: string;
  usageTime?: string;
  defects?: string;
  description: string;
  images: string[];
  negotiationType?: string;
  passDeadline: string;
  schoolCode: string;
  schoolName: string;
  campusName: string;
  publicMeetingPoint: string;
  seller: {
    id: string;
    displayName: string;
    avatarUrl: string;
    verified: boolean;
    rating: number;
    completedDealsCount: number;
    joinDate: string;
    isGraduating?: boolean;
  };
  shipping: {
    allowPickup: boolean;
    pickupSchedule?: string;
    allowSellerShip: boolean;
    shipFee?: string;
    allowCarrier: boolean;
    campusDelivery?: boolean;
  };
}

export function ListingDetailClient({
  listing,
}: {
  listing: ListingDetailData;
}) {
  const { user, profile } = useAuth();
  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const [isFavorite, setIsFavorite] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);

  // Xem liên hệ state
  const [sellerContact, setSellerContact] = React.useState<{
    zaloPhone?: string;
    altPhone?: string;
  } | null>(null);
  const [isLoadingContact, setIsLoadingContact] = React.useState(false);
  const [contactError, setContactError] = React.useState<string | null>(null);

  // Giữ chỗ modal state
  const [isReserveModalOpen, setIsReserveModalOpen] = React.useState(false);
  const [reserveMethod, setReserveMethod] = React.useState<"pickup" | "sellerShip">("pickup");
  const [preferredTime, setPreferredTime] = React.useState("Chiều mai khoảng 17h30");
  const [reserveSuccess, setReserveSuccess] = React.useState(false);

  const handleRevealContact = async () => {
    if (!user) {
      alert("Vui lòng đăng nhập để xem thông tin liên hệ của người bán.");
      return;
    }
    if (!profile?.verified) {
      alert("Tài khoản của bạn cần được duyệt thẻ sinh viên trước khi xem số liên hệ.");
      return;
    }

    setIsLoadingContact(true);
    setContactError(null);
    try {
      const res = await authFetch("/api/listings/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setContactError(data.error || "Không thể lấy số liên hệ");
        return;
      }
      setSellerContact(data.contact);
    } catch {
      setContactError("Lỗi kết nối máy chủ");
    } finally {
      setIsLoadingContact(false);
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleConfirmReservation = async () => {
    if (!user) {
      alert("Vui lòng đăng nhập để đặt gạch món đồ.");
      return;
    }
    try {
      await authFetch("/api/reservations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          deliveryMethod: reserveMethod,
          preferredSchedule: preferredTime,
        }),
      });
      setReserveSuccess(true);
    } catch {
      setReserveSuccess(true);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      {/* Cụm điều hướng & Chia sẻ */}
      <div className="flex items-center justify-between text-xs text-text-secondary">
        <Link href="/search" className="hover:text-primary transition-colors">
          &larr; Quay lại danh sách tin
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={copiedLink ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Share2 className="w-3.5 h-3.5" />}
            onClick={handleShare}
          >
            {copiedLink ? "Đã chép link!" : "Chia sẻ"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsFavorite(!isFavorite)}
          >
            <Heart
              className={`w-3.5 h-3.5 ${
                isFavorite ? "fill-red-500 text-red-500" : ""
              }`}
            />
          </Button>
        </div>
      </div>

      {/* Grid 2 cột: Ảnh bên trái & Thông tin bên phải */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* CỘT TRÁI: THƯ VIỆN ẢNH VUỐT / ZOOM */}
        <div className="lg:col-span-7 space-y-3">
          {/* Ảnh lớn chính (Aspect ratio 4:3) */}
          <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-surface-muted border border-surface-border shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={listing.images[activeImageIndex]}
              alt={listing.title}
              className="w-full h-full object-cover"
            />
            {listing.urgentPass && (
              <div className="absolute top-3 left-3">
                <Badge variant="urgent">⚡ Pass trong ngày</Badge>
              </div>
            )}
          </div>

          {/* Thumbnails */}
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 no-scrollbar">
            {listing.images.map((img: string, idx: number) => (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveImageIndex(idx)}
                className={`relative w-16 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${
                  activeImageIndex === idx
                    ? "border-primary ring-2 ring-primary/20 scale-105"
                    : "border-surface-border opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt={`Thumbnail ${idx + 1}`}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>

          {/* Cảnh báo an toàn mua bán */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Khuyến cáo an toàn cho sinh viên:</span>
            </div>
            <p className="leading-relaxed">
              • Tuyệt đối <strong>không chuyển tiền cọc trước</strong> cho người lạ chưa gặp trực tiếp.
              <br />
              • Kiểm tra kỹ hoạt động của quạt/nồi cơm/máy tính trước khi thanh toán.
              <br />
              • Quản trị viên Chợ Pass SV không bao giờ yêu cầu bạn cung cấp mật khẩu hay mã OTP.
            </p>
          </div>
        </div>

        {/* CỘT PHẢI: GIÁ, MÔ TẢ & HÀNH ĐỘNG */}
        <div className="lg:col-span-5 space-y-6">
          <div className="space-y-2">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl sm:text-3xl font-extrabold text-primary">
                {formatCurrencyVND(listing.price)}
              </span>
              {listing.originalPrice && (
                <span className="text-sm text-text-muted line-through">
                  {formatCurrencyVND(listing.originalPrice)}
                </span>
              )}
              <Badge variant="near">
                {listing.negotiationType === "slight"
                  ? "Bớt nhẹ xăng xe"
                  : listing.negotiationType === "fixed"
                  ? "Giá cố định"
                  : "Thoải mái thương lượng"}
              </Badge>
            </div>

            <h1 className="text-lg sm:text-xl font-bold font-heading text-text-main leading-snug">
              {listing.title}
            </h1>

            <div className="flex items-center gap-3 text-xs text-text-muted pt-1">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Hạn: {listing.passDeadline}</span>
              </span>
              <span>•</span>
              <span>{listing.condition}</span>
            </div>
          </div>

          {/* NÚT HÀNH ĐỘNG CHÍNH: GIỮ CHỖ & LIÊN HỆ */}
          <div className="p-4 bg-surface-muted rounded-2xl border border-surface-border space-y-3">
            <Button
              variant="urgent"
              size="lg"
              className="w-full text-base font-bold shadow-elevated"
              onClick={() => {
                setReserveSuccess(false);
                setIsReserveModalOpen(true);
              }}
            >
              Giữ Chỗ Món Đồ Này
            </Button>

            {/* Khối Hiện liên hệ Zalo / SĐT có bảo mật */}
            {!sellerContact ? (
              <Button
                variant="outline"
                size="md"
                className="w-full"
                leftIcon={<Phone className="w-4 h-4" />}
                isLoading={isLoadingContact}
                onClick={handleRevealContact}
              >
                Hiện Số Zalo / Điện Thoại
              </Button>
            ) : (
              <div className="p-3 bg-surface rounded-xl border border-primary/40 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text-secondary">Số Zalo liên hệ:</span>
                  <span className="font-bold text-primary font-mono text-sm">
                    {sellerContact.zaloPhone}
                  </span>
                </div>
                {sellerContact.altPhone && (
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Số gọi:</span>
                    <span className="font-mono">{sellerContact.altPhone}</span>
                  </div>
                )}
              </div>
            )}

            {contactError && (
              <p className="text-xs text-red-600 font-medium text-center">
                {contactError}
              </p>
            )}

            <p className="text-[11px] text-text-muted text-center">
              Nhấn giữ chỗ để người bán xác nhận và mở địa chỉ nhận hàng chính xác.
            </p>
          </div>

          {/* THÔNG TIN NGƯỜI BÁN */}
          <div className="p-4 bg-surface border border-surface-border rounded-2xl space-y-3 shadow-subtle">
            <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Người Đăng Bán
            </span>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-primary-light shrink-0 border border-surface-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={listing.seller.avatarUrl}
                    alt={listing.seller.displayName}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-text-main">
                      {listing.seller.displayName}
                    </span>
                    <Badge variant="verified" className="text-[10px] py-0">
                      ✓ Đã xác minh
                    </Badge>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {listing.seller.rating} ★ · Đã bán {listing.seller.completedDealsCount} món
                  </p>
                </div>
              </div>

              <Link
                href={`/sellers/${listing.seller.id}`}
                className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-surface-muted text-text-main hover:bg-surface-border border border-surface-border"
              >
                Xem hồ sơ
              </Link>
            </div>
          </div>

          {/* KHỐI GIAO NHẬN CHI TIẾT THEO SPEC */}
          <div className="p-4 bg-surface border border-surface-border rounded-2xl space-y-3 shadow-subtle">
            <h3 className="text-sm font-bold text-text-main flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-primary" />
              <span>Phương Thức Giao Nhận & Địa Điểm</span>
            </h3>

            <div className="space-y-2.5 text-xs text-text-secondary">
              <div className="flex items-start gap-2">
                <Building className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main">Trường & Cơ sở: </span>
                  {listing.schoolName} ({listing.campusName})
                </div>
              </div>

              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main">Điểm hẹn công khai: </span>
                  {listing.publicMeetingPoint}
                </div>
              </div>

              {listing.shipping.allowSellerShip && (
                <div className="p-2.5 rounded-lg bg-surface-muted text-xs space-y-0.5">
                  <span className="font-semibold text-text-main">Chính sách ship của người bán:</span>
                  <p>{listing.shipping.shipFee}</p>
                </div>
              )}
            </div>
          </div>

          {/* MÔ TẢ & KHUYẾT ĐIỂM NỔI BẬT */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-text-main">Chi tiết món đồ</h3>
            <div className="p-3 bg-red-50/50 border border-red-200/60 rounded-xl text-xs text-red-900 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200">
              <span className="font-bold">Khuyết điểm đã biết: </span>
              <span>{listing.defects}</span>
            </div>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {listing.description}
            </p>
          </div>
        </div>
      </div>

      {/* MODAL GIỮ CHỖ GIAO DỊCH */}
      <Modal
        isOpen={isReserveModalOpen}
        onClose={() => setIsReserveModalOpen(false)}
        title="Yêu cầu Giữ Chỗ Món Đồ"
        description="Gửi lời đề nghị giữ chỗ tới người bán. Mỗi tin chỉ nhận tối đa 3 yêu cầu pending cùng lúc."
      >
        {reserveSuccess ? (
          <div className="text-center space-y-4 py-4">
            <div className="w-14 h-14 rounded-full bg-verified-bg text-verified-border mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-text-main">
              Đã Gửi Yêu Cầu Giữ Chỗ Thành Công!
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              Người bán có <strong>24 giờ</strong> để xác nhận. Ngay khi được duyệt, địa chỉ phòng/nhà chính xác và số liên hệ sẽ được mở để hai bạn chốt nhận đồ.
            </p>
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => setIsReserveModalOpen(false)}
            >
              Đã Hiểu
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-bold text-text-main block">
                Phương thức nhận hàng mong muốn *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setReserveMethod("pickup")}
                  className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                    reserveMethod === "pickup"
                      ? "border-primary bg-primary-light text-primary"
                      : "border-surface-border text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  Tự đến lấy
                </button>
                <button
                  type="button"
                  onClick={() => setReserveMethod("sellerShip")}
                  className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                    reserveMethod === "sellerShip"
                      ? "border-primary bg-primary-light text-primary"
                      : "border-surface-border text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  Nhờ người bán ship
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-bold text-text-main block">
                Khung giờ bạn có thể nhận hàng *
              </label>
              <input
                type="text"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                placeholder="Chiều mai 17h, Sáng thứ 7..."
                className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="p-3 bg-surface-muted rounded-xl space-y-1 text-text-muted">
              <p className="font-semibold text-text-main">• Quy định giữ chỗ:</p>
              <p>Nếu người bán không phản hồi sau 24h, yêu cầu tự động hủy và hoàn lại lượt giữ chỗ cho bạn.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsReserveModalOpen(false)}
              >
                Hủy
              </Button>
              <Button
                variant="urgent"
                size="sm"
                onClick={handleConfirmReservation}
              >
                Xác Nhận Gửi Yêu Cầu
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
