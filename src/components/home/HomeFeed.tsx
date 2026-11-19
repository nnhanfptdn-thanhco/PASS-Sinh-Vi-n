"use client";

import * as React from "react";
import { ListingCard } from "@/components/ui/ListingCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Loader2 } from "lucide-react";
import type { PublicListingDTO } from "@/lib/services/listings";
import { formatDeadlineVN } from "@/lib/utils/date";

export function HomeFeed({
  initialItems = [],
  initialCursor,
}: {
  initialItems?: PublicListingDTO[];
  initialCursor?: string;
}) {
  const [items, setItems] = React.useState<PublicListingDTO[]>(initialItems);
  const [nextCursor, setNextCursor] = React.useState<string | undefined>(initialCursor);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);

    try {
      const res = await fetch(`/api/listings/search?sort=newest&limit=12&cursor=${nextCursor}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.items)) {
          setItems((prev) => [...prev, ...data.items]);
        }
        setNextCursor(data.nextCursor);
      }
    } catch (err) {
      console.error("Lỗi tải thêm tin đăng:", err);
    } finally {
      setIsLoadingMore(false);
    }
  };

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
            proximity="sameSchool"
            campusDelivery={item.shippingMethods?.campusDelivery}
            condition={item.condition}
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
