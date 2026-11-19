"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { authFetch } from "@/lib/firebase/client";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { UniversitySelect } from "@/components/ui/UniversitySelect";
import {
  ShieldCheck,
  GraduationCap,
  Upload,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Check,
  FileCheck,
  HelpCircle,
} from "lucide-react";
import { compressAndAnalyzeImage, ImageQualityCheck } from "@/lib/utils/image";
import universitiesData from "../../../../data/universities_vietnam.json";
import provincesData from "../../../../data/provinces_34.json";
import wardsData from "../../../../data/communes_wards.json";

function OnboardingContent() {
  const router = useRouter();
  const { user } = useAuth();

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [successMessage, setSuccessMessage] = React.useState(false);

  // Bước 1: Đồng ý điều khoản & bảo vệ dữ liệu cá nhân
  const [consentTerms, setConsentTerms] = React.useState(false);
  const [consentPDP, setConsentPDP] = React.useState(false);

  // Bước 2: Thông tin hồ sơ sinh viên
  const [formData, setFormData] = React.useState({
    realName: user?.displayName || "",
    displayName: user?.displayName || "",
    schoolCode: universitiesData[0]?.code || "QSX",
    campusId: universitiesData[0]?.campuses[0]?.id || "c1",
    faculty: "",
    studentClass: "",
    studentId: "",
    zaloPhone: "",
    altPhone: "",
    provinceCode: universitiesData[0]?.provinceCode || "79",
    wardCode: universitiesData[0]?.wardCode || "27139",
    dormOrAddress: "",
    isGraduating: false,
  });

  // Bước 3: Tải ảnh thẻ SV
  const [cardImagePreview, setCardImagePreview] = React.useState<string | null>(null);
  const [cardImageBlob, setCardImageBlob] = React.useState<Blob | null>(null);
  const [qualityCheck, setQualityCheck] = React.useState<ImageQualityCheck | null>(null);
  const [consentCardPrivacy, setConsentCardPrivacy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Tự gợi ý tỉnh/phường khi chọn trường
  const handleSchoolChange = (code: string) => {
    const selectedSchool = universitiesData.find((s) => s.code === code);
    if (selectedSchool) {
      setFormData((prev) => ({
        ...prev,
        schoolCode: code,
        campusId: selectedSchool.campuses[0]?.id || "c1",
        provinceCode: selectedSchool.provinceCode,
        wardCode: selectedSchool.wardCode,
      }));
    }
  };

  const currentSchool = React.useMemo(() => {
    return universitiesData.find((s) => s.code === formData.schoolCode) || universitiesData[0];
  }, [formData.schoolCode]);

  // Tự nhận diện trường học nếu email đăng nhập là email sinh viên (@fpt.edu.vn, @hcmut.edu.vn...)
  React.useEffect(() => {
    if (user?.email) {
      const emailLower = user.email.toLowerCase();
      const detected = universitiesData.find((s) =>
        s.emailDomains?.some(
          (d) => emailLower.endsWith(`@${d}`) || emailLower.endsWith(`.${d}`)
        )
      );
      if (detected) {
        setFormData((prev) => ({
          ...prev,
          schoolCode: detected.code,
          campusId: detected.campuses[0]?.id || "c1",
          provinceCode: detected.provinceCode,
          wardCode: detected.wardCode,
        }));
      }
    }
  }, [user?.email]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await compressAndAnalyzeImage(file, 1600, 0.85);
      setCardImagePreview(result.dataUrl);
      setCardImageBlob(result.blob);
      setQualityCheck(result.quality);
    } catch (err) {
      console.error("Lỗi nén ảnh thẻ:", err);
      alert("Không thể đọc tệp ảnh. Vui lòng chọn ảnh định dạng JPG/PNG hợp lệ.");
    }
  };

  const handleSubmitVerification = async () => {
    setSubmitError(null);
    if (!user) {
      setSubmitError("Vui lòng đăng nhập trước khi gửi hồ sơ xác minh.");
      return;
    }
    if (!cardImageBlob || !formData.studentId || !formData.zaloPhone) {
      setSubmitError("Vui lòng điền đầy đủ các mục bắt buộc và tải ảnh thẻ.");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Chuyển đổi ảnh thẻ sang Base64 Data URL (0ms tức thì, không bị treo mạng, 100% miễn phí)
      const reader = new FileReader();
      const storagePath = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(cardImageBlob);
      });

      // 2. Gửi metadata tới server route
      const res = await authFetch("/api/verifications/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          cardStoragePath: storagePath,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || errJson.error || "Không thể gửi hồ sơ xác minh tới máy chủ.");
      }

      // 3. KHÔNG tự động gán verified giả vào localStorage!
      // Hồ sơ hiện ở trạng thái chờ duyệt (pending) bởi quản trị viên.
      setSuccessMessage(true);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Đã xảy ra lỗi khi gửi hồ sơ xác minh";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-surface border border-surface-border rounded-2xl shadow-card text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-verified-bg text-verified-border mx-auto flex items-center justify-center">
          <FileCheck className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold font-heading text-text-main">
          Hồ Sơ Đã Được Gửi Duyệt!
        </h2>
        <p className="text-xs text-text-secondary leading-relaxed">
          Quản trị viên đang đối chiếu thông tin thẻ sinh viên của bạn.
          Thời gian duyệt dự kiến từ 15 - 60 phút trong giờ làm việc. Bạn sẽ nhận được thông báo ngay khi có kết quả.
        </p>
        <div className="p-3 bg-surface-muted rounded-xl text-xs text-text-muted text-left space-y-1">
          <p className="font-semibold text-text-main">Thông tin bảo mật:</p>
          <p>• Mã số sinh viên đã được băm bảo mật (HMAC-SHA256).</p>
          <p>• Ảnh thẻ sẽ tự động xóa sau 30 ngày theo quy định bảo vệ dữ liệu.</p>
        </div>
        <Button variant="primary" size="md" className="w-full" onClick={() => router.push("/")}>
          Về Trang Chủ Khám Phá
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      {/* Tiêu đề & Tiến độ 3 bước */}
      <div className="text-center space-y-2">
        <Badge variant="verified">Quy Trình Xác Minh 3 Bước</Badge>
        <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-text-main">
          Xác Thực Thẻ Sinh Viên
        </h1>
        <p className="text-xs text-text-secondary max-w-md mx-auto">
          Chợ Pass Sinh Viên yêu cầu 100% người bán và xem liên hệ xác thực thẻ để tạo môi trường mua bán uy tín, tránh gian lận.
        </p>

        {/* Thanh tiến độ */}
        <div className="flex items-center justify-center gap-3 pt-4">
          <div
            className={`flex items-center gap-1.5 text-xs font-bold ${
              step >= 1 ? "text-primary" : "text-text-muted"
            }`}
          >
            <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs">
              1
            </span>
            <span>Điều khoản</span>
          </div>
          <div className="w-8 h-0.5 bg-surface-border" />
          <div
            className={`flex items-center gap-1.5 text-xs font-bold ${
              step >= 2 ? "text-primary" : "text-text-muted"
            }`}
          >
            <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs">
              2
            </span>
            <span>Hồ sơ</span>
          </div>
          <div className="w-8 h-0.5 bg-surface-border" />
          <div
            className={`flex items-center gap-1.5 text-xs font-bold ${
              step >= 3 ? "text-primary" : "text-text-muted"
            }`}
          >
            <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs">
              3
            </span>
            <span>Tải thẻ</span>
          </div>
        </div>
      </div>

      {/* NỘI DUNG TỪNG BƯỚC */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card space-y-6">
        {/* BƯỚC 1: ĐIỀU KHOẢN & BẢO VỆ DỮ LIỆU CÁ NHÂN */}
        {step === 1 && (
          <div className="space-y-5">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <span>Bước 1: Xác nhận Quy định & Bảo vệ Dữ liệu Cá nhân</span>
            </h3>

            <div className="p-4 bg-surface-muted rounded-xl space-y-3 text-xs text-text-secondary leading-relaxed border border-surface-border">
              <p className="font-semibold text-text-main">
                Cam kết tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 & Nghị định 356/2025/NĐ-CP:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>Ảnh thẻ sinh viên và khuôn mặt được lưu trữ trong phân vùng riêng tư an toàn.</li>
                <li>Chỉ quản trị viên được phân quyền mới có thể xem ảnh thẻ để đối chiếu duyệt.</li>
                <li>Hệ thống <strong>tự động xóa vĩnh viễn ảnh thẻ sau 30 ngày</strong> kể từ khi có kết quả duyệt.</li>
                <li>Số điện thoại và Zalo của bạn được ẩn mặc định, chỉ hiển thị khi có yêu cầu giữ chỗ được bạn xác nhận.</li>
              </ul>
            </div>

            <div className="space-y-3 pt-2">
              <label className="flex items-start gap-3 cursor-pointer text-xs text-text-main">
                <input
                  type="checkbox"
                  checked={consentTerms}
                  onChange={(e) => setConsentTerms(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-border text-primary focus:ring-primary mt-0.5"
                />
                <span>
                  Tôi đồng ý với <strong>Điều khoản Dịch vụ</strong> và cam kết chỉ đăng bán đồ thuộc quyền sở hữu hợp pháp của mình, không bán hàng gian, hàng cấm.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer text-xs text-text-main">
                <input
                  type="checkbox"
                  checked={consentPDP}
                  onChange={(e) => setConsentPDP(e.target.checked)}
                  className="w-4 h-4 rounded border-surface-border text-primary focus:ring-primary mt-0.5"
                />
                <span>
                  Tôi đồng ý cho phép nền tảng xử lý dữ liệu ảnh thẻ sinh viên nhằm mục đích xác minh danh tính và chấp thuận thời hạn lưu trữ tối đa 30 ngày.
                </span>
              </label>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                variant="primary"
                size="md"
                disabled={!consentTerms || !consentPDP}
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => setStep(2)}
              >
                Tiếp Tục Bước 2
              </Button>
            </div>
          </div>
        )}

        {/* BƯỚC 2: NHẬP HỒ SƠ SINH VIÊN */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-primary" />
              <span>Bước 2: Thông tin Trường học & Nơi ở</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Họ và tên thật (như trên thẻ SV) *"
                value={formData.realName}
                onChange={(e) =>
                  setFormData({ ...formData, realName: e.target.value })
                }
                placeholder="Nguyễn Văn A"
              />
              <Input
                label="Tên hiển thị công khai *"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData({ ...formData, displayName: e.target.value })
                }
                placeholder="Văn A (HCMUT)"
                helperText="Họ tên thật sẽ được ẩn để bảo vệ quyền riêng tư"
              />
            </div>

            {/* Chọn trường từ danh mục toàn quốc (có ô gõ tìm kiếm thông minh) */}
            <UniversitySelect
              value={formData.schoolCode}
              onChange={(code) => handleSchoolChange(code)}
              label="Trường Đại học / Cao đẳng / Học viện *"
              placeholder="Gõ tìm trường (vd: FPT, Bách Khoa, Kinh Tế, HUST, UEH, DUT...)"
              helperText="Hỗ trợ gõ tiếng Việt có dấu, không dấu hoặc tên viết tắt"
            />

            {/* Nếu trường có nhiều hơn 1 cơ sở / campus, cho chọn campus cụ thể */}
            {currentSchool && currentSchool.campuses && currentSchool.campuses.length > 1 && (
              <div className="space-y-1.5 p-3 bg-surface-muted/60 border border-surface-border rounded-xl">
                <label className="block text-xs font-semibold text-text-main">
                  Cơ sở / Campus trực thuộc ({currentSchool.campuses.length} cơ sở) *
                </label>
                <select
                  value={formData.campusId}
                  onChange={(e) => {
                    const cid = e.target.value;
                    const c = currentSchool.campuses.find((camp) => camp.id === cid);
                    setFormData((prev) => ({
                      ...prev,
                      campusId: cid,
                      provinceCode: c?.provinceCode || prev.provinceCode,
                      wardCode: c?.wardCode || prev.wardCode,
                    }));
                  }}
                  className="w-full h-10 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {currentSchool.campuses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.address})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label="Khoa / Ngành học"
                value={formData.faculty}
                onChange={(e) =>
                  setFormData({ ...formData, faculty: e.target.value })
                }
                placeholder="CNTT, Kinh tế, Cơ khí..."
              />
              <Input
                label="Khóa học"
                value={formData.studentClass}
                onChange={(e) =>
                  setFormData({ ...formData, studentClass: e.target.value })
                }
                placeholder="K21 / K66"
              />
              <Input
                label="Mã số sinh viên (MSSV) *"
                value={formData.studentId}
                onChange={(e) =>
                  setFormData({ ...formData, studentId: e.target.value })
                }
                placeholder="2110123"
                helperText="Sẽ được băm bảo mật HMAC"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Số Zalo liên hệ chính (bắt buộc) *"
                value={formData.zaloPhone}
                onChange={(e) =>
                  setFormData({ ...formData, zaloPhone: e.target.value })
                }
                placeholder="0912 345 678"
                helperText="Ẩn mặc định, chỉ hiện cho người giữ chỗ được duyệt"
              />
              <Input
                label="Số điện thoại gọi (tùy chọn)"
                value={formData.altPhone}
                onChange={(e) =>
                  setFormData({ ...formData, altPhone: e.target.value })
                }
                placeholder="0987 654 321"
              />
            </div>

            {/* Chọn Tỉnh/Thành & Phường/Xã nơi ở */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-surface-border">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Tỉnh / Thành phố đang ở *
                </label>
                <select
                  value={formData.provinceCode}
                  onChange={(e) =>
                    setFormData({ ...formData, provinceCode: e.target.value })
                  }
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {provincesData.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-text-main">
                  Phường / Xã / Đặc khu *
                </label>
                <select
                  value={formData.wardCode}
                  onChange={(e) =>
                    setFormData({ ...formData, wardCode: e.target.value })
                  }
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {wardsData
                    .filter((w) => w.provinceCode === formData.provinceCode)
                    .map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.name} ({w.oldDistrictName})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <Input
              label="Ký túc xá hoặc khu trọ gần trường (tùy chọn)"
              value={formData.dormOrAddress}
              onChange={(e) =>
                setFormData({ ...formData, dormOrAddress: e.target.value })
              }
              placeholder="KTX Khu A ĐHQG, KTX Bách Khoa, Hẻm 128 Hoàng Diệu..."
            />

            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-text-main pt-1">
              <input
                type="checkbox"
                checked={formData.isGraduating}
                onChange={(e) =>
                  setFormData({ ...formData, isGraduating: e.target.checked })
                }
                className="w-4 h-4 rounded border-surface-border text-primary focus:ring-primary"
              />
              <span>Tôi là sinh viên năm cuối / Sắp tốt nghiệp ra trường</span>
            </label>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => setStep(1)}
              >
                Quay Lại
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={!formData.realName || !formData.studentId || !formData.zaloPhone}
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => setStep(3)}
              >
                Tiếp Tục Bước 3
              </Button>
            </div>
          </div>
        )}

        {/* BƯỚC 3: TẢI ẢNH THẺ SINH VIÊN */}
        {step === 3 && (
          <div className="space-y-5">
            <h3 className="text-base font-bold text-text-main flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              <span>Bước 3: Tải Ảnh Mặt Trước Thẻ Sinh Viên</span>
            </h3>

            {/* Lưu ý che thông tin */}
            <div className="p-3.5 bg-surface-muted rounded-xl flex items-start gap-2.5 text-xs text-text-secondary border border-surface-border">
              <HelpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-text-main">Mẹo chụp thẻ rõ nét: </span>
                Đặt thẻ trên mặt phẳng đủ sáng. Bạn có thể dùng ngón tay hoặc mẩu giấy che số CCCD, chỉ cần thấy rõ <strong>Tên trường, Họ tên và Mã số sinh viên</strong>.
              </div>
            </div>

            {/* Khung tải ảnh */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-surface-border hover:border-primary rounded-2xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer bg-surface hover:bg-surface-muted/50 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleImageSelect}
              />

              {cardImagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cardImagePreview}
                  alt="Ảnh xem trước thẻ sinh viên"
                  className="max-h-60 rounded-xl object-contain shadow-card"
                />
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-primary-light flex items-center justify-center text-primary">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-text-main">
                      Bấm để chọn ảnh hoặc kéo thả vào đây
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      Hỗ trợ định dạng JPG, PNG, WebP (Tối đa 5 MB)
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Cảnh báo chất lượng ảnh tự động bằng Canvas */}
            {qualityCheck && (
              <div className="space-y-2">
                {qualityCheck.isBlurry && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Cảnh báo: Ảnh có dấu hiệu bị mờ ({qualityCheck.sharpness}). Vui lòng chụp lại rõ nét hơn để không bị từ chối duyệt.
                    </span>
                  </div>
                )}
                {qualityCheck.isTooDark && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Cảnh báo: Ảnh quá tối (độ sáng {qualityCheck.luminance}/255). Hãy chụp ở nơi có ánh sáng tốt hơn.
                    </span>
                  </div>
                )}
                {!qualityCheck.isBlurry && !qualityCheck.isTooDark && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-xs text-green-800 dark:bg-green-950/60 dark:text-green-200 dark:border-green-800">
                    <Check className="w-4 h-4 text-green-600 shrink-0" />
                    <span>
                      Độ sáng ({qualityCheck.luminance}) và độ sắc nét ({qualityCheck.sharpness}) đạt chuẩn. Ảnh đã sẵn sàng gửi duyệt!
                    </span>
                  </div>
                )}
              </div>
            )}

            <label className="flex items-start gap-3 cursor-pointer text-xs text-text-main pt-2">
              <input
                type="checkbox"
                checked={consentCardPrivacy}
                onChange={(e) => setConsentCardPrivacy(e.target.checked)}
                className="w-4 h-4 rounded border-surface-border text-primary focus:ring-primary mt-0.5"
              />
              <span>
                Tôi xác nhận ảnh thẻ sinh viên là của chính tôi và đồng ý để quản trị viên đối chiếu với thông tin đã nhập.
              </span>
            </label>

            {submitError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => setStep(2)}
              >
                Quay Lại
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={!cardImageBlob || !consentCardPrivacy || isSubmitting}
                isLoading={isSubmitting}
                rightIcon={<Check className="w-4 h-4" />}
                onClick={handleSubmitVerification}
              >
                Gửi Hồ Sơ Xác Minh
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <OnboardingContent />
    </RequireAuth>
  );
}
