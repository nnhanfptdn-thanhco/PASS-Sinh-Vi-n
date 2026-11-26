"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import {
  Clock,
  MapPin,
  Building,
  Truck,
  Heart,
  Share2,
  AlertTriangle,
  Check,
  CheckCircle2,
  Phone,
  ShieldAlert,
  Lock,
  MessageCircle,
  Flag,
} from "lucide-react";
import { formatCurrencyVND } from "@/lib/utils";
import { copyCurrentUrlToClipboard } from "@/lib/utils/webview";
import { authFetch } from "@/lib/firebase/client";
import type { PublicListingDTO, PublicSellerProfile } from "@/lib/services/listings";
import { formatDeadlineVN } from "@/lib/utils/date";

type DeliveryMethodKey = "pickup" | "sellerDelivery" | "campusDelivery" | "carrierShipping";

const DELIVERY_METHOD_LABELS: Record<DeliveryMethodKey, string> = {
  pickup: "Tự đến lấy",
  sellerDelivery: "Nhờ người bán ship",
  campusDelivery: "Giao trong khuôn viên trường",
  carrierShipping: "Gửi đơn vị vận chuyển",
};

export function ListingDetailClient({
  listing,
  seller,
}: {
  listing: PublicListingDTO;
  seller: PublicSellerProfile;
}) {
  const router = useRouter();
  const { user, profile } = useAuth();

  const [activeImageIndex, setActiveImageIndex] = React.useState(0);
  const [isFavorited, setIsFavorited] = React.useState(false);
  const [copiedLink, setCopiedLink] = React.useState(false);

  // Xem liên hệ state (gộp cả contact lẫn privateDetails.exactAddress & detailedSchedule)
  const [sellerContact, setSellerContact] = React.useState<{
    zaloPhone?: string | null;
    altPhone?: string | null;
    exactAddress?: string | null;
    detailedSchedule?: string | null;
  } | null>(null);
  const [isLoadingContact, setIsLoadingContact] = React.useState(false);
  const [isStartingChat, setIsStartingChat] = React.useState(false);
  const [contactError, setContactError] = React.useState<string | null>(null);

  // Danh sách phương thức nhận hàng thực tế mà người bán hỗ trợ
  const availableDeliveryMethods = React.useMemo<DeliveryMethodKey[]>(() => {
    const sm = listing.shippingMethods || { pickup: true, sellerDelivery: false, carrierShipping: false };
    const list: DeliveryMethodKey[] = [];
    if (sm.pickup) list.push("pickup");
    if (sm.campusDelivery) list.push("campusDelivery");
    if (sm.sellerDelivery) list.push("sellerDelivery");
    if (sm.carrierShipping) list.push("carrierShipping");
    return list.length > 0 ? list : ["pickup"];
  }, [listing.shippingMethods]);

  // Giữ chỗ modal state
  const [isReserveModalOpen, setIsReserveModalOpen] = React.useState(false);
  const [reserveMethod, setReserveMethod] = React.useState<DeliveryMethodKey>(
    availableDeliveryMethods[0]
  );
  const [preferredTime, setPreferredTime] = React.useState("Chiều mai khoảng 17h30");
  const [isSubmittingReserve, setIsSubmittingReserve] = React.useState(false);
  const [reserveSuccess, setReserveSuccess] = React.useState(false);
  const [reserveError, setReserveError] = React.useState<string | null>(null);

  // Báo cáo tin đăng state
  const [isReportModalOpen, setIsReportModalOpen] = React.useState(false);
  const [reportReason, setReportReason] = React.useState<
    "scam" | "wrong_description" | "banned_goods" | "duplicate" | "spam" | "other"
  >("scam");
  const [reportDetails, setReportDetails] = React.useState("");
  const [isSubmittingReport, setIsSubmittingReport] = React.useState(false);
  const [reportFeedback, setReportFeedback] = React.useState<string | null>(null);
  const [reportError, setReportError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setReserveMethod(availableDeliveryMethods[0]);
  }, [availableDeliveryMethods]);

  // Đồng bộ trạng thái yêu thích ban đầu khi user đăng nhập
  React.useEffect(() => {
    if (!user) {
      setIsFavorited(false);
      return;
    }
    let cancelled = false;
    authFetch("/api/favorites/toggle")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.listingIds)) {
          setIsFavorited(data.listingIds.includes(listing.id));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, listing.id]);

  const isOwner = Boolean(user && user.uid === listing.sellerId);
  const isReserved = listing.status === "reserved";

  const handleStartChat = async () => {
    if (!user) {
      router.push(`/auth/login?next=/listings/${listing.id}`);
      return;
    }
    if (!profile?.verified) {
      setContactError("Tài khoản cần được phê duyệt thẻ sinh viên trước khi nhắn tin với người bán.");
      return;
    }

    setIsStartingChat(true);
    setContactError(null);
    try {
      const res = await authFetch("/api/conversations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otherUserId: listing.sellerId,
          listingId: listing.id,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.conversationId) {
        throw new Error(json?.error || "Không thể mở cuộc trò chuyện.");
      }
      router.push(`/messages?conversationId=${encodeURIComponent(json.conversationId)}`);
    } catch (err: unknown) {
      setContactError(err instanceof Error ? err.message : "Không thể kết nối phòng chat.");
    } finally {
      setIsStartingChat(false);
    }
  };

  const handleRevealContact = async () => {
    if (!user) {
      router.push(`/auth/login?next=/listings/${listing.id}`);
      return;
    }
    if (!profile?.verified) {
      setContactError("Tài khoản của bạn cần được phê duyệt thẻ sinh viên trước khi xem số liên hệ.");
      return;
    }

    setIsLoadingContact(true);
    setContactError(null);
    try {
      const res = await authFetch("/api/listings/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setContactError(data.error?.message || data.error || "Không thể lấy số liên hệ");
        return;
      }
      setSellerContact({
        zaloPhone: data.contact?.zaloPhone ?? null,
        altPhone: data.contact?.altPhone ?? null,
        exactAddress: data.privateDetails?.exactAddress ?? data.contact?.exactAddress ?? null,
        detailedSchedule: data.privateDetails?.detailedSchedule ?? null,
      });
    } catch {
      setContactError("Lỗi kết nối máy chủ");
    } finally {
      setIsLoadingContact(false);
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: listing.title,
          text: `Pass đồ sinh viên: ${listing.title} - ${listing.price.toLocaleString("vi-VN")} đ`,
          url: window.location.href,
        });
        return;
      } catch {
        // Fallback sang copy link
      }
    }
    const ok = await copyCurrentUrlToClipboard();
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  const handleToggleFavorite = async () => {
    if (!user) {
      router.push(`/auth/login?next=/listings/${listing.id}`);
      return;
    }
    const nextVal = !isFavorited;
    setIsFavorited(nextVal);
    try {
      const res = await authFetch("/api/favorites/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.id }),
      });
      if (!res.ok) setIsFavorited(!nextVal);
    } catch {
      setIsFavorited(!nextVal);
    }
  };

  const handleSubmitReport = async () => {
    if (!user) {
      router.push(`/auth/login?next=/listings/${listing.id}`);
      return;
    }
    setIsSubmittingReport(true);
    setReportError(null);
    try {
      const res = await authFetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: "listing",
          targetId: listing.id,
          reason: reportReason,
          details: reportDetails.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportError(json.error || "Không thể gửi báo cáo lúc này.");
        return;
      }
      setReportFeedback(json.message || "Đã ghi nhận báo cáo của bạn.");
      setReportDetails("");
    } catch {
      setReportError("Lỗi kết nối máy chủ khi gửi báo cáo.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleConfirmReservation = async () => {
    if (!user) {
      router.push(`/auth/login?next=/listings/${listing.id}`);
      return;
    }
    if (!profile?.verified) {
      setReserveError("Bạn cần được duyệt thẻ sinh viên để gửi yêu cầu giữ chỗ.");
      return;
    }

    setIsSubmittingReserve(true);
    setReserveError(null);
    try {
      const res = await authFetch("/api/reservations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId: listing.id,
          deliveryMethod: reserveMethod,
          preferredSchedule: preferredTime,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReserveError(data.error?.message || data.error || "Không thể gửi yêu cầu giữ chỗ.");
        return;
      }
      setReserveSuccess(true);
    } catch {
      setReserveError("Lỗi kết nối máy chủ.");
    } finally {
      setIsSubmittingReserve(false);
    }
  };

  const currentImage = listing.images[activeImageIndex] || listing.coverImage || "";

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
            onClick={handleToggleFavorite}
            aria-label={isFavorited ? "Bỏ yêu thích" : "Lưu yêu thích"}
          >
            <Heart
              className={`w-3.5 h-3.5 ${isFavorited ? "fill-red-500 text-red-500" : ""}`}
            />
          </Button>
          {!isOwner && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Flag className="w-3.5 h-3.5 text-red-500" />}
              onClick={() => {
                if (!user) {
                  router.push(`/auth/login?next=/listings/${listing.id}`);
                  return;
                }
                setReportError(null);
                setReportFeedback(null);
                setIsReportModalOpen(true);
              }}
            >
              Báo cáo
            </Button>
          )}
        </div>
      </div>

      {/* Banner nếu là tin của chính người xem */}
      {isOwner && (
        <div className="p-4 bg-primary-light border border-primary/30 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-primary">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
            <span className="font-semibold text-sm">
              Đây là tin đăng của bạn. Người mua sẽ nhìn thấy tin này theo đúng giao diện dưới đây.
            </span>
          </div>
          <Link href="/my-listings">
            <Button variant="primary" size="sm">
              Quản lý trong Tin của tôi
            </Button>
          </Link>
        </div>
      )}

      {/* Banner nếu tin đang ở trạng thái reserved */}
      {isReserved && !isOwner && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800">
          <Lock className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <span className="font-bold text-sm block">Món đồ này đã có người giữ chỗ</span>
            <span>Tin đăng hiện đang tạm khóa giữ chỗ mới để người bán hoàn tất giao dịch với người mua trước.</span>
          </div>
        </div>
      )}

      {/* Grid 2 cột: Ảnh bên trái & Thông tin bên phải */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* CỘT TRÁI: THƯ VIỆN ẢNH */}
        <div className="lg:col-span-7 space-y-3">
          {/* Ảnh lớn chính (Aspect ratio 4:3) */}
          <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-surface-muted border border-surface-border shadow-card">
            {currentImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentImage}
                alt={listing.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                Chưa có ảnh
              </div>
            )}
            {listing.urgentPass && (
              <div className="absolute top-3 left-3">
                <Badge variant="urgent">⚡ Pass trong ngày</Badge>
              </div>
            )}
          </div>

          {/* Thumbnails */}
          {listing.images.length > 1 && (
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
          )}

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
              • Luôn hẹn gặp ở nơi công cộng như cổng trường, KTX vào ban ngày.
            </p>
          </div>
        </div>

        {/* CỘT PHẢI: GIÁ, MÔ TẢ & HÀNH ĐỘNG */}
        <div className="lg:col-span-5 space-y-6">
          <div className="space-y-2">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl sm:text-3xl font-extrabold text-primary">
                {listing.price === 0 ? "Tặng miễn phí" : formatCurrencyVND(listing.price)}
              </span>
              {listing.originalPrice && listing.originalPrice > listing.price && (
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

            <div className="flex items-start justify-between gap-3">
              <h1 className="text-lg sm:text-xl font-bold font-heading text-text-main leading-snug flex-1">
                {listing.title}
              </h1>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleFavorite}
                  className="p-2 rounded-xl bg-surface border border-surface-border hover:bg-surface-muted transition-colors text-text-muted hover:text-red-500 cursor-pointer"
                  aria-label="Yêu thích"
                >
                  <Heart
                    className={`w-5 h-5 ${
                      isFavorited ? "fill-red-500 text-red-500" : ""
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="p-2 rounded-xl bg-surface border border-surface-border hover:bg-surface-muted transition-colors text-text-muted hover:text-text-main cursor-pointer"
                  aria-label="Chia sẻ"
                >
                  {copiedLink ? (
                    <Check className="w-5 h-5 text-primary" />
                  ) : (
                    <Share2 className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-text-muted pt-1">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Hạn: {formatDeadlineVN(listing.passDeadline)}</span>
              </span>
              <span>•</span>
              <span>{listing.condition}</span>
            </div>
          </div>

          {/* NÚT HÀNH ĐỘNG: GIỮ CHỖ & LIÊN HỆ */}
          {!isOwner && (
            <div className="p-4 bg-surface-muted rounded-2xl border border-surface-border space-y-3">
              <Button
                variant="urgent"
                size="lg"
                disabled={isReserved}
                className="w-full text-base font-bold shadow-elevated"
                onClick={() => {
                  setReserveError(null);
                  setReserveSuccess(false);
                  setIsReserveModalOpen(true);
                }}
              >
                {isReserved ? "Đã Có Người Giữ Chỗ" : "Giữ Chỗ Món Đồ Này"}
              </Button>

              <Button
                variant="outline"
                size="md"
                className="w-full font-semibold"
                leftIcon={<MessageCircle className="w-4 h-4 text-primary" />}
                isLoading={isStartingChat}
                disabled={isStartingChat}
                onClick={handleStartChat}
              >
                Nhắn tin người bán
              </Button>

              {/* Theo Phương án A: SĐT & Zalo được bảo mật, chỉ mở khi người bán xác nhận giữ chỗ */}
              {sellerContact ? (
                <div className="p-3 bg-surface rounded-xl border border-primary/40 space-y-1.5 text-xs">
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
                  {sellerContact.exactAddress && (
                    <div className="pt-1 border-t border-surface-border">
                      <span className="font-semibold text-text-secondary block">Địa chỉ nhận đồ chính xác:</span>
                      <span className="text-text-main">{sellerContact.exactAddress}</span>
                    </div>
                  )}
                  {sellerContact.detailedSchedule && (
                    <div className="pt-1 border-t border-surface-border">
                      <span className="font-semibold text-text-secondary block">Khung giờ nhận hàng chi tiết:</span>
                      <span className="text-text-main">{sellerContact.detailedSchedule}</span>
                    </div>
                  )}
                </div>
              ) : isReserved ? (
                <Button
                  variant="outline"
                  size="md"
                  className="w-full"
                  leftIcon={<Phone className="w-4 h-4" />}
                  isLoading={isLoadingContact}
                  onClick={handleRevealContact}
                >
                  Xem Liên Hệ (Dành Cho Người Mua Đã Xác Nhận)
                </Button>
              ) : (
                <div className="p-3 bg-surface-muted/60 rounded-xl border border-surface-border text-center space-y-1">
                  <p className="text-xs text-text-secondary font-medium flex items-center justify-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-text-muted" />
                    <span>Số Zalo / Điện thoại được bảo mật</span>
                  </p>
                  <p className="text-[11px] text-text-muted">
                    Bấm &quot;Giữ Chỗ Món Đồ Này&quot; để kết nối. Thông tin liên hệ và địa chỉ sẽ tự động mở khi người bán xác nhận giữ chỗ cho bạn.
                  </p>
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
          )}

          {/* THÔNG TIN NGƯỜI BÁN */}
          <div className="p-4 bg-surface border border-surface-border rounded-2xl space-y-3 shadow-subtle">
            <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Người Đăng Bán
            </span>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-primary-light shrink-0 border border-surface-border">
                  {seller.photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={seller.photoURL}
                      alt={seller.displayName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-bold text-primary text-sm">
                      {seller.displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-text-main">
                      {seller.displayName}
                    </span>
                    {seller.verified && (
                      <Badge variant="verified" className="text-[10px] py-0">
                        ✓ Đã xác minh
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">
                    {seller.rating != null && seller.reviewsCount > 0
                      ? `${seller.rating} ★ · `
                      : "Chưa có đánh giá · "}
                    Đã bán {seller.completedDealsCount} món
                  </p>
                </div>
              </div>

              <Link
                href={`/sellers/${seller.id}`}
                className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-surface-muted text-text-main hover:bg-surface-border border border-surface-border"
              >
                Xem hồ sơ
              </Link>
            </div>
          </div>

          {/* KHỐI GIAO NHẬN CHI TIẾT */}
          <div className="p-4 bg-surface border border-surface-border rounded-2xl space-y-3 shadow-subtle">
            <h3 className="text-sm font-bold text-text-main flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-primary" />
              <span>Phương Thức Giao Nhận & Địa Điểm</span>
            </h3>

            <div className="space-y-2.5 text-xs text-text-secondary">
              <div className="flex items-start gap-2">
                <Building className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main">Trường: </span>
                  {listing.schoolName} {listing.campusName ? `(${listing.campusName})` : ""}
                </div>
              </div>

              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-text-main">Điểm hẹn công khai: </span>
                  {listing.publicMeetingPoint}
                </div>
              </div>

              {listing.shippingMethods?.sellerDelivery && listing.shippingMethods?.shipFeeNote && (
                <div className="p-2.5 rounded-lg bg-surface-muted text-xs space-y-0.5">
                  <span className="font-semibold text-text-main">Ghi chú phí ship của người bán:</span>
                  <p>{listing.shippingMethods.shipFeeNote}</p>
                </div>
              )}
            </div>
          </div>

          {/* CẢNH BÁO XE CỘ NẾU THUỘC DANH MỤC XE CỘ */}
          {listing.categoryId === "xe-co" && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <span>
                <strong>Lưu ý giao dịch xe cộ:</strong> Không chuyển tiền cọc trước. Kiểm tra giấy tờ xe chính chủ và số khung trước khi thanh toán. Hẹn xem xe ở nơi công cộng.
              </span>
            </div>
          )}

          {/* MÔ TẢ & KHUYẾT ĐIỂM */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-text-main">Chi tiết món đồ</h3>
            {listing.defects ? (
              <div className="p-3 bg-red-50/50 border border-red-200/60 rounded-xl text-xs text-red-900 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200">
                <span className="font-bold">Khuyết điểm đã biết: </span>
                <span>{listing.defects}</span>
              </div>
            ) : (
              <div className="p-2.5 bg-green-50/50 border border-green-200/60 rounded-xl text-xs text-green-900 dark:bg-green-950/30 dark:border-green-800 dark:text-green-200">
                <span>Món đồ hoạt động tốt, không có khuyết điểm đáng kể.</span>
              </div>
            )}
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed whitespace-pre-line">
              {listing.description}
            </p>
          </div>
        </div>
      </div>

      {/* MODAL GIỮ CHỖ */}
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
            {reserveError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{reserveError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-bold text-text-main block">
                Phương thức nhận hàng mong muốn *
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableDeliveryMethods.map((methodKey) => (
                  <button
                    key={methodKey}
                    type="button"
                    onClick={() => setReserveMethod(methodKey)}
                    className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                      reserveMethod === methodKey
                        ? "border-primary bg-primary-light text-primary"
                        : "border-surface-border text-text-secondary hover:bg-surface-muted"
                    }`}
                  >
                    {DELIVERY_METHOD_LABELS[methodKey]}
                  </button>
                ))}
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
                placeholder="Ví dụ: Chiều mai 17h, Sáng thứ 7..."
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
                disabled={isSubmittingReserve}
                isLoading={isSubmittingReserve}
                onClick={handleConfirmReservation}
              >
                Xác Nhận Gửi Yêu Cầu
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL BÁO CÁO TIN ĐĂNG VI PHẠM */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="Báo cáo tin đăng vi phạm"
        description="Báo cáo của bạn sẽ được gửi trực tiếp tới Ban Quản Trị để kiểm tra bảo vệ cộng đồng sinh viên."
      >
        {reportFeedback ? (
          <div className="space-y-4 py-3 text-center">
            <div className="w-12 h-12 rounded-full bg-verified-bg text-verified-border mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-xs text-text-main font-medium">{reportFeedback}</p>
            <Button variant="primary" size="sm" onClick={() => setIsReportModalOpen(false)}>
              Đóng
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            {reportError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
                {reportError}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="font-bold text-text-main block">Lý do báo cáo *</label>
              <select
                value={reportReason}
                onChange={(e) =>
                  setReportReason(
                    e.target.value as
                      | "scam"
                      | "wrong_description"
                      | "banned_goods"
                      | "duplicate"
                      | "spam"
                      | "other"
                  )
                }
                className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-text-main"
              >
                <option value="scam">Dấu hiệu lừa đảo / đòi cọc trước</option>
                <option value="wrong_description">Mô tả sai sự thật / ảnh không thực tế</option>
                <option value="banned_goods">Hàng cấm / vi phạm pháp luật</option>
                <option value="duplicate">Đăng tin trùng lặp</option>
                <option value="spam">Spam / chèn SĐT quảng cáo</option>
                <option value="other">Lý do khác</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="font-bold text-text-main block">Chi tiết bổ sung (tùy chọn)</label>
              <textarea
                rows={3}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                maxLength={1000}
                placeholder="Mô tả ngắn gọn vấn đề bạn phát hiện..."
                className="w-full p-3 bg-surface border border-surface-border rounded-lg text-text-main"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setIsReportModalOpen(false)}>
                Hủy
              </Button>
              <Button
                variant="danger"
                size="sm"
                isLoading={isSubmittingReport}
                disabled={isSubmittingReport}
                onClick={handleSubmitReport}
              >
                Gửi báo cáo
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
