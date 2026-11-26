"use client";

import * as React from "react";
import Link from "next/link";
import { authFetch, db } from "@/lib/firebase/client";
import { collection, query, where, onSnapshot, getDocs, limit } from "firebase/firestore";
import { useAuth } from "@/lib/auth/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatCurrencyVND } from "@/lib/utils";
import {
  CheckCircle2,
  MapPin,
  Star,
  Clock,
  AlertTriangle,
  Truck,
  UserX,
  Phone,
  ShieldCheck,
  Package,
} from "lucide-react";

interface ReservationItem {
  id: string;
  listingId: string;
  listingTitle: string;
  listingPrice: number;
  listingImage: string;
  sellerId: string;
  sellerSchool?: string;
  buyerId: string;
  buyerName?: string;
  deliveryMethod?: string;
  preferredSchedule?: string;
  status:
    | "pending"
    | "confirmed"
    | "waitlisted"
    | "completed"
    | "rejected"
    | "cancelled"
    | "expired"
    | "no_show";
  expiresAt?: string;
  holdExpiresAt?: string;
  cancelReason?: string;
  createdAt?: { toDate?: () => Date } | string;
  role: "buyer" | "seller";
}

export default function ReservationsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = React.useState<"all" | "buyer" | "seller">("all");
  const [reservations, setReservations] = React.useState<ReservationItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [busyReservationId, setBusyReservationId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  // Đánh giá
  const [reviewedIds, setReviewedIds] = React.useState<Set<string>>(new Set());
  const [reviewModalItem, setReviewModalItem] = React.useState<ReservationItem | null>(null);
  const [rating, setRating] = React.useState(5);
  const [comment, setComment] = React.useState("");
  const [isSubmittingReview, setIsSubmittingReview] = React.useState(false);

  // Địa chỉ chính xác đã mở khóa cho tin confirmed
  const [revealedContacts, setRevealedContacts] = React.useState<
    Record<
      string,
      {
        realName?: string;
        zaloPhone?: string | null;
        altPhone?: string | null;
        exactAddress?: string | null;
        detailedSchedule?: string | null;
      }
    >
  >({});
  const attemptedContactIdsRef = React.useRef<Set<string>>(new Set());

  // Lắng nghe danh sách giữ chỗ thực tế từ Firestore
  React.useEffect(() => {
    attemptedContactIdsRef.current.clear();
    if (!user?.uid) {
      setReservations([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let buyerList: ReservationItem[] = [];
    let sellerList: ReservationItem[] = [];

    const updateCombined = () => {
      const map = new Map<string, ReservationItem>();
      buyerList.forEach((r) => map.set(r.id, r));
      sellerList.forEach((r) => map.set(r.id, r));

      const merged = Array.from(map.values());
      // Sắp xếp giảm dần theo thời gian tạo
      merged.sort((a, b) => {
        const aTime =
          typeof a.createdAt === "object" && a.createdAt?.toDate
            ? a.createdAt.toDate().getTime()
            : 0;
        const bTime =
          typeof b.createdAt === "object" && b.createdAt?.toDate
            ? b.createdAt.toDate().getTime()
            : 0;
        return bTime - aTime;
      });

      setReservations(merged);
      setIsLoading(false);
    };

    // 1. Lắng nghe với tư cách người mua
    const buyerQuery = query(
      collection(db, "reservations"),
      where("buyerId", "==", user.uid),
      limit(50)
    );

    const unsubBuyer = onSnapshot(
      buyerQuery,
      (snap) => {
        buyerList = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          role: "buyer" as const,
          ...(docSnap.data() as Omit<ReservationItem, "id" | "role">),
        }));
        updateCombined();
      },
      (err) => {
        console.error("Lỗi khi tải giữ chỗ với tư cách người mua:", err);
        setIsLoading(false);
      }
    );

    // 2. Lắng nghe với tư cách người bán
    const sellerQuery = query(
      collection(db, "reservations"),
      where("sellerId", "==", user.uid),
      limit(50)
    );

    const unsubSeller = onSnapshot(
      sellerQuery,
      (snap) => {
        sellerList = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          role: "seller" as const,
          ...(docSnap.data() as Omit<ReservationItem, "id" | "role">),
        }));
        updateCombined();
      },
      (err) => {
        console.error("Lỗi khi tải giữ chỗ với tư cách người bán:", err);
        setIsLoading(false);
      }
    );

    // 3. Tải các đánh giá của người dùng này để ẩn nút Đánh giá nếu đã đánh giá rồi
    const loadReviews = async () => {
      try {
        const revSnap = await getDocs(
          query(collection(db, "reviews"), where("reviewerId", "==", user.uid), limit(100))
        );
        const set = new Set<string>();
        revSnap.forEach((doc) => {
          const resId = doc.data().reservationId as string;
          if (resId) set.add(resId);
        });
        setReviewedIds(set);
      } catch (e) {
        console.warn("Lỗi tải lịch sử đánh giá:", e);
      }
    };
    loadReviews();

    return () => {
      unsubBuyer();
      unsubSeller();
    };
  }, [user?.uid]);

  // Lấy chi tiết liên hệ và địa chỉ chính xác khi có giao dịch confirmed
  const fetchRevealedContact = async (listingId: string) => {
    if (revealedContacts[listingId]) return;
    try {
      const res = await authFetch("/api/listings/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const data = await res.json();
      if (res.ok && data.contact) {
        setRevealedContacts((prev) => ({
          ...prev,
          [listingId]: {
            ...data.contact,
            exactAddress: data.privateDetails?.exactAddress,
            detailedSchedule: data.privateDetails?.detailedSchedule,
          },
        }));
      }
    } catch {
      // Bỏ qua lỗi ngầm
    }
  };

  // Tự động tải địa chỉ chỉ cho NGƯỜI MUA có giao dịch confirmed (tránh gọi 400 với tin seller)
  React.useEffect(() => {
    reservations.forEach((item) => {
      if (
        item.status === "confirmed" &&
        item.role === "buyer" &&
        !revealedContacts[item.listingId] &&
        !attemptedContactIdsRef.current.has(item.listingId)
      ) {
        attemptedContactIdsRef.current.add(item.listingId);
        void fetchRevealedContact(item.listingId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations]);

  // Thực hiện hành động giữ chỗ
  const handleAction = async (
    id: string,
    action: "confirm" | "reject" | "cancel" | "complete" | "no_show",
    reason?: string
  ) => {
    setBusyReservationId(id);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await authFetch("/api/reservations/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: id,
          action,
          reason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Thao tác thất bại. Vui lòng thử lại.");
      }

      setSuccessMessage(data.message || "Cập nhật thành công!");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Đã xảy ra lỗi không xác định.");
    } finally {
      setBusyReservationId(null);
    }
  };

  // Gửi đánh giá
  const handleSubmitReview = async () => {
    if (!reviewModalItem) return;
    setIsSubmittingReview(true);
    setErrorMessage(null);

    try {
      const res = await authFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationId: reviewModalItem.id,
          rating,
          comment: comment.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Gửi đánh giá thất bại.");
      }

      setReviewedIds((prev) => new Set(prev).add(reviewModalItem.id));
      setSuccessMessage("Cảm ơn bạn đã gửi đánh giá uy tín cho bạn sinh viên!");
      setReviewModalItem(null);
      setComment("");
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Đã xảy ra lỗi khi gửi đánh giá.");
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const filteredReservations = reservations.filter((r) => {
    if (activeTab === "buyer") return r.role === "buyer";
    if (activeTab === "seller") return r.role === "seller";
    return true;
  });

  return (
    <RequireAuth>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="border-b border-surface-border pb-4">
          <h1 className="text-2xl font-bold font-heading text-text-main">
            Quản Lý Giữ Chỗ & Giao Dịch
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Bảo đảm giao dịch trực tiếp an toàn giữa sinh viên cùng trường, mở địa chỉ chính xác khi được duyệt
          </p>
        </div>

        {/* Thông báo kết quả */}
        {errorMessage && (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center justify-between text-red-600 dark:text-red-400 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-xs font-bold underline hover:no-underline"
            >
              Đóng
            </button>
          </div>
        )}

        {successMessage && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl flex items-center justify-between text-emerald-700 dark:text-emerald-300 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="text-xs font-bold underline hover:no-underline"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Tab phân loại vai trò */}
        <div className="flex border-b border-surface-border gap-4">
          <button
            onClick={() => setActiveTab("all")}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
              activeTab === "all"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            Tất cả ({reservations.length})
          </button>
          <button
            onClick={() => setActiveTab("buyer")}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
              activeTab === "buyer"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            Tôi là người mua (
            {reservations.filter((r) => r.role === "buyer").length})
          </button>
          <button
            onClick={() => setActiveTab("seller")}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${
              activeTab === "seller"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            Tôi là người bán (
            {reservations.filter((r) => r.role === "seller").length})
          </button>
        </div>

        {/* Danh sách */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="bg-surface border border-surface-border rounded-2xl p-5 animate-pulse flex gap-4"
              >
                <div className="w-24 h-24 bg-surface-muted rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-surface-muted rounded w-2/3" />
                  <div className="h-4 bg-surface-muted rounded w-1/3" />
                  <div className="h-8 bg-surface-muted rounded w-1/4 mt-4" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredReservations.length === 0 ? (
          <div className="text-center py-16 bg-surface border border-surface-border rounded-2xl p-6 space-y-3">
            <Package className="w-12 h-12 text-text-muted mx-auto" />
            <h3 className="text-base font-bold text-text-main">
              Chưa có yêu cầu giữ chỗ nào
            </h3>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">
              Khi bạn giữ chỗ một món đồ đang pass hoặc có bạn sinh viên khác muốn mua đồ của bạn, giao dịch sẽ hiển thị ở đây.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredReservations.map((item) => {
              const isBusy = busyReservationId === item.id;
              const contactInfo = revealedContacts[item.listingId];
              const isAlreadyReviewed = reviewedIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className="bg-surface border border-surface-border rounded-2xl p-5 shadow-card space-y-4"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Ảnh món đồ */}
                    <div className="relative w-full sm:w-28 h-32 sm:h-28 rounded-xl overflow-hidden bg-surface-muted shrink-0">
                      {item.listingImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.listingImage}
                          alt={item.listingTitle}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                          Không có ảnh
                        </div>
                      )}
                    </div>

                    {/* Nội dung chi tiết */}
                    <div className="flex-1 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-surface-muted text-text-secondary">
                            {item.role === "buyer" ? "Bạn là Người Mua" : "Bạn là Người Bán"}
                          </span>

                          {item.status === "pending" && (
                            <Badge variant="pickup">Chờ duyệt (24h)</Badge>
                          )}
                          {item.status === "confirmed" && (
                            <Badge variant="verified">Đã duyệt giữ chỗ</Badge>
                          )}
                          {item.status === "waitlisted" && (
                            <Badge variant="default">Hàng chờ dự phòng</Badge>
                          )}
                          {item.status === "completed" && (
                            <Badge variant="sameSchool">Đã giao xong</Badge>
                          )}
                          {item.status === "rejected" && (
                            <Badge variant="outline">Người bán từ chối</Badge>
                          )}
                          {item.status === "cancelled" && (
                            <Badge variant="outline">Đã hủy</Badge>
                          )}
                          {item.status === "expired" && (
                            <Badge variant="urgent">Hết hạn</Badge>
                          )}
                          {item.status === "no_show" && (
                            <Badge variant="urgent">Vắng mặt (Bom hẹn)</Badge>
                          )}
                        </div>

                        {item.status === "pending" && item.expiresAt && (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Hạn phản hồi:{" "}
                            {new Date(item.expiresAt).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                        )}

                        {item.status === "confirmed" && item.holdExpiresAt && (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            Hạn giữ đồ 72h:{" "}
                            {new Date(item.holdExpiresAt).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </span>
                        )}
                      </div>

                      <h2 className="text-base font-bold text-text-main line-clamp-1">
                        <Link
                          href={`/listings/${item.listingId}`}
                          className="hover:text-primary transition-colors"
                        >
                          {item.listingTitle}
                        </Link>
                      </h2>

                      <p className="text-sm font-extrabold text-primary">
                        {formatCurrencyVND(item.listingPrice)}
                      </p>

                      <div className="text-xs text-text-secondary space-y-1 pt-1">
                        <p>
                          Đối tác:{" "}
                          <span className="font-semibold text-text-main">
                            {item.role === "buyer"
                              ? item.sellerSchool || "Người bán"
                              : item.buyerName || "Sinh viên"}
                          </span>
                        </p>
                        {item.deliveryMethod && (
                          <p className="flex items-center gap-1">
                            <Truck className="w-3.5 h-3.5 text-text-muted" />
                            Phương thức:{" "}
                            {item.deliveryMethod === "pickup"
                              ? "Tự đến lấy"
                              : item.deliveryMethod === "sellerDelivery"
                              ? "Người bán tự giao"
                              : item.deliveryMethod === "campusDelivery"
                              ? "Giao tận phòng KTX"
                              : "Ship dịch vụ"}
                          </p>
                        )}
                        {item.preferredSchedule && (
                          <p className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-text-muted" />
                            Ghi chú hẹn: &ldquo;{item.preferredSchedule}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* THÔNG TIN BẢO MẬT ĐÃ MỞ KHÓA CHO NGƯỜI MUA Ở GIAO DỊCH CONFIRMED */}
                  {item.role === "buyer" && item.status === "confirmed" && contactInfo && (
                    <div className="p-4 bg-primary-light/40 border border-primary/20 rounded-xl space-y-2 text-xs">
                      <div className="flex items-center gap-2 font-bold text-primary">
                        <ShieldCheck className="w-4 h-4" />
                        <span>Thông tin liên hệ & Địa chỉ chính xác đã được mở:</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-text-main">
                        {contactInfo.zaloPhone && (
                          <div className="flex items-center gap-1.5 font-medium">
                            <Phone className="w-3.5 h-3.5 text-primary" />
                            <span>SĐT / Zalo: {contactInfo.zaloPhone}</span>
                          </div>
                        )}
                        {contactInfo.exactAddress && (
                          <div className="flex items-center gap-1.5 font-medium sm:col-span-2">
                            <MapPin className="w-3.5 h-3.5 text-amber-500" />
                            <span>Địa chỉ nhận đồ: {contactInfo.exactAddress}</span>
                          </div>
                        )}
                        {contactInfo.detailedSchedule && (
                          <div className="flex items-center gap-1.5 text-text-secondary sm:col-span-2">
                            <Clock className="w-3.5 h-3.5 text-text-muted" />
                            <span>Lịch hẹn chi tiết: {contactInfo.detailedSchedule}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* CÁC NÚT HÀNH ĐỘNG THEO VAI TRÒ & TRẠNG THÁI */}
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-surface-border">
                    {/* Người bán xử lý yêu cầu pending */}
                    {item.role === "seller" && item.status === "pending" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(item.id, "reject")}
                          disabled={isBusy}
                        >
                          Từ chối
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleAction(item.id, "confirm")}
                          disabled={isBusy}
                          leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        >
                          Đồng ý giữ chỗ
                        </Button>
                      </>
                    )}

                    {/* Người bán xử lý giao dịch confirmed */}
                    {item.role === "seller" && item.status === "confirmed" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(item.id, "no_show")}
                          disabled={isBusy}
                          leftIcon={<UserX className="w-3.5 h-3.5" />}
                        >
                          Người mua không đến
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(item.id, "cancel")}
                          disabled={isBusy}
                        >
                          Hủy giữ chỗ
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleAction(item.id, "complete")}
                          disabled={isBusy}
                          leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        >
                          Đã giao xong
                        </Button>
                      </>
                    )}

                    {/* Người mua hủy yêu cầu */}
                    {item.role === "buyer" &&
                      (item.status === "pending" ||
                        item.status === "waitlisted" ||
                        item.status === "confirmed") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction(item.id, "cancel")}
                          disabled={isBusy}
                        >
                          Hủy giữ chỗ
                        </Button>
                      )}

                    {/* Nút đánh giá sau khi hoàn tất giao dịch */}
                    {item.status === "completed" && (
                      <>
                        {isAlreadyReviewed ? (
                          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Đã đánh giá
                          </span>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setReviewModalItem(item);
                              setRating(5);
                              setComment("");
                            }}
                            leftIcon={<Star className="w-3.5 h-3.5" />}
                          >
                            Đánh giá giao dịch
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal đánh giá */}
        {reviewModalItem && (
          <Modal
            isOpen={true}
            onClose={() => setReviewModalItem(null)}
            title="Đánh Giá Giao Dịch Sinh Viên"
          >
            <div className="space-y-4">
              <p className="text-xs text-text-secondary">
                Đánh giá uy tín cho món đồ:{" "}
                <span className="font-semibold text-text-main">
                  {reviewModalItem.listingTitle}
                </span>
              </p>

              {/* Chọn số sao */}
              <div className="flex items-center justify-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="p-1 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`w-8 h-8 ${
                        star <= rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-surface-border"
                      }`}
                    />
                  </button>
                ))}
              </div>

              {/* Nhận xét */}
              <div>
                <label className="block text-xs font-semibold text-text-main mb-1">
                  Nhận xét ngắn (tùy chọn)
                </label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Đồ đúng mô tả, bạn sinh viên đúng giờ, nhiệt tình..."
                  className="w-full text-xs p-3 rounded-xl border border-surface-border bg-surface text-text-main focus:outline-none focus:ring-2 focus:ring-primary/40"
                  maxLength={500}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReviewModalItem(null)}
                  disabled={isSubmittingReview}
                >
                  Bỏ qua
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSubmitReview}
                  disabled={isSubmittingReview}
                >
                  {isSubmittingReview ? "Đang gửi..." : "Gửi Đánh Giá"}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </RequireAuth>
  );
}
