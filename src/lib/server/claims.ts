import "server-only";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";

export function hasAdminClaim(c: Record<string, unknown> | undefined | null): boolean {
  return c?.admin === true || c?.role === "admin";
}

function redactClaimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || "unknown");
  return msg.slice(0, 200);
}

export async function enqueueClaimsSyncJob(params: {
  uid: string;
  targetVerified: boolean;
  shouldRevoke: boolean;
  clearAdmin?: boolean;
  lastError: string;
}): Promise<void> {
  try {
    const jobRef = adminDb.collection("claimsSyncJobs").doc(params.uid);
    const jitterMs = Math.floor(Math.random() * 15_000);
    const nextAttemptAt = new Date(Date.now() + 60_000 + jitterMs);

    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      const prev = snap.exists ? snap.data() || {} : {};
      const attempts = typeof prev.attempts === "number" ? prev.attempts + 1 : 0;
      const deadLetter = attempts >= 5;

      tx.set(
        jobRef,
        {
          uid: params.uid,
          targetVerified: params.targetVerified,
          shouldRevoke: params.shouldRevoke,
          clearAdmin: Boolean(params.clearAdmin),
          status: deadLetter ? "dead_letter" : "pending",
          deadLetter,
          attempts,
          nextAttemptAt: deadLetter ? null : nextAttemptAt,
          lastError: params.lastError,
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: prev.createdAt || FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  } catch (qErr) {
    console.error("[CLAIMS] Failed to enqueue claimsSyncJobs:", redactClaimError(qErr));
  }
}

/**
 * Đồng bộ claim `verified`; KHÔNG BAO GIỜ làm rớt quyền admin hay các claim khác không liên quan.
 * Loại bỏ claim legacy `studentVerified`. Nếu fail bất kỳ bước nào (setCustomUserClaims hoặc revokeRefreshTokens),
 * ghi nhận job bền vững vào `claimsSyncJobs/{uid}` để cron/bootstrap retry.
 */
export async function setVerifiedClaim(uid: string, verified: boolean): Promise<boolean> {
  try {
    const rec = await adminAuth.getUser(uid);
    const claims = { ...(rec.customClaims || {}) } as Record<string, unknown>;

    // Bảo vệ quyền admin: chỉ tin claim admin hiện có hoặc email admin ĐÃ XÁC MINH trên Auth
    const adminEmailsConfig = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
    const adminEmails = adminEmailsConfig
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isEmailAdmin = Boolean(
      rec.email &&
        rec.emailVerified &&
        adminEmails.length > 0 &&
        adminEmails.includes(rec.email.toLowerCase())
    );
    const isAdmin = hasAdminClaim(claims) || isEmailAdmin;

    const hasLegacyClaim = "studentVerified" in claims;
    const needsClaimUpdate =
      claims.verified !== verified ||
      hasLegacyClaim ||
      (isAdmin && (claims.admin !== true || claims.role !== "admin")) ||
      (!isAdmin && claims.role !== (verified ? "verified" : "pending"));

    if (needsClaimUpdate) {
      delete claims.studentVerified; // Xóa legacy claim sau migration
      claims.verified = verified;
      claims.role = isAdmin ? "admin" : verified ? "verified" : "pending";
      if (isAdmin) {
        claims.admin = true;
      }
      await adminAuth.setCustomUserClaims(uid, claims);
    }

    if (!verified) {
      await adminAuth.revokeRefreshTokens(uid);
    }

    // Dọn job cũ nếu đồng bộ thành công
    await adminDb.collection("claimsSyncJobs").doc(uid).delete().catch(() => undefined);
    return true;
  } catch (e) {
    const errMsg = redactClaimError(e);
    console.error("[CLAIMS] sync failed:", errMsg);
    await enqueueClaimsSyncJob({
      uid,
      targetVerified: verified,
      shouldRevoke: !verified,
      lastError: errMsg,
    });
    return false;
  }
}

/** Gỡ bỏ hoàn toàn quyền Admin và thu hồi tokens tức thì; đồng thời dọn xác minh giả ADMIN nếu có. */
export async function clearAdminClaim(uid: string): Promise<boolean> {
  try {
    const rec = await adminAuth.getUser(uid);
    const claims = { ...(rec.customClaims || {}) } as Record<string, unknown>;
    delete claims.admin;
    delete claims.studentVerified;

    // Kiểm tra hồ sơ xác minh thật sự (không phải hồ sơ synthetic schoolCode='ADMIN')
    let keepVerified = false;
    const verifRef = adminDb.collection("verifications").doc(uid);
    const verifSnap = await verifRef.get().catch(() => null);
    if (verifSnap?.exists) {
      const vData = verifSnap.data() || {};
      const isSyntheticAdmin =
        vData.schoolCode === "ADMIN" || vData.reviewerId === "system_bootstrap";
      if (isSyntheticAdmin) {
        await verifRef.delete().catch(() => undefined);
        await adminDb.collection("users").doc(uid).set(
          { verified: false, isAdmin: false, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        ).catch(() => undefined);
      } else if (vData.status === "approved") {
        keepVerified = true;
      }
    }

    claims.verified = keepVerified;
    claims.role = keepVerified ? "verified" : "pending";
    await adminAuth.setCustomUserClaims(uid, claims);
    await adminAuth.revokeRefreshTokens(uid);
    await adminDb.collection("claimsSyncJobs").doc(uid).delete().catch(() => undefined);
    return true;
  } catch (e) {
    const errMsg = redactClaimError(e);
    console.error("[CLAIMS] clearAdminClaim failed:", errMsg);
    await enqueueClaimsSyncJob({
      uid,
      targetVerified: false,
      shouldRevoke: true,
      clearAdmin: true,
      lastError: errMsg,
    });
    return false;
  }
}
