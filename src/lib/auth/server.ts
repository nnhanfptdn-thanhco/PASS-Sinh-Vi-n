import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth } from "@/lib/firebase/admin";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Xác thực Bearer ID Token từ header Authorization.
 * Bắt buộc kiểm tra token có bị thu hồi (checkRevoked = true).
 */
export async function requireUser(req: NextRequest): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/i.exec(authHeader);
  if (!match) {
    throw new HttpError(401, "Vui lòng đăng nhập.");
  }

  const token = match[1];
  try {
    return await adminAuth.verifyIdToken(token, true);
  } catch {
    throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  }
}

/**
 * Yêu cầu người dùng đã xác minh thẻ sinh viên (verified === true) hoặc là admin.
 */
export async function requireVerified(req: NextRequest): Promise<DecodedIdToken> {
  const token = await requireUser(req);
  if (token.verified !== true && token.admin !== true) {
    throw new HttpError(403, "Tài khoản cần được xác minh thẻ sinh viên.");
  }
  return token;
}

/**
 * Yêu cầu quyền quản trị viên (admin === true).
 */
export async function requireAdmin(req: NextRequest): Promise<DecodedIdToken> {
  const token = await requireUser(req);
  if (token.admin !== true) {
    throw new HttpError(403, "Chỉ quản trị viên mới có quyền này.");
  }
  return token;
}

/**
 * Chuẩn hóa phản hồi lỗi cho API Routes.
 */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }

  if (process.env.NODE_ENV !== "production") {
    console.error("API error:", e instanceof Error ? e.stack || e.message : e);
  } else {
    console.error("API error:", e instanceof Error ? e.message : "unknown");
  }

  return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
}
