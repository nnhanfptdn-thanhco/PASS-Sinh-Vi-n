import * as React from "react";
import Link from "next/link";
import {
  Search,
  MapPin,
  GraduationCap,
  Sparkles,
  BookOpen,
  Tv,
  Bike,
  Coffee,
  Armchair,
  Layers,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export default function HomePage() {
  const categories = [
    { name: "Điện máy", icon: Tv, slug: "dien-may" },
    { name: "Sách & Giáo trình", icon: BookOpen, slug: "giao-trinh" },
    { name: "Bàn & Ghế", icon: Armchair, slug: "noi-that" },
    { name: "Xe cộ", icon: Bike, slug: "xe-co" },
    { name: "Đồ bếp", icon: Coffee, slug: "do-bep" },
    { name: "Tất cả", icon: Layers, slug: "all" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6 space-y-8">
      {/* Banner chào mừng sinh viên */}
      <div className="bg-gradient-to-r from-primary-light via-surface to-urgent-bg/30 border border-primary/20 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-subtle">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 shadow-sm">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm sm:text-base font-heading font-bold text-text-main flex items-center gap-2">
              Chào mừng bạn đến với Chợ Pass Sinh Viên!
              <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-verified-bg text-verified-text border border-verified-border">
                Uy tín 100%
              </span>
            </h4>
            <p className="text-xs text-text-secondary mt-0.5">
              Cộng đồng pass đồ cũ chính chủ giữa sinh viên. Xác minh thẻ SV để xem liên hệ và giữ chỗ món đồ ưng ý.
            </p>
          </div>
        </div>
        <Link href="/listings/new" className="shrink-0">
          <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-4 h-4" />}>
            Đăng món đồ ngay
          </Button>
        </Link>
      </div>

      {/* Hero Section & Tìm kiếm lớn */}
      <section className="text-center space-y-4 pt-2 pb-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface border border-surface-border text-xs font-semibold text-text-secondary shadow-subtle">
          <GraduationCap className="w-4 h-4 text-primary" />
          <span>Chợ đồ cũ sinh viên toàn quốc · 100% Thẻ SV xác thực</span>
        </div>

        <h1 className="text-2xl sm:text-4xl font-heading font-extrabold tracking-tight text-text-main max-w-2xl mx-auto">
          Pass nhanh đồ cũ, chuyển trọ nhẹ tênh cùng sinh viên cả nước
        </h1>
        <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto">
          Mua bán an tâm giữa sinh viên cùng trường, cùng phường/xã. Quạt, bàn học, nồi cơm, giáo trình pass giá hạt dẻ.
        </p>

        {/* Thanh tìm kiếm trung tâm */}
        <div className="max-w-2xl mx-auto mt-4">
          <div className="relative flex items-center bg-surface border-2 border-primary/40 focus-within:border-primary rounded-2xl shadow-card p-1.5 transition-all">
            <Search className="w-5 h-5 text-text-muted ml-3 shrink-0" />
            <input
              type="text"
              placeholder="Tìm quạt đứng, nồi cơm, giáo trình giải tích..."
              className="w-full bg-transparent px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none"
            />
            <Button variant="primary" size="md" className="rounded-xl shrink-0">
              Tìm kiếm
            </Button>
          </div>
        </div>

        {/* Lối chọn nhanh khu vực */}
        <div className="flex items-center justify-center gap-2 text-xs text-text-secondary flex-wrap pt-1">
          <span className="flex items-center gap-1 font-medium">
            <MapPin className="w-3.5 h-3.5 text-primary" />
            <span>Khu vực ưu tiên:</span>
          </span>
          <button className="px-2.5 py-1 rounded-full bg-surface border border-surface-border font-medium hover:border-primary transition-colors">
            TP. Hồ Chí Minh
          </button>
          <button className="px-2.5 py-1 rounded-full bg-surface border border-surface-border font-medium hover:border-primary transition-colors">
            Hà Nội
          </button>
          <button className="px-2.5 py-1 rounded-full bg-surface border border-surface-border font-medium hover:border-primary transition-colors">
            Đà Nẵng
          </button>
          <button className="text-primary font-semibold hover:underline">
            Đổi tỉnh/thành khác &rarr;
          </button>
        </div>
      </section>

      {/* Danh mục nhanh */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-text-main flex items-center justify-between">
          <span>Danh mục món đồ</span>
          <Link href="/search" className="text-xs text-primary font-semibold hover:underline">
            Xem tất cả
          </Link>
        </h2>

        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <Link
                key={cat.slug}
                href={`/search?category=${cat.slug}`}
                className="flex flex-col items-center justify-center p-3.5 bg-surface border border-surface-border rounded-xl hover:border-primary/50 hover:shadow-subtle transition-all group"
              >
                <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-text-main mt-2 text-center group-hover:text-primary transition-colors">
                  {cat.name}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Bộ lọc nhanh */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
        <Badge variant="urgent" className="cursor-pointer py-1.5 px-3">
          ⚡ Pass trong ngày
        </Badge>
        <Badge variant="ship" className="cursor-pointer py-1.5 px-3">
          🚚 Có ship
        </Badge>
        <Badge variant="sameSchool" className="cursor-pointer py-1.5 px-3">
          🎓 Cùng trường của tôi
        </Badge>
        <Badge variant="pickup" className="cursor-pointer py-1.5 px-3">
          📍 Tự đến lấy
        </Badge>
      </div>

      {/* Danh sách tin đăng: Chuẩn trạng thái Empty State theo SPEC */}
      <section className="space-y-4 pt-4 border-t border-surface-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-text-main">
              Tin đăng mới quanh bạn
            </h2>
            <Badge variant="near">Toàn quốc</Badge>
          </div>
          <span className="text-xs text-text-muted">Cập nhật liên tục</span>
        </div>

        {/* Đúng yêu cầu SPEC: Không có tin đăng giả trên production -> Hiển thị Empty State chuẩn chỉnh */}
        <EmptyState
          title="Chưa có món đồ nào được đăng quanh khu vực này"
          description="Hệ thống không tạo dữ liệu giả. Hãy là sinh viên đầu tiên đăng món đồ hoặc giáo trình cần pass của trường bạn nhé!"
          actionText="Đăng món đồ đầu tiên của trường bạn"
          actionHref="/listings/new"
        />
      </section>
    </div>
  );
}
