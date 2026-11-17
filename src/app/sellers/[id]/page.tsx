import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { ListingCard } from "@/components/ui/ListingCard";
import {
  GraduationCap,
  Star,
  PackageCheck,
  Tag,
  MapPin,
} from "lucide-react";

export default function SellerProfilePage({
  params,
}: {
  params: { id: string };
}) {
  // Dữ liệu người bán công khai (Tuân thủ nghiêm ngặt PDP: Không hiện họ tên thật, SĐT, Email, MSSV)
  const seller = {
    id: params.id,
    displayName: "Tuấn Anh (K21 Bách Khoa)",
    avatarUrl:
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop&q=80",
    schoolName: "Trường Đại học Bách khoa - ĐHQG TP.HCM",
    provinceName: "TP. Hồ Chí Minh",
    joinDate: "Tháng 09/2025",
    verified: true,
    rating: 4.9,
    reviewsCount: 14,
    completedDealsCount: 8,
    activeListingsCount: 2,
    isGraduating: true,
  };

  const sellerListings = [
    {
      id: "l1",
      title: "Quạt đứng Senko công suất lớn lồng sóc màu xám còn rất mới",
      price: 180000,
      originalPrice: 350000,
      urgentPass: true,
      hasShipping: true,
      schoolName: "ĐH Bách Khoa TP.HCM",
      passDeadline: "Hôm nay",
      proximity: "sameSchool" as const,
      condition: "Như mới (95%)",
      imageUrl:
        "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=600&auto=format&fit=crop&q=80",
    },
    {
      id: "l2",
      title: "Bộ giáo trình Đại cương Bách Khoa K21 gồm 5 cuốn",
      price: 90000,
      originalPrice: 220000,
      urgentPass: false,
      hasShipping: true,
      schoolName: "ĐH Bách Khoa TP.HCM",
      passDeadline: "25/11/2026",
      proximity: "sameSchool" as const,
      condition: "Tốt (85%)",
      imageUrl:
        "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80",
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      {/* Header Hồ Sơ Người Bán (Bảo Mật Quyền Riêng Tư) */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card flex flex-col sm:flex-row items-center sm:items-start gap-6 text-center sm:text-left">
        <div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-primary-light border-2 border-primary/30 shadow-subtle shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={seller.avatarUrl}
            alt={seller.displayName}
            className="w-full h-full object-cover"
          />
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

            <p className="text-xs text-text-secondary mt-1 flex items-center justify-center sm:justify-start gap-1.5">
              <GraduationCap className="w-4 h-4 text-primary" />
              <span>{seller.schoolName}</span>
              <span>•</span>
              <MapPin className="w-3.5 h-3.5 text-text-muted" />
              <span>{seller.provinceName}</span>
            </p>
          </div>

          {/* Thống kê người bán */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-surface-border text-center max-w-sm mx-auto sm:mx-0">
            <div className="p-2 bg-surface-muted rounded-xl">
              <div className="flex items-center justify-center gap-1 text-sm font-bold text-amber-500">
                <Star className="w-4 h-4 fill-current" />
                <span>{seller.rating}</span>
              </div>
              <span className="text-[10px] text-text-muted">
                {seller.reviewsCount} đánh giá
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
                <span>{seller.activeListingsCount}</span>
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
            Món Đồ Đang Pass ({sellerListings.length})
          </h2>
          <span className="text-xs text-text-muted">Cùng người bán</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {sellerListings.map((item) => (
            <ListingCard
              key={item.id}
              id={item.id}
              title={item.title}
              price={item.price}
              originalPrice={item.originalPrice}
              imageUrl={item.imageUrl}
              urgent={item.urgentPass}
              hasShipping={item.hasShipping}
              schoolName={item.schoolName}
              passDeadline={item.passDeadline}
              proximity={item.proximity}
              condition={item.condition}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
