import * as React from "react";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ListingCard } from "@/components/ui/ListingCard";
import {
  GraduationCap,
  Star,
  PackageCheck,
  Tag,
  MapPin,
  Calendar,
  MessageSquare,
} from "lucide-react";
import {
  getSellerPublicProfile,
  getSellerActiveListings,
  getSellerRecentReviews,
} from "@/lib/services/listings";
import { formatDeadlineVN } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

export default async function SellerProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const seller = await getSellerPublicProfile(params.id);
  if (!seller) {
    notFound();
  }

  const listings = await getSellerActiveListings(params.id);
  const reviews = await getSellerRecentReviews(params.id);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header Hồ Sơ Người Bán (Bảo Mật Quyền Riêng Tư - Không lộ PII) */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
        <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-primary-light border-2 border-primary/30 shadow-subtle shrink-0 flex items-center justify-center">
          {seller.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seller.photoURL}
              alt={seller.displayName}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-3xl font-bold text-primary">
              {seller.displayName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="space-y-3 flex-1">
          <div>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-xl sm:text-2xl font-bold font-heading text-text-main">
                {seller.displayName}
              </h1>
              {seller.verified && (
                <Badge variant="verified">✓ Đã xác minh sinh viên</Badge>
              )}
              {seller.isGraduating && (
                <Badge variant="graduating">Sắp tốt nghiệp</Badge>
              )}
            </div>

            <div className="text-xs text-text-secondary mt-1.5 flex flex-wrap items-center justify-center sm:justify-start gap-2">
              {seller.schoolName && (
                <span className="flex items-center gap-1">
                  <GraduationCap className="w-4 h-4 text-primary" />
                  {seller.schoolName}
                </span>
              )}
              {seller.provinceName && (
                <span className="flex items-center gap-1 text-text-muted">
                  <MapPin className="w-3.5 h-3.5" />
                  {seller.provinceName}
                </span>
              )}
              <span className="flex items-center gap-1 text-text-muted">
                <Calendar className="w-3.5 h-3.5" />
                Tham gia: {seller.joinDate}
              </span>
            </div>
          </div>

          {/* Thống kê người bán */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-surface-border text-center max-w-sm mx-auto sm:mx-0">
            <div className="p-2 bg-surface-muted rounded-xl">
              <div className="flex items-center justify-center gap-1 text-sm font-bold text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                <span>
                  {seller.rating != null && seller.reviewsCount > 0
                    ? seller.rating.toFixed(1)
                    : "—"}
                </span>
              </div>
              <span className="text-[10px] text-text-muted">
                {seller.reviewsCount > 0
                  ? `${seller.reviewsCount} đánh giá`
                  : "Chưa có đánh giá"}
              </span>
            </div>

            <div className="p-2 bg-surface-muted rounded-xl">
              <div className="flex items-center justify-center gap-1 text-sm font-bold text-primary">
                <PackageCheck className="w-4 h-4" />
                <span>{seller.completedDealsCount}</span>
              </div>
              <span className="text-[10px] text-text-muted">Đã pass thành công</span>
            </div>

            <div className="p-2 bg-surface-muted rounded-xl">
              <div className="flex items-center justify-center gap-1 text-sm font-bold text-text-main">
                <Tag className="w-4 h-4" />
                <span>{listings.length}</span>
              </div>
              <span className="text-[10px] text-text-muted">Đang đăng bán</span>
            </div>
          </div>
        </div>
      </div>

      {/* Danh sách món đồ đang bán */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-surface-border pb-3">
          <h2 className="text-lg font-bold font-heading text-text-main">
            Món Đồ Đang Pass ({listings.length})
          </h2>
          <span className="text-xs text-text-muted">Cùng người bán</span>
        </div>

        {listings.length === 0 ? (
          <div className="text-center py-12 bg-surface rounded-2xl border border-surface-border p-6 space-y-2">
            <Tag className="w-8 h-8 text-text-muted mx-auto" />
            <p className="text-text-secondary text-sm font-medium">
              Người bán hiện không có tin đăng nào đang mở bán.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {listings.map((item) => {
              const hasShip = Boolean(
                item.shippingMethods?.sellerDelivery ||
                item.shippingMethods?.carrierShipping ||
                item.shippingMethods?.campusDelivery
              );
              return (
                <ListingCard
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  price={item.price}
                  originalPrice={item.originalPrice}
                  imageUrl={item.coverThumb || item.coverImage}
                  urgent={item.urgentPass}
                  hasShipping={hasShip}
                  schoolName={item.schoolName}
                  passDeadline={formatDeadlineVN(item.passDeadline)}
                  proximity="nationwide"
                  condition={item.condition}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Đánh giá gần đây từ người mua */}
      {reviews.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-surface-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold font-heading text-text-main flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Đánh Giá Từ Sinh Viên Khác ({seller.reviewsCount})
            </h2>
          </div>

          <div className="space-y-3">
            {reviews.map((rev) => (
              <div
                key={rev.id}
                className="bg-surface border border-surface-border rounded-xl p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-text-main">
                      {rev.reviewerName}
                    </span>
                    <div className="flex items-center text-amber-500 text-xs font-bold gap-0.5">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span>{rev.rating}</span>
                    </div>
                  </div>
                  {rev.createdAt && (
                    <span className="text-[11px] text-text-muted">
                      {new Date(rev.createdAt).toLocaleDateString("vi-VN")}
                    </span>
                  )}
                </div>
                {rev.comment ? (
                  <p className="text-xs text-text-secondary leading-relaxed">
                    &ldquo;{rev.comment}&rdquo;
                  </p>
                ) : (
                  <p className="text-xs text-text-muted italic">
                    (Người mua không để lại nhận xét bằng chữ)
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
