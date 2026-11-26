import "server-only";
import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import { ApiError } from "./http";
import { hasAdminClaim } from "./claims";

export type AccountStatus = "active" | "deleting" | "banned" | "disabled" | "deleted";

export interface AuthenticatedUser {
  token: DecodedIdToken;
  uid: string;
  email: string | null;
  name: string | null;
  claims: Record<string, unknown>;
  isAdmin: boolean;
  isVerifiedStudent: boolean;
  accountStatus: AccountStatus;
  userDoc: Record<string, unknown> | null;
}

export interface VerifiedUser extends AuthenticatedUser {
  isVerifiedStudent: true;
  verificationStatus: "approved";
  verification: Record<string, unknown>;
  schoolCode?: string;
  studentIdLast4?: string;
}

export interface RequireAuthOptions {
  /** Chỉ bật với route kiểm tra/xử lý đặc biệt; mọi route mutation phải giữ false (mặc định). */
  allowInactiveAccount?: boolean;
}

function isCredentialOrPermissionError(code: string, msg: string): boolean {
  const lowerMsg = msg.toLowerCase();
  const lowerCode = code.toLowerCase();
  return (
    lowerMsg.includes("default credentials") ||
    lowerMsg.includes("could not load the default credentials") ||
    lowerMsg.includes("permission denied") ||
    lowerMsg.includes("permission_denied") ||
    lowerMsg.includes("insufficient permission") ||
    lowerMsg.includes("unauthenticated") ||
    lowerMsg.includes("metadata") ||
    lowerCode === "app/invalid-credential" ||
    lowerCode === "auth/insufficient-permission" ||
    lowerCode === "permission-denied"
  );
}

function isExplicitRevocationError(code: string, msg: string): boolean {
  const lowerMsg = msg.toLowerCase();
  return (
    code === "auth/id-token-revoked" ||
    code === "auth/user-disabled" ||
    lowerMsg.includes("revoked") ||
    lowerMsg.includes("disabled")
  );
}

function isExplicitInvalidTokenError(code: string, msg: string): boolean {
  const lowerMsg = msg.toLowerCase();
  return (
    code === "auth/id-token-expired" ||
    code === "auth/invalid-id-token" ||
    code === "auth/argument-error" ||
    lowerMsg.includes("expired") ||
    lowerMsg.includes("decoding firebase id token failed") ||
    lowerMsg.includes("firebase id token has invalid")
  );
}

/**
 * Đọc trạng thái tài khoản trực tiếp từ Firestore (`users/{uid}` và `pendingDeletions/{uid}`).
 * Fail-closed nếu Firestore gặp lỗi hạ tầng (ném 503).
 */
async function loadAccountState(uid: string): Promise<{
  accountStatus: AccountStatus;
  userDoc: Record<string, unknown> | null;
}> {
  try {
    const [userSnap, pendingDelSnap] = await Promise.all([
      adminDb.collection("users").doc(uid).get(),
      adminDb.collection("pendingDeletions").doc(uid).get(),
    ]);

    const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : null;
    const pendingData = pendingDelSnap.exists
      ? (pendingDelSnap.data() as Record<string, unknown>)
      : null;

    const hasDeletionMarker = Boolean(
      pendingDelSnap.exists &&
        pendingData &&
        (pendingData.deletionState === "pending" ||
          pendingData.status === "pending" ||
          pendingData.startedAt !== undefined ||
          (pendingData.userId === uid && pendingData.status !== "approved"))
    );

    let accountStatus: AccountStatus = "active";
    if (
      userData?.deleted === true ||
      userData?.deletionState === "deleted" ||
      userData?.accountStatus === "deleted"
    ) {
      accountStatus = "deleted";
    } else if (
      hasDeletionMarker ||
      userData?.deletionState === "pending" ||
      userData?.deletionState === "deleting" ||
      userData?.accountStatus === "deleting"
    ) {
      accountStatus = "deleting";
    } else if (
      userData?.status === "banned" ||
      userData?.accountStatus === "banned"
    ) {
      accountStatus = "banned";
    } else if (
      userData?.status === "disabled" ||
      userData?.disabled === true ||
      userData?.accountStatus === "disabled"
    ) {
      accountStatus = "disabled";
    }

    return { accountStatus, userDoc: userData };
  } catch (err: unknown) {
    console.error(
      "[AUTH_GUARD] Firestore account state lookup failed:",
      err instanceof Error ? err.message : "unknown"
    );
    throw new ApiError(
      503,
      "AUTH_SERVICE_UNAVAILABLE",
      "Không thể kiểm tra trạng thái tài khoản lúc này. Vui lòng thử lại sau."
    );
  }
}

export function assertAccountActive(auth: AuthenticatedUser): void {
  if (auth.accountStatus === "deleting") {
    throw new ApiError(
      423,
      "ACCOUNT_DELETING",
      "Tài khoản đang trong quá trình xóa vĩnh viễn và đã bị khóa mọi thao tác mới."
    );
  }
  if (
    auth.accountStatus === "banned" ||
    auth.accountStatus === "disabled" ||
    auth.accountStatus === "deleted"
  ) {
    throw new ApiError(
      403,
      "ACCOUNT_INACTIVE",
      "Tài khoản đã bị khóa, vô hiệu hóa hoặc đã xóa khỏi hệ thống."
    );
  }
}

async function verifyBearerTokenStrict(tokenString: string): Promise<DecodedIdToken> {
  try {
    return await adminAuth.verifyIdToken(tokenString, true);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || "";
    const msg = err instanceof Error ? err.message : String(err || "");
    console.error("[AUTH_GUARD] verifyIdToken(checkRevoked=true) failed:", code || msg);

    if (isExplicitRevocationError(code, msg)) {
      throw new ApiError(
        401,
        "SESSION_REVOKED",
        "Phiên đăng nhập đã bị thu hồi hoặc tài khoản bị vô hiệu hóa."
      );
    }

    if (isExplicitInvalidTokenError(code, msg)) {
      throw new ApiError(
        401,
        "INVALID_TOKEN",
        "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."
      );
    }

    if (isCredentialOrPermissionError(code, msg)) {
      throw new ApiError(
        503,
        "AUTH_REVOCATION_CHECK_UNAVAILABLE",
        "Máy chủ chưa đủ quyền hoặc thiếu thông tin xác thực để kiểm tra thu hồi phiên đăng nhập."
      );
    }

    throw new ApiError(
      503,
      "AUTH_SERVICE_UNAVAILABLE",
      "Dịch vụ xác thực tạm thời không khả dụng. Vui lòng thử lại sau."
    );
  }
}

/**
 * Guard xác thực Canonical (Single Source of Truth):
 * - Bắt buộc kiểm tra `verifyIdToken(tokenString, true)` (checkRevoked = true).
 * - TUYỆT ĐỐI KHÔNG fallback sang `verifyIdToken(tokenString, false)` khi thiếu credentials hay lỗi ADC.
 * - Kiểm tra trạng thái sống của tài khoản từ Firestore (`active`, `deleting`, `banned`, `disabled`, `deleted`).
 */
export async function requireAuth(
  req: NextRequest,
  options: RequireAuthOptions = {}
): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("authorization") || "";
  const match = /^Bearer (.+)$/i.exec(authHeader);

  if (!match || !match[1].trim()) {
    throw new ApiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập.");
  }

  const decoded = await verifyBearerTokenStrict(match[1].trim());
  const claims = (decoded as unknown as Record<string, unknown>) || {};
  const isAdmin = hasAdminClaim(claims);

  const { accountStatus, userDoc } = await loadAccountState(decoded.uid);

  const identity: AuthenticatedUser = {
    token: decoded,
    uid: decoded.uid,
    email: decoded.email || null,
    name: decoded.name || null,
    claims,
    isAdmin,
    isVerifiedStudent: false,
    accountStatus,
    userDoc,
  };

  if (!options.allowInactiveAccount) {
    assertAccountActive(identity);
  }

  return identity;
}

/**
 * Yêu cầu tài khoản đã xác thực, token chưa bị thu hồi và trạng thái tài khoản đang `active`.
 */
export async function requireActiveUser(req: NextRequest): Promise<AuthenticatedUser> {
  const auth = await requireAuth(req, { allowInactiveAccount: false });
  assertAccountActive(auth);
  return auth;
}

/**
 * Yêu cầu tài khoản đang active và đã được phê duyệt thẻ sinh viên trên Firestore (`verifications/{uid}.status === "approved"`).
 * Admin bypass chỉ dựa trên claim admin hợp lệ nhưng KHÔNG bỏ qua revoke check hay khóa deleting/banned/disabled.
 */
export async function requireVerified(req: NextRequest): Promise<VerifiedUser> {
  const auth = await requireActiveUser(req);

  if (auth.isAdmin) {
    return {
      ...auth,
      isVerifiedStudent: true,
      verificationStatus: "approved",
      verification: { status: "approved", schoolCode: "ADMIN", role: "admin" },
    };
  }

  let verifSnap: FirebaseFirestore.DocumentSnapshot;
  try {
    verifSnap = await adminDb.collection("verifications").doc(auth.uid).get();
  } catch (err: unknown) {
    console.error(
      "[AUTH_GUARD] Firestore verification lookup failed:",
      err instanceof Error ? err.message : "unknown"
    );
    throw new ApiError(
      503,
      "AUTH_SERVICE_UNAVAILABLE",
      "Không thể kiểm tra hồ sơ xác minh sinh viên lúc này. Vui lòng thử lại sau."
    );
  }

  if (!verifSnap.exists) {
    throw new ApiError(
      403,
      "FORBIDDEN_NOT_VERIFIED",
      "Tài khoản chưa nộp hồ sơ xác minh sinh viên."
    );
  }

  const verifData = (verifSnap.data() || {}) as Record<string, unknown>;
  const status = verifData.status;

  if (status === "expired") {
    throw new ApiError(
      403,
      "FORBIDDEN_VERIFICATION_EXPIRED",
      "Hồ sơ thẻ sinh viên của bạn đã hết hạn. Vui lòng nộp lại thẻ để gia hạn."
    );
  }

  if (status !== "approved") {
    throw new ApiError(
      403,
      "FORBIDDEN_NOT_VERIFIED",
      "Tài khoản đang chờ duyệt hoặc chưa được duyệt thẻ sinh viên."
    );
  }

  return {
    ...auth,
    isVerifiedStudent: true,
    verificationStatus: "approved",
    verification: verifData,
    schoolCode: (verifData.schoolCode as string) || undefined,
    studentIdLast4: (verifData.studentIdLast4 as string) || undefined,
  };
}

/**
 * Alias tương thích ngữ nghĩa với các Route Handler dành cho sinh viên đã duyệt.
 */
export async function requireApprovedStudent(req: NextRequest): Promise<VerifiedUser> {
  return requireVerified(req);
}

/**
 * Yêu cầu quyền Quản trị viên (Admin):
 * - Dùng cùng canonical token verifier (checkRevoked = true) + active account check.
 * - Chỉ tin claim `admin: true` (hoặc `role === "admin"`) từ server token đã xác minh.
 */
export async function requireAdmin(req: NextRequest): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("authorization") || "";
  const match = /^Bearer (.+)$/i.exec(authHeader);
  if (!match || !match[1].trim()) {
    throw new ApiError(401, "UNAUTHORIZED", "Vui lòng đăng nhập.");
  }

  // Verify token & revocation first via same single verifier helper, fail-fast 403 if non-admin before Firestore lookup
  const decoded = await verifyBearerTokenStrict(match[1].trim());
  const claims = (decoded as unknown as Record<string, unknown>) || {};
  if (!hasAdminClaim(claims)) {
    throw new ApiError(
      403,
      "FORBIDDEN_NOT_ADMIN",
      "Bạn không có quyền thực hiện thao tác quản trị."
    );
  }

  const { accountStatus, userDoc } = await loadAccountState(decoded.uid);
  const auth: AuthenticatedUser = {
    token: decoded,
    uid: decoded.uid,
    email: decoded.email || null,
    name: decoded.name || null,
    claims,
    isAdmin: true,
    isVerifiedStudent: false,
    accountStatus,
    userDoc,
  };
  assertAccountActive(auth);
  return auth;
}
