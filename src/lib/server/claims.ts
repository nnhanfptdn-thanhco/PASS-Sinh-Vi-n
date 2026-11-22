import { adminAuth } from "@/lib/firebase/admin";

export function hasAdminClaim(c: Record<string, unknown> | undefined | null): boolean {
  return c?.admin === true || c?.role === "admin";
}

/** Đồng bộ claim `verified`; KHÔNG BAO GIỜ làm rớt quyền admin. Trả về true nếu thành công. */
export async function setVerifiedClaim(uid: string, verified: boolean): Promise<boolean> {
  try {
    const rec = await adminAuth.getUser(uid);
    const claims = { ...(rec.customClaims || {}) } as Record<string, unknown>;
    if (claims.verified === verified) return true;
    const isAdmin = hasAdminClaim(claims);
    claims.verified = verified;
    claims.role = isAdmin ? "admin" : verified ? "verified" : "pending";
    if (isAdmin) claims.admin = true; // chuẩn hóa dạng claim admin
    await adminAuth.setCustomUserClaims(uid, claims);
    return true;
  } catch (e) {
    console.error("[CLAIMS] sync failed", e instanceof Error ? e.message : "unknown");
    return false;
  }
}
