"use client";

import * as React from "react";
import Link from "next/link";
import { ListingCard } from "@/components/ui/ListingCard";
import { EmptyState } from "@/components/ui/EmptyState";

interface FeedItem {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  imageUrl?: string;
  coverImage?: string;
  urgent?: boolean;
  urgentPass?: boolean;
  hasShipping?: boolean;
  schoolName: string;
  passDeadline: string;
  proximity?: "sameSchool" | "sameWard" | "sameCity" | "nationwide";
  campusDelivery?: boolean;
  condition?: string;
  createdAt?: string;
}

interface RawListingItem {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  coverImage?: string;
  images?: string[];
  urgentPass?: boolean;
  hasShipping?: boolean;
  schoolName?: string;
  passDeadline?: string;
  campusDelivery?: boolean;
  condition?: string;
  createdAt?: string;
}

export function HomeFeed() {
  const [items, setItems] = React.useState<FeedItem[]>([]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    let localItems: FeedItem[] = [];
    try {
      const stored = localStorage.getItem("cho_pass_my_listings");
      if (stored) {
        const parsed: RawListingItem[] = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          localItems = parsed.map((item) => ({
            id: item.id,
            title: item.title,
            price: item.price,
            originalPrice: item.originalPrice || item.price,
            imageUrl: item.coverImage || item.images?.[0] || "",
            urgent: Boolean(item.urgentPass),
            hasShipping: Boolean(item.hasShipping),
            schoolName: item.schoolName || "Đại học FPT Đà Nẵng",
            passDeadline: item.passDeadline || "Còn 3 ngày",
            proximity: "sameSchool" as const,
            campusDelivery: Boolean(item.campusDelivery),
            condition: item.condition || "Dùng được",
            createdAt: item.createdAt || "Vừa xong",
          }));
        }
      }
    } catch {
      // ignore
    }

    const defaultItems: FeedItem[] = [
      {
        id: "l1",
        title: "Quạt đứng Senko lồng sóc màu xám còn rất mới",
        price: 180000,
        originalPrice: 350000,
        imageUrl:
          "https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=600&auto=format&fit=crop&q=80",
        urgent: true,
        hasShipping: true,
        schoolName: "ĐH Bách Khoa - ĐHQG TP.HCM",
        passDeadline: "Hôm nay",
        proximity: "sameCity",
        campusDelivery: true,
        condition: "Như mới (90%)",
      },
      {
        id: "l2",
        title: "Nồi cơm điện Sharp 1.8L nấu ngon chống dính tốt",
        price: 250000,
        originalPrice: 520000,
        imageUrl:
          "https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80",
        urgent: false,
        hasShipping: false,
        schoolName: "ĐH Kinh Tế Quốc Dân (NEU)",
        passDeadline: "2 ngày nữa",
        proximity: "sameCity",
        campusDelivery: false,
        condition: "Tốt (75%)",
      },
      {
        id: "l3",
        title: "Bàn học gấp chân sắt kèm ghế xoay nỉ",
        price: 120000,
        originalPrice: 280000,
        imageUrl:
          "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600&auto=format&fit=crop&q=80",
        urgent: false,
        hasShipping: true,
        schoolName: "ĐH FPT - Phân hiệu Đà Nẵng",
        passDeadline: "25/11/2026",
        proximity: "sameSchool",
        campusDelivery: true,
        condition: "Dùng tốt",
      },
    ];

    setItems([...localItems, ...defaultItems]);
  }, []);

  if (!mounted) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="aspect-[4/3] bg-surface-muted rounded-xl border border-surface-border"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Chưa có món đồ nào được đăng quanh khu vực này"
        description="Hệ thống không tạo dữ liệu giả. Hãy là sinh viên đầu tiên đăng món đồ hoặc giáo trình cần pass của trường bạn nhé!"
        actionText="Đăng món đồ đầu tiên của trường bạn"
        actionHref="/listings/new"
      />
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/listings/${item.id}`}
          className="block group"
        >
          <ListingCard
            id={item.id}
            title={item.title}
            price={item.price}
            originalPrice={item.originalPrice}
            imageUrl={item.imageUrl}
            urgent={item.urgent}
            hasShipping={item.hasShipping}
            schoolName={item.schoolName}
            passDeadline={item.passDeadline}
            proximity={item.proximity}
            campusDelivery={item.campusDelivery}
            condition={item.condition}
          />
        </Link>
      ))}
    </div>
  );
}
