import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { redactErrorMessage } from "@/lib/server/request-utils";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";
import { purgeUserData } from "@/lib/services/account-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực tài khoản đang active + kiểm tra revoked
  const auth = await requireActiveUser(req);
  const userId = auth.uid;

  // Bắt buộc đăng nhập lại trong vòng 5 phút gần đây để tránh CSRF / phiên bỏ quên
  const nowSec = Math.floor(Date.now() / 1000);
  const authTime = typeof auth.token.auth_time === "number" ? auth.token.auth_time : 0;
  if (nowSec - authTime > 300) {
    throw new ApiError(
      403,
      "REAUTH_REQUIRED",
      "Phiên đăng nhập đã cũ. Vui lòng đăng nhập lại trước khi thực hiện xóa vĩnh viễn tài khoản."
    );
  }

  await consumeRateLimit({
    scope: "account_delete",
    key: userId,
    limit: 5,
    windowSec: 3600,
    customMessage: "Bạn thao tác yêu cầu xóa tài khoản quá nhiều lần. Vui lòng thử lại sau.",
  });

  const jobId = `del_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const userRef = adminDb.collection("users").doc(userId);
  const pendingRef = adminDb.collection("pendingDeletions").doc(userId);

  // 2. FREEZE GATE TRANSACTION TRƯỚC: chặn mọi mutation mới trong khi kiểm tra & xóa
  await adminDb.runTransaction(async (tx) => {
    const [uSnap, pSnap] = await Promise.all([tx.get(userRef), tx.get(pendingRef)]);
    if (pSnap.exists || uSnap.data()?.accountStatus === "deleting") {
      throw new ApiError(
        409,
        "DELETION_ALREADY_IN_PROGRESS",
        "Tài khoản đang trong quá trình khóa và xóa dữ liệu."
      );
    }

    tx.set(
      userRef,
      {
        accountStatus: "deleting",
        deletionState: "pending",
        deletionJobId: jobId,
        deletionRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(pendingRef, {
      userId,
      jobId,
      deletionState: "pending",
      status: "freezing",
      studentIdHash: null,
      startedAt: FieldValue.serverTimestamp(),
      nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
      attempts: 0,
      deadLetter: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  const unlockOnFailure = async () => {
    await adminDb
      .runTransaction(async (tx) => {
        tx.set(
          userRef,
          {
            accountStatus: "active",
            deletionState: FieldValue.delete(),
            deletionJobId: FieldValue.delete(),
            deletionRequestedAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        tx.delete(pendingRef);
      })
      .catch(() => undefined);
  };

  // 3. Kiểm tra giao dịch đã chốt sau khi cổng mutation đã khóa hoàn toàn
  let confirmedBuyerSnap: FirebaseFirestore.QuerySnapshot;
  let confirmedSellerSnap: FirebaseFirestore.QuerySnapshot;
  let reservedListingSnap: FirebaseFirestore.QuerySnapshot;
  try {
    [confirmedBuyerSnap, confirmedSellerSnap, reservedListingSnap] = await Promise.all([
      adminDb
        .collection("reservations")
        .where("buyerId", "==", userId)
        .where("status", "==", "confirmed")
        .limit(1)
        .get(),
      adminDb
        .collection("reservations")
        .where("sellerId", "==", userId)
        .where("status", "==", "confirmed")
        .limit(1)
        .get(),
      adminDb
        .collection("listings")
        .where("sellerId", "==", userId)
        .where("status", "==", "reserved")
        .limit(1)
        .get(),
    ]);
  } catch (checkErr) {
    // Nếu truy vấn kiểm tra lỗi hạ tầng -> mở khóa bù để tài khoản không bị đóng băng vĩnh viễn
    await unlockOnFailure();
    throw checkErr;
  }

  if (!confirmedBuyerSnap.empty || !confirmedSellerSnap.empty || !reservedListingSnap.empty) {
    // Compensating unlock để user giải quyết giao dịch còn dở
    await unlockOnFailure();

    throw new ApiError(
      409,
      "ACTIVE_CONFIRMED_TRANSACTIONS",
      "Bạn đang có giao dịch đã chốt hoặc tin đang trong thời gian giữ chỗ 72 giờ. Vui lòng hoàn tất hoặc hủy giữ chỗ trước khi xóa tài khoản."
    );
  }

  // Vô hiệu hóa ngay lập tức các uploadSessions còn mở của user để chặn tải ảnh mới qua Storage Rules
  try {
    const openUploadSessions = await adminDb
      .collection("uploadSessions")
      .where("ownerUid", "==", userId)
      .where("status", "in", ["pending", "finalized"])
      .limit(50)
      .get();
    if (!openUploadSessions.empty) {
      const sBatch = adminDb.batch();
      for (const sDoc of openUploadSessions.docs) {
        sBatch.update(sDoc.ref, {
          status: "cleaned",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await sBatch.commit();
    }
  } catch {
    // Best-effort; Phase 4 trong purgeUserData vẫn sẽ xóa toàn bộ uploadSessions
  }

  const verifSnap = await adminDb.collection("verifications").doc(userId).get();
  const studentIdHash = verifSnap.exists ? (verifSnap.data()?.studentIdHash as string) || null : null;

  await pendingRef.set(
    {
      studentIdHash,
      status: "disabling_auth",
      leaseOwner: jobId,
      leaseUntil: new Date(Date.now() + 5 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // 4. Vô hiệu hóa và thu hồi toàn bộ phiên Firebase Auth TRƯỚC khi purge
  try {
    await adminAuth.updateUser(userId, { disabled: true });
    await adminAuth.revokeRefreshTokens(userId);
  } catch (authErr: unknown) {
    const msg = redactErrorMessage(authErr);
    await pendingRef.set(
      {
        status: "auth_disable_failed",
        attempts: 1,
        lastError: msg,
        lastAttemptAt: FieldValue.serverTimestamp(),
        nextAttemptAt: new Date(Date.now() + 60 * 1000),
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json(
      {
        success: true,
        deleted: false,
        deletionState: "pending",
        status: "auth_disable_failed",
        message:
          "Yêu cầu xóa đã được ghi nhận ở trạng thái chờ xử lý hệ thống. Vui lòng không đăng nhập lại; hệ thống sẽ tự động hoàn tất dọn dẹp.",
      },
      { status: 202 }
    );
  }

  // 5. Thực hiện dọn dữ liệu idempotent với lease độc quyền (ngăn cron chạy song song)
  await pendingRef.set(
    {
      status: "purging",
      leaseOwner: jobId,
      leaseUntil: new Date(Date.now() + 5 * 60 * 1000),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await purgeUserData(userId, studentIdHash);
  } catch (purgeErr: unknown) {
    const errMsg = redactErrorMessage(purgeErr);
    console.error(`[AccountDelete] Purge pending for uid=${userId}:`, errMsg);
    await pendingRef.set(
      {
        status: "pending_retry",
        attempts: FieldValue.increment(1),
        lastError: errMsg,
        lastAttemptAt: FieldValue.serverTimestamp(),
        nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
        leaseOwner: null,
        leaseUntil: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json(
      {
        success: true,
        deleted: false,
        deletionState: "pending",
        status: "pending_retry",
        message:
          "Tài khoản đã được khóa vĩnh viễn và đang trong hàng đợi dọn dữ liệu an toàn. Một số dữ liệu đang được xử lý hoàn tất tự động.",
      },
      { status: 202 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      deleted: true,
      deletionState: "completed",
      message:
        "Tài khoản, hồ sơ cá nhân, ảnh tải lên và tin nhắn của bạn đã được xóa. Các bản ghi giao dịch/báo cáo đã ẩn danh chống gian lận được lưu tối đa 90 ngày trước khi tự động hủy.",
      retentionPolicy: {
        pseudonymizedRecordsRetentionDays: 90,
        deletedImmediately: [
          "users",
          "usersPrivate",
          "verifications",
          "studentIdHashes",
          "listings",
          "listingsPrivate",
          "conversations",
          "aiConversations",
          "favorites",
          "notifications",
          "storagePrefixes",
          "firebaseAuthUser",
        ],
      },
    },
    { status: 200 }
  );
});
