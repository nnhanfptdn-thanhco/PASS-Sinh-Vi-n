import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyCronRequest } from "@/lib/server/cron";
import { withApi } from "@/lib/server/http";
import { adminDb } from "@/lib/firebase/admin";
import { purgeUserData } from "@/lib/services/account-purge";
import {
  acquireDocLease,
  computeBackoffWithJitter,
  extractErrorCode,
  recordDeadLetterAlert,
} from "@/lib/server/dlq";
import { redactErrorMessage } from "@/lib/server/request-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (req: NextRequest) => {
  verifyCronRequest(req);

  const now = new Date();
  const leaseOwner = `cron_purge_${crypto.randomUUID().slice(0, 8)}`;

  let pendingDocs: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[] = [];
  try {
    const snap = await adminDb
      .collection("pendingDeletions")
      .where("deadLetter", "==", false)
      .where("nextAttemptAt", "<=", now)
      .orderBy("nextAttemptAt", "asc")
      .limit(20)
      .get();
    pendingDocs = snap.docs;
  } catch (idxErr: unknown) {
    const errStr = String(idxErr);
    if (errStr.includes("requires an index") || errStr.includes("FAILED_PRECONDITION")) {
      const snap = await adminDb
        .collection("pendingDeletions")
        .where("deadLetter", "==", false)
        .limit(20)
        .get();
      pendingDocs = snap.docs.filter((d) => {
        const nextAt = d.data()?.nextAttemptAt;
        if (!nextAt) return true;
        const ms = typeof nextAt?.toMillis === "function" ? nextAt.toMillis() : Date.parse(String(nextAt));
        return !Number.isFinite(ms) || ms <= now.getTime();
      });
    } else {
      throw idxErr;
    }
  }

  let purgedCount = 0;
  let deadLetterCount = 0;
  let skippedLeaseCount = 0;
  let failedRetryCount = 0;

  for (const doc of pendingDocs) {
    const preData = doc.data() || {};
    if (preData.status === "freezing") {
      const startedRaw = preData.startedAt as { toMillis?: () => number } | Date | undefined;
      const startedMs =
        startedRaw instanceof Date
          ? startedRaw.getTime()
          : typeof startedRaw?.toMillis === "function"
          ? startedRaw.toMillis()
          : now.getTime();
      if (now.getTime() - startedMs < 2 * 60 * 1000) {
        skippedLeaseCount++;
        continue;
      }
    }

    const lease = await acquireDocLease(doc.ref, leaseOwner, 5 * 60 * 1000);
    if (!lease.acquired || !lease.data) {
      skippedLeaseCount++;
      continue;
    }

    const data = lease.data;
    const uid = doc.id;
    const hash = (data.studentIdHash as string) || null;
    const currentAttempts = typeof data.attempts === "number" ? data.attempts : 0;
    const nextAttempts = currentAttempts + 1;

    try {
      await purgeUserData(uid, hash);
      purgedCount++;
    } catch (err) {
      const isDeadLetter = nextAttempts >= 3;
      const errMsg = redactErrorMessage(err);
      const errCode = extractErrorCode(err);
      const nextAttemptAt = isDeadLetter ? null : computeBackoffWithJitter(nextAttempts, 60_000);

      console.error(
        `[PurgeAccountsCron] Lỗi dọn tài khoản (lần ${nextAttempts}${isDeadLetter ? " -> DEAD LETTER" : ""}):`,
        errMsg
      );

      await doc.ref
        .update({
          attempts: nextAttempts,
          lastAttemptAt: new Date(),
          lastError: errMsg,
          errorCode: errCode,
          step: String(data.status || "purgeUserData"),
          deadLetter: isDeadLetter,
          status: isDeadLetter ? "dead_letter" : "pending_retry",
          nextAttemptAt,
          leaseOwner: null,
          leaseUntil: null,
          ...(currentAttempts === 0 ? { firstFailedAt: new Date() } : {}),
        })
        .catch(() => {});

      if (isDeadLetter) {
        deadLetterCount++;
        await recordDeadLetterAlert({
          sourceCollection: "pendingDeletions",
          sourceDocId: uid,
          step: String(data.status || "purgeUserData"),
          error: err,
          attempts: nextAttempts,
          dataToResume: { userId: uid, hasStudentIdHash: Boolean(hash) },
        });
      } else {
        failedRetryCount++;
      }
    }
  }

  return NextResponse.json({
    success: true,
    message: `Đã xử lý ${purgedCount} tài khoản, ${failedRetryCount} hẹn thử lại, ${deadLetterCount} dead-letter (bỏ qua lease: ${skippedLeaseCount}) trên ${pendingDocs.length} hàng đợi.`,
    purgedCount,
    failedRetryCount,
    deadLetterCount,
    skippedLeaseCount,
  });
});
