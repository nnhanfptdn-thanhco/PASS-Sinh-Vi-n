"use client";

import * as React from "react";
import Link from "next/link";
import { GraduationCap, MapPin, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full bg-surface/90 backdrop-blur-md border-b border-surface-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-white shadow-subtle">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-heading font-extrabold text-base sm:text-lg tracking-tight text-text-main">
                Chợ Pass
              </span>
              <span className="text-xs px-1.5 py-0.2 font-bold bg-primary-light text-primary rounded-md">
                SV
              </span>
            </div>
            <span className="hidden sm:block text-[10px] text-text-muted font-medium">
              Chợ đồ cũ sinh viên toàn quốc
            </span>
          </div>
        </Link>

        {/* Nút chọn khu vực & trường nhanh (Header Quick Selector) */}
        <button
          type="button"
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-muted hover:bg-surface-border text-text-main text-xs font-semibold border border-surface-border transition-colors max-w-xs truncate"
          title="Chọn khu vực & trường học của bạn"
        >
          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">ĐHQG TP.HCM · P. Linh Trung</span>
        </button>

        {/* Cụm công cụ bên phải */}
        <div className="flex items-center gap-2">
          {/* Nút tìm kiếm nhanh trên mobile */}
          <Link
            href="/search"
            aria-label="Tìm kiếm món đồ"
            className="sm:hidden w-9 h-9 rounded-lg border border-surface-border flex items-center justify-center text-text-secondary hover:text-text-main"
          >
            <Search className="w-4 h-4" />
          </Link>

          {/* Đổi màu & Sáng/Tối */}
          <ThemeToggle />

          {/* Nút Đăng tin nổi bật trên Desktop */}
          <Link href="/listings/new" className="hidden md:inline-flex">
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
            >
              Đăng tin ngay
            </Button>
          </Link>

          {/* Nút Đăng nhập / Tài khoản */}
          <Link href="/auth/login">
            <Button variant="secondary" size="sm" className="px-2.5 sm:px-3 text-xs">
              Đăng nhập
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
