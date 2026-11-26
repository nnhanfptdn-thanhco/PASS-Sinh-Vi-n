"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrencyVND } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Clock, Heart } from "lucide-react";
import { authFetch } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth/AuthContext";

export interface ListingCardProps {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  imageUrl?: string;
  urgent?: boolean;
  hasShipping?: boolean;
  schoolName: string;
  passDeadline: string;
  proximity?: "sameSchool" | "sameWard" | "sameCity" | "nationwide";
  campusDelivery?: boolean;
  condition?: string;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  previewMode?: boolean;
}

export function ListingCard({
  id,
  title,
  price,
  originalPrice,
  imageUrl,
  urgent = false,
  hasShipping = false,
  schoolName,
  passDeadline,
  proximity = "nationwide",
  campusDelivery = false,
  condition,
  isFavorite = false,
  onToggleFavorite,
  previewMode = false,
}: ListingCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [favorite, setFavorite] = React.useState(isFavorite);

  React.useEffect(() => {
    setFavorite(isFavorite);
  }, [isFavorite]);

  const handleFavoriteClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (previewMode) return;
    if (onToggleFavorite) {
      onToggleFavorite(id);
      return;
    }
    if (!user) {
      router.push(`/auth/login?next=${encodeURIComponent(`/listings/${id}`)}`);
      return;
    }
    const nextVal = !favorite;
    setFavorite(nextVal);
    try {
      const res = await authFetch("/api/favorites/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: id }),
      });
      if (!res.ok) {
        setFavorite(!nextVal);
      }
    } catch {
      setFavorite(!nextVal);
    }
  };

  const proximityLabels = {
    sameSchool: "Cùng trường",
    sameWard: "Cùng phường/xã",
    sameCity: "Cùng tỉnh/thành",
    nationwide: "Toàn quốc",
  };

  const discountPercent =
    originalPrice && originalPrice > price
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : null;

  const imageBoxContent = (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-text-muted text-xs bg-gradient-to-br from-surface-muted to-surface-border/50">
          Chưa có ảnh
        </div>
      )}

      {!previewMode && (
        <button
          type="button"
          aria-label={favorite ? "Bỏ lưu tin" : "Lưu tin"}
          onClick={handleFavoriteClick}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 transition-colors z-10"
        >
          <Heart
            className={`w-4 h-4 ${
              favorite ? "fill-red-500 text-red-500" : "text-white"
            }`}
          />
        </button>
      )}

      <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
        {urgent && <Badge variant="urgent">Pass trong ngày</Badge>}
        {campusDelivery && (
          <Badge variant="sameSchool">Giao trong trường</Badge>
        )}
      </div>

      {condition && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[11px] font-medium text-white">
          {condition}
        </div>
      )}
    </>
  );

  return (
    <div className="group relative flex flex-col bg-surface border border-surface-border rounded-xl overflow-hidden hover:shadow-card hover:border-primary/40 transition-all duration-200">
      {previewMode ? (
        <div className="relative aspect-[4/3] w-full bg-surface-muted overflow-hidden block">
          {imageBoxContent}
        </div>
      ) : (
        <Link href={`/listings/${id}`} className="relative aspect-[4/3] w-full bg-surface-muted overflow-hidden block">
          {imageBoxContent}
        </Link>
      )}

      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2.5">
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-bold text-primary">
              {formatCurrencyVND(price)}
            </span>
            {originalPrice && originalPrice > price && (
              <span className="text-xs text-text-muted line-through">
                {formatCurrencyVND(originalPrice)}
              </span>
            )}
            {discountPercent && (
              <span className="text-[11px] font-semibold text-urgent-solid">
                -{discountPercent}%
              </span>
            )}
          </div>

          {previewMode ? (
            <h3
              title={title}
              className="text-sm font-semibold text-text-main line-clamp-2 leading-snug mt-0.5"
            >
              {title}
            </h3>
          ) : (
            <Link href={`/listings/${id}`} className="block">
              <h3
                title={title}
                className="text-sm font-semibold text-text-main line-clamp-2 leading-snug hover:text-primary transition-colors mt-0.5"
              >
                {title}
              </h3>
            </Link>
          )}
        </div>

        <div className="pt-2 border-t border-surface-border/60 flex flex-col gap-1.5 text-xs text-text-secondary">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate max-w-[170px] font-medium text-text-main" title={schoolName}>
              {schoolName}
            </span>
            <Badge variant="near" className="text-[10px] px-1.5 py-0 shrink-0">
              {proximityLabels[proximity]}
            </Badge>
          </div>

          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Hạn: {passDeadline}</span>
            </span>
            {hasShipping && (
              <Badge variant="ship" className="text-[10px] px-1.5 py-0">
                Có ship
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
