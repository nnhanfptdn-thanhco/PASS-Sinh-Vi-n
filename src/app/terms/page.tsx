import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangle } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Banner lưu ý pháp lý theo SPEC */}
      <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200 text-xs">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-sm block">
            BẢN MẪU ĐIỀU KHOẢN DỊCH VỤ — CẦN LUẬT SƯ RÀ SOÁT
          </span>
          <span>
            Tài liệu này là bản thảo khung pháp lý dành cho nền tảng Chợ Pass Sinh Viên.
            Chủ dự án cần tham vấn luật sư chuyên ngành thương mại điện tử và bảo vệ dữ liệu cá nhân trước khi áp dụng chính thức cho người dùng thật. Thông tin pháp nhân hiện để dưới dạng placeholder.
          </span>
        </div>
      </div>

      <div className="bg-surface border border-surface-border rounded-2xl p-6 sm:p-8 shadow-card space-y-6 text-sm text-text-secondary leading-relaxed">
        <div className="border-b border-surface-border pb-4">
          <Badge variant="verified">Phiên bản 1.0 (Hiệu lực từ 2026)</Badge>
          <h1 className="text-2xl font-bold font-heading text-text-main mt-2">
            Điều Khoản Sử Dụng Dịch Vụ Chợ Pass Sinh Viên
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Đơn vị vận hành: [TÊN TỔ CHỨC / CÔNG TY CHỦ DỰ ÁN - ĐANG CẬP NHẬT]
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">1. Mục đích và Phạm vi</h2>
          <p>
            Chợ Pass Sinh Viên là nền tảng kết nối trực tuyến phi lợi nhuận / hỗ trợ sinh viên tại Việt Nam có nhu cầu chuyển nhượng (pass lại) đồ dùng cá nhân, giáo trình học tập đã qua sử dụng. Nền tảng không tham gia trực tiếp vào việc định giá, thanh toán hay vận chuyển giữa người mua và người bán.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">2. Điều kiện tham gia</h2>
          <p>
            Mọi thành viên đăng bán đồ hoặc xem thông tin liên hệ bắt buộc phải hoàn tất quy trình xác minh bằng thẻ sinh viên chính quy hoặc chứng nhận sinh viên còn hiệu lực của các trường Đại học, Cao đẳng, Học viện tại Việt Nam.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">3. Danh mục hàng hóa cấm đăng tải</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>Hàng gian, tài sản trộm cắp, không chứng minh được nguồn gốc sở hữu.</li>
            <li>Vũ khí, hung khí, vật liệu nổ, chất dễ cháy.</li>
            <li>Thuốc chữa bệnh, dược phẩm, thực phẩm chức năng có hạn chế.</li>
            <li>Giấy tờ tùy thân (CCCD, hộ chiếu, bằng lái xe).</li>
            <li>Tài khoản ngân hàng, tài khoản phần mềm, thiết bị dính khóa bảo mật (iCloud, Knox).</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">4. Quy định giữ chỗ và giao dịch</h2>
          <p>
            Hệ thống cung cấp cơ chế giữ chỗ 24 giờ. Người bán có trách nhiệm xác nhận hoặc từ chối giữ chỗ trong thời hạn này. Nghiêm cấm hành vi thỏa thuận xong nhưng không đến (no-show) hoặc cố tình hủy giao dịch mà không có lý do chính đáng. Người vi phạm sẽ bị trừ điểm uy tín hoặc khóa tài khoản.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">5. Giới hạn trách nhiệm</h2>
          <p>
            Các bên tự thỏa thuận phương thức kiểm tra hàng và thanh toán trực tiếp. Nền tảng khuyến cáo không đặt cọc trực tuyến trước khi gặp mặt. Ban quản trị sẽ hỗ trợ cung cấp nhật ký giao dịch và thông tin cho cơ quan có thẩm quyền khi có yêu cầu xử lý vi phạm pháp luật.
          </p>
        </section>
      </div>
    </div>
  );
}
