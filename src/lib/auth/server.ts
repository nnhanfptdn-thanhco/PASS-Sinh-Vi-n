import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { ApiError } from "@/lib/server/http";
import {
  requireAuth,
  requireVerified as canonicalRequireVerified,
  requireApprovedStudent as canonicalRequireApprovedStudent,
  requireAdmin as canonicalRequireAdmin,
  type AuthenticatedUser,
  type VerifiedUser,
} from "@/lib/server/auth-guard";

export class HttpError extends ApiError {
  constructor(status: number, message: string, code?: string) {
    super(status, code || `HTTP_${status}`, message);
    this.name = "HttpError";
  }
}

export type ApprovedStudentResult = VerifiedUser;

/**
 * Facade ủy thác 100% sang canonical guard tại `@/lib/server/auth-guard`.
 * Không có logic verify độc lập hoặc bản guard yếu hơn.
 */
export async function requireUser(
  req: NextRequest,
  options?: { allowInactiveAccount?: boolean }
): Promise<DecodedIdToken> {
  const auth: AuthenticatedUser = await requireAuth(req, options);
  return auth.token;
}

export async function requireApprovedStudent(req: NextRequest): Promise<ApprovedStudentResult> {
  return canonicalRequireApprovedStudent(req);
}

export async function requireVerified(req: NextRequest): Promise<DecodedIdToken> {
  const verified = await canonicalRequireVerified(req);
  return verified.token;
}

export async function requireAdmin(req: NextRequest): Promise<DecodedIdToken> {
  const admin = await canonicalRequireAdmin(req);
  return admin.token;
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }
  console.error("API Error:", err instanceof Error ? err.message : "unknown");
  return NextResponse.json(
    { error: "Lỗi nội bộ máy chủ", code: "INTERNAL_SERVER_ERROR" },
    { status: 500 }
  );
}
