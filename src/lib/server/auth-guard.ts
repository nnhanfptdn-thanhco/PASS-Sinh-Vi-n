import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import { ApiError } from "./http";

export interface AuthenticatedUser {
  token: DecodedIdToken;
  uid: string;
  email: string | null;
  name: string | null;
}

export interface VerifiedUser extends AuthenticatedUser {
  verificationStatus: "approved";
  schoolCode?: string;
  studentIdLast4?: string;
}

/**
 * Xác thực Bearer Token từ Header Authorization
 * Bắt buộc kiểm tra token có bị revoke hoặc tài khoản bị vô hiệu hóa (checkRevoked = true)
 */
export async function requireAuth(req: NextRequest): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("authorization") || "";
  const match = /^Bearer (.+)$/i.exec(authHeader);

  if (!match) {
    throw new ApiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập để tiếp tục.");
  }

  const tokenString = match[1];

  try {
    const decoded = await adminAuth.verifyIdToken(tokenString, true);
    return {
      token: decoded,
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("revoked") || msg.includes("disabled")) {
      throw new ApiError(401, "SESSION_REVOKED", "Phiên đăng nhập đã bị thu hồi hoặc tài khoản bị vô hiệu hóa.");
    }
    throw new ApiError(401, "INVALID_TOKEN", "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  }
}

/**
 * Yêu cầu tài khoản đã được phê duyệt thẻ sinh viên
 * Nguồn sự thật: Collection verifications/{uid}.status === 'approved' trong Firestore
 * (Hoặc token.admin === true cho quản trị viên)
 */
export async function requireVerified(req: NextRequest): Promise<VerifiedUser> {
  const auth = await requireAuth(req);

  // Admin có quyền vượt qua
  if (auth.token.admin === true || auth.token.role === "admin") {
    return {
      ...auth,
      verificationStatus: "approved",
    };
  }

  // Đọc Firestore làm Single Source of Truth, không tin claim cũ hay client
  const verifDoc = await adminDb.collection("verifications").doc(auth.uid).get();

  if (!verifDoc.exists || verifDoc.data()?.status !== "approved") {
    throw new ApiError(
      403,
      "FORBIDDEN_NOT_VERIFIED",
      "Tính năng này chỉ dành cho sinh viên đã được phê duyệt thẻ sinh viên."
    );
  }

  const verifData = verifDoc.data() || {};

  return {
    ...auth,
    verificationStatus: "approved",
    schoolCode: verifData.schoolCode,
    studentIdLast4: verifData.studentIdLast4,
  };
}

/**
 * Yêu cầu quyền Quản trị viên (Admin)
 */
export async function requireAdmin(req: NextRequest): Promise<AuthenticatedUser> {
  const auth = await requireAuth(req);

  if (auth.token.admin !== true && auth.token.role !== "admin") {
    throw new ApiError(403, "FORBIDDEN_NOT_ADMIN", "Bạn không có quyền thực hiện thao tác quản trị.");
  }

  return auth;
}
