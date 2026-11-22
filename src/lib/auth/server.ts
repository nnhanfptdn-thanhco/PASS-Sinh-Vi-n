import { NextRequest, NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { ApiError } from "@/lib/server/http";
import { hasAdminClaim } from "@/lib/server/claims";

export class HttpError extends ApiError {
  constructor(status: number, message: string) {
    super(status, `HTTP_${status}`, message);
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
  try {
    // checkRevoked = true: token bị thu hồi / tài khoản bị disable PHẢI bị từ chối
    return await adminAuth.verifyIdToken(match[1], true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("revoked") || msg.includes("disabled")) {
      throw new HttpError(401, "Phiên đăng nhập đã bị thu hồi hoặc tài khoản bị vô hiệu hóa.");
    }
    throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  }
}

export interface ApprovedStudentResult {
  token: DecodedIdToken;
  verification: Record<string, unknown>;
  userDoc: Record<string, unknown>;
}

/**
 * YÊU CẦU SINH VIÊN ĐÃ ĐƯỢC DUYỆT THẺ (WP-0.4)
 * - Đọc trực tiếp Firestore verifications/{uid}.status === 'approved' (Single Source of Truth)
 * - Không tin tưởng custom claim cũ vì token có thể sống 1 giờ sau khi admin thu hồi/từ chối
 * - Trả về { token, verification, userDoc }
 * - Khi status === 'expired' trả 403 đúng SPEC
 */
export async function requireApprovedStudent(req: NextRequest): Promise<ApprovedStudentResult> {
  const token = await requireUser(req);

  // Admin có thể bỏ qua kiểm tra hồ sơ thẻ sinh viên
  if (hasAdminClaim(token)) {
    let userDoc: Record<string, unknown> = { displayName: token.name || "Quản trị viên" };
    try {
      const userSnap = await adminDb.collection("users").doc(token.uid).get();
      if (userSnap.exists) {
        userDoc = userSnap.data() as Record<string, unknown>;
      }
    } catch {
      // Fallback an toàn khi chưa thiết lập Firebase Admin
    }
    return {
      token,
      verification: { status: "approved", schoolCode: "ADMIN", role: "admin" },
      userDoc,
    };
  }

  const verifSnap = await adminDb.collection("verifications").doc(token.uid).get();

  if (!verifSnap.exists) {
    throw new HttpError(403, "Tài khoản chưa nộp hồ sơ xác minh sinh viên.");
  }

  const verifData = verifSnap.data() as Record<string, unknown>;
  const status = verifData.status;

  if (status === "expired") {
    throw new HttpError(403, "Hồ sơ thẻ sinh viên của bạn đã hết hạn. Vui lòng nộp lại thẻ để gia hạn.");
  }

  if (status !== "approved") {
    throw new HttpError(403, "Tài khoản đang chờ duyệt hoặc chưa được duyệt thẻ sinh viên.");
  }

  const userSnap = await adminDb.collection("users").doc(token.uid).get();
  const userDoc = userSnap.exists
    ? (userSnap.data() as Record<string, unknown>)
    : { displayName: token.name || "Sinh viên" };

  return {
    token,
    verification: verifData,
    userDoc,
  };
}

/**
 * Yêu cầu người dùng đã xác minh thẻ sinh viên (Single Source of Truth qua requireApprovedStudent).
 */
export async function requireVerified(req: NextRequest): Promise<DecodedIdToken> {
  const { token } = await requireApprovedStudent(req);
  return token;
}

/**
 * Yêu cầu quyền quản trị viên (admin === true).
 */
export async function requireAdmin(req: NextRequest): Promise<DecodedIdToken> {
  const token = await requireUser(req);
  if (!hasAdminClaim(token)) {
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
