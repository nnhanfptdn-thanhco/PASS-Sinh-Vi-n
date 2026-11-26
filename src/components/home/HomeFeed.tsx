"use client";

import * as React from "react";
import { ListingCard } from "@/components/ui/ListingCard";
import { SkeletonListingCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Loader2 } from "lucide-react";
import type { PublicListingDTO } from "@/lib/services/listings";
import { formatDeadlineVN } from "@/lib/utils/date";
import { useAuth } from "@/lib/auth/AuthContext";
import { authFetch } from "@/lib/firebase/client";

export function HomeFeed({
  initialItems = [],
  initialCursor,
}: {
  initialItems?: PublicListingDTO[];
  initialCursor?: string;
}) {
  const { user, profile } = useAuth();
  const [items, setItems] = React.useState<PublicListingDTO[]>(initialItems);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>(initialCursor);
  const [isInitialLoading, setIsInitialLoading] = React.useState(initialItems.length === 0);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [favoriteIds, setFavoriteIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (initialItems.length > 0) {
      setIsInitialLoading(false);
      return;
    }
    let cancelled = false;
    setIsInitialLoading(true);
    fetch("/api/listings/search?sort=newest&limit=12")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && Array.isArray(data.items)) {
          setItems(data.items);
          setNextCursor(data.nextCursor);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsInitialLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialItems.length]);

  React.useEffect(() => {
    if (!user) {
      setFavoriteIds(new Set());
      return;
    }
    let cancelled = false;
    authFetch("/api/favorites/toggle")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.listingIds)) {
          setFavoriteIds(new Set(data.listingIds));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);

    try {
      const res = await fetch(
        `/api/listings/search?sort=newest&limit=12&cursor=${encodeURIComponent(nextCursor)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items)) {
          setItems((prev) => {
            const seen = new Set(prev.map((i) => i.id));
            return [...prev, ...data.items.filter((i: PublicListingDTO) => !seen.has(i.id))];
          });
        }
        setNextCursor(data.nextCursor);
      }
    } catch (err) {
      console.error("Lỗi tải thêm tin đăng:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const getProximity = (item: PublicListingDTO): "sameSchool" | "sameCity" | "nationwide" => {
    if (profile?.schoolCode && item.schoolCode === profile.schoolCode) return "sameSchool";
    if (profile?.provinceCode && item.provinceCode === profile.provinceCode) return "sameCity";
    return "nationwide";
  };

  if (isInitialLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        <SkeletonListingCard />
        <SkeletonListingCard />
        <SkeletonListingCard />
        <SkeletonListingCard />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Chưa có món đồ nào đang pass"
        description="Hãy là người đầu tiên đăng món đồ cần pass để tiếp cận các bạn sinh viên xung quanh bạn!"
        actionLabel="Đăng tin ngay"
        actionHref="/listings/new"
      />
    );
  }

  return (
    <div className="space-y-6">
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
            schoolName={item.schoolName || "Sinh viên"}
            passDeadline={formatDeadlineVN(item.passDeadline)}
            proximity={getProximity(item)}
            campusDelivery={item.shippingMethods?.campusDelivery}
            condition={item.condition}
            isFavorite={favoriteIds.has(item.id)}
          />
        ))}
      </div>

      {nextCursor && (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            size="md"
            disabled={isLoadingMore}
            onClick={handleLoadMore}
            className="w-full sm:w-auto px-8"
          >
            {isLoadingMore ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang tải...
              </span>
            ) : (
              "Xem thêm tin đăng khác"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
