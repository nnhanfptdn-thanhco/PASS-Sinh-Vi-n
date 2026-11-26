"use client";

import * as React from "react";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  isAndroidDevice,
  isIOSDevice,
  getAndroidChromeIntentUrl,
  copyCurrentUrlToClipboard,
} from "@/lib/utils/webview";
import { safeNext } from "@/lib/utils/url";
import {
  GraduationCap,
  Copy,
  Check,
  AlertCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const targetNext = safeNext(rawNext);

  const {
    user,
    profile,
    role,
    isLoading: isAuthLoading,
    isVerificationLoaded,
    isSigningIn,
    loginWithGoogle,
    isWebView,
    errorMessage,
    clearError,
  } = useAuth();

  const [copied, setCopied] = React.useState(false);
  const [isAndroid, setIsAndroid] = React.useState(false);
  const [isIOS, setIsIOS] = React.useState(false);

  React.useEffect(() => {
    setIsAndroid(isAndroidDevice());
    setIsIOS(isIOSDevice());
  }, []);

  // Điều hướng dựa trên trạng thái người dùng (chờ isVerificationLoaded để không redirect sai sang /auth/onboarding)
  React.useEffect(() => {
    if (user && !isAuthLoading) {
      const vStatus = profile?.verificationStatus;

      if (
        role === "admin" ||
        role === "verified" ||
        vStatus === "approved" ||
        vStatus === "pending"
      ) {
        router.replace(targetNext !== "/" ? targetNext : "/");
      } else if (
        isVerificationLoaded &&
        (vStatus === "none" || vStatus === "rejected" || vStatus === "expired")
      ) {
        router.replace("/auth/onboarding");
      }
    }
  }, [user, profile, role, isAuthLoading, isVerificationLoaded, targetNext, router]);

  const handleGoogleLogin = async () => {
    clearError();
    await loginWithGoogle();
    // Không dùng window.location.href="/" ở đây để tránh làm mất lỗi hoặc chuyển hướng sai trang
  };

  const handleCopyLink = async () => {
    const success = await copyCurrentUrlToClipboard();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const isBusy = isSigningIn || (user !== null && isAuthLoading);

  return (
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
            {isIOS
              ? "Google bảo mật chặn đăng nhập trong trình duyệt nhúng của Zalo/Facebook/TikTok trên iPhone & iPad. Vui lòng bấm biểu tượng la bàn Safari hoặc nút ba chấm (...) rồi chọn 'Mở bằng Safari', hoặc sao chép liên kết bên dưới dán vào Safari."
              : "Google bảo mật chặn đăng nhập trong app Zalo/Facebook/TikTok. Vui lòng mở bằng trình duyệt hệ thống bên ngoài để tiếp tục an toàn."}
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {isAndroid && (
              <a
                href={getAndroidChromeIntentUrl()}
                className="w-full h-9 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Mở bằng Google Chrome (Android)</span>
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              leftIcon={
                copied ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )
              }
              onClick={handleCopyLink}
            >
              {copied ? "Đã sao chép liên kết!" : "Sao chép liên kết trang"}
            </Button>
          </div>
        </div>
      )}

      {/* LỖI NẾU CÓ (Hiển thị bền vững, có nút tắt) */}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 text-left flex items-start justify-between gap-2 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            aria-label="Đóng thông báo lỗi"
            className="text-red-500 hover:text-red-700 font-bold text-base leading-none p-0.5"
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
          disabled={isBusy || isWebView}
          aria-busy={isBusy}
          className="w-full h-12 px-4 rounded-xl border border-surface-border bg-surface hover:bg-surface-muted text-text-main font-semibold text-sm flex items-center justify-center gap-3 transition-all shadow-subtle hover:border-primary/50 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
        >
          {isBusy ? (
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          ) : (
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
          )}
          <span>{isBusy ? "Đang kết nối xác thực..." : "Tiếp tục với Google"}</span>
        </button>

        <p className="text-[11px] text-text-muted leading-relaxed">
          Hệ thống chỉ sử dụng tài khoản Google để xác thực an toàn. Bạn không cần tạo hoặc nhớ thêm mật khẩu.
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
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[75vh] flex items-center justify-center px-4 py-8">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-surface border border-surface-border rounded-2xl p-8 shadow-card flex items-center justify-center min-h-[300px]">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
