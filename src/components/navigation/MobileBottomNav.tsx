"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileBottomNav() {
  const pathname = usePathname();

  const navItems = [
    { label: "Trang chủ", href: "/", icon: Home },
    { label: "Tìm kiếm", href: "/search", icon: Search },
    {
      label: "Đăng tin",
      href: "/listings/new",
      icon: PlusCircle,
      isSpecial: true,
    },
    { label: "Tin nhắn", href: "/messages", icon: MessageSquare },
    { label: "Tôi", href: "/profile", icon: User },
  ];

  return (
    <nav
      aria-label="Thanh điều hướng di động"
      className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-surface-border md:hidden"
    >
      <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          if (item.isSpecial) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center -mt-5 group"
              >
                <div className="w-12 h-12 rounded-full bg-primary hover:bg-primary-hover text-white shadow-elevated flex items-center justify-center transition-transform active:scale-95 group-hover:scale-105">
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold text-primary mt-1">
                  {item.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-14 h-full touch-target transition-colors",
                isActive
                  ? "text-primary font-bold"
                  : "text-text-muted hover:text-text-main font-medium"
              )}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
