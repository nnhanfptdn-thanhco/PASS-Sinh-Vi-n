"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { ListingCard } from "@/components/ui/ListingCard";
import {
  Upload,
  Zap,
  ShieldAlert,
  ArrowRight,
  ArrowLeft,
  Check,
  MapPin,
  Truck,
  Building,
  Image as ImageIcon,
  DollarSign,
  Info,
  Clock,
  Trash2,
  Star,
  Eye,
} from "lucide-react";
import { compressAndAnalyzeImage } from "@/lib/utils/image";
import categoriesData from "../../../../data/categories.json";
import universitiesData from "../../../../data/universities_vietnam.json";

export default function NewListingPage() {
  const router = useRouter();
  const { user, profile } = useAuth();

  const [currentStep, setCurrentStep] = React.useState<1 | 2 | 3 | 4 | 5>(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Form State
  const [images, setImages] = React.useState<string[]>([]);
  const [coverIndex, setCoverIndex] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("dien-may");
  const [subcategory, setSubcategory] = React.useState("Quạt đứng / quạt bàn");
  const [condition, setCondition] = React.useState("Như mới (còn trên 90%)");
  const [brandModel, setBrandModel] = React.useState("");
  const [usageTime, setUsageTime] = React.useState("6 tháng");
  const [noDefects, setNoDefects] = React.useState(false);
  const [defects, setDefects] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pledgeClean, setPledgeClean] = React.useState(false);

  // Giá & hạn
  const [price, setPrice] = React.useState<number>(150000);
  const [originalPrice, setOriginalPrice] = React.useState<number | undefined>(300000);
  const [negotiationType, setNegotiationType] = React.useState<"fixed" | "slight" | "flexible">("slight");
  const [urgentPass, setUrgentPass] = React.useState(false);
  const [passDeadline, setPassDeadline] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split("T")[0];
  });

  // Giao nhận
  const [allowPickup, setAllowPickup] = React.useState(true);
  const [allowSellerShip, setAllowSellerShip] = React.useState(true);
  const [allowCarrier, setAllowCarrier] = React.useState(false);
  const [campusDelivery, setCampusDelivery] = React.useState(true);
  const [publicMeetingPoint, setPublicMeetingPoint] = React.useState("Cổng ký túc xá / Thư viện trường");
  const [exactAddress, setExactAddress] = React.useState("Phòng 402, Nhà B3, Ký túc xá");
  const [shipFee, setShipFee] = React.useState("Freeship nội trường, 15k bán kính 3km");
  const [isBulky, setIsBulky] = React.useState(false);
  const [itemWeight, setItemWeight] = React.useState("");
  const [itemDimensions, setItemDimensions] = React.useState("");

  // Kiểm tra lưu nháp (Auto-Save Draft)
  React.useEffect(() => {
    const draft = localStorage.getItem("listing_draft");
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.title) setTitle(parsed.title);
        if (parsed.price) setPrice(parsed.price);
        if (parsed.description) setDescription(parsed.description);
      } catch {
        // Bỏ qua lỗi draft
      }
    }
  }, []);

  // Tự động lưu nháp mỗi khi thay đổi
  React.useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(
        "listing_draft",
        JSON.stringify({ title, price, description, categoryId })
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [title, price, description, categoryId]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      if (images.length >= 10) break;
      try {
        const compressed = await compressAndAnalyzeImage(files[i], 1600, 0.85);
        setImages((prev) => [...prev, compressed.dataUrl]);
      } catch (err) {
        console.error("Lỗi nén ảnh:", err);
      }
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    if (coverIndex === index) setCoverIndex(0);
    else if (coverIndex > index) setCoverIndex((prev) => prev - 1);
  };

  const handleSubmit = async () => {
    if (images.length < 3) {
      alert("Vui lòng tải tối thiểu 3 ảnh thực tế của món đồ.");
      setCurrentStep(1);
      return;
    }
    if (!title || title.length < 10) {
      alert("Tên món đồ phải từ 10 ký tự trở lên.");
      setCurrentStep(2);
      return;
    }
    if (!pledgeClean) {
      alert("Vui lòng cam kết món đồ không thuộc danh sách hàng cấm.");
      setCurrentStep(2);
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedSchool = universitiesData[0];
      const payload = {
        sellerId: user?.uid || "demo-seller-id",
        sellerName: profile?.displayName || user?.displayName || "Sinh viên K21",
        title,
        categoryId,
        subcategory,
        condition,
        brandModel,
        usageTime,
        defects,
        noDefects,
        description,
        price,
        originalPrice,
        negotiationType,
        urgentPass,
        passDeadline,
        schoolCode: profile?.schoolCode || selectedSchool.code,
        campusId: profile?.campusId || "c1",
        provinceCode: profile?.provinceCode || selectedSchool.provinceCode,
        wardCode: profile?.wardCode || selectedSchool.wardCode,
        publicMeetingPoint,
        exactAddress,
        shippingMethods: {
          pickup: allowPickup,
          sellerDelivery: allowSellerShip,
          carrierShipping: allowCarrier,
          campusDelivery,
          shipFeeNote: shipFee,
        },
        itemDimensions: isBulky
          ? { weight: itemWeight, dimensions: itemDimensions }
          : null,
        images,
      };

      const res = await fetch("/api/listings/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Đăng tin thất bại");
        return;
      }

      localStorage.removeItem("listing_draft");
      router.push(`/my-listings`);
    } catch (err) {
      console.error("Lỗi đăng tin:", err);
      alert("Đã xảy ra lỗi khi tạo tin đăng.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCategory = categoriesData.find((c) => c.id === categoryId);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Tiêu đề & Thanh tiến độ 5 bước */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-text-main">
          Đăng Món Đồ Cần Pass
        </h1>
        <p className="text-xs text-text-secondary">
          Tiếp cận trực tiếp các bạn sinh viên cùng trường và các trường lân cận.
        </p>

        {/* Thanh 5 bước */}
        <div className="flex items-center justify-between max-w-lg mx-auto pt-4 text-xs">
          {[
            { num: 1, label: "Ảnh" },
            { num: 2, label: "Thông tin" },
            { num: 3, label: "Giá & Hạn" },
            { num: 4, label: "Giao nhận" },
            { num: 5, label: "Xem lại" },
          ].map((s) => (
            <div
              key={s.num}
              className={`flex flex-col items-center gap-1 cursor-pointer ${
                currentStep === s.num
                  ? "text-primary font-bold"
                  : currentStep > s.num
                  ? "text-verified-border font-semibold"
                  : "text-text-muted"
              }`}
              onClick={() => setCurrentStep(s.num as 1 | 2 | 3 | 4 | 5)}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs border-2 transition-all ${
                  currentStep === s.num
                    ? "border-primary bg-primary text-white"
                    : currentStep > s.num
                    ? "border-verified-border bg-verified-bg text-verified-border"
                    : "border-surface-border text-text-muted"
                }`}
              >
                {currentStep > s.num ? <Check className="w-3.5 h-3.5" /> : s.num}
              </div>
              <span className="hidden sm:inline text-[11px]">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FORM BODY */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card space-y-6">
        {/* BƯỚC 1: TẢI VÀ QUẢN LÝ ẢNH (3 - 10 ẢNH) */}
        {currentStep === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-primary" />
                  <span>Bước 1: Ảnh Món Đồ Thực Tế</span>
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Tải từ 3 đến 10 ảnh. Bấm biểu tượng ngôi sao để chọn làm ảnh bìa.
                </p>
              </div>
              <Badge variant={images.length >= 3 ? "verified" : "urgent"}>
                {images.length}/10 ảnh
              </Badge>
            </div>

            {/* Grid hiển thị ảnh */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {images.map((img, idx) => (
                <div
                  key={idx}
                  className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 group ${
                    coverIndex === idx
                      ? "border-primary shadow-subtle ring-2 ring-primary/20"
                      : "border-surface-border"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt={`Ảnh ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />

                  {/* Nút đặt ảnh bìa */}
                  <button
                    type="button"
                    onClick={() => setCoverIndex(idx)}
                    title={coverIndex === idx ? "Ảnh bìa hiện tại" : "Chọn làm ảnh bìa"}
                    className={`absolute top-1.5 left-1.5 p-1 rounded-md transition-colors ${
                      coverIndex === idx
                        ? "bg-primary text-white"
                        : "bg-black/50 text-white hover:bg-primary"
                    }`}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>

                  {/* Nút xóa ảnh */}
                  <button
                    type="button"
                    onClick={() => removeImage(idx)}
                    title="Xóa ảnh này"
                    className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white hover:bg-red-600 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {coverIndex === idx && (
                    <span className="absolute bottom-1 left-1.5 px-1.5 py-0.2 rounded bg-primary text-[10px] font-bold text-white">
                      Ảnh bìa
                    </span>
                  )}
                </div>
              ))}

              {/* Ô thêm ảnh mới */}
              {images.length < 10 && (
                <label className="border-2 border-dashed border-surface-border hover:border-primary rounded-xl aspect-[4/3] flex flex-col items-center justify-center gap-1.5 cursor-pointer bg-surface hover:bg-surface-muted/40 transition-colors text-center p-2">
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleImageUpload}
                  />
                  <div className="w-9 h-9 rounded-full bg-primary-light flex items-center justify-center text-primary">
                    <Upload className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold text-text-main">
                    Thêm ảnh
                  </span>
                  <span className="text-[10px] text-text-muted">
                    Canvas WebP &le; 5MB
                  </span>
                </label>
              )}
            </div>

            {images.length < 3 && (
              <p className="text-xs text-amber-600 font-medium">
                * Vui lòng tải tối thiểu 3 ảnh góc khác nhau (mặt trước, mặt sau, chi tiết lỗi nếu có).
              </p>
            )}

            <div className="flex justify-end pt-4">
              <Button
                variant="primary"
                size="md"
                disabled={images.length < 3}
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => setCurrentStep(2)}
              >
                Tiếp Tục: Thông Tin
              </Button>
            </div>
          </div>
        )}

        {/* BƯỚC 2: THÔNG TIN CHI TIẾT */}
        {currentStep === 2 && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <Info className="w-5 h-5 text-primary" />
              <span>Bước 2: Thông Tin Chi Tiết Món Đồ</span>
            </h3>

            <Input
              label="Tên món đồ (10 - 80 ký tự) *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ví dụ: Quạt đứng Senko lồng sóc màu xám còn rất mới"
              helperText="Không viết hoa toàn bộ, không chứa số điện thoại hoặc link web"
            />

            {/* Danh mục 2 cấp */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Danh mục chính *
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    const cat = categoriesData.find((c) => c.id === e.target.value);
                    if (cat?.subcategories?.[0]) setSubcategory(cat.subcategories[0]);
                  }}
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {categoriesData.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Phân loại chi tiết *
                </label>
                <select
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {currentCategory?.subcategories.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tình trạng 5 mức kèm giải thích */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-main">
                Tình trạng món đồ *
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="Mới 100%">Mới 100% (Chưa qua sử dụng, còn nguyên hộp/tem)</option>
                <option value="Như mới (còn trên 90%)">Như mới (còn trên 90%, không trầy xước)</option>
                <option value="Tốt (70 đến 90%)">Tốt (70 đến 90%, hoạt động ổn định, xước nhẹ)</option>
                <option value="Dùng được (50 đến 70%)">Dùng được (50 đến 70%, ngoại hình cũ nhưng đủ chức năng)</option>
                <option value="Cũ hoặc cần sửa">Cũ hoặc cần sửa (Pass giá xác / cần thay phụ tùng)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Hãng sản xuất / Model"
                value={brandModel}
                onChange={(e) => setBrandModel(e.target.value)}
                placeholder="Senko, Sharp, Casio, Sunhouse..."
              />
              <Input
                label="Thời gian đã sử dụng *"
                value={usageTime}
                onChange={(e) => setUsageTime(e.target.value)}
                placeholder="3 tháng / 1 học kỳ / 2 năm..."
              />
            </div>

            {/* Khuyết điểm đã biết */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-text-main">
                  Khuyết điểm đã biết (nếu có)
                </label>
                <label className="flex items-center gap-1.5 text-xs text-primary font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noDefects}
                    onChange={(e) => {
                      setNoDefects(e.target.checked);
                      if (e.target.checked) setDefects("");
                    }}
                    className="rounded border-surface-border text-primary focus:ring-primary"
                  />
                  <span>Món đồ không có lỗi</span>
                </label>
              </div>
              {!noDefects && (
                <Input
                  value={defects}
                  onChange={(e) => setDefects(e.target.value)}
                  placeholder="Ví dụ: Vỏ hơi xước, mất nắp pin, dây nguồn hơi ngắn..."
                  helperText="Mô tả trung thực giúp bạn bán nhanh hơn và được đánh giá 5 sao"
                />
              )}
            </div>

            {/* Mô tả chi tiết */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-main">
                Mô tả chi tiết (30 - 1000 ký tự) *
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Mô tả lý do pass (chuyển trọ, đổi đồ mới...), chức năng hoạt động, tặng kèm thêm đồ gì..."
                className="w-full p-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-[11px] text-text-muted">
                {description.length}/1000 ký tự
              </span>
            </div>

            {/* Cam kết hàng sạch */}
            <div className="p-3.5 bg-surface-muted rounded-xl border border-surface-border space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-text-main">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>Danh mục hàng cấm nghiêm ngặt:</span>
              </div>
              <p className="text-[11px] text-text-secondary">
                Tuyệt đối không đăng: Hàng gian / trộm cắp, vũ khí, thuốc điều trị, đồ có giới hạn độ tuổi, động vật sống, CCCD/giấy tờ tùy thân, tài khoản/thiết bị bị dính iCloud.
              </p>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-text-main pt-1">
                <input
                  type="checkbox"
                  checked={pledgeClean}
                  onChange={(e) => setPledgeClean(e.target.checked)}
                  className="rounded border-surface-border text-primary focus:ring-primary"
                />
                <span>Tôi cam kết món đồ thuộc sở hữu của tôi và mô tả đúng sự thật.</span>
              </label>
            </div>

            <div className="flex justify-between pt-4">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => setCurrentStep(1)}
              >
                Quay Lại: Ảnh
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={title.length < 10 || !pledgeClean}
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => setCurrentStep(3)}
              >
                Tiếp Tục: Giá & Hạn
              </Button>
            </div>
          </div>
        )}

        {/* BƯỚC 3: GIÁ & HẠN PASS */}
        {currentStep === 3 && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              <span>Bước 3: Giá Pass & Hạn Cần Pass</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Giá pass (VNĐ) *
                </label>
                <input
                  type="number"
                  step={1000}
                  min={0}
                  max={500000000}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-base font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-xs text-text-muted">
                  {price === 0 ? "Tặng miễn phí" : `${price.toLocaleString()} VNĐ`}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Giá khi mua mới (tùy chọn)
                </label>
                <input
                  type="number"
                  step={1000}
                  min={price}
                  value={originalPrice || ""}
                  onChange={(e) => setOriginalPrice(Number(e.target.value) || undefined)}
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="350000"
                />
                {originalPrice && originalPrice > price && (
                  <span className="text-xs text-urgent-solid font-semibold">
                    Đã giảm: {Math.round(((originalPrice - price) / originalPrice) * 100)}%
                  </span>
                )}
              </div>
            </div>

            {/* Kiểu thương lượng */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-main">
                Mức độ thương lượng giá *
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "fixed", label: "Giá cố định" },
                  { id: "slight", label: "Bớt nhẹ xăng xe" },
                  { id: "flexible", label: "Thoải mái thương lượng" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setNegotiationType(
                        item.id as "fixed" | "slight" | "flexible"
                      )
                    }
                    className={`p-3 rounded-xl border text-xs font-semibold text-center transition-all ${
                      negotiationType === item.id
                        ? "border-primary bg-primary-light text-primary ring-2 ring-primary/20"
                        : "border-surface-border hover:bg-surface-muted text-text-secondary"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Công tắc "Pass trong ngày" đặc quyền */}
            <div className="p-4 rounded-xl border border-urgent-border/60 bg-urgent-bg/30 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-urgent-solid text-sm">
                  <Zap className="w-4 h-4 fill-current" />
                  <span>Bật nhãn &ldquo;Pass Trong Ngày&rdquo;</span>
                </div>
                <p className="text-xs text-text-secondary">
                  Hiển thị huy hiệu nổi bật màu vàng hổ phách trên trang chủ và ưu tiên người mua lấy gấp.
                </p>
              </div>
              <input
                type="checkbox"
                checked={urgentPass}
                onChange={(e) => setUrgentPass(e.target.checked)}
                className="w-5 h-5 rounded text-urgent-solid focus:ring-urgent-solid"
              />
            </div>

            {/* Hạn cần pass */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-main flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-primary" />
                <span>Hạn chót cần pass (múi giờ Việt Nam) *</span>
              </label>
              <input
                type="date"
                value={passDeadline}
                onChange={(e) => setPassDeadline(e.target.value)}
                className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-[11px] text-text-muted">
                Tin sẽ tự động hết hạn sau ngày này. Hệ thống sẽ gửi thông báo nhắc bạn gia hạn trước 2 ngày.
              </span>
            </div>

            <div className="flex justify-between pt-4">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => setCurrentStep(2)}
              >
                Quay Lại: Thông Tin
              </Button>
              <Button
                variant="primary"
                size="md"
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => setCurrentStep(4)}
              >
                Tiếp Tục: Giao Nhận
              </Button>
            </div>
          </div>
        )}

        {/* BƯỚC 4: KHỐI GIAO NHẬN */}
        {currentStep === 4 && (
          <div className="space-y-5">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              <span>Bước 4: Phương Thức Giao Nhận & Địa Điểm Hẹn</span>
            </h3>

            {/* Lựa chọn phương thức giao nhận */}
            <div className="space-y-3">
              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-surface-border hover:bg-surface-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPickup}
                  onChange={(e) => setAllowPickup(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-primary focus:ring-primary"
                />
                <div className="text-xs">
                  <span className="font-bold text-text-main block">
                    1. Người mua tự đến lấy hàng (Phổ biến nhất)
                  </span>
                  <span className="text-text-muted">
                    Hẹn gặp tại khuôn viên trường, cổng KTX hoặc quán cà phê gần trọ.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-surface-border hover:bg-surface-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSellerShip}
                  onChange={(e) => setAllowSellerShip(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-primary focus:ring-primary"
                />
                <div className="text-xs">
                  <span className="font-bold text-text-main block">
                    2. Người bán tự đi ship (Nội thành / nội tỉnh)
                  </span>
                  <span className="text-text-muted">
                    Bạn tự chở đồ đến tận nơi cho người mua.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-surface-border hover:bg-surface-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowCarrier}
                  onChange={(e) => setAllowCarrier(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-primary focus:ring-primary"
                />
                <div className="text-xs">
                  <span className="font-bold text-text-main block">
                    3. Gửi qua đơn vị vận chuyển (Viettel Post, GHTK, SPX...)
                  </span>
                  <span className="text-text-muted">
                    Phù hợp giáo trình hoặc đồ nhẹ chuyển liên tỉnh. Người mua trả phí ship.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-surface-border hover:bg-surface-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={campusDelivery}
                  onChange={(e) => setCampusDelivery(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-primary focus:ring-primary"
                />
                <div className="text-xs">
                  <span className="font-bold text-text-main block">
                    4. Giao tận tay trong khuôn viên trường / KTX
                  </span>
                  <span className="text-text-muted">
                    Hẹn gặp tại hành lang giảng đường, căn tin hoặc phòng tự học.
                  </span>
                </div>
              </label>
            </div>

            {/* Chi tiết phí giao hàng */}
            {allowSellerShip && (
              <Input
                label="Ghi chú phí ship / khu vực giao"
                value={shipFee}
                onChange={(e) => setShipFee(e.target.value)}
                placeholder="Freeship nội trường, 15k bán kính 3km..."
                helperText="Nêu rõ mức phí để người mua không phải hỏi lại"
              />
            )}

            {/* Điểm hẹn công khai vs Địa chỉ chính xác bí mật */}
            <div className="space-y-4 pt-2 border-t border-surface-border">
              <Input
                label="Điểm hẹn công khai (Hiển thị cho tất cả mọi người) *"
                value={publicMeetingPoint}
                onChange={(e) => setPublicMeetingPoint(e.target.value)}
                placeholder="Cổng KTX Khu B, Cổng 1 trường Bách Khoa..."
                leftIcon={<Building className="w-4 h-4" />}
                helperText="Điểm hẹn chung, an toàn nơi đông người vào ban ngày"
              />

              <Input
                label="Địa chỉ phòng/nhà chính xác (BẢO MẬT - ẨN MẶC ĐỊNH) *"
                value={exactAddress}
                onChange={(e) => setExactAddress(e.target.value)}
                placeholder="Phòng 304 KTX, Số 12 Hẻm 45 Đường..."
                leftIcon={<MapPin className="w-4 h-4 text-amber-600" />}
                helperText="Chỉ hiển thị cho người mua sau khi bạn duyệt xác nhận giữ chỗ"
              />
            </div>

            {/* Món đồ cồng kềnh */}
            <div className="p-3.5 bg-surface-muted rounded-xl space-y-3 border border-surface-border">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-text-main">
                <input
                  type="checkbox"
                  checked={isBulky}
                  onChange={(e) => setIsBulky(e.target.checked)}
                  className="rounded border-surface-border text-primary focus:ring-primary"
                />
                <span>Món đồ lớn / cồng kềnh (Tủ lạnh, bàn học, tủ gỗ, xe máy)</span>
              </label>

              {isBulky && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <Input
                    label="Kích thước ước tính (Dài x Rộng x Cao)"
                    value={itemDimensions}
                    onChange={(e) => setItemDimensions(e.target.value)}
                    placeholder="120 x 60 x 75 cm"
                  />
                  <Input
                    label="Cân nặng ước tính"
                    value={itemWeight}
                    onChange={(e) => setItemWeight(e.target.value)}
                    placeholder="Khoảng 15 kg (cần 2 người khiêng)"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => setCurrentStep(3)}
              >
                Quay Lại: Giá
              </Button>
              <Button
                variant="primary"
                size="md"
                rightIcon={<Eye className="w-4 h-4" />}
                onClick={() => setCurrentStep(5)}
              >
                Xem Trước Tin Đăng
              </Button>
            </div>
          </div>
        )}

        {/* BƯỚC 5: XEM LẠI BẢN PREVIEW TRƯỚC KHI ĐĂNG */}
        {currentStep === 5 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <Eye className="w-5 h-5 text-primary" />
                <span>Bước 5: Xem Lại Tin Đăng Của Bạn</span>
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">
                Kiểm tra giao diện thẻ tin đúng như người mua sinh viên sẽ nhìn thấy.
              </p>
            </div>

            {/* Preview Card */}
            <div className="max-w-sm mx-auto">
              <ListingCard
                id="preview-id"
                title={title || "Tên món đồ của bạn"}
                price={price}
                originalPrice={originalPrice}
                imageUrl={images[coverIndex] || images[0]}
                urgent={urgentPass}
                hasShipping={allowSellerShip || allowCarrier}
                schoolName={profile?.schoolName || "ĐH Bách Khoa TP.HCM"}
                passDeadline={urgentPass ? "Hôm nay" : passDeadline}
                proximity="sameSchool"
                campusDelivery={campusDelivery}
                condition={condition}
              />
            </div>

            {/* Bảng tóm tắt thông tin chi tiết */}
            <div className="p-4 bg-surface-muted rounded-xl space-y-2 text-xs text-text-secondary border border-surface-border">
              <div className="flex justify-between">
                <span>Điểm hẹn công khai:</span>
                <span className="font-semibold text-text-main">{publicMeetingPoint}</span>
              </div>
              <div className="flex justify-between">
                <span>Thương lượng:</span>
                <span className="font-semibold text-text-main">
                  {negotiationType === "fixed"
                    ? "Giá cố định"
                    : negotiationType === "slight"
                    ? "Bớt nhẹ"
                    : "Thoải mái thương lượng"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tình trạng lỗi:</span>
                <span className="font-semibold text-text-main">
                  {noDefects ? "Không có lỗi" : defects || "Không có lỗi"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Số lượng ảnh:</span>
                <span className="font-semibold text-text-main">{images.length} ảnh WebP</span>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-surface-border">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => setCurrentStep(4)}
              >
                Chỉnh Sửa Thêm
              </Button>
              <Button
                variant="urgent"
                size="lg"
                isLoading={isSubmitting}
                rightIcon={<Check className="w-5 h-5" />}
                onClick={handleSubmit}
              >
                Xác Nhận & Đăng Tin Ngay
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
