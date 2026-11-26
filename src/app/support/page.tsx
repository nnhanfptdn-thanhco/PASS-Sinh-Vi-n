"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { authFetch } from "@/lib/firebase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { HelpCircle, Send, CheckCircle2, ShieldAlert, AlertTriangle } from "lucide-react";

function SupportContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const [targetType, setTargetType] = React.useState<"listing" | "account">("listing");
  const [targetId, setTargetId] = React.useState("");
  const [appealReason, setAppealReason] = React.useState("Nhầm lẫn trong nội dung mô tả");
  const [note, setNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const paramType = searchParams.get("type");
    const paramTargetId = searchParams.get("targetId");
    if (paramType === "account") {
      setTargetType("account");
    } else if (paramTargetId) {
      setTargetType("listing");
      setTargetId(paramTargetId.trim());
    }
  }, [searchParams]);

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!user) {
      setSubmitError("Vui lòng đăng nhập trước khi gửi yêu cầu kháng nghị.");
      return;
    }
    const resolvedTargetId = targetType === "account" ? user.uid : targetId.trim();
    if (!resolvedTargetId) {
      setSubmitError("Vui lòng nhập chính xác mã tin đăng bị ẩn.");
      return;
    }
    if (appealReason.trim().length < 5) {
      setSubmitError("Lý do giải trình phải có ít nhất 5 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await authFetch("/api/appeals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId: resolvedTargetId,
          appealReason: appealReason.trim(),
          note: note.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          typeof json?.error === "string"
            ? json.error
            : json?.issues?.[0]?.message || `Không thể gửi đơn kháng nghị (HTTP ${res.status}).`;
        setSubmitError(msg);
        return;
      }
      setSubmitted(true);
      setNote("");
    } catch {
      setSubmitError("Lỗi kết nối máy chủ. Đơn kháng nghị CHƯA được gửi, vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="border-b border-surface-border pb-5">
        <h1 className="text-2xl font-heading font-extrabold text-text-main">
          Trung Tâm Hỗ Trợ & Gửi Kháng Nghị
        </h1>
        <p className="text-xs text-text-secondary mt-0.5">
          Giải đáp thắc mắc và tiếp nhận yêu cầu mở lại tin đăng hoặc tài khoản bị khóa nhầm.
        </p>
      </div>

      {submitted ? (
        <div className="p-8 text-center bg-surface border border-surface-border rounded-2xl shadow-card space-y-3 max-w-md mx-auto">
          <CheckCircle2 className="w-12 h-12 text-primary mx-auto" />
          <h2 className="text-base font-bold text-text-main">
            Đã Tiếp Nhận Yêu Cầu Kháng Nghị!
          </h2>
          <p className="text-xs text-text-secondary leading-relaxed">
            Đội ngũ quản trị viên sẽ rà soát lại thông tin và phản hồi kết quả qua email của bạn trong vòng 24 - 48 giờ làm việc.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setSubmitted(false)}>
            Gửi yêu cầu khác
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* CỘT TRÁI: FORM KHÁNG NGHỊ */}
          <div className="md:col-span-7 bg-surface border border-surface-border rounded-2xl p-6 shadow-card space-y-5">
            <div className="flex items-center gap-2 border-b border-surface-border pb-3">
              <ShieldAlert className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold text-text-main">
                Gửi Kháng Nghị Quyết Định Của Quản Trị Viên
              </h2>
            </div>

            <form onSubmit={handleSubmitAppeal} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="font-bold text-text-main block">
                  Đối tượng cần kháng nghị *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetType("listing")}
                    className={`p-2.5 rounded-lg border text-center font-semibold transition-all ${
                      targetType === "listing"
                        ? "border-primary bg-primary-light text-primary"
                        : "border-surface-border text-text-secondary"
                    }`}
                  >
                    Tin đăng bị ẩn
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetType("account")}
                    className={`p-2.5 rounded-lg border text-center font-semibold transition-all ${
                      targetType === "account"
                        ? "border-primary bg-primary-light text-primary"
                        : "border-surface-border text-text-secondary"
                    }`}
                  >
                    Tài khoản bị khóa
                  </button>
                </div>
              </div>

              {targetType === "listing" && (
                <Input
                  label="Mã tin đăng bị ẩn *"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  placeholder="Ví dụ: nhập mã ID tin đăng từ trang Quản lý tin"
                  required
                />
              )}

              <div className="space-y-1.5">
                <label className="font-bold text-text-main block">
                  Lý do giải trình *
                </label>
                <select
                  value={appealReason}
                  onChange={(e) => setAppealReason(e.target.value)}
                  className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                >
                  <option value="Nhầm lẫn trong nội dung mô tả">Nhầm lẫn trong nội dung mô tả</option>
                  <option value="Đã bổ sung chứng từ / hóa đơn chứng minh">Đã bổ sung hóa đơn chứng minh chính chủ</option>
                  <option value="Đã che biển số xe theo đúng quy định">Đã che biển số xe theo đúng quy định</option>
                  <option value="Bị báo cáo ác ý từ đối thủ cạnh tranh">Bị báo cáo ác ý không đúng sự thật</option>
                  <option value="Lý do kháng nghị khác">Lý do khác</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-text-main block">
                  Nội dung giải thích chi tiết *
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  required
                  placeholder="Trình bày rõ các điểm bạn cho rằng có sự nhầm lẫn để ban quản trị đối chiếu..."
                  className="w-full p-3 bg-surface border border-surface-border rounded-lg text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary text-xs"
                />
              </div>

              {submitError && (
                <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="md"
                className="w-full"
                isLoading={isSubmitting}
                rightIcon={<Send className="w-4 h-4" />}
              >
                Gửi Đơn Kháng Nghị
              </Button>
            </form>
          </div>

          {/* CỘT PHẢI: CÂU HỎI THƯỜNG GẶP (FAQ) */}
          <div className="md:col-span-5 space-y-4">
            <h2 className="text-sm font-bold text-text-main flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-primary" />
              <span>Câu Hỏi Thường Gặp</span>
            </h2>

            <div className="space-y-3 text-xs text-text-secondary">
              <div className="p-3.5 bg-surface border border-surface-border rounded-xl space-y-1">
                <span className="font-bold text-text-main block">
                  Bao lâu thì thẻ sinh viên được duyệt?
                </span>
                <p>
                  Thông thường từ 15 đến 60 phút trong giờ hành chính. Các tài khoản dùng email đuôi .edu.vn được tự động ưu tiên lên đầu hàng chờ.
                </p>
              </div>

              <div className="p-3.5 bg-surface border border-surface-border rounded-xl space-y-1">
                <span className="font-bold text-text-main block">
                  Nếu thẻ bị từ chối thì làm thế nào?
                </span>
                <p>
                  Bạn hãy xem kỹ lý do từ chối (ảnh mờ, hết hạn, không khớp tên) và chụp lại ảnh rõ nét hơn. Hệ thống cho phép nộp lại tối đa 3 lần mỗi ngày.
                </p>
              </div>

              <div className="p-3.5 bg-surface border border-surface-border rounded-xl space-y-1">
                <span className="font-bold text-text-main block">
                  Tôi đã tốt nghiệp rồi có pass đồ được không?
                </span>
                <p>
                  Được! Chợ Pass SV khuyến khích sinh viên năm cuối pass lại đồ dùng cho các bạn khóa dưới. Bạn chỉ cần tích chọn &ldquo;Sắp tốt nghiệp&rdquo; trên hồ sơ.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SupportPage() {
  return (
    <React.Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 py-12 text-center text-xs text-text-muted">
          Đang tải Trung tâm hỗ trợ...
        </div>
      }
    >
      <SupportContent />
    </React.Suspense>
  );
}
