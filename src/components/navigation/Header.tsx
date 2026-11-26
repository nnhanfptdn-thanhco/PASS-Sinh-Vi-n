"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  GraduationCap,
  MapPin,
  Plus,
  Search,
  User,
  ShieldCheck,
  Package,
  Settings,
  LogOut,
  ChevronDown,
  ShieldAlert,
  Sparkles,
  MessageSquare,
  Bell,
  Clock,
  LifeBuoy,
  Shield,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth/AuthContext";
import { Badge } from "@/components/ui/Badge";

function getInitials(name?: string | null): string {
  if (!name) return "SV";
  const trimmed = name.trim();
  if (!trimmed) return "SV";
  const cleaned = trimmed.replace(/^[^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+/i, "");
  return cleaned.charAt(0).toUpperCase() || "SV";
}

export function Header() {
  const pathname = usePathname();
  const { user, profile, role, isLoading, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Đóng dropdown khi click ra ngoài hoặc nhấn Esc
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  // Đóng dropdown khi chuyển trang
  React.useEffect(() => {
    setDropdownOpen(false);
  }, [pathname]);

  const loginHref =
    pathname && pathname !== "/"
      ? `/auth/login?next=${encodeURIComponent(pathname)}`
      : "/auth/login";

  const postListingHref = !user
    ? `/auth/login?next=${encodeURIComponent("/listings/new")}`
    : role === "admin" || role === "verified" || profile?.verificationStatus === "approved"
    ? "/listings/new"
    : "/auth/onboarding";

  const verificationStatus = profile?.verificationStatus || "none";

  const renderVerificationBadge = () => {
    switch (verificationStatus) {
      case "approved":
        return <Badge variant="verified">Đã xác minh SV</Badge>;
      case "pending":
        return <Badge variant="pickup">Đang chờ duyệt</Badge>;
      case "rejected":
        return <Badge variant="urgent">Bị từ chối</Badge>;
      case "expired":
        return <Badge variant="default">Thẻ hết hạn</Badge>;
      default:
        return <Badge variant="outline">Chưa xác minh</Badge>;
    }
  };

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

        {/* Nút hiển thị trường / khu vực động */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-muted text-text-main text-xs font-semibold border border-surface-border max-w-xs truncate">
          <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">
            {profile?.schoolName || "Sinh viên Toàn quốc"}
          </span>
        </div>

        {/* Cụm công cụ bên phải */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Nút tìm kiếm nhanh (mobile & iPad/desktop) */}
          <Link
            href="/search"
            aria-label="Tìm kiếm món đồ"
            className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
              pathname === "/search"
                ? "border-primary bg-primary-light text-primary"
                : "border-surface-border text-text-secondary hover:text-text-main"
            }`}
          >
            <Search className="w-4 h-4" />
          </Link>

          {/* Liên kết Tin nhắn, Giữ chỗ & Thông báo cho iPad (md+) và Desktop */}
          {user && (
            <>
              <Link
                href="/messages"
                aria-label="Tin nhắn"
                title="Tin nhắn"
                className={`hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                  pathname?.startsWith("/messages")
                    ? "border-primary bg-primary-light text-primary"
                    : "border-surface-border text-text-secondary hover:text-text-main"
                }`}
              >
                <MessageSquare className="w-4 h-4" />
              </Link>
              <Link
                href="/reservations"
                aria-label="Giữ chỗ"
                title="Quản lý giữ chỗ"
                className={`hidden md:inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                  pathname?.startsWith("/reservations")
                    ? "border-primary bg-primary-light text-primary"
                    : "border-surface-border text-text-secondary hover:text-text-main"
                }`}
              >
                <Clock className="w-4 h-4" />
              </Link>
              <Link
                href="/notifications"
                aria-label="Thông báo"
                title="Thông báo"
                className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                  pathname?.startsWith("/notifications")
                    ? "border-primary bg-primary-light text-primary"
                    : "border-surface-border text-text-secondary hover:text-text-main"
                }`}
              >
                <Bell className="w-4 h-4" />
              </Link>
            </>
          )}

          {/* Nút NnhanAI Assistant */}
          <Link
            href="/ai"
            className={`inline-flex items-center justify-center font-semibold rounded-lg transition-colors h-9 px-2.5 text-xs border gap-1.5 ${
              pathname === "/ai"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
            }`}
            aria-label="Trợ lý NnhanAI"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">NnhanAI</span>
          </Link>

          {/* Đổi màu Sáng/Tối */}
          <ThemeToggle />

          {/* Nút Đăng tin nổi bật */}
          <Link
            href={postListingHref}
            className="hidden md:inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-primary text-white hover:bg-primary-hover shadow-subtle gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Đăng tin ngay</span>
          </Link>

          {/* Trạng thái Đăng nhập / Tài khoản */}
          {isLoading ? (
            /* Skeleton cùng kích thước nút, chống giật/nhấp nháy */
            <div
              className="w-24 h-9 bg-surface-muted animate-pulse rounded-lg border border-surface-border"
              aria-label="Đang tải trạng thái đăng nhập"
            />
          ) : user ? (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen((prev) => !prev)}
                aria-expanded={dropdownOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 p-1 pl-2 pr-2.5 rounded-xl border border-surface-border bg-surface hover:bg-surface-muted transition-colors text-left"
              >
                {/* Avatar người dùng */}
                <div className="w-7 h-7 rounded-full overflow-hidden bg-primary-light text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20">
                  {profile?.photoURL ? (
                    <Image
                      src={profile.photoURL}
                      alt={profile.displayName || "Avatar"}
                      width={28}
                      height={28}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span>{getInitials(profile?.displayName)}</span>
                  )}
                </div>

                <div className="hidden sm:flex flex-col text-left max-w-[110px]">
                  <span className="text-xs font-semibold text-text-main truncate">
                    {profile?.displayName || "Sinh viên"}
                  </span>
                  <span className="text-[10px] text-text-muted leading-tight truncate">
                    {role === "admin" ? "Quản trị viên" : role === "verified" ? "Đã duyệt thẻ" : "Chưa duyệt"}
                  </span>
                </div>

                <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Menu Dropdown Tài khoản */}
              {dropdownOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-64 bg-surface rounded-2xl shadow-elevated border border-surface-border p-2 space-y-1 z-50 animate-in fade-in-50 slide-in-from-top-2 duration-150"
                >
                  {/* Header trong Dropdown */}
                  <div className="p-3 border-b border-surface-border space-y-1.5">
                    <p className="font-heading font-bold text-sm text-text-main truncate">
                      {profile?.displayName || "Sinh viên"}
                    </p>
                    <p className="text-xs text-text-secondary truncate">
                      {profile?.email || user.email || "Chưa có email"}
                    </p>
                    <div className="pt-1 flex items-center gap-1.5">
                      {renderVerificationBadge()}
                      {role === "admin" && (
                        <Badge variant="verified">Admin</Badge>
                      )}
                    </div>
                  </div>

                  {/* Danh sách mục menu */}
                  <div className="py-1">
                    <Link
                      href="/my-listings"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <Package className="w-4 h-4 text-primary shrink-0" />
                      <span>Tin của tôi</span>
                    </Link>

                    <Link
                      href="/reservations"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <Clock className="w-4 h-4 text-primary shrink-0" />
                      <span>Quản lý giữ chỗ</span>
                    </Link>

                    <Link
                      href="/messages"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <MessageSquare className="w-4 h-4 text-primary shrink-0" />
                      <span>Tin nhắn 1-1</span>
                    </Link>

                    <Link
                      href="/notifications"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <Bell className="w-4 h-4 text-primary shrink-0" />
                      <span>Thông báo</span>
                    </Link>

                    {verificationStatus !== "approved" && (
                      <Link
                        href="/auth/onboarding"
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-xl transition-colors"
                      >
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span>Xác minh thẻ sinh viên</span>
                      </Link>
                    )}

                    {role === "admin" && (
                      <Link
                        href="/admin/verifications"
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary-light/50 rounded-xl transition-colors"
                      >
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>Quản trị duyệt thẻ</span>
                      </Link>
                    )}

                    <Link
                      href="/safety"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <Shield className="w-4 h-4 text-text-secondary shrink-0" />
                      <span>Cẩm nang an toàn</span>
                    </Link>

                    <Link
                      href="/support"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <LifeBuoy className="w-4 h-4 text-text-secondary shrink-0" />
                      <span>Hỗ trợ & Kháng nghị</span>
                    </Link>

                    <Link
                      href="/settings"
                      role="menuitem"
                      className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-muted rounded-xl transition-colors"
                    >
                      <Settings className="w-4 h-4 text-text-secondary shrink-0" />
                      <span>Cài đặt tài khoản</span>
                    </Link>
                  </div>

                  <div className="pt-1 border-t border-surface-border">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setDropdownOpen(false);
                        await logout();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-danger-solid hover:bg-danger-subtle/20 rounded-xl transition-colors"
                    >
                      <LogOut className="w-4 h-4 shrink-0" />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href={loginHref}
              className="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3 text-xs bg-surface-muted text-text-main hover:bg-surface-border border border-surface-border cursor-pointer select-none"
            >
              <User className="w-3.5 h-3.5 mr-1.5 text-text-secondary" />
              <span>Đăng nhập</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
