import { hasAdminCredentials } from "@/lib/firebase/admin";
import { ApiError } from "./http";

/** API GHI/ADMIN ở production không được "giả thành công" khi thiếu Service Account. */
export function assertAdminSdkReady(): void {
  if (!hasAdminCredentials) {
    throw new ApiError(
      503,
      "ADMIN_SDK_NOT_CONFIGURED",
      "Máy chủ chưa nạp Firebase Service Account. Thao tác bị chặn để tránh mất dữ liệu."
    );
  }
}
