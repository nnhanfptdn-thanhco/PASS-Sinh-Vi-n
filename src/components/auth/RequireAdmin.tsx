"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { ShieldX, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, profile, role, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isAdmin = role === "admin" || profile?.isAdmin === true;

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
        <p className="text-xs text-text-muted">Đang kiểm tra quyền hạn quản trị viên...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-surface border border-surface-border rounded-2xl p-6 sm:p-8 text-center space-y-5 shadow-card">
          <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400 flex items-center justify-center mx-auto">
            <ShieldX className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-heading font-extrabold text-text-main">
              Truy cập bị từ chối
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Trang này chỉ dành riêng cho Quản trị viên (Admin) của hệ thống Chợ Pass Sinh Viên.
            </p>
          </div>

          <div className="pt-2">
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
