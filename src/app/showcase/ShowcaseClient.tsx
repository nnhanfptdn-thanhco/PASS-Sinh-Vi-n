"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ListingCard } from "@/components/ui/ListingCard";
import { SkeletonListingCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Zap, ShieldCheck, Search, Mail, HelpCircle } from "lucide-react";

export default function ShowcaseClient() {
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [favorites, setFavorites] = React.useState<string[]>(["item-1"]);

  const toggleFav = (id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
      <div className="space-y-3 border-b border-surface-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Design System & Tokens v1.0
            </span>
            <h1 className="text-2xl sm:text-3xl font-heading font-black text-text-main mt-1">
              Thử nghiệm Thành phần Giao diện Chợ Pass SV
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle showPaletteSwitcher={true} />
            <Badge variant="verified" className="text-sm px-3 py-1">
              Chuẩn WCAG AA (Contrast &ge; 4.5:1)
            </Badge>
          </div>
        </div>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">Nút bấm & Input</h2>
        <div className="p-5 bg-surface border border-surface-border rounded-xl space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="urgent" leftIcon={<Zap className="w-4 h-4 fill-current" />}>
              Pass Gấp
            </Button>
            <Button variant="verified" leftIcon={<ShieldCheck className="w-4 h-4" />}>
              Đã Xác Minh
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Tìm kiếm" placeholder="Tìm quạt, bàn học..." leftIcon={<Search className="w-4 h-4" />} />
            <Input label="Email" placeholder="sv@hcmut.edu.vn" leftIcon={<Mail className="w-4 h-4" />} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">Listing Card & Skeleton</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <ListingCard
            id="item-1"
            title="Quạt đứng Senko công suất lớn lồng sóc còn rất mới"
            price={180000}
            originalPrice={350000}
            urgent={true}
            hasShipping={true}
            schoolName="ĐH Bách Khoa TP.HCM"
            passDeadline="Hôm nay"
            proximity="sameSchool"
            campusDelivery={true}
            condition="Như mới (95%)"
            imageUrl="https://images.unsplash.com/photo-1618941709405-b0b30bb63214?w=600&auto=format&fit=crop&q=80"
            isFavorite={favorites.includes("item-1")}
            onToggleFavorite={toggleFav}
          />
          <SkeletonListingCard />
          <EmptyState
            title="Chưa có món đồ nào"
            description="Hãy đăng món đồ đầu tiên!"
            actionText="Đăng tin"
            actionHref="/listings/new"
          />
        </div>
      </section>

      <section className="space-y-4">
        <Button variant="primary" onClick={() => setIsModalOpen(true)}>
          Mở Modal Thử Nghiệm
        </Button>
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Xác thực thẻ sinh viên"
        >
          <div className="space-y-4 text-sm text-text-secondary">
            <div className="p-3 bg-surface-muted rounded-lg flex items-start gap-2 text-xs">
              <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>Ảnh thẻ sinh viên được lưu riêng tư và tự động xóa sau 30 ngày kể từ ngày quyết định.</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="primary" onClick={() => setIsModalOpen(false)}>Đóng</Button>
            </div>
          </div>
        </Modal>
      </section>
    </div>
  );
}
