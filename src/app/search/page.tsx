"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ListingCard } from "@/components/ui/ListingCard";
import { SkeletonListingCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Search as SearchIcon,
  SlidersHorizontal,
  X,
  Zap,
  Truck,
  GraduationCap,
} from "lucide-react";
import categoriesData from "../../../data/categories.json";
import universitiesData from "../../../data/universities_vietnam.json";
import provincesData from "../../../data/provinces_34.json";

interface SearchCardItem {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  coverImage?: string;
  images?: string[];
  urgentPass?: boolean;
  hasShipping?: boolean;
  schoolCode?: string;
  passDeadline?: string;
  campusDelivery?: boolean;
  condition?: string;
}

function SearchContent() {
  const searchParams = useSearchParams();

  const [query, setQuery] = React.useState(searchParams.get("q") || "");
  const [selectedCategory, setSelectedCategory] = React.useState(
    searchParams.get("category") || "all"
  );
  const [selectedSchool, setSelectedSchool] = React.useState(
    searchParams.get("school") || "all"
  );
  const [selectedProvince, setSelectedProvince] = React.useState(
    searchParams.get("province") || "all"
  );
  const [onlyUrgent, setOnlyUrgent] = React.useState(
    searchParams.get("urgent") === "true"
  );
  const [onlyShipping, setOnlyShipping] = React.useState(
    searchParams.get("shipping") === "true"
  );
  const [onlySameSchool, setOnlySameSchool] = React.useState(false);
  const [sortBy, setSortBy] = React.useState(
    searchParams.get("sort") || "relevant"
  );

  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [items, setItems] = React.useState<SearchCardItem[]>([]);

  // Thực hiện tìm kiếm
  const performSearch = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (selectedSchool !== "all") params.set("school", selectedSchool);
      if (selectedProvince !== "all") params.set("province", selectedProvince);
      if (onlyUrgent) params.set("urgent", "true");
      if (onlyShipping) params.set("shipping", "true");
      if (sortBy !== "relevant") params.set("sort", sortBy);

      const res = await fetch(`/api/listings/search?${params.toString()}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [query, selectedCategory, selectedSchool, selectedProvince, onlyUrgent, onlyShipping, sortBy]);

  React.useEffect(() => {
    performSearch();
  }, [performSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Thanh tìm kiếm & Nút mở bộ lọc mobile */}
      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm quạt đứng, nồi cơm, giáo trình giải tích..."
            leftIcon={<SearchIcon className="w-4 h-4" />}
            className="h-12 text-sm"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-12 px-3.5 shrink-0 flex items-center gap-1.5"
          onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Bộ lọc</span>
        </Button>
        <Button type="submit" variant="primary" className="h-12 px-5 shrink-0">
          Tìm
        </Button>
      </form>

      {/* Chip bộ lọc nhanh */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
          type="button"
          onClick={() => setOnlyUrgent(!onlyUrgent)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
            onlyUrgent
              ? "bg-urgent-solid text-white border-urgent-solid shadow-sm font-bold"
              : "bg-surface border-surface-border text-text-secondary hover:border-primary"
          }`}
        >
          <Zap className="w-3.5 h-3.5 fill-current" />
          <span>Pass trong ngày</span>
        </button>

        <button
          type="button"
          onClick={() => setOnlyShipping(!onlyShipping)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
            onlyShipping
              ? "bg-primary text-white border-primary shadow-sm font-bold"
              : "bg-surface border-surface-border text-text-secondary hover:border-primary"
          }`}
        >
          <Truck className="w-3.5 h-3.5" />
          <span>Có hỗ trợ ship</span>
        </button>

        <button
          type="button"
          onClick={() => setOnlySameSchool(!onlySameSchool)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all ${
            onlySameSchool
              ? "bg-primary text-white border-primary shadow-sm font-bold"
              : "bg-surface border-surface-border text-text-secondary hover:border-primary"
          }`}
        >
          <GraduationCap className="w-3.5 h-3.5" />
          <span>Chỉ trường của tôi</span>
        </button>
      </div>

      {/* Khung Bộ Lọc Mở Rộng */}
      {isFilterDrawerOpen && (
        <div className="p-4 sm:p-5 bg-surface border border-surface-border rounded-2xl shadow-card space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <h3 className="text-sm font-bold text-text-main flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              <span>Tùy Chọn Lọc & Sắp Xếp Nâng Cao</span>
            </h3>
            <button
              onClick={() => setIsFilterDrawerOpen(false)}
              className="text-text-muted hover:text-text-main"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {/* Lọc danh mục */}
            <div className="space-y-1.5">
              <label className="font-semibold text-text-main">Danh mục</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full h-10 px-2.5 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Tất cả danh mục</option>
                {categoriesData.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Lọc tỉnh thành */}
            <div className="space-y-1.5">
              <label className="font-semibold text-text-main">Tỉnh / Thành phố</label>
              <select
                value={selectedProvince}
                onChange={(e) => setSelectedProvince(e.target.value)}
                className="w-full h-10 px-2.5 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Toàn quốc (34 tỉnh/thành)</option>
                {provincesData.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Lọc trường */}
            <div className="space-y-1.5">
              <label className="font-semibold text-text-main">Trường Đại học</label>
              <select
                value={selectedSchool}
                onChange={(e) => setSelectedSchool(e.target.value)}
                className="w-full h-10 px-2.5 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Tất cả các trường</option>
                {universitiesData.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.shortName} - {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sắp xếp */}
            <div className="space-y-1.5">
              <label className="font-semibold text-text-main">Sắp xếp theo</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full h-10 px-2.5 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="relevant">Phù hợp nhất (ưu tiên cùng trường)</option>
                <option value="newest">Mới đăng nhất</option>
                <option value="price_asc">Giá: Thấp đến cao</option>
                <option value="price_desc">Giá: Cao đến thấp</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSelectedCategory("all");
                setSelectedSchool("all");
                setSelectedProvince("all");
                setOnlyUrgent(false);
                setOnlyShipping(false);
                setSortBy("relevant");
              }}
            >
              Đặt lại bộ lọc
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                performSearch();
                setIsFilterDrawerOpen(false);
              }}
            >
              Áp dụng
            </Button>
          </div>
        </div>
      )}

      {/* KẾT QUẢ TÌM KIẾM */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary">
            Tìm thấy {items.length} món đồ phù hợp
          </span>
          <Badge variant="near">Toàn quốc</Badge>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <SkeletonListingCard />
            <SkeletonListingCard />
            <SkeletonListingCard />
            <SkeletonListingCard />
            <SkeletonListingCard />
            <SkeletonListingCard />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Không tìm thấy món đồ nào phù hợp với bộ lọc"
            description="Hãy thử đổi từ khóa tìm kiếm hoặc mở rộng phạm vi sang toàn quốc nhé!"
            actionText="Đăng món đồ đầu tiên của trường bạn"
            actionHref="/listings/new"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((item) => (
              <ListingCard
                key={item.id}
                id={item.id}
                title={item.title}
                price={item.price}
                originalPrice={item.originalPrice}
                imageUrl={item.coverImage || item.images?.[0]}
                urgent={item.urgentPass}
                hasShipping={item.hasShipping}
                schoolName={item.schoolCode || "ĐH Bách Khoa TP.HCM"}
                passDeadline={item.urgentPass ? "Hôm nay" : item.passDeadline || "Gấp"}
                proximity="sameSchool"
                campusDelivery={item.campusDelivery}
                condition={item.condition}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <React.Suspense fallback={<div className="p-8 text-center text-xs">Đang tải tìm kiếm...</div>}>
      <SearchContent />
    </React.Suspense>
  );
}
