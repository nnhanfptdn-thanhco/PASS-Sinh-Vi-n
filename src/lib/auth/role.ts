export type UserRole = "guest" | "pending" | "verified" | "admin";

/**
 * Quyền hạn suy ra duy nhất từ Firebase Auth Custom Claims (Single Source of Truth).
 * Tuyệt đối không hardcode hoặc để lộ danh sách email admin ra client bundle.
 */
export function deriveRole(claims: Record<string, unknown>) {
  const isAdmin = claims.admin === true || claims.role === "admin";
  const isVerified = claims.verified === true || claims.role === "verified" || isAdmin;
  const role: UserRole = isAdmin ? "admin" : isVerified ? "verified" : "pending";
  return { isAdmin, isVerified, role, adminClaimMissing: false };
}
