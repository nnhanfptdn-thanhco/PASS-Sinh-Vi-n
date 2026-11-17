import * as React from "react";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangle, Trash2 } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Banner cảnh báo pháp lý theo SPEC */}
      <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200 text-xs">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-sm block">
            CHÍNH SÁCH BẢO VỆ DỮ LIỆU CÁ NHÂN — CẦN LUẬT SƯ RÀ SOÁT
          </span>
          <span>
            Tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 (hiệu lực từ 01/01/2026) và Nghị định 356/2025/NĐ-CP.
            Chủ dự án bắt buộc phải rà soát với luật sư chuyên ngành về việc thu thập ảnh có khuôn mặt và mã số sinh viên trước khi vận hành thực tế.
          </span>
        </div>
      </div>

      <div className="bg-surface border border-surface-border rounded-2xl p-6 sm:p-8 shadow-card space-y-6 text-sm text-text-secondary leading-relaxed">
        <div className="border-b border-surface-border pb-4">
          <Badge variant="verified">Bảo vệ dữ liệu cá nhân 100%</Badge>
          <h1 className="text-2xl font-bold font-heading text-text-main mt-2">
            Chính Sách Xử Lý & Bảo Vệ Dữ Liệu Cá Nhân
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Đơn vị kiểm soát dữ liệu: [CHỦ DỰ ÁN - ĐANG CẬP NHẬT]
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">
            1. Các loại dữ liệu thu thập & Mục đích
          </h2>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>Dữ liệu cơ bản:</strong> Email Google, họ tên thật, tên hiển thị, trường đại học, khoa, khóa học.
            </li>
            <li>
              <strong>Dữ liệu liên hệ:</strong> Số Zalo, số điện thoại (chỉ hiển thị cho người mua sau khi người bán xác nhận giữ chỗ).
            </li>
            <li>
              <strong>Dữ liệu xác thực thẻ sinh viên:</strong> Ảnh mặt trước thẻ sinh viên. Chỉ dùng duy nhất cho mục đích đối chiếu duyệt quyền đăng bán và bảo vệ sinh viên khỏi các đối tượng lừa đảo bên ngoài.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">
            2. Cam kết bảo mật & Thời hạn lưu trữ ảnh thẻ
          </h2>
          <div className="p-4 bg-surface-muted rounded-xl space-y-2 border border-surface-border text-xs">
            <div className="flex items-center gap-2 font-bold text-text-main">
              <Trash2 className="w-4 h-4 text-primary" />
              <span>Chính sách tự động xóa vĩnh viễn sau 30 ngày:</span>
            </div>
            <p>
              Ảnh thẻ sinh viên được lưu trữ trong phân vùng riêng tư (Private Storage), chỉ có quản trị viên được chỉ định mới có quyền đọc trong lúc duyệt.
              Sau <strong>30 ngày</strong> kể từ khi hồ sơ được duyệt hoặc bị từ chối, hệ thống Cloud Function sẽ <strong>tự động xóa vĩnh viễn tệp ảnh thẻ</strong> khỏi máy chủ lưu trữ.
            </p>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">
            3. Mã hóa & Chống trùng lặp bằng HMAC-SHA256
          </h2>
          <p>
            Mã số sinh viên không bao giờ được lưu trữ dưới dạng thô để chống dò ngược thông tin. Hệ thống sử dụng thuật toán mã băm HMAC-SHA256 với khóa bảo mật đặt tại Secret Manager chỉ xử lý tại Cloud Functions máy chủ.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-text-main">
            4. Quyền của chủ thể dữ liệu (Sinh viên)
          </h2>
          <p>
            Theo quy định hiện hành, bạn có toàn quyền:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Yêu cầu trích xuất toàn bộ dữ liệu cá nhân qua tính năng <strong>Tải Về Dữ Liệu</strong> tại mục Cài đặt.</li>
            <li>Yêu cầu xóa toàn bộ tài khoản và lịch sử giao dịch thông qua tính năng <strong>Xóa Tài Khoản Vĩnh Viễn</strong>.</li>
            <li>Rút lại sự đồng ý xử lý dữ liệu bất cứ lúc nào.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
