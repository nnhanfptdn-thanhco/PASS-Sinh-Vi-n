import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-surface-muted border border-surface-border/40",
        className
      )}
      {...props}
    />
  );
}

export function SkeletonListingCard() {
  return (
    <div className="flex flex-col bg-surface border border-surface-border rounded-xl overflow-hidden shadow-subtle">
      {/* Khung ảnh 4:3 */}
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      {/* Thông tin */}
      <div className="p-3.5 space-y-3">
        <Skeleton className="h-6 w-24 rounded" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full rounded" />
          <Skeleton className="h-4 w-3/4 rounded" />
        </div>
        <div className="pt-2 border-t border-surface-border/60 flex items-center justify-between">
          <Skeleton className="h-3 w-28 rounded" />
          <Skeleton className="h-3 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}
