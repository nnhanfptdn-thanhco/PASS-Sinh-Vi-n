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
import {
  Zap,
  ShieldCheck,
  Search,
  Mail,
  HelpCircle,
} from "lucide-react";

export default function ShowcasePage() {
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [favorites, setFavorites] = React.useState<string[]>(["item-1"]);

  const toggleFav = (id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
      {/* Tiêu đề & Giới thiệu Design System */}
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
        <p className="text-sm text-text-secondary max-w-3xl leading-relaxed">
          Trang thử nghiệm các linh kiện giao diện mobile-first theo tài liệu đặc tả SPEC.md.
          Hỗ trợ chuyển đổi giữa 2 phương án màu chủ đạo (Xanh Ngọc Emerald vs Xanh Lam Ocean)
          và chế độ Sáng / Tối trên thanh công cụ góc trên bên phải.
        </p>
      </div>

      {/* 1. TYPOGRAPHY & KIỂM TRA DẤU TIẾNG VIỆT */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main flex items-center gap-2">
          <span>1. Typography & Kiểm tra Dấu Tiếng Việt (Be Vietnam Pro)</span>
        </h2>
        <div className="p-5 bg-surface border border-surface-border rounded-xl space-y-3">
          <p className="text-2xl font-bold font-heading text-text-main">
            Quạt đứng Senko, Nồi cơm điện Sharp, Bàn học sinh viên giá rẻ
          </p>
          <p className="text-base text-text-secondary">
            Kiểm tra hiển thị đầy đủ các dấu thanh tiếng Việt: ệ, ữ, ợ, ặ, ỹ, ề, ồ, ế, ẩ, ẫ, ử, ớ, ứ.
            Tất cả ký tự không bị lệch dòng, không bị cắt dấu và hiển thị sắc nét trên cả màn hình retina.
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-mono text-text-muted bg-surface-muted p-3 rounded-lg">
            <span>Font Body: Be Vietnam Pro</span> · 
            <span>Font Heading: Plus Jakarta Sans</span> · 
            <span>Line-height: 1.5</span>
          </div>
        </div>
      </section>

      {/* 2. BẢNG MÀU CHỦ ĐẠO & ĐẶC QUYỀN */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main flex items-center gap-2">
          <span>2. Nhận diện Màu sắc & Tương phản WCAG AA</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Màu chủ đạo */}
          <div className="p-4 bg-primary text-white rounded-xl shadow-subtle space-y-2">
            <span className="text-xs font-semibold opacity-90">Màu chủ đạo (Primary)</span>
            <div className="text-lg font-bold">Xanh Chủ đạo</div>
            <p className="text-xs opacity-80">
              Dịu mắt, tin cậy, không gắn với bất kỳ địa phương nào.
            </p>
          </div>

          {/* Màu Pass trong ngày */}
          <div className="p-4 bg-urgent-solid text-white rounded-xl shadow-subtle space-y-2">
            <span className="text-xs font-semibold opacity-90">Màu Nhấn Đặc quyền</span>
            <div className="text-lg font-bold flex items-center gap-1.5">
              <Zap className="w-5 h-5 fill-current" />
              <span>Pass Trong Ngày</span>
            </div>
            <p className="text-xs opacity-90">
              Vàng hổ phách ấm, nổi bật tức thì trong mùa ra trường gấp.
            </p>
          </div>

          {/* Màu Đã xác minh */}
          <div className="p-4 bg-verified-border text-white rounded-xl shadow-subtle space-y-2">
            <span className="text-xs font-semibold opacity-90">Chứng thực Thẻ SV</span>
            <div className="text-lg font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-5 h-5" />
              <span>Đã Xác Minh</span>
            </div>
            <p className="text-xs opacity-90">
              Xanh lá tin cậy, minh bạch danh tính sinh viên.
            </p>
          </div>

          {/* Nền & Bề mặt */}
          <div className="p-4 bg-surface text-text-main border border-surface-border rounded-xl shadow-subtle space-y-2">
            <span className="text-xs font-semibold text-text-muted">Bề mặt & Nền</span>
            <div className="text-lg font-bold">Surface / Card</div>
            <p className="text-xs text-text-secondary">
              Tương phản chữ/nền đạt 15.8:1 (vượt chuẩn WCAG AA 4.5:1).
            </p>
          </div>
        </div>
      </section>

      {/* 3. BUTTONS (VÙNG BẤM TỐI THIỂU 44PX) */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">
          3. Nút Bấm (Buttons - Touch Target &ge; 44px)
        </h2>
        <div className="p-5 bg-surface border border-surface-border rounded-xl space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Button variant="primary">Nút Chính (Primary)</Button>
            <Button variant="secondary">Nút Phụ (Secondary)</Button>
            <Button variant="outline">Đường Viền (Outline)</Button>
            <Button variant="urgent" leftIcon={<Zap className="w-4 h-4 fill-current" />}>
              Pass Gấp Trong Ngày
            </Button>
            <Button variant="verified" leftIcon={<ShieldCheck className="w-4 h-4" />}>
              Đã Xác Minh
            </Button>
            <Button variant="danger">Báo cáo vi phạm</Button>
            <Button variant="ghost">Bỏ qua</Button>
          </div>

          <div className="flex flex-wrap gap-3 items-center pt-3 border-t border-surface-border/60">
            <Button size="sm" variant="primary">Cỡ Nhỏ (sm)</Button>
            <Button size="md" variant="primary">Cỡ Chuẩn (md)</Button>
            <Button size="lg" variant="primary">Cỡ Lớn (lg)</Button>
            <Button variant="primary" isLoading>Đang xử lý</Button>
            <Button variant="primary" disabled>Bị vô hiệu hóa</Button>
          </div>
        </div>
      </section>

      {/* 4. INPUTS & FIELDS */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">
          4. Ô Nhập Liệu (Inputs & Fields)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5 bg-surface border border-surface-border rounded-xl">
          <Input
            label="Ô tìm kiếm nhanh"
            placeholder="Tìm quạt, bàn học, giáo trình..."
            leftIcon={<Search className="w-4 h-4" />}
          />
          <Input
            label="Email sinh viên (.edu.vn)"
            placeholder="nguyenvana@hcmut.edu.vn"
            helperText="Dùng email trường giúp duyệt hồ sơ nhanh hơn"
            leftIcon={<Mail className="w-4 h-4" />}
          />
          <Input
            label="Số Zalo liên hệ (bắt buộc)"
            placeholder="0912 345 678"
            error="Số điện thoại Zalo không hợp lệ"
          />
        </div>
      </section>

      {/* 5. HUY HIỆU & CHIP */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">
          5. Huy Hiệu & Nhãn Trạng Thái (Badges & Chips)
        </h2>
        <div className="flex flex-wrap gap-2.5 p-5 bg-surface border border-surface-border rounded-xl">
          <Badge variant="urgent">⚡ Pass trong ngày</Badge>
          <Badge variant="verified">✓ Đã xác minh SV</Badge>
          <Badge variant="ship">🚚 Có ship</Badge>
          <Badge variant="pickup">📍 Tự đến lấy</Badge>
          <Badge variant="sameSchool">🎓 Cùng trường</Badge>
          <Badge variant="near">📍 Cùng phường/xã</Badge>
          <Badge variant="graduating">🎓 Sắp tốt nghiệp</Badge>
          <Badge variant="outline">Mới 95%</Badge>
          <Badge variant="default">Đồ điện máy</Badge>
        </div>
      </section>

      {/* 6. THẺ TIN ĐĂNG (LISTING CARD - 4:3 RATIO) */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-heading font-bold text-text-main">
            6. Thẻ Tin Đăng (Khung ảnh 4:3, Trực quan, Không Vỡ Lưới)
          </h2>
          <span className="text-xs text-text-muted">Mô phỏng Responsive Grid</span>
        </div>

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

          <ListingCard
            id="item-2"
            title="Combo Giáo trình Giải tích 1 2 + Đại số tuyến tính kèm bài tập giải chi tiết"
            price={50000}
            originalPrice={160000}
            urgent={false}
            hasShipping={false}
            schoolName="ĐH Kinh Tế Quốc Dân"
            passDeadline="3 ngày nữa"
            proximity="sameWard"
            condition="Tốt (80%)"
            imageUrl="https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600&auto=format&fit=crop&q=80"
            isFavorite={favorites.includes("item-2")}
            onToggleFavorite={toggleFav}
          />

          <ListingCard
            id="item-3"
            title="Nồi cơm điện Cuckoo 1.8L còn bảo hành dùng tốt"
            price={220000}
            originalPrice={450000}
            urgent={true}
            hasShipping={true}
            schoolName="ĐH Quốc Gia Hà Nội"
            passDeadline="Hôm nay"
            proximity="sameCity"
            condition="Dùng tốt"
            imageUrl="https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80"
            isFavorite={favorites.includes("item-3")}
            onToggleFavorite={toggleFav}
          />
        </div>
      </section>

      {/* 7. TRẠNG THÁI CHỜ (SKELETON LOADING) */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">
          7. Trạng thái Đang Tải (Skeleton Loading State)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <SkeletonListingCard />
          <SkeletonListingCard />
          <SkeletonListingCard />
        </div>
      </section>

      {/* 8. TRẠNG THÁI TRỐNG (EMPTY STATE CHO PROD SẠCH) */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">
          8. Trạng thái Trống (Empty State - Không Tạo Dữ Liệu Ảo)
        </h2>
        <EmptyState
          title="Chưa có món đồ nào được đăng tại trường này"
          description="Bạn đang dọn phòng trọ hoặc chuẩn bị ra trường? Hãy đăng món đồ đầu tiên để kết nối với các bạn sinh viên nhé!"
          actionText="Đăng món đồ đầu tiên của trường bạn"
          actionHref="/listings/new"
        />
      </section>

      {/* 9. MODAL & BOTTOM SHEET TEST */}
      <section className="space-y-4">
        <h2 className="text-lg font-heading font-bold text-text-main">
          9. Cửa sổ Thoại (Modal / Bottom Sheet Mobile-First)
        </h2>
        <div className="p-5 bg-surface border border-surface-border rounded-xl flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-main">Thử nghiệm Bottom Sheet</h3>
            <p className="text-xs text-text-secondary">Trượt từ dưới lên trên Mobile, popup căn giữa trên Desktop.</p>
          </div>
          <Button variant="primary" onClick={() => setIsModalOpen(true)}>
            Mở Cửa Sổ Thử Nghiệm
          </Button>
        </div>

        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Xác thực thẻ sinh viên"
          description="Thông tin thẻ chỉ dùng để duyệt quyền đăng tin và mua bán an toàn."
        >
          <div className="space-y-4 text-sm text-text-secondary">
            <p>
              Hệ thống tuân thủ Nghị định 356/2025/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân.
              Ảnh thẻ sinh viên được lưu trữ trong thư mục riêng tư và tự động xóa sau 30 ngày.
            </p>
            <div className="p-3 bg-surface-muted rounded-lg flex items-start gap-2 text-xs">
              <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>
                Bạn có thể che bớt số CCCD hoặc ngày sinh, chỉ cần để rõ họ tên, mã số sinh viên và tên trường.
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                Đóng
              </Button>
              <Button variant="primary" onClick={() => setIsModalOpen(false)}>
                Tôi Đã Hiểu
              </Button>
            </div>
          </div>
        </Modal>
      </section>
    </div>
  );
}
