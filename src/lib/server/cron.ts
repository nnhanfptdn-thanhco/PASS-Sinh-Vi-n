import crypto from "crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "./http";

/**
 * Kiểm tra xác thực yêu cầu Cron từ Vercel
 * Vercel tự động đính kèm header: Authorization: Bearer <CRON_SECRET>
 */
export function verifyCronRequest(request: NextRequest): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new ApiError(500, "CRON_SECRET_NOT_CONFIGURED", "Hệ thống chưa cấu hình khóa bí mật cron");
  }

  const authHeader = request.headers.get("authorization") || "";
  const m = /^Bearer (.+)$/i.exec(authHeader);
  if (!m) {
    throw new ApiError(401, "UNAUTHORIZED_CRON", "Khóa bí mật cron không hợp lệ");
  }

  const token = m[1].trim();
  const a = crypto.createHash("sha256").update(secret).digest();
  const b = crypto.createHash("sha256").update(token).digest();

  if (!crypto.timingSafeEqual(a, b)) {
    throw new ApiError(401, "UNAUTHORIZED_CRON", "Khóa bí mật cron không hợp lệ");
  }
}
