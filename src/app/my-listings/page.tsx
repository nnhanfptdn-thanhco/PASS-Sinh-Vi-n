"use client";

import * as React from "react";
import Link from "next/link";
import { authFetch, db } from "@/lib/firebase/client";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { useAuth } from "@/lib/auth/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrencyVND } from "@/lib/utils";
import { isPastDeadline } from "@/lib/utils/date";
import {
  Eye,
  Heart,
  Clock,
  CheckCircle,
  EyeOff,
  RefreshCw,
  PlusCircle,
  AlertTriangle,
  PackageCheck,
  ShieldAlert,
} from "lucide-react";

interface ListingDoc {
  id: string;
  title: string;
  price: number;
  coverThumb?: string;
  coverImage?: string;
  images?: string[];
  status: "active" | "reserved" | "sold" | "hidden_by_seller" | "hidden_by_admin" | "expired";
  viewsCount?: number;
  favoritesCount?: number;
  passDeadline: string;
  urgentPass?: boolean;
  schoolName?: string;
  createdAt?: { toDate?: () => Date } | string;
}

export default function MyListingsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = React.useState<"active" | "reserved" | "sold" | "hidden">("active");
  const [listings, setListings] = React.useState<ListingDoc[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = React.useState<string | null>(null);
  const [busyListingId, setBusyListingId] = React.useState<string | null>(null);

  // Hộp thoại xác nhận
  const [confirmDialog, setConfirmDialog] = React.useState<{
    isOpen: boolean;
    action: "hide" | "mark_sold";
    listingId: string;
    listingTitle: string;
  } | null>(null);

  // Đọc danh sách tin thực tế từ Firestore thông qua onSnapshot
  React.useEffect(() => {
    if (!user?.uid) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setActionError(null);

    let fallbackUnsub: Unsubscribe | null = null;

    // Truy vấn các tin thuộc sở hữu của người bán hiện tại
    const q = query(
      collection(db, "listings"),
      where("sellerId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items: ListingDoc[] = [];
        snapshot.forEach((docSnap) => {
          items.push({
            id: docSnap.id,
            ...(docSnap.data() as Omit<ListingDoc, "id">),
          });
        });
        setListings(items);
        setIsLoading(false);
      },
      (err) => {
        console.error("Lỗi khi tải tin đăng của tôi từ Firestore:", err);
        // Fallback truy vấn không orderBy nếu thiếu index tạm thời
        const fallbackQuery = query(
          collection(db, "listings"),
          where("sellerId", "==", user.uid),
          limit(100)
        );
        fallbackUnsub = onSnapshot(
          fallbackQuery,
          (fallbackSnap) => {
            const fallbackItems: ListingDoc[] = [];
            fallbackSnap.forEach((docSnap) => {
              fallbackItems.push({
                id: docSnap.id,
                ...(docSnap.data() as Omit<ListingDoc, "id">),
              });
            });
            // Sắp xếp bộ nhớ
            fallbackItems.sort((a, b) => {
              const aTime = typeof a.createdAt === "object" && a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
              const bTime = typeof b.createdAt === "object" && b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
              return bTime - aTime;
            });
            setListings(fallbackItems);
            setIsLoading(false);
          },
          (fErr) => {
            console.error("Lỗi fallback khi tải tin đăng:", fErr);
            setActionError("Không thể tải danh sách tin đăng. Vui lòng kiểm tra kết nối mạng.");
            setIsLoading(false);
          }
        );
      }
    );

    return () => {
      unsubscribe();
      fallbackUnsub?.();
    };
  }, [user?.uid]);

  // Phân loại tin theo Tab
  const now = new Date();

  const activeListings = listings.filter(
    (l) => l.status === "active" && !isPastDeadline(l.passDeadline, now)
  );
  const reservedListings = listings.filter((l) => l.status === "reserved");
  const soldListings = listings.filter((l) => l.status === "sold");
  const hiddenAndExpiredListings = listings.filter(
    (l) =>
      l.status === "hidden_by_seller" ||
      l.status === "hidden_by_admin" ||
      l.status === "expired" ||
      (l.status === "active" && isPastDeadline(l.passDeadline, now))
  );

  const currentTabListings =
    activeTab === "active"
      ? activeListings
      : activeTab === "reserved"
      ? reservedListings
      : activeTab === "sold"
      ? soldListings
      : hiddenAndExpiredListings;

  // Thực hiện hành động quản lý
  const executeManageAction = async (listingId: string, action: "hide" | "show" | "mark_sold" | "renew") => {
    setBusyListingId(listingId);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await authFetch("/api/listings/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, action }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Thao tác thất bại. Vui lòng thử lại.");
      }

      setActionSuccess(data.message || "Cập nhật thành công!");
      // Tự tắt thông báo thành công sau 4 giây
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Đã xảy ra lỗi không xác định.");
    } finally {
      setBusyListingId(null);
      setConfirmDialog(null);
    }
  };

  return (
    <RequireAuth>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Tiêu đề & Nút đăng tin mới */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-border pb-4">
          <div>
            <h1 className="text-2xl font-bold font-heading text-text-main">
              Quản Lý Tin Đăng
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Theo dõi và quản lý toàn bộ các món đồ bạn đang pass trong cộng đồng sinh viên
            </p>
          </div>
          <Link
            href="/listings/new"
            className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-11 px-4 text-sm bg-primary text-white hover:bg-primary-hover shadow-subtle gap-2 cursor-pointer w-full sm:w-auto"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Đăng món mới</span>
          </Link>
        </div>

        {/* Thông báo kết quả hành động */}
        {actionError && (
          <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl flex items-center justify-between gap-3 text-red-600 dark:text-red-400 text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              onClick={() => setActionError(null)}
              className="text-xs font-bold underline hover:no-underline"
            >
              Đóng
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xl flex items-center justify-between gap-3 text-emerald-700 dark:text-emerald-300 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
            <button
              onClick={() => setActionSuccess(null)}
              className="text-xs font-bold underline hover:no-underline"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Hệ thống Tabs chuẩn Ma trận 2.2 */}
        <div className="flex border-b border-surface-border overflow-x-auto scrollbar-none gap-2">
          <button
            onClick={() => setActiveTab("active")}
            className={`pb-3 px-3 text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap border-b-2 ${
              activeTab === "active"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            <span>Đang bán</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary">
              {activeListings.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("reserved")}
            className={`pb-3 px-3 text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap border-b-2 ${
              activeTab === "reserved"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            <span>Đã có người giữ</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/10 text-amber-600 dark:text-amber-400">
              {reservedListings.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("sold")}
            className={`pb-3 px-3 text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap border-b-2 ${
              activeTab === "sold"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            <span>Đã bán</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-surface-muted text-text-muted">
              {soldListings.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("hidden")}
            className={`pb-3 px-3 text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap border-b-2 ${
              activeTab === "hidden"
                ? "border-primary text-primary"
                : "border-transparent text-text-secondary hover:text-text-main"
            }`}
          >
            <span>Đã ẩn / Hết hạn</span>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-surface-muted text-text-muted">
              {hiddenAndExpiredListings.length}
            </span>
          </button>
        </div>

        {/* Nội dung danh sách theo Tab */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="bg-surface border border-surface-border rounded-2xl p-4 flex gap-4 animate-pulse"
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
        ) : currentTabListings.length === 0 ? (
          <div className="text-center py-16 bg-surface border border-surface-border rounded-2xl p-6 space-y-3">
            <PackageCheck className="w-12 h-12 text-text-muted mx-auto" />
            <h3 className="text-base font-bold text-text-main">
              {activeTab === "active" && "Bạn chưa có tin đăng nào đang mở bán"}
              {activeTab === "reserved" && "Hiện không có món đồ nào đang trong trạng thái giữ chỗ"}
              {activeTab === "sold" && "Bạn chưa có món đồ nào đánh dấu đã bán"}
              {activeTab === "hidden" && "Không có món đồ nào bị ẩn hoặc hết hạn"}
            </h3>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">
              {activeTab === "active"
                ? "Dọn dẹp phòng trọ, góc học tập và đăng pass đồ không dùng để vừa đỡ chật vừa kiếm thêm thu nhập nhé!"
                : "Các cập nhật về giao dịch và giữ chỗ sẽ hiển thị ở đây."}
            </p>
            {activeTab === "active" && (
              <Link
                href="/listings/new"
                className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-10 px-4 text-sm bg-primary text-white hover:bg-primary-hover shadow-subtle gap-2 cursor-pointer mt-2"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Đăng tin ngay</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {currentTabListings.map((item) => {
              const isOverdue = isPastDeadline(item.passDeadline, now);
              const isBusy = busyListingId === item.id;
              const imageUrl = item.coverThumb || item.coverImage || item.images?.[0] || "";

              return (
                <div
                  key={item.id}
                  className="bg-surface border border-surface-border rounded-2xl p-4 shadow-card hover:border-primary/30 transition-colors flex flex-col sm:flex-row gap-4"
                >
                  {/* Ảnh đại diện */}
                  <div className="relative w-full sm:w-28 h-32 sm:h-28 rounded-xl overflow-hidden bg-surface-muted shrink-0">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                        Không có ảnh
                      </div>
                    )}
                    {item.urgentPass && (
                      <div className="absolute top-1.5 left-1.5">
                        <Badge variant="urgent">Gấp</Badge>
                      </div>
                    )}
                  </div>

                  {/* Thông tin tin đăng */}
                  <div className="flex-1 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {item.status === "active" && !isOverdue && (
                          <Badge variant="success">Đang hiển thị</Badge>
                        )}
                        {item.status === "reserved" && (
                          <Badge variant="reserved">Đã có người giữ chỗ</Badge>
                        )}
                        {item.status === "sold" && (
                          <Badge variant="default">Đã bán</Badge>
                        )}
                        {item.status === "hidden_by_seller" && (
                          <Badge variant="default">Tạm ẩn</Badge>
                        )}
                        {item.status === "hidden_by_admin" && (
                          <Badge variant="danger">Bị Admin ẩn</Badge>
                        )}
                        {(item.status === "expired" || (item.status === "active" && isOverdue)) && (
                          <Badge variant="urgent">Đã hết hạn</Badge>
                        )}
                        <span className="text-[11px] text-text-muted flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Hạn pass: {item.passDeadline}
                        </span>
                      </div>

                      <h2 className="text-base font-bold text-text-main mt-1.5 line-clamp-2">
                        {item.status === "active" || item.status === "reserved" ? (
                          <Link
                            href={`/listings/${item.id}`}
                            className="hover:text-primary transition-colors"
                          >
                            {item.title}
                          </Link>
                        ) : (
                          <span>{item.title}</span>
                        )}
                      </h2>

                      <p className="text-base font-extrabold text-primary mt-1">
                        {formatCurrencyVND(item.price)}
                      </p>
                    </div>

                    {/* Chỉ số thực tế (Lượt xem thật; WP-7: ẩn chatsCount vì chưa có tính năng) */}
                    <div className="flex items-center gap-4 text-xs text-text-muted pt-2 border-t border-surface-border">
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        <span>{item.viewsCount || 0} lượt xem</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5" />
                        <span>{item.favoritesCount || 0} yêu thích</span>
                      </span>
                    </div>
                  </div>

                  {/* Cột nút hành động theo trạng thái */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-surface-border shrink-0">
                    {/* Tin đang hiển thị */}
                    {item.status === "active" && !isOverdue && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setConfirmDialog({
                              isOpen: true,
                              action: "hide",
                              listingId: item.id,
                              listingTitle: item.title,
                            })
                          }
                          disabled={isBusy}
                          leftIcon={<EyeOff className="w-3.5 h-3.5" />}
                        >
                          Ẩn tin
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            setConfirmDialog({
                              isOpen: true,
                              action: "mark_sold",
                              listingId: item.id,
                              listingTitle: item.title,
                            })
                          }
                          disabled={isBusy}
                          leftIcon={<CheckCircle className="w-3.5 h-3.5" />}
                        >
                          Đã bán
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => executeManageAction(item.id, "renew")}
                          disabled={isBusy}
                          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                        >
                          Gia hạn
                        </Button>
                      </>
                    )}

                    {/* Tin đang có người giữ chỗ */}
                    {item.status === "reserved" && (
                      <Link
                        href="/reservations"
                        className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-amber-500 text-white hover:bg-amber-600 shadow-subtle gap-1.5 cursor-pointer"
                      >
                        <PackageCheck className="w-3.5 h-3.5" />
                        <span>Quản lý giữ chỗ</span>
                      </Link>
                    )}

                    {/* Tin bị người bán tạm ẩn: nếu đã quá hạn thì hiện nút Gia hạn để kích hoạt lại */}
                    {item.status === "hidden_by_seller" && (
                      isOverdue ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => executeManageAction(item.id, "renew")}
                          disabled={isBusy}
                          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                        >
                          Gia hạn thêm 7 ngày
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => executeManageAction(item.id, "show")}
                          disabled={isBusy}
                          leftIcon={<Eye className="w-3.5 h-3.5" />}
                        >
                          Hiện lại tin
                        </Button>
                      )
                    )}

                    {/* Tin hết hạn hoặc active nhưng quá hạn */}
                    {(item.status === "expired" || (item.status === "active" && isOverdue)) && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => executeManageAction(item.id, "renew")}
                        disabled={isBusy}
                        leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
                      >
                        Gia hạn thêm 7 ngày
                      </Button>
                    )}

                    {/* Tin đã bán: Đăng lại tin tương tự */}
                    {item.status === "sold" && (
                      <Link
                        href={`/listings/new?cloneTitle=${encodeURIComponent(item.title)}&clonePrice=${item.price}`}
                        className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-surface-muted text-text-main hover:bg-surface-border shadow-subtle gap-1.5 cursor-pointer"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Đăng tin tương tự</span>
                      </Link>
                    )}

                    {/* Tin bị admin ẩn: Nút kháng nghị */}
                    {item.status === "hidden_by_admin" && (
                      <Link
                        href={`/support?type=appeal&targetId=${item.id}`}
                        className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 hover:bg-red-200 shadow-subtle gap-1.5 cursor-pointer"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Kháng nghị vi phạm</span>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hộp thoại xác nhận thao tác */}
        {confirmDialog && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <div className="bg-surface border border-surface-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 text-amber-500">
                <AlertTriangle className="w-6 h-6" />
                <h3 className="text-lg font-bold text-text-main">
                  {confirmDialog.action === "mark_sold"
                    ? "Xác nhận đánh dấu Đã Bán?"
                    : "Xác nhận tạm ẩn tin đăng?"}
                </h3>
              </div>

              <p className="text-sm text-text-secondary leading-relaxed">
                {confirmDialog.action === "mark_sold"
                  ? "Tin đăng sẽ biến mất khỏi chợ, trang chủ và tìm kiếm. Mọi yêu cầu giữ chỗ đang mở của bạn sẽ tự động được hủy. Hành động này không thể hoàn tác!"
                  : "Món đồ sẽ không còn hiển thị công khai trên chợ cho sinh viên khác tìm thấy. Mọi yêu cầu giữ chỗ đang chờ sẽ bị hủy."}
              </p>

              <div className="p-3 bg-surface-muted rounded-xl text-xs font-semibold text-text-main truncate">
                Món đồ: {confirmDialog.listingTitle}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmDialog(null)}
                  disabled={busyListingId !== null}
                >
                  Hủy bỏ
                </Button>
                <Button
                  variant={confirmDialog.action === "mark_sold" ? "primary" : "outline"}
                  onClick={() =>
                    executeManageAction(confirmDialog.listingId, confirmDialog.action)
                  }
                  disabled={busyListingId !== null}
                >
                  {confirmDialog.action === "mark_sold" ? "Xác nhận Đã Bán" : "Tạm Ẩn Tin"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
