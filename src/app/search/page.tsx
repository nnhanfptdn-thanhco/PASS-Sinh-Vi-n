"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { Search, Filter, SlidersHorizontal, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ListingCard } from "@/components/ui/ListingCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { UniversitySelect } from "@/components/ui/UniversitySelect";
import categoriesData from "../../../data/categories.json";
import provincesData from "../../../data/provinces_34.json";
import type { PublicListingDTO } from "@/lib/services/listings";
import { formatDeadlineVN } from "@/lib/utils/date";

function SkeletonListingCard() {
  return (
    <div className="bg-surface border border-surface-border rounded-2xl overflow-hidden shadow-card animate-pulse">
      <div className="aspect-[4/3] bg-surface-muted w-full" />
      <div className="p-3.5 space-y-2.5">
        <div className="h-4 bg-surface-muted rounded w-2/3" />
        <div className="h-5 bg-surface-muted rounded w-3/4" />
        <div className="h-3 bg-surface-muted rounded w-1/2 pt-2" />
      </div>
    </div>
  );
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { profile, user } = useAuth();

  const [query, setQuery] = React.useState(searchParams.get("q") || "");
  const [selectedCategory, setSelectedCategory] = React.useState(searchParams.get("category") || "all");
  const [selectedSchool, setSelectedSchool] = React.useState(searchParams.get("school") || "all");
  const [selectedProvince, setSelectedProvince] = React.useState(searchParams.get("province") || "all");
  const [onlyUrgent, setOnlyUrgent] = React.useState(searchParams.get("urgent") === "true");
  const [onlyShipping, setOnlyShipping] = React.useState(searchParams.get("shipping") === "true");
  const [minPrice, setMinPrice] = React.useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = React.useState(searchParams.get("maxPrice") || "");
  const [sortBy, setSortBy] = React.useState(searchParams.get("sort") || "relevant");

  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<PublicListingDTO[]>([]);

  // Đồng bộ bộ lọc lên URL
  const syncParamsToUrl = React.useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (selectedSchool !== "all") params.set("school", selectedSchool);
    if (selectedProvince !== "all") params.set("province", selectedProvince);
    if (onlyUrgent) params.set("urgent", "true");
    if (onlyShipping) params.set("shipping", "true");
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    if (sortBy !== "relevant") params.set("sort", sortBy);

    const queryString = params.toString();
    router.replace(queryString ? `/search?${queryString}` : "/search", { scroll: false });
  }, [query, selectedCategory, selectedSchool, selectedProvince, onlyUrgent, onlyShipping, minPrice, maxPrice, sortBy, router]);

  // Thực hiện tìm kiếm với AbortController
  const performSearch = React.useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setFetchError(null);

      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (selectedCategory !== "all") params.set("category", selectedCategory);
        if (selectedSchool !== "all") params.set("school", selectedSchool);
        if (selectedProvince !== "all") params.set("province", selectedProvince);
        if (onlyUrgent) params.set("urgent", "true");
        if (onlyShipping) params.set("shipping", "true");
        if (minPrice) params.set("minPrice", minPrice);
        if (maxPrice) params.set("maxPrice", maxPrice);
        if (sortBy) params.set("sort", sortBy);
        if (profile?.schoolCode) params.set("viewerSchool", profile.schoolCode);
        if (profile?.provinceCode) params.set("viewerProvince", profile.provinceCode);

        const res = await fetch(`/api/listings/search?${params.toString()}`, { signal });
        if (!res.ok) {
          throw new Error("Lỗi khi tải kết quả tìm kiếm");
        }

        const data = await res.json();
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (err: unknown) {
        if ((err as Error).name !== "AbortError") {
          console.error("Lỗi tìm kiếm:", err);
          setFetchError("Không thể tải kết quả tìm kiếm. Vui lòng thử lại.");
          setItems([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [query, selectedCategory, selectedSchool, selectedProvince, onlyUrgent, onlyShipping, minPrice, maxPrice, sortBy, profile]
  );

  // Debounce tìm kiếm 300ms và hủy request cũ khi thay đổi input
  React.useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      syncParamsToUrl();
      performSearch(controller.signal);
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [syncParamsToUrl, performSearch]);

  const handleToggleSameSchool = () => {
    if (!user) {
      router.push("/auth/login?next=/search");
      return;
    }
    if (selectedSchool === profile?.schoolCode) {
      setSelectedSchool("all");
    } else if (profile?.schoolCode) {
      setSelectedSchool(profile.schoolCode);
    }
  };

  const getProximity = (item: PublicListingDTO): "sameSchool" | "sameCity" | "nationwide" => {
    if (profile?.schoolCode && item.schoolCode === profile.schoolCode) {
      return "sameSchool";
    }
    if (profile?.provinceCode && item.provinceCode === profile.provinceCode) {
      return "sameCity";
    }
    return "nationwide";
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6 space-y-6">
      {/* KHỐI TÌM KIẾM CHÍNH */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên món đồ, hãng sản xuất, mã model..."
            leftIcon={<Search className="w-4 h-4 text-text-muted" />}
            className="h-11"
          />
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
            leftIcon={<SlidersHorizontal className="w-4 h-4" />}
            className="sm:w-auto"
          >
            Bộ lọc nâng cao
          </Button>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-11 px-3 bg-surface border border-surface-border rounded-xl text-xs sm:text-sm font-semibold text-text-main focus:outline-none focus:ring-2 focus:ring-primary shadow-subtle cursor-pointer"
          >
            <option value="relevant">Phù hợp nhất</option>
            <option value="newest">Mới đăng nhất</option>
            <option value="price_asc">Giá tăng dần</option>
            <option value="price_desc">Giá giảm dần</option>
          </select>
        </div>
      </div>

      {/* CHIP LỌC NHANH */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
        <button
          type="button"
          onClick={() => setOnlyUrgent(!onlyUrgent)}
          className={`px-3 py-1.5 rounded-full border transition-all font-semibold shrink-0 cursor-pointer ${
            onlyUrgent
              ? "bg-urgent-solid text-white border-urgent-solid shadow-sm"
              : "bg-surface text-text-secondary border-surface-border hover:border-primary"
          }`}
        >
          ⚡ Pass trong ngày
        </button>

        <button
          type="button"
          onClick={() => setOnlyShipping(!onlyShipping)}
          className={`px-3 py-1.5 rounded-full border transition-all font-semibold shrink-0 cursor-pointer ${
            onlyShipping
              ? "bg-primary text-white border-primary shadow-sm"
              : "bg-surface text-text-secondary border-surface-border hover:border-primary"
          }`}
        >
          🚚 Có ship đồ
        </button>

        <button
          type="button"
          onClick={handleToggleSameSchool}
          className={`px-3 py-1.5 rounded-full border transition-all font-semibold shrink-0 cursor-pointer ${
            selectedSchool !== "all" && selectedSchool === profile?.schoolCode
              ? "bg-primary text-white border-primary shadow-sm"
              : "bg-surface text-text-secondary border-surface-border hover:border-primary"
          }`}
        >
          🎓 Chỉ trường của tôi
        </button>
      </div>

      {/* BỘ LỌC CHI TIẾT */}
      {isFilterDrawerOpen && (
        <div className="p-4 bg-surface border border-surface-border rounded-2xl shadow-card space-y-4">
          <div className="flex items-center justify-between border-b border-surface-border pb-3">
            <h3 className="text-sm font-bold text-text-main flex items-center gap-2">
              <Filter className="w-4 h-4 text-primary" />
              <span>Bộ lọc chi tiết</span>
            </h3>
            <button
              type="button"
              onClick={() => {
                setSelectedCategory("all");
                setSelectedSchool("all");
                setSelectedProvince("all");
                setOnlyUrgent(false);
                setOnlyShipping(false);
                setMinPrice("");
                setMaxPrice("");
                setSortBy("relevant");
              }}
              className="text-xs text-text-muted hover:text-primary transition-colors cursor-pointer"
            >
              Đặt lại bộ lọc
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-secondary">Danh mục</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full h-10 px-3 bg-surface border border-surface-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Tất cả danh mục</option>
                {categoriesData.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-secondary">Trường đại học / CĐ</label>
              <UniversitySelect
                value={selectedSchool}
                onChange={(code) => setSelectedSchool(code)}
                placeholder="Chọn trường đại học..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-secondary">Tỉnh / Thành phố</label>
              <select
                value={selectedProvince}
                onChange={(e) => setSelectedProvince(e.target.value)}
                className="w-full h-10 px-3 bg-surface border border-surface-border rounded-lg text-xs text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Toàn quốc</option>
                {provincesData.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Input
              label="Giá tối thiểu (VNĐ)"
              type="number"
              placeholder="Ví dụ: 50000"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
            <Input
              label="Giá tối đa (VNĐ)"
              type="number"
              placeholder="Ví dụ: 1000000"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* KẾT QUẢ TÌM KIẾM */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-secondary">
            Tìm thấy {items.length} món đồ phù hợp
          </span>
          <Badge variant="near">
            {selectedSchool !== "all"
              ? "Lọc theo trường"
              : selectedProvince !== "all"
              ? "Lọc theo tỉnh thành"
              : "Toàn quốc"}
          </Badge>
        </div>

        {fetchError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between gap-3">
            <span>{fetchError}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => performSearch()}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Thử lại
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            <SkeletonListingCard />
            <SkeletonListingCard />
            <SkeletonListingCard />
            <SkeletonListingCard />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Không tìm thấy món đồ nào phù hợp với bộ lọc"
            description="Hãy thử đổi từ khóa tìm kiếm hoặc mở rộng phạm vi sang toàn quốc nhé!"
            actionLabel="Đăng món đồ đầu tiên của trường bạn"
            actionHref="/listings/new"
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {items.map((item) => (
              <ListingCard
                key={item.id}
                id={item.id}
                title={item.title}
                price={item.price}
                originalPrice={item.originalPrice}
                imageUrl={item.coverThumb || item.coverImage}
                urgent={item.urgentPass}
                hasShipping={
                  item.shippingMethods?.sellerDelivery ||
                  item.shippingMethods?.carrierShipping
                }
                schoolName={item.schoolName || item.schoolCode || "Sinh viên"}
                passDeadline={formatDeadlineVN(item.passDeadline)}
                proximity={getProximity(item)}
                campusDelivery={item.shippingMethods?.campusDelivery}
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
