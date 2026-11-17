"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  User,
  Bell,
  Download,
  Trash2,
  AlertTriangle,
  Lock,
  Check,
} from "lucide-react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();
  const { user, profile, logout } = useAuth();

  const [displayName, setDisplayName] = React.useState(
    profile?.displayName || "Sinh viên K21"
  );
  const [zaloPhone, setZaloPhone] = React.useState("0912 345 678");
  const [notifyApp, setNotifyApp] = React.useState(true);
  const [notifyEmail, setNotifyEmail] = React.useState(true);
  const [saveSuccess, setSaveSuccess] = React.useState(false);

  // Modal Xóa tài khoản
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [isDeleting, setIsDeleting] = React.useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleExportData = () => {
    const uid = user?.uid || "demo-user-id";
    window.open(`/api/account/export?userId=${uid}`, "_blank");
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "XÓA TÀI KHOẢN") {
      alert("Vui lòng gõ chính xác cụm từ 'XÓA TÀI KHOẢN' để xác nhận.");
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user?.uid || "demo-user-id" }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Không thể xóa tài khoản");
        return;
      }

      alert("Tài khoản của bạn đã được xóa thành công.");
      await logout();
      router.push("/");
    } catch {
      alert("Đã xảy ra lỗi kết nối");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div className="border-b border-surface-border pb-5">
        <h1 className="text-2xl font-heading font-extrabold text-text-main">
          Cài Đặt Tài Khoản & Quyền Riêng Tư
        </h1>
        <p className="text-xs text-text-secondary mt-0.5">
          Quản lý thông tin hồ sơ, thông báo và quyền dữ liệu theo Luật Bảo vệ dữ liệu cá nhân 2025.
        </p>
      </div>

      {saveSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 text-xs text-green-800 rounded-xl flex items-center gap-2 dark:bg-green-950/40 dark:border-green-800 dark:text-green-200">
          <Check className="w-4 h-4 text-green-600 shrink-0" />
          <span>Đã lưu cài đặt tài khoản thành công!</span>
        </div>
      )}

      {/* 1. SỬA HỒ SƠ */}
      <form onSubmit={handleSaveProfile} className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center gap-2 border-b border-surface-border pb-3">
          <User className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-text-main">Hồ Sơ Hiển Thị</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Tên hiển thị công khai *"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            helperText="Tên này sẽ hiện trên tin đăng và trong chat"
          />
          <Input
            label="Số Zalo liên hệ *"
            value={zaloPhone}
            onChange={(e) => setZaloPhone(e.target.value)}
            helperText="Chỉ hiển thị khi có yêu cầu giữ chỗ được duyệt"
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" size="sm">
            Lưu Thay Đổi
          </Button>
        </div>
      </form>

      {/* 2. CÀI ĐẶT THÔNG BÁO */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center gap-2 border-b border-surface-border pb-3">
          <Bell className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-text-main">Cài Đặt Thông Báo</h2>
        </div>

        <div className="space-y-3 text-xs">
          <label className="flex items-center justify-between p-3 rounded-xl border border-surface-border hover:bg-surface-muted/40 cursor-pointer">
            <div>
              <span className="font-bold text-text-main block">
                Thông báo trong ứng dụng
              </span>
              <span className="text-text-muted">
                Nhận tin khi có người giữ chỗ, tin nhắn mới, kết quả xác minh thẻ.
              </span>
            </div>
            <input
              type="checkbox"
              checked={notifyApp}
              onChange={(e) => setNotifyApp(e.target.checked)}
              className="w-4 h-4 rounded text-primary focus:ring-primary"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-xl border border-surface-border hover:bg-surface-muted/40 cursor-pointer">
            <div>
              <span className="font-bold text-text-main block">
                Thông báo qua Email
              </span>
              <span className="text-text-muted">
                Nhắc nhở khi tin đăng sắp hết hạn trước 2 ngày và tóm tắt giao dịch.
              </span>
            </div>
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.checked)}
              className="w-4 h-4 rounded text-primary focus:ring-primary"
            />
          </label>
        </div>
      </div>

      {/* 3. QUYỀN DỮ LIỆU CÁ NHÂN (EXPORT & DELETE) */}
      <div className="bg-surface border border-surface-border rounded-2xl p-6 shadow-card space-y-4">
        <div className="flex items-center gap-2 border-b border-surface-border pb-3">
          <Lock className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-text-main">Quyền Dữ Liệu Cá Nhân</h2>
        </div>

        <div className="space-y-4 text-xs text-text-secondary leading-relaxed">
          <div className="p-3.5 bg-surface-muted rounded-xl flex items-start justify-between gap-4">
            <div>
              <span className="font-bold text-text-main block">
                Tải về dữ liệu cá nhân của bạn (.JSON)
              </span>
              <span className="text-text-muted text-[11px]">
                Xuất toàn bộ tin đăng, lịch sử giữ chỗ, hồ sơ cá nhân và nhật ký theo Nghị định 356/2025/NĐ-CP.
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download className="w-3.5 h-3.5" />}
              onClick={handleExportData}
            >
              Tải Về
            </Button>
          </div>

          <div className="p-3.5 bg-red-50/60 border border-red-200 rounded-xl flex items-start justify-between gap-4 dark:bg-red-950/20 dark:border-red-900">
            <div>
              <span className="font-bold text-red-700 dark:text-red-300 block">
                Xóa vĩnh viễn tài khoản & Dữ liệu
              </span>
              <span className="text-red-600/80 dark:text-red-400 text-[11px]">
                Xóa sạch mọi tin đăng, ảnh thẻ, hội thoại chat, mã băm sinh viên studentIdHash và vô hiệu hóa tài khoản.
              </span>
            </div>
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => setIsDeleteModalOpen(true)}
            >
              Xóa Tài Khoản
            </Button>
          </div>
        </div>
      </div>

      {/* Modal xác nhận Xóa tài khoản */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Xác nhận xóa tài khoản vĩnh viễn"
        description="Hành động này không thể khôi phục lại. Toàn bộ tin đăng và hình ảnh của bạn sẽ bị xóa sạch."
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-red-50 text-red-800 rounded-xl border border-red-200 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span>Cảnh báo dữ liệu:</span>
            </p>
            <p>• Nếu bạn còn giao dịch đang giữ chỗ, bạn cần hủy hoặc hoàn tất trước.</p>
            <p>• Mã băm studentIdHash sẽ được xóa để bạn có thể đăng ký lại sau này nếu có nhu cầu.</p>
          </div>

          <div className="space-y-1.5">
            <label className="font-bold text-text-main block">
              Gõ chính xác cụm từ <span className="text-red-600 font-mono">XÓA TÀI KHOẢN</span> để xác nhận:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="XÓA TÀI KHOẢN"
              className="w-full h-11 px-3 bg-surface border border-surface-border rounded-lg text-text-main focus:outline-none focus:ring-2 focus:ring-red-500 font-bold"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsDeleteModalOpen(false)}
            >
              Hủy
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={confirmText !== "XÓA TÀI KHOẢN" || isDeleting}
              isLoading={isDeleting}
              onClick={handleDeleteAccount}
            >
              Xác Nhận Xóa Vĩnh Viễn
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
