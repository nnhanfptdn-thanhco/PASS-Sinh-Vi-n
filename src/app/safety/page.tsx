import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangle, MapPin, Eye, Lock } from "lucide-react";

export default function SafetyPage() {
  const tips = [
    {
      title: "1. Tuyệt đối KHÔNG chuyển tiền cọc trước",
      desc: "Kẻ gian thường viện lý do 'có nhiều người hỏi mua' để ép bạn chuyển khoản đặt cọc. Nguyên tắc vàng: Chỉ thanh toán khi đã gặp mặt trực tiếp và cầm hàng trên tay.",
      icon: AlertTriangle,
      variant: "urgent" as const,
    },
    {
      title: "2. Hẹn gặp tại khuôn viên trường hoặc nơi đông người",
      desc: "Nên chọn các địa điểm an toàn, có bảo vệ và camera như Cổng trường, Sảnh Ký túc xá, Căn tin, Thư viện vào ban ngày (từ 8h00 - 18h00). Tránh hẹn ở các ngõ vắng vào đêm khuya.",
      icon: MapPin,
      variant: "verified" as const,
    },
    {
      title: "3. Kiểm tra kỹ tình trạng đồ trước khi nhận",
      desc: "Với đồ điện máy (quạt, nồi cơm, tủ lạnh, bếp điện), hãy nhờ bảo vệ KTX hoặc vào phòng cắm điện thử trực tiếp. Với xe máy, đối chiếu kỹ số khung số máy và giấy tờ chính chủ.",
      icon: Eye,
      variant: "verified" as const,
    },
    {
      title: "4. Cảnh giác với giả mạo Quản trị viên (Admin)",
      desc: "Ban quản trị Chợ Pass Sinh Viên KHÔNG BAO GIỜ yêu cầu bạn cung cấp mã xác thực OTP ngân hàng, mật khẩu tài khoản hay yêu cầu nạp tiền để duyệt thẻ.",
      icon: Lock,
      variant: "urgent" as const,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div className="text-center space-y-2">
        <Badge variant="verified">Cẩm Nang An Toàn Sinh Viên</Badge>
        <h1 className="text-2xl sm:text-3xl font-heading font-extrabold text-text-main">
          Hướng Dẫn Mua Bán Đồ Cũ An Toàn
        </h1>
        <p className="text-xs sm:text-sm text-text-secondary max-w-xl mx-auto">
          Những kinh nghiệm quý báu giúp các bạn tân sinh viên và sinh viên năm cuối giao dịch văn minh, không lo bị lừa đảo hay mua phải đồ hỏng.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {tips.map((tip, idx) => {
          const Icon = tip.icon;
          return (
            <div
              key={idx}
              className="p-6 bg-surface border border-surface-border rounded-2xl shadow-card space-y-3"
            >
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                  tip.variant === "urgent"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-text-main">{tip.title}</h3>
              <p className="text-xs text-text-secondary leading-relaxed">
                {tip.desc}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
