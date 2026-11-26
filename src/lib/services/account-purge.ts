import "server-only";
import crypto from "crypto";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";
import { redactErrorMessage } from "@/lib/server/request-utils";
import { deleteStoragePrefixAndCheckEmpty } from "@/lib/server/storage-provider";
import {
  activeReservationLockRef,
  listingReservationStatsRef,
  userReservationStatsRef,
} from "@/lib/server/stats";

const WRITE_CHUNK_SIZE = 400;
const RETENTION_DAYS = 90;

function retentionDeadlineDate(nowMs = Date.now()): Date {
  return new Date(nowMs + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function pseudonymizedActorId(uid: string): string {
  const digest = crypto.createHash("sha256").update(`anon:${uid}`).digest("hex").slice(0, 16);
  return `deleted_${digest}`;
}

async function deleteRefsInChunks(
  refs: FirebaseFirestore.DocumentReference[]
): Promise<void> {
  for (let i = 0; i < refs.length; i += WRITE_CHUNK_SIZE) {
    const batch = adminDb.batch();
    for (const ref of refs.slice(i, i + WRITE_CHUNK_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function deletePrefixAndVerifyEmpty(params: {
  prefix: string;
  jobId: string;
  ownerUid: string;
  reason: string;
  conversationId?: string;
}): Promise<void> {
  const { prefix, jobId, ownerUid, reason, conversationId } = params;
  const jobRef = adminDb.collection("storageCleanupJobs").doc(jobId);

  await jobRef.set(
    {
      jobId,
      kind: "prefix",
      targetPath: prefix,
      ownerUid,
      conversationId: conversationId || null,
      reason,
      status: "in_progress",
      deadLetter: false,
      nextAttemptAt: new Date(Date.now() + 60_000),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  try {
    await deleteStoragePrefixAndCheckEmpty(prefix);
    await jobRef.delete().catch(() => undefined);
  } catch (err: unknown) {
    const errMsg = redactErrorMessage(err);
    await jobRef.set(
      {
        status: "pending",
        attempts: FieldValue.increment(1),
        lastError: errMsg,
        nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    throw err;
  }
}

/**
 * Xóa dữ liệu và vô hiệu hóa/xóa danh tính của userId theo từng phase idempotent:
 * 0) Re-verify Auth đã disabled + revoked (không bao giờ purge Auth user còn đang active)
 * 1) Hủy giữ chỗ pending/waitlisted (cả mua & bán), nhả lock/stats, pseudonymize lịch sử retained 90 ngày
 * 2) Tạo storageCleanupJobs + xóa & verify Storage chat prefix TRƯỚC khi recursiveDelete conversations
 * 3) Xóa & verify các Storage prefix cá nhân (cards, listings, avatars)
 * 4) Xóa tài liệu/locks/stats/AI history trong Firestore theo chunk <= 400; anonymize reviews/reports/appeals với TTL 90 ngày
 * 5) Xóa Auth user + pendingDeletions marker
 */
export async function purgeUserData(
  userId: string,
  initialStudentIdHash?: string | null
): Promise<void> {
  // Phase 0: Re-verify Auth disabled before destructive purge
  try {
    const authUser = await adminAuth.getUser(userId);
    if (!authUser.disabled) {
      await adminAuth.updateUser(userId, { disabled: true });
      await adminAuth.revokeRefreshTokens(userId);
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || "";
    if (code !== "auth/user-not-found") {
      throw err;
    }
  }

  let studentIdHash = initialStudentIdHash || null;
  const [pendingSnap, verifSnap] = await Promise.all([
    adminDb.collection("pendingDeletions").doc(userId).get(),
    adminDb.collection("verifications").doc(userId).get(),
  ]);

  if (!studentIdHash && pendingSnap.exists) {
    studentIdHash = (pendingSnap.data()?.studentIdHash as string) || null;
  }
  if (!studentIdHash && verifSnap.exists) {
    studentIdHash = (verifSnap.data()?.studentIdHash as string) || null;
  }

  const pseudoId = pseudonymizedActorId(userId);
  const purgeAt = retentionDeadlineDate();

  // Phase 1A: Hủy mọi yêu cầu giữ chỗ đang pending/waitlisted (cả phía mua & phía bán), nhả locks/stats
  const [buyerResSnap, sellerResSnap] = await Promise.all([
    adminDb.collection("reservations").where("buyerId", "==", userId).get(),
    adminDb.collection("reservations").where("sellerId", "==", userId).get(),
  ]);

  const allResMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const d of buyerResSnap.docs) allResMap.set(d.id, d);
  for (const d of sellerResSnap.docs) allResMap.set(d.id, d);
  const allResDocs = Array.from(allResMap.values());

  const activeStatuses = new Set(["pending", "waitlisted"]);
  const activeResDocs = allResDocs.filter((d) =>
    activeStatuses.has(String(d.data()?.status || ""))
  );
  const historicalResDocs = allResDocs.filter(
    (d) => !activeStatuses.has(String(d.data()?.status || ""))
  );

  // Batch <= 100 reservations -> <= 400 writes/commit
  for (let i = 0; i < activeResDocs.length; i += 100) {
    const batch = adminDb.batch();
    for (const doc of activeResDocs.slice(i, i + 100)) {
      const r = doc.data() || {};
      const listingId = String(r.listingId || "");
      const buyerId = String(r.buyerId || "");
      const sellerId = String(r.sellerId || "");
      const isBuyerDeleted = buyerId === userId;

      batch.update(doc.ref, {
        status: "cancelled",
        cancelReason: isBuyerDeleted ? "buyer_account_deleted" : "seller_account_deleted",
        ...(isBuyerDeleted ? { buyerName: "Tài khoản đã ẩn danh", buyerId: pseudoId } : {}),
        ...(!isBuyerDeleted ? { sellerName: "Tài khoản đã ẩn danh", sellerId: pseudoId } : {}),
        preferredSchedule: "",
        pseudonymized: true,
        pseudonymizedAt: FieldValue.serverTimestamp(),
        retentionReason: "dispute_fraud_prevention",
        retentionPurgeAt: purgeAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (listingId && buyerId) {
        batch.delete(activeReservationLockRef(listingId, buyerId));
      }
      if (r.status === "pending" && listingId) {
        batch.set(
          listingReservationStatsRef(listingId),
          {
            pendingCount: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      if (r.status === "pending" && buyerId && buyerId !== userId) {
        batch.set(
          userReservationStatsRef(buyerId),
          {
            pendingCount: FieldValue.increment(-1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      const targetNotifyUser = isBuyerDeleted ? sellerId : buyerId;
      if (targetNotifyUser && targetNotifyUser !== userId) {
        const notifRef = adminDb.collection("notifications").doc(`res_del_${doc.id}`);
        batch.set(notifRef, {
          userId: targetNotifyUser,
          type: "reservation_cancelled",
          title: "Yêu cầu giữ chỗ đã hủy tự động",
          body: `Yêu cầu giữ chỗ cho "${String(r.listingTitle || "món đồ")}" đã hủy do đối tác xóa tài khoản.`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }

  // Phase 1B: Pseudonymize lịch sử reservations (completed/cancelled/expired/no_show/rejected) + TTL 90 ngày
  for (let i = 0; i < historicalResDocs.length; i += WRITE_CHUNK_SIZE) {
    const batch = adminDb.batch();
    for (const doc of historicalResDocs.slice(i, i + WRITE_CHUNK_SIZE)) {
      const r = doc.data() || {};
      const isBuyerDeleted = r.buyerId === userId;
      const isSellerDeleted = r.sellerId === userId;
      batch.update(doc.ref, {
        ...(isBuyerDeleted
          ? {
              buyerId: pseudoId,
              buyerName: "Tài khoản đã ẩn danh",
              buyerSchool: null,
            }
          : {}),
        ...(isSellerDeleted
          ? {
              sellerId: pseudoId,
              sellerName: "Tài khoản đã ẩn danh",
              sellerSchool: null,
            }
          : {}),
        preferredSchedule: "",
        pseudonymized: true,
        pseudonymizedAt: FieldValue.serverTimestamp(),
        retentionReason: "dispute_fraud_prevention",
        retentionPurgeAt: purgeAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // Phase 2: Durable Storage cleanup BEFORE Firestore recursiveDelete cho hội thoại chat
  const convSnap = await adminDb
    .collection("conversations")
    .where("participantIds", "array-contains", userId)
    .get();

  for (const convDoc of convSnap.docs) {
    const convId = convDoc.id;
    await deletePrefixAndVerifyEmpty({
      prefix: `private/chats/${convId}/`,
      jobId: `chat_${convId}`,
      ownerUid: userId,
      conversationId: convId,
      reason: "account_delete_chat",
    });
    await adminDb.recursiveDelete(convDoc.ref);
  }

  // Phase 3: Xóa các thư mục Storage cá nhân và verify trống trước khi tiếp tục
  const userPrefixes: Array<{ prefix: string; jobId: string }> = [
    { prefix: `private/cards/${userId}/`, jobId: `cards_${userId}` },
    { prefix: `public/listings/${userId}/`, jobId: `listings_pub_${userId}` },
    { prefix: `listings/${userId}/`, jobId: `listings_leg_${userId}` },
    { prefix: `public/avatars/${userId}/`, jobId: `avatars_${userId}` },
  ];
  for (const item of userPrefixes) {
    await deletePrefixAndVerifyEmpty({
      prefix: item.prefix,
      jobId: item.jobId,
      ownerUid: userId,
      reason: "account_delete_user_storage",
    });
  }

  // Phase 4: Thu thập toàn bộ Firestore documents & aggregate locks cần xóa ngay
  const refsToDelete: FirebaseFirestore.DocumentReference[] = [
    adminDb.collection("users").doc(userId),
    adminDb.collection("usersPrivate").doc(userId),
    adminDb.collection("verifications").doc(userId),
    adminDb.collection("sellerListingStats").doc(userId),
    adminDb.collection("userReservationStats").doc(userId),
    adminDb.collection("claimsSyncJobs").doc(userId),
  ];

  // Chỉ xóa khóa MSSV studentIdHashes/{hash} KHI VÀ CHỈ KHI bản ghi thuộc đúng userId đang xóa
  // (tránh người dùng bị từ chối xóa nhầm khóa MSSV của sinh viên đã duyệt hợp lệ).
  if (studentIdHash) {
    const hashRef = adminDb.collection("studentIdHashes").doc(studentIdHash);
    const hashSnap = await hashRef.get();
    if (hashSnap.exists && hashSnap.data()?.userId === userId) {
      refsToDelete.push(hashRef);
    }
  }

  const [
    listingsSnap,
    titleLocksSnap,
    favSnap,
    notifSnap,
    contactViewerSnap,
    contactSellerSnap,
    uploadSessionsSnap,
    uploadQuotasSnap,
    aiQuotasSnap,
    resLocksSnap,
    appealLocksSnap,
    sentReviewsSnap,
    receivedReviewsSnap,
    reportsAsReporterSnap,
    reportsAsReportedSnap,
    appealsSnap,
    aiConvsSnap,
  ] = await Promise.all([
    adminDb.collection("listings").where("sellerId", "==", userId).get(),
    adminDb.collection("sellerTitleLocks").where("sellerId", "==", userId).get(),
    adminDb.collection("favorites").where("userId", "==", userId).get(),
    adminDb.collection("notifications").where("userId", "==", userId).get(),
    adminDb.collection("contactViewLogs").where("viewerId", "==", userId).get(),
    adminDb.collection("contactViewLogs").where("sellerId", "==", userId).get(),
    adminDb.collection("uploadSessions").where("ownerUid", "==", userId).get(),
    adminDb.collection("userUploadQuotas").where("uid", "==", userId).get(),
    adminDb.collection("userAiQuotas").where("uid", "==", userId).get(),
    adminDb.collection("activeReservationLocks").where("buyerId", "==", userId).get(),
    adminDb.collection("appealPendingLocks").where("userId", "==", userId).get(),
    adminDb.collection("reviews").where("reviewerId", "==", userId).get(),
    adminDb.collection("reviews").where("targetUserId", "==", userId).get(),
    adminDb.collection("reports").where("reporterId", "==", userId).get(),
    adminDb.collection("reports").where("reportedUserId", "==", userId).get(),
    adminDb.collection("appeals").where("userId", "==", userId).get(),
    adminDb.collection("aiConversations").where("ownerUid", "==", userId).get(),
  ]);

  for (const d of listingsSnap.docs) {
    refsToDelete.push(d.ref);
    refsToDelete.push(adminDb.collection("listingsPrivate").doc(d.id));
    refsToDelete.push(adminDb.collection("listingReservationStats").doc(d.id));
  }
  for (const d of titleLocksSnap.docs) refsToDelete.push(d.ref);
  for (const d of favSnap.docs) refsToDelete.push(d.ref);
  for (const d of notifSnap.docs) refsToDelete.push(d.ref);
  for (const d of contactViewerSnap.docs) refsToDelete.push(d.ref);
  for (const d of contactSellerSnap.docs) refsToDelete.push(d.ref);
  for (const d of uploadSessionsSnap.docs) refsToDelete.push(d.ref);
  for (const d of uploadQuotasSnap.docs) refsToDelete.push(d.ref);
  for (const d of aiQuotasSnap.docs) refsToDelete.push(d.ref);
  for (const d of resLocksSnap.docs) refsToDelete.push(d.ref);
  for (const d of appealLocksSnap.docs) refsToDelete.push(d.ref);

  await deleteRefsInChunks(refsToDelete);

  // Xóa toàn bộ lịch sử NnhanAI của user bằng recursiveDelete (collection riêng biệt)
  for (const aiDoc of aiConvsSnap.docs) {
    await adminDb.recursiveDelete(aiDoc.ref);
  }

  // Pseudonymize reviews, reports (cả reporter & reportedUserId + evidence), appeals (kèm xóa userEmail) với TTL 90 ngày
  const retentionUpdateMap = new Map<
    string,
    { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }
  >();
  const mergeRetentionUpdate = (
    ref: FirebaseFirestore.DocumentReference,
    patch: Record<string, unknown>
  ) => {
    const key = ref.path;
    const prev = retentionUpdateMap.get(key);
    if (prev) {
      prev.data = { ...prev.data, ...patch };
    } else {
      retentionUpdateMap.set(key, { ref, data: patch });
    }
  };

  for (const d of sentReviewsSnap.docs) {
    mergeRetentionUpdate(d.ref, {
      reviewerId: pseudoId,
      reviewerName: "Tài khoản đã ẩn danh",
      pseudonymized: true,
      retentionReason: "marketplace_integrity",
      retentionPurgeAt: purgeAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const d of receivedReviewsSnap.docs) {
    mergeRetentionUpdate(d.ref, {
      targetUserId: pseudoId,
      targetUserName: "Tài khoản đã ẩn danh",
      pseudonymized: true,
      retentionReason: "marketplace_integrity",
      retentionPurgeAt: purgeAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const d of reportsAsReporterSnap.docs) {
    mergeRetentionUpdate(d.ref, {
      reporterId: pseudoId,
      pseudonymized: true,
      retentionReason: "moderation_audit",
      retentionPurgeAt: purgeAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  for (const d of reportsAsReportedSnap.docs) {
    const rData = d.data() || {};
    const patch: Record<string, unknown> = {
      reportedUserId: pseudoId,
      pseudonymized: true,
      retentionReason: "moderation_audit",
      retentionPurgeAt: purgeAt,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (Array.isArray(rData.evidence)) {
      patch.evidence = (rData.evidence as Array<Record<string, unknown>>).map((ev) =>
        ev && ev.senderId === userId ? { ...ev, senderId: pseudoId } : ev
      );
    }
    mergeRetentionUpdate(d.ref, patch);
  }
  for (const d of appealsSnap.docs) {
    mergeRetentionUpdate(d.ref, {
      userId: pseudoId,
      userEmail: null,
      pseudonymized: true,
      retentionReason: "moderation_audit",
      retentionPurgeAt: purgeAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const retentionUpdates = Array.from(retentionUpdateMap.values());

  for (let i = 0; i < retentionUpdates.length; i += WRITE_CHUNK_SIZE) {
    const batch = adminDb.batch();
    for (const item of retentionUpdates.slice(i, i + WRITE_CHUNK_SIZE)) {
      batch.update(item.ref, item.data);
    }
    await batch.commit();
  }

  // Phase 5: Xóa tài khoản Firebase Authentication
  try {
    await adminAuth.deleteUser(userId);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || "";
    if (code !== "auth/user-not-found") {
      throw err;
    }
  }

  // Phase 6: Xóa marker pendingDeletions để hoàn tất idempotent
  await adminDb.collection("pendingDeletions").doc(userId).delete();
}
