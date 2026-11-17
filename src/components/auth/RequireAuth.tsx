"use client";

import * as React from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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
        <p className="text-xs text-text-muted">Đang kiểm tra trạng thái đăng nhập...</p>
      </div>
    );
  }

  return <>{children}</>;
}
