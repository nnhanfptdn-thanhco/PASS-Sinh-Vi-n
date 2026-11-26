"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { authFetch } from "@/lib/firebase/client";
import { RequireAuth } from "@/components/auth/RequireAuth";
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
  const { user, profile, logout, reauthenticateWithGoogle } = useAuth();

  const [displayName, setDisplayName] = React.useState(
    profile?.displayName || "Sinh viên"
  );
  const [zaloPhone] = React.useState("Được quản lý qua hồ sơ xác minh riêng tư");
  const [notifyApp, setNotifyApp] = React.useState(true);
  const [notifyEmail, setNotifyEmail] = React.useState(true);
  const [isSavingProfile, setIsSavingProfile] = React.useState(false);
  const [isSavingNotif, setIsSavingNotif] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [saveSuccess, setSaveSuccess] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (profile?.displayName) {
      setDisplayName(profile.displayName);
    }
  }, [profile?.displayName]);

  // Tải cấu hình thông báo thực tế từ server
  React.useEffect(() => {
    if (!user?.uid) return;
    let active = true;
    authFetch("/api/account/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!active || !json) return;
        if (typeof json.displayName === "string" && json.displayName.trim()) {
          setDisplayName(json.displayName);
        }
        if (typeof json.notifyApp === "boolean") setNotifyApp(json.notifyApp);
        if (typeof json.notifyEmail === "boolean") setNotifyEmail(json.notifyEmail);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user?.uid]);

  // Modal Xóa tài khoản
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [isDeleting, setIsDeleting] = React.useState(false);

  const flashSuccess = (msg: string) => {
    setSaveSuccess(msg);
    setTimeout(() => setSaveSuccess((cur) => (cur === msg ? null : cur)), 3500);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setSaveSuccess(null);
    setIsSavingProfile(true);
    try {
      const res = await authFetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveError(json?.error || "Không thể lưu tên hiển thị mới.");
        return;
      }
      flashSuccess("Đã lưu tên hiển thị mới thành công!");
    } catch {
      setSaveError("Lỗi kết nối máy chủ khi lưu hồ sơ.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleToggleNotification = async (
    field: "notifyApp" | "notifyEmail",
    nextValue: boolean
  ) => {
    const prevValue = field === "notifyApp" ? notifyApp : notifyEmail;
    if (field === "notifyApp") setNotifyApp(nextValue);
    else setNotifyEmail(nextValue);

    setSaveError(null);
    setIsSavingNotif(true);
    try {
      const res = await authFetch("/api/account/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: nextValue }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        if (field === "notifyApp") setNotifyApp(prevValue);
        else setNotifyEmail(prevValue);
        setSaveError(json?.error || "Không thể cập nhật cài đặt thông báo.");
        return;
      }
      flashSuccess("Đã cập nhật cài đặt thông báo!");
    } catch {
      if (field === "notifyApp") setNotifyApp(prevValue);
      else setNotifyEmail(prevValue);
      setSaveError("Lỗi kết nối khi lưu cài đặt thông báo.");
    } finally {
      setIsSavingNotif(false);
    }
  };

  const handleExportData = async (retried = false) => {
    setSaveError(null);
    setIsExporting(true);
    try {
      const res = await authFetch("/api/account/export");
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        if (res.status === 403 && err?.code === "REAUTH_REQUIRED" && !retried) {
          const reauthed = await reauthenticateWithGoogle();
          if (reauthed) {
            setIsExporting(false);
            await handleExportData(true);
            return;
          }
          setSaveError(
            "Phiên đăng nhập đã cũ hơn 10 phút. Vui lòng hoàn tất xác thực lại Google rồi bấm Tải Về lần nữa."
          );
          return;
        }
        setSaveError(err?.error || "Không thể xuất dữ liệu cá nhân.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chopass-data-${user?.uid || "me"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Trì hoãn thu hồi ObjectURL để iOS/iPadOS Safari kịp mở trình tải xuống
      setTimeout(() => window.URL.revokeObjectURL(url), 2500);
      flashSuccess("Đã tạo tệp xuất dữ liệu cá nhân (.JSON)!");
    } catch {
      setSaveError("Đã xảy ra lỗi khi xuất dữ liệu.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async (retried = false) => {
    if (confirmText !== "XÓA TÀI KHOẢN") {
      alert("Vui lòng gõ chính xác cụm từ 'XÓA TÀI KHOẢN' để xác nhận.");
      return;
    }

    setSaveError(null);
    setIsDeleting(true);
    try {
      const res = await authFetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 403 && data?.code === "REAUTH_REQUIRED" && !retried) {
          const reauthed = await reauthenticateWithGoogle();
          if (reauthed) {
            setIsDeleting(false);
            await handleDeleteAccount(true);
            return;
          }
          setSaveError(
            "Vui lòng xác thực lại tài khoản Google để đảm bảo an toàn, sau đó xác nhận xóa lại."
          );
          setIsDeleteModalOpen(false);
          return;
        }
        alert(data?.error || "Không thể xóa tài khoản");
        return;
      }

      alert(
        data?.message ||
          (res.status === 202
            ? "Tài khoản đã được khóa và đang trong hàng đợi dọn dữ liệu tự động."
            : "Tài khoản và dữ liệu cá nhân của bạn đã được xóa thành công.")
      );
      await logout();
      router.push("/");
    } catch {
      alert("Đã xảy ra lỗi kết nối");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <RequireAuth>
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
          <span>{saveSuccess}</span>
        </div>
      )}

      {saveError && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700 rounded-xl flex items-center gap-2 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{saveError}</span>
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
            helperText="Tên này sẽ hiện trên tin đăng và trong chat (được lọc thông tin liên hệ)"
          />
          <Input
            label="Số Zalo liên hệ riêng tư"
            value={zaloPhone}
            readOnly
            disabled
            helperText="Chỉ cung cấp cho người mua đã được chốt giữ chỗ qua luồng bảo mật Option A"
          />
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" variant="primary" size="sm" isLoading={isSavingProfile} disabled={isSavingProfile}>
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
              disabled={isSavingNotif}
              onChange={(e) => void handleToggleNotification("notifyApp", e.target.checked)}
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
              disabled={isSavingNotif}
              onChange={(e) => void handleToggleNotification("notifyEmail", e.target.checked)}
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
                Xuất tin đăng, giữ chỗ, đánh giá, chat và lịch sử NnhanAI tách biệt (hỗ trợ phân trang nếu hội thoại dài; không gồm ảnh thẻ gốc và bí mật hệ thống).
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              isLoading={isExporting}
              disabled={isExporting}
              leftIcon={<Download className="w-3.5 h-3.5" />}
              onClick={() => void handleExportData(false)}
            >
              Tải Về
            </Button>
          </div>

          <div className="p-3.5 bg-red-50/60 border border-red-200 rounded-xl flex items-start justify-between gap-4 dark:bg-red-950/20 dark:border-red-900">
            <div>
              <span className="font-bold text-red-700 dark:text-red-300 block">
                Xóa tài khoản & Quyền riêng tư
              </span>
              <span className="text-red-600/80 dark:text-red-400 text-[11px]">
                Xóa hồ sơ, tin đăng, ảnh, tin nhắn & studentIdHash và khóa Auth. Các bản ghi giao dịch/báo cáo đã ẩn danh (không còn PII trực tiếp) được lưu tối đa 90 ngày để phòng gian lận trước khi tự hủy.
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
            <p>• Nếu hệ thống đang dọn dữ liệu nền, tài khoản sẽ khóa ngay ở trạng thái chờ xử lý (202) và không thể đăng nhập lại.</p>
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
              onClick={() => void handleDeleteAccount(false)}
            >
              Xác Nhận Xóa Vĩnh Viễn
            </Button>
          </div>
        </div>
      </Modal>
    </div>
    </RequireAuth>
  );
}
