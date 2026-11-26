import { hasAdminCredentials } from "@/lib/firebase/admin";
import { ApiError } from "./http";

/**
 * API GHI/ADMIN không được giả thành công khi thiếu Service Account / ADC ở môi trường chạy thực tế.
 */
export function assertAdminSdkReady(): void {
  if (!hasAdminCredentials && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new ApiError(
      503,
      "ADMIN_SDK_NOT_CONFIGURED",
      "Máy chủ chưa nạp Firebase Service Account hoặc ADC. Thao tác bị chặn để tránh mất dữ liệu."
    );
  }
}
