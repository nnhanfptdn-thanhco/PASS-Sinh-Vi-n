"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { ShieldAlert, Loader2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export function RequireVerified({ children }: { children: React.ReactNode }) {
  const { user, profile, role, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isVerified =
    role === "admin" ||
    role === "verified" ||
    profile?.verificationStatus === "approved";

  React.useEffect(() => {
    if (!isLoading && !user) {
      const nextParam = pathname ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/auth/login${nextParam}`);
    }
  }, [user, isLoading, router, pathname]);

  if (isLoading || !user) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-3" />
        <p className="text-xs text-text-muted">Đang kiểm tra quyền hạn sinh viên...</p>
      </div>
    );
  }

  if (!isVerified) {
    const isPending = profile?.verificationStatus === "pending";

    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-surface border border-surface-border rounded-2xl p-6 sm:p-8 text-center space-y-5 shadow-card">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-heading font-extrabold text-text-main">
              {isPending ? "Hồ sơ đang chờ duyệt thẻ" : "Cần xác thực thẻ sinh viên"}
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              {isPending
                ? "Thẻ sinh viên của bạn đang được Ban Quản Trị xét duyệt. Vui lòng quay lại sau ít phút hoặc theo dõi thông báo."
                : "Tính năng này chỉ dành riêng cho sinh viên các trường đã xác thực thẻ để đảm bảo an toàn giao dịch."}
            </p>
          </div>

          <div className="pt-2 flex flex-col gap-2.5">
            {!isPending && (
              <Link href="/auth/onboarding">
                <Button
                  variant="primary"
                  className="w-full"
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Xác minh thẻ sinh viên ngay
                </Button>
              </Link>
            )}
            <Link href="/">
              <Button variant="outline" className="w-full">
                Quay về trang chủ
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
