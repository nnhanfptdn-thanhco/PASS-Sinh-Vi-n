"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { copyCurrentUrlToClipboard } from "@/lib/utils/webview";
import {
  GraduationCap,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const { user, role, loginWithGoogle, loginWithDemo, isWebView, errorMessage, clearError } =
    useAuth();
  const [copied, setCopied] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    // Nếu đã đăng nhập và là thành viên, chuyển hướng phù hợp
    if (user) {
      if (role === "verified" || role === "admin") {
        router.push("/");
      } else {
        router.push("/auth/onboarding");
      }
    }
  }, [user, role, router]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    await loginWithGoogle();
    setIsLoading(false);
  };

  const handleCopyLink = async () => {
    const success = await copyCurrentUrlToClipboard();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-surface border border-surface-border rounded-2xl p-6 sm:p-8 shadow-card space-y-6 text-center">
        {/* Logo */}
        <div className="w-14 h-14 rounded-2xl bg-primary text-white flex items-center justify-center mx-auto shadow-subtle">
          <GraduationCap className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold text-text-main">
            Đăng Nhập Chợ Pass SV
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            Dành riêng cho cộng đồng sinh viên các trường đại học, cao đẳng toàn quốc.
          </p>
        </div>

        {/* CẢNH BÁO TRÌNH DUYỆT NHÚNG (ZALO, FACEBOOK WEBVIEW) */}
        {isWebView && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-left space-y-3 dark:bg-amber-950/60 dark:border-amber-700">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-bold text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>Phát hiện trình duyệt Zalo/Facebook</span>
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              Google bảo mật chặn đăng nhập trong app Zalo/Facebook. Vui lòng bấm vào dấu <strong>ba chấm (...)</strong> góc trên bên phải và chọn <strong>&ldquo;Mở bằng trình duyệt ngoài&rdquo;</strong> (Chrome hoặc Safari).
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              leftIcon={copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              onClick={handleCopyLink}
            >
              {copied ? "Đã sao chép liên kết!" : "Sao chép liên kết trang"}
            </Button>
          </div>
        )}

        {/* LỖI NẾU CÓ */}
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 text-left flex items-start justify-between gap-2 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300">
            <span>{errorMessage}</span>
            <button
              onClick={clearError}
              className="text-red-500 hover:text-red-700 font-bold text-sm leading-none"
            >
              &times;
            </button>
          </div>
        )}

        {/* NÚT TIẾP TỤC VỚI GOOGLE */}
        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading || isWebView}
            className="w-full h-12 px-4 rounded-xl border border-surface-border bg-surface hover:bg-surface-muted text-text-main font-semibold text-sm flex items-center justify-center gap-3 transition-all shadow-subtle hover:border-primary/50 disabled:opacity-50 disabled:pointer-events-none"
          >
            {/* Google SVG Logo */}
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>{isLoading ? "Đang kết nối..." : "Tiếp tục với Google"}</span>
          </button>

          <p className="text-[11px] text-text-muted leading-relaxed">
            Hệ thống chỉ sử dụng tài khoản Google để xác thực an toàn. Bạn không cần tạo hoặc nhớ thêm mật khẩu.
          </p>
        </div>

        {/* ĐĂNG NHẬP TRẢI NGHIỆM NHANH (DEMO MODE) */}
        <div className="pt-2 border-t border-surface-border space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-[1px] bg-surface-border flex-1" />
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Hoặc dùng thử ngay
            </span>
            <div className="h-[1px] bg-surface-border flex-1" />
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              onClick={() => {
                loginWithDemo("verified");
                router.push("/");
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-primary-light border border-primary/30 text-primary font-bold text-xs hover:bg-primary/20 transition-all flex items-center justify-center gap-2"
            >
              <span>🎓</span>
              <span>Đăng nhập thử (Sinh viên đã duyệt thẻ SV)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                loginWithDemo("pending");
                router.push("/auth/onboarding");
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-surface border border-surface-border text-text-secondary font-medium text-xs hover:bg-surface-muted transition-all flex items-center justify-center gap-2"
            >
              <span>📝</span>
              <span>Đăng nhập thử (Sinh viên mới - Vào xác thực thẻ)</span>
            </button>
          </div>

          <p className="text-[10px] text-text-muted">
            Tài khoản dùng thử giúp bạn và bạn bè test ngay lập tức các chức năng Đăng bài, Chat 1-1, Đặt gạch 24h trên điện thoại.
          </p>
        </div>

        {/* LƯU Ý BẢO MẬT & ĐIỀU KHOẢN */}
        <div className="pt-4 border-t border-surface-border text-xs text-text-secondary space-y-2">
          <div className="flex items-center justify-center gap-1.5 text-text-muted">
            <Badge variant="verified" className="text-[10px] py-0">
              Bảo mật 100%
            </Badge>
            <span>Tuân thủ Luật BV Dữ liệu cá nhân 2025</span>
          </div>

          <p className="text-[11px] text-text-muted">
            Bằng việc tiếp tục, bạn đồng ý với{" "}
            <Link href="/terms" className="text-primary hover:underline">
              Điều khoản Dịch vụ
            </Link>{" "}
            và{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Chính sách Dữ liệu Cá nhân
            </Link>{" "}
            của Chợ Pass Sinh Viên.
          </p>
        </div>
      </div>
    </div>
  );
}
