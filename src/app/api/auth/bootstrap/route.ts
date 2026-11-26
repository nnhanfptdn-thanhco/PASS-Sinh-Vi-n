import { NextRequest, NextResponse } from "next/server";
import { requireAuth, assertAccountActive } from "@/lib/server/auth-guard";
import { withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";
import { setVerifiedClaim } from "@/lib/server/claims";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async (req: NextRequest) => {
  // Bắt buộc verifyIdToken(token, true) + kiểm tra trạng thái tài khoản;
  // nếu Admin SDK/ADC lỗi -> ném 503 fail-closed, KHÔNG trả { ok: true } giả.
  const auth = await requireAuth(req, { allowInactiveAccount: true });
  assertAccountActive(auth);

  const token = auth.token;
  const uid = auth.uid;

  await consumeRateLimit({
    scope: "auth_bootstrap",
    key: uid,
    limit: 30,
    windowSec: 3600,
    customMessage: "Bạn đã gửi quá nhiều yêu cầu xác thực. Vui lòng thử lại sau 1 giờ.",
  });

  const userRef = adminDb.collection("users").doc(uid);
  const userPrivateRef = adminDb.collection("usersPrivate").doc(uid);

  // 1. Transaction: Đảm bảo tạo mới hoặc cập nhật thông tin an toàn, tuyệt đối không mở lại user đang deleting/banned
  await adminDb.runTransaction(async (transaction) => {
    const [userSnap, pendingDelSnap] = await Promise.all([
      transaction.get(userRef),
      transaction.get(adminDb.collection("pendingDeletions").doc(uid)),
    ]);

    if (pendingDelSnap.exists) {
      throw new ApiError(
        423,
        "ACCOUNT_DELETING",
        "Tài khoản đang trong quá trình xóa vĩnh viễn và không thể kích hoạt lại."
      );
    }

    if (!userSnap.exists) {
      transaction.set(userRef, {
        uid,
        displayName: token.name || "Sinh viên",
        photoURL: token.picture || null,
        accountStatus: "active",
        status: "active",
        verified: false,
        rating: null,
        activeListingsCount: 0,
        completedDealsCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      });

      transaction.set(
        userPrivateRef,
        {
          uid,
          email: token.email || null,
          emailVerified: Boolean(token.email_verified),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const existingData = userSnap.data() || {};
      if (
        existingData.deleted === true ||
        existingData.disabled === true ||
        existingData.deletionState === "pending" ||
        existingData.deletionState === "deleting" ||
        existingData.deletionState === "deleted" ||
        existingData.status === "banned" ||
        existingData.status === "disabled" ||
        existingData.accountStatus === "banned" ||
        existingData.accountStatus === "disabled" ||
        existingData.accountStatus === "deleting" ||
        existingData.accountStatus === "deleted"
      ) {
        throw new ApiError(
          403,
          "ACCOUNT_INACTIVE",
          "Tài khoản đã bị khóa hoặc đang chờ xóa, không thể khởi tạo phiên."
        );
      }

      const updateData: Record<string, unknown> = {
        lastLoginAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!existingData.accountStatus) {
        updateData.accountStatus = "active";
      }
      if (!existingData.status) {
        updateData.status = "active";
      }

      if (!existingData.displayName && token.name) {
        updateData.displayName = token.name;
      }
      if (!existingData.photoURL && token.picture) {
        updateData.photoURL = token.picture;
      }

      transaction.update(userRef, updateData);

      transaction.set(
        userPrivateRef,
        {
          email: token.email || null,
          emailVerified: Boolean(token.email_verified),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  // 2. Admin Bootstrap: Tự động gán quyền Admin CHỈ KHI email đã verified và nằm trong ADMIN_EMAILS server-side
  let claimsChanged = false;
  const adminEmailsConfig = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
  const adminEmails = adminEmailsConfig
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const userEmail = (token.email || "").toLowerCase();
  const isEmailVerified = Boolean(token.email_verified);

  if (
    userEmail &&
    isEmailVerified &&
    adminEmails.includes(userEmail) &&
    token.admin !== true
  ) {
    const currentAuthUser = await adminAuth.getUser(uid);
    const existingClaims = { ...(currentAuthUser.customClaims || {}) } as Record<string, unknown>;
    delete existingClaims.studentVerified;

    await adminAuth.setCustomUserClaims(uid, {
      ...existingClaims,
      admin: true,
      verified: true,
      role: "admin",
    });

    await adminDb.collection("verifications").doc(uid).set(
      {
        uid,
        status: "approved",
        realName: token.name || "Quản trị viên",
        displayName: token.name || "Quản trị viên",
        schoolCode: "ADMIN",
        schoolName: "Ban Quản Trị Hệ Thống",
        approvedAt: FieldValue.serverTimestamp(),
        reviewerId: "system_bootstrap",
      },
      { merge: true }
    );

    await adminDb.collection("users").doc(uid).set(
      {
        verified: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    claimsChanged = true;

    await adminDb.collection("adminLogs").add({
      action: "BOOTSTRAP_ADMIN_CLAIM_GRANTED",
      targetUid: uid,
      targetEmail: userEmail,
      grantedAt: FieldValue.serverTimestamp(),
      reason: "Configured in ADMIN_EMAILS environment variable",
    });
  }

  // 3. Claims Reconciliation: Đồng bộ trạng thái xác minh sinh viên với Firestore
  const verifDocRef = adminDb.collection("verifications").doc(uid);
  const verifSnap = await verifDocRef.get();
  if (verifSnap.exists) {
    const vData = verifSnap.data()!;
    const isApproved = vData.status === "approved";
    const hasVerifiedClaim = token.verified === true;
    const hasLegacyClaim = "studentVerified" in (auth.claims || {});

    if (isApproved && (!hasVerifiedClaim || hasLegacyClaim || vData.claimsSyncPending)) {
      const synced = await setVerifiedClaim(uid, true);
      if (synced) {
        await verifDocRef.update({ claimsSyncPending: FieldValue.delete() }).catch(() => undefined);
        claimsChanged = true;
      }
    } else if (!isApproved && (vData.status === "rejected" || vData.status === "expired") && (hasVerifiedClaim || hasLegacyClaim)) {
      const synced = await setVerifiedClaim(uid, false);
      if (synced) {
        claimsChanged = true;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    claimsChanged,
  });
});
