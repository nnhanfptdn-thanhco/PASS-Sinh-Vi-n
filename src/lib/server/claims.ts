import { adminAuth } from "@/lib/firebase/admin";

export function hasAdminClaim(c: Record<string, unknown> | undefined | null): boolean {
  return c?.admin === true || c?.role === "admin";
}

/** Đồng bộ claim `verified`; KHÔNG BAO GIỜ làm rớt quyền admin. Trả về true nếu thành công. */
export async function setVerifiedClaim(uid: string, verified: boolean): Promise<boolean> {
  try {
    const rec = await adminAuth.getUser(uid);
    const claims = { ...(rec.customClaims || {}) } as Record<string, unknown>;
    
    // Bảo vệ quyền admin: kiểm tra cả custom claims hiện tại lẫn email admin cấu hình
    const adminEmailsConfig = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "nnhanfptdn@gmail.com";
    const adminEmails = adminEmailsConfig
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isEmailAdmin = Boolean(
      rec.email && rec.emailVerified && adminEmails.includes(rec.email.toLowerCase())
    );
    const isAdmin = hasAdminClaim(claims) || isEmailAdmin;

    if (claims.verified === verified && (!isAdmin || claims.admin === true)) return true;

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
