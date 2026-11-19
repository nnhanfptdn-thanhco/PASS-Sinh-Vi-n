import { NextRequest } from "next/server";
import { ApiError } from "./http";

/**
 * Kiểm tra xác thực yêu cầu Cron từ Vercel
 * Vercel tự động đính kèm header: Authorization: Bearer <CRON_SECRET>
 */
export function verifyCronRequest(request: NextRequest): void {
  const secret = process.env.CRON_SECRET;

  // Trong môi trường production, bắt buộc phải có CRON_SECRET
  if (process.env.NODE_ENV === "production" && !secret) {
    throw new ApiError(500, "CRON_SECRET_NOT_CONFIGURED", "Hệ thống chưa cấu hình khóa bí mật cron");
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ApiError(401, "UNAUTHORIZED_CRON", "Yêu cầu cron thiếu header ủy quyền Bearer");
  }

  const token = authHeader.substring(7).trim();
  const expectedSecret = secret || "dev_cron_secret";

  if (token !== expectedSecret) {
    throw new ApiError(401, "INVALID_CRON_SECRET", "Khóa bí mật cron không hợp lệ");
  }
}
