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
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { RequireVerified } from "@/components/auth/RequireVerified";
import { storage, authFetch } from "@/lib/firebase/client";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { compressListingImage } from "@/lib/image/compress";
import { todayVN, addDaysVN } from "@/lib/utils/date";
import categoriesData from "../../../../data/categories.json";

interface UploadedImageItem {
  id: string;
  previewUrl: string;
  storageUrl?: string;
  thumbUrl?: string;
  storagePath?: string;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

// Tạo ảnh thumbnail 480px phía client
async function createThumbBlob(file: File, maxEdge = 320, quality = 0.7): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Không thể giải mã ảnh để tạo thumbnail"));
      img.src = url;
    });
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxEdge || h > maxEdge) {
      if (w > h) {
        h = Math.round((h * maxEdge) / w);
        w = maxEdge;
      } else {
        w = Math.round((w * maxEdge) / h);
        h = maxEdge;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas không hỗ trợ");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Lỗi toBlob"))), "image/webp", quality);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function NewListingPage() {
  const router = useRouter();
  const { user, profile } = useAuth();

  const [currentStep, setCurrentStep] = React.useState<1 | 2 | 3 | 4 | 5>(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [stepError, setStepError] = React.useState<string | null>(null);

  // Sinh draftId cố định cho phiên đăng tin
  const draftId = React.useMemo(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `draft_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }, []);

  // Form State
  const [imageItems, setImageItems] = React.useState<UploadedImageItem[]>([]);
  const [coverIndex, setCoverIndex] = React.useState(0);
  const [title, setTitle] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("dien-may");
  const [subcategory, setSubcategory] = React.useState("Quạt đứng / quạt bàn");
  const [condition, setCondition] = React.useState("Như mới (còn trên 90%)");
  const [brandModel, setBrandModel] = React.useState("");
  const [usageTime, setUsageTime] = React.useState("");
  const [noDefects, setNoDefects] = React.useState(false);
  const [defects, setDefects] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [pledgeClean, setPledgeClean] = React.useState(false);

  // Giá & hạn
  const [price, setPrice] = React.useState<number>(0);
  const [originalPrice, setOriginalPrice] = React.useState<number | undefined>(undefined);
  const [negotiationType, setNegotiationType] = React.useState<"fixed" | "slight" | "flexible">("slight");
  const [urgentPass, setUrgentPass] = React.useState(false);
  const [passDeadline, setPassDeadline] = React.useState(() => addDaysVN(todayVN(), 3));

  // Giao nhận
  const [allowPickup, setAllowPickup] = React.useState(true);
  const [allowSellerShip, setAllowSellerShip] = React.useState(false);
  const [allowCarrier, setAllowCarrier] = React.useState(false);
  const [campusDelivery, setCampusDelivery] = React.useState(true);
  const [publicMeetingPoint, setPublicMeetingPoint] = React.useState("");
  const [exactAddress, setExactAddress] = React.useState("");
  const [shipFee, setShipFee] = React.useState("");
  const [isBulky, setIsBulky] = React.useState(false);
  const [itemWeight, setItemWeight] = React.useState("");
  const [itemDimensions, setItemDimensions] = React.useState("");

  // Tự động chuyển hạn pass về hôm nay khi bật "Pass trong ngày"
  React.useEffect(() => {
    if (urgentPass) {
      setPassDeadline(todayVN());
    } else {
      setPassDeadline(addDaysVN(todayVN(), 3));
    }
  }, [urgentPass]);

  // Kiểm tra lưu nháp (Auto-Save Draft gắn theo uid)
  React.useEffect(() => {
    if (!user?.uid || typeof window === "undefined") return;
    const draftKey = `listing_draft_${user.uid}`;
    const draft = localStorage.getItem(draftKey);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.title) setTitle(parsed.title);
        if (parsed.categoryId) setCategoryId(parsed.categoryId);
        if (parsed.subcategory) setSubcategory(parsed.subcategory);
        if (parsed.condition) setCondition(parsed.condition);
        if (parsed.brandModel) setBrandModel(parsed.brandModel);
        if (parsed.usageTime) setUsageTime(parsed.usageTime);
        if (parsed.price !== undefined) setPrice(parsed.price);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.publicMeetingPoint) setPublicMeetingPoint(parsed.publicMeetingPoint);
      } catch {
        // Bỏ qua lỗi draft
      }
    }
  }, [user?.uid]);

  // Tự động lưu nháp mỗi khi thay đổi
  React.useEffect(() => {
    if (!user?.uid || typeof window === "undefined") return;
    const timer = setTimeout(() => {
      localStorage.setItem(
        `listing_draft_${user.uid}`,
        JSON.stringify({
          title,
          price,
          description,
          categoryId,
          subcategory,
          condition,
          brandModel,
          usageTime,
          publicMeetingPoint,
        })
      );
    }, 1200);
    return () => clearTimeout(timer);
  }, [user?.uid, title, price, description, categoryId, subcategory, condition, brandModel, usageTime, publicMeetingPoint]);

  // Xử lý nén và tải ảnh lên Firebase Storage
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user?.uid) return;
    setStepError(null);

    const availableSlots = 10 - imageItems.length;
    const filesToUpload = Array.from(files).slice(0, availableSlots);

    for (const file of filesToUpload) {
      const localId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const previewUrl = URL.createObjectURL(file);

      const newItem: UploadedImageItem = {
        id: localId,
        previewUrl,
        status: "uploading",
        progress: 10,
      };

      setImageItems((prev) => [...prev, newItem]);

      try {
        setImageItems((prev) => prev.map((it) => (it.id === localId ? { ...it, progress: 30 } : it)));
        const compressed = await compressListingImage(file);
        const thumbBlob = await createThumbBlob(file);

        const ext = compressed.extension || (compressed.mimeType === "image/jpeg" ? "jpg" : "webp");
        const contentType = compressed.mimeType || (ext === "jpg" ? "image/jpeg" : "image/webp");

        const base = `public/listings/${user.uid}/${draftId}`;
        const mainPath = `${base}/${localId}.${ext}`;
        const thumbPath = `${base}/${localId}_t.webp`;

        let mainUrl = "";
        let thumbUrl = "";
        let storagePath = mainPath;

        try {
          const uploadPromise = Promise.all([
            uploadBytes(ref(storage, mainPath), compressed.blob, { contentType }),
            uploadBytes(ref(storage, thumbPath), thumbBlob, { contentType: "image/webp" }),
          ]);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("STORAGE_TIMEOUT")), 6000)
          );
          const [mainSnap, thumbSnap] = await Promise.race([uploadPromise, timeoutPromise]);
          const [mUrl, tUrl] = await Promise.all([
            getDownloadURL(mainSnap.ref),
            getDownloadURL(thumbSnap.ref),
          ]);
          mainUrl = mUrl;
          thumbUrl = tUrl;
        } catch {
          console.warn("Upload Storage quá 6s hoặc chưa kích hoạt, chuyển sang Base64 WebP nhẹ:");
          const reader = new FileReader();
          mainUrl = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(compressed.blob);
          });
          const thumbReader = new FileReader();
          thumbUrl = await new Promise<string>((resolve, reject) => {
            thumbReader.onloadend = () => resolve(thumbReader.result as string);
            thumbReader.onerror = reject;
            thumbReader.readAsDataURL(thumbBlob);
          });
          storagePath = `data/${localId}.webp`;
        }

        setImageItems((prev) =>
          prev.map((it) =>
            it.id === localId
              ? {
                  ...it,
                  status: "done",
                  progress: 100,
                  storageUrl: mainUrl,
                  thumbUrl,
                  storagePath,
                }
              : it
          )
        );
      } catch (err: unknown) {
        console.error("Lỗi tải ảnh:", err);
        const msg = err instanceof Error ? err.message : "Không thể nén hoặc tải ảnh";
        setImageItems((prev) =>
          prev.map((item) =>
            item.id === localId ? { ...item, status: "error", error: msg } : item
          )
        );
      }
    }
  };

  const removeImage = async (index: number) => {
    const item = imageItems[index];
    if (item) {
      if (item.storagePath && !item.storagePath.startsWith("data/")) {
        deleteObject(ref(storage, item.storagePath)).catch(() => {});
        const thumbPath = item.storagePath.replace(/\.(webp|jpg)$/, "_t.webp");
        deleteObject(ref(storage, thumbPath)).catch(() => {});
      }
      URL.revokeObjectURL(item.previewUrl);
    }
    setImageItems((prev) => prev.filter((_, i) => i !== index));
    if (coverIndex === index) setCoverIndex(0);
    else if (coverIndex > index) setCoverIndex((prev) => prev - 1);
  };

  const doneImages = imageItems.filter((i) => i.status === "done" && i.storageUrl);

  const validateStep = (step: number): boolean => {
    setStepError(null);
    if (step === 1) {
      if (doneImages.length < 1) {
        setStepError("Vui lòng tải lên tối thiểu 1 ảnh thực tế của món đồ.");
        return false;
      }
      const uploadingCount = imageItems.filter((i) => i.status === "uploading").length;
      if (uploadingCount > 0) {
        setStepError("Vui lòng chờ các ảnh đang tải hoàn tất trước khi tiếp tục.");
        return false;
      }
    }
    if (step === 2) {
      if (title.trim().length < 10) {
        setStepError("Tên món đồ phải từ 10 đến 80 ký tự.");
        return false;
      }
      if (!pledgeClean) {
        setStepError("Vui lòng cam kết món đồ thuộc sở hữu của bạn và không thuộc danh mục hàng cấm.");
        return false;
      }
    }
    if (step === 3) {
      if (price < 0 || price > 500000000) {
        setStepError("Giá pass không hợp lệ (từ 0 đ đến 500.000.000 đ).");
        return false;
      }
      if (originalPrice !== undefined && originalPrice < price) {
        setStepError("Giá khi mua mới phải lớn hơn hoặc bằng giá pass.");
        return false;
      }
      if (passDeadline < todayVN()) {
        setStepError("Hạn pass không được là ngày trong quá khứ.");
        return false;
      }
    }
    if (step === 4) {
      if (!allowPickup && !allowSellerShip && !allowCarrier && !campusDelivery) {
        setStepError("Vui lòng chọn ít nhất một phương thức giao nhận.");
        return false;
      }
      if (!publicMeetingPoint.trim() || publicMeetingPoint.trim().length < 3) {
        setStepError("Vui lòng nhập điểm hẹn công khai (tối thiểu 3 ký tự).");
        return false;
      }
      if (!exactAddress.trim() || exactAddress.trim().length < 3) {
        setStepError("Vui lòng nhập địa chỉ phòng/nhà chính xác (dành cho người mua sau khi bạn duyệt giữ chỗ).");
        return false;
      }
    }
    return true;
  };

  const goToNextStep = (next: 1 | 2 | 3 | 4 | 5) => {
    if (validateStep(currentStep)) {
      setCurrentStep(next);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
      return;
    }

    if (!user) {
      setStepError("Vui lòng đăng nhập để đăng tin.");
      return;
    }

    setIsSubmitting(true);
    setStepError(null);

    try {
      const orderedUrls = doneImages.map((i) => i.storageUrl!);
      const orderedThumbs = doneImages.map((i) => i.thumbUrl || i.storageUrl!);

      if (coverIndex > 0 && coverIndex < orderedUrls.length) {
        const [covUrl] = orderedUrls.splice(coverIndex, 1);
        orderedUrls.unshift(covUrl);
        const [covTh] = orderedThumbs.splice(coverIndex, 1);
        orderedThumbs.unshift(covTh);
      }

      const payload = {
        draftId,
        clientRequestId: draftId,
        title: title.trim(),
        categoryId,
        subcategory,
        condition,
        brandModel: brandModel.trim() || undefined,
        usageTime: usageTime.trim() || undefined,
        defects: defects.trim() || undefined,
        noDefects,
        description: description.trim() || "",
        price: Number(price) || 0,
        originalPrice: originalPrice ? Number(originalPrice) : undefined,
        negotiationType,
        urgentPass,
        passDeadline,
        schoolCode: profile?.schoolCode || undefined,
        campusId: profile?.campusId || undefined,
        provinceCode: profile?.provinceCode || undefined,
        wardCode: profile?.wardCode || undefined,
        publicMeetingPoint: publicMeetingPoint.trim(),
        exactAddress: exactAddress.trim(),
        shippingMethods: {
          pickup: allowPickup,
          sellerDelivery: allowSellerShip,
          carrierShipping: allowCarrier,
          campusDelivery,
          shipFeeNote: shipFee.trim() || undefined,
        },
        itemDimensions: isBulky
          ? { weight: itemWeight.trim() || undefined, dimensions: itemDimensions.trim() || undefined }
          : null,
        images: orderedUrls,
        thumbs: orderedThumbs,
      };

      const res = await authFetch("/api/listings/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": draftId,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.error || "Không thể tạo tin đăng trên máy chủ.");
      }

      const resData = await res.json();

      // Dọn dẹp nháp khi đã đăng thành công
      if (typeof window !== "undefined" && user?.uid) {
        localStorage.removeItem(`listing_draft_${user.uid}`);
        localStorage.removeItem("listing_draft");
      }

      router.push(`/listings/${resData.listingId}`);
    } catch (err: unknown) {
      console.error("Lỗi đăng tin:", err);
      const msg = err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo tin đăng.";
      setStepError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCategory = categoriesData.find((c) => c.id === categoryId);

  return (
    <RequireVerified>
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
                onClick={() => {
                  if (s.num < currentStep || validateStep(currentStep)) {
                    setCurrentStep(s.num as 1 | 2 | 3 | 4 | 5);
                  }
                }}
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

        {/* Thông báo lỗi inline */}
        {stepError && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="font-medium">{stepError}</span>
          </div>
        )}

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
                <Badge variant={doneImages.length >= 1 ? "verified" : "urgent"}>
                  {doneImages.length}/10 ảnh đã tải
                </Badge>
              </div>

              {/* Grid hiển thị ảnh */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {imageItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`relative aspect-[4/3] rounded-xl overflow-hidden border-2 group ${
                      coverIndex === idx
                        ? "border-primary shadow-subtle ring-2 ring-primary/20"
                        : "border-surface-border"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl}
                      alt={`Ảnh ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />

                    {/* Lớp phủ khi đang tải */}
                    {item.status === "uploading" && (
                      <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5 text-white p-2 text-center">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="text-[11px] font-semibold">{item.progress}%</span>
                      </div>
                    )}

                    {/* Lớp phủ khi lỗi */}
                    {item.status === "error" && (
                      <div className="absolute inset-0 bg-red-900/80 flex flex-col items-center justify-center p-2 text-center text-white text-[10px]">
                        <AlertTriangle className="w-4 h-4 text-red-300 mb-1" />
                        <span>{item.error || "Lỗi tải ảnh"}</span>
                      </div>
                    )}

                    {/* Nút đặt ảnh bìa */}
                    {item.status === "done" && (
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
                    )}

                    {/* Nút xóa ảnh */}
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      title="Xóa ảnh này"
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>

                    {coverIndex === idx && item.status === "done" && (
                      <span className="absolute bottom-1 left-1.5 px-1.5 py-0.2 rounded bg-primary text-[10px] font-bold text-white">
                        Ảnh bìa
                      </span>
                    )}
                  </div>
                ))}

                {/* Ô thêm ảnh mới */}
                {imageItems.length < 10 && (
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
                      JPG, PNG, WebP &le; 25MB
                    </span>
                  </label>
                )}
              </div>

              {doneImages.length < 1 && (
                <p className="text-xs text-amber-600 font-medium">
                  * Vui lòng tải tối thiểu 1 ảnh thực tế của món đồ để người mua dễ đánh giá.
                </p>
              )}

              <div className="flex justify-end pt-4">
                <Button
                  variant="primary"
                  size="md"
                  disabled={doneImages.length < 1}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                  onClick={() => goToNextStep(2)}
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

              {/* Cảnh báo riêng cho danh mục Xe cộ */}
              {categoryId === "xe-co" && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    <strong>Cảnh báo mua bán xe cộ:</strong> Không chuyển tiền cọc trước. Kiểm tra giấy tờ đăng ký xe chính chủ và số khung/số máy trước khi thanh toán. Luôn hẹn xem xe ở nơi công cộng.
                  </span>
                </div>
              )}

              {/* Tình trạng món đồ */}
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
                  label="Hãng sản xuất / Model (nếu có)"
                  value={brandModel}
                  onChange={(e) => setBrandModel(e.target.value)}
                  placeholder="Ví dụ: Senko, Sharp, Casio, Sunhouse..."
                />
                <Input
                  label="Thời gian đã sử dụng (tùy chọn)"
                  value={usageTime}
                  onChange={(e) => setUsageTime(e.target.value)}
                  placeholder="Ví dụ: 3 tháng, 1 học kỳ..."
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
                    helperText="Mô tả trung thực giúp bạn pass nhanh và nhận đánh giá 5 sao từ bạn học"
                  />
                )}
              </div>

              {/* Mô tả chi tiết */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Mô tả chi tiết *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Mô tả lý do pass (chuyển trọ, đổi đồ mới...), chức năng hoạt động, tặng kèm thêm đồ gì..."
                  className="w-full p-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-[11px] text-text-muted">
                  {description.length}/2000 ký tự
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
                  disabled={title.trim().length < 10 || !pledgeClean}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                  onClick={() => goToNextStep(3)}
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
                    value={price === 0 ? "" : price}
                    placeholder="0 (Tặng miễn phí)"
                    onChange={(e) => setPrice(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-base font-bold text-primary focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-xs text-text-muted">
                    {price === 0 ? "Tặng miễn phí" : `${price.toLocaleString("vi-VN")} VNĐ`}
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
                    placeholder="Ví dụ: 300000"
                  />
                  {originalPrice && originalPrice > price && (
                    <span className="text-xs text-urgent-solid font-semibold">
                      Tiết kiệm: {Math.round(((originalPrice - price) / originalPrice) * 100)}%
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
                      onClick={() => setNegotiationType(item.id as "fixed" | "slight" | "flexible")}
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

              {/* Công tắc "Pass trong ngày" */}
              <div className="p-4 rounded-xl border border-urgent-border/60 bg-urgent-bg/30 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-urgent-solid text-sm">
                    <Zap className="w-4 h-4 fill-current" />
                    <span>Bật nhãn &ldquo;Pass Trong Ngày&rdquo;</span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Gắn huy hiệu nổi bật màu hổ phách để ưu tiên các bạn sinh viên cần đồ gấp trong ngày.
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
                  disabled={urgentPass}
                  min={todayVN()}
                  max={addDaysVN(todayVN(), 30)}
                  value={passDeadline}
                  onChange={(e) => setPassDeadline(e.target.value)}
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main disabled:bg-surface-muted disabled:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="text-[11px] text-text-muted">
                  {urgentPass
                    ? "Đang bật chế độ 'Pass trong ngày': Hạn chót cố định là cuối ngày hôm nay."
                    : "Tin đăng sẽ tự động kết thúc vào cuối ngày này (23:59 giờ VN)."}
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
                  onClick={() => goToNextStep(4)}
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
                      Hẹn gặp tại cổng trường, cổng KTX hoặc quán cà phê gần trọ.
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
                      2. Người bán tự đi ship (Nội thành / gần trường)
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
                      3. Gửi qua đơn vị vận chuyển (Viettel Post, GHTK...)
                    </span>
                    <span className="text-text-muted">
                      Phù hợp với sách vở, giáo trình hoặc đồ nhẹ chuyển liên tỉnh.
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
                  placeholder="Ví dụ: Freeship nội trường, 15k bán kính 3km..."
                  helperText="Nêu rõ mức phí để người mua không phải hỏi lại"
                />
              )}

              {/* Điểm hẹn công khai vs Địa chỉ chính xác */}
              <div className="space-y-4 pt-2 border-t border-surface-border">
                <Input
                  label="Điểm hẹn công khai (Hiển thị cho tất cả mọi người) *"
                  value={publicMeetingPoint}
                  onChange={(e) => setPublicMeetingPoint(e.target.value)}
                  placeholder="Ví dụ: Cổng 1 trường ĐH, Cổng KTX Khu B, Thư viện trường..."
                  leftIcon={<Building className="w-4 h-4" />}
                  helperText="Điểm hẹn chung, an toàn nơi đông người vào ban ngày"
                />

                <Input
                  label="Địa chỉ phòng/nhà chính xác (BẢO MẬT - ẨN MẶC ĐỊNH) *"
                  value={exactAddress}
                  onChange={(e) => setExactAddress(e.target.value)}
                  placeholder="Ví dụ: Phòng 402, Nhà B3 Ký túc xá / Số 12 ngõ 45 đường..."
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
                  <span>Món đồ lớn / cồng kềnh (Tủ lạnh, bàn học, đệm, xe máy)</span>
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
                  onClick={() => goToNextStep(5)}
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
                  imageUrl={doneImages[coverIndex]?.storageUrl || doneImages[0]?.storageUrl}
                  urgent={urgentPass}
                  hasShipping={allowSellerShip || allowCarrier}
                  schoolName={profile?.schoolName || "Trường của bạn"}
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
                  <span>Địa chỉ chính xác (bảo mật):</span>
                  <span className="font-semibold text-text-main">{exactAddress}</span>
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
                  <span className="font-semibold text-text-main">{doneImages.length} ảnh WebP đã tải</span>
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
                  disabled={isSubmitting}
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
    </RequireVerified>
  );
}
