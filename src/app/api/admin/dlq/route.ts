import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth-guard";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DLQ_COLLECTIONS = [
  "pendingDeletions",
  "claimsSyncJobs",
  "storageCleanupJobs",
  "listingOperationJobs",
] as const;

type DlqCollection = (typeof DLQ_COLLECTIONS)[number];

const dlqActionSchema = z
  .object({
    collection: z.enum(DLQ_COLLECTIONS),
    docId: FIRESTORE_ID_SCHEMA,
    action: z.enum(["replay", "quarantine"]),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}

export const GET = withApi(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  await consumeRateLimit({
    scope: "admin_dlq_read",
    key: admin.uid,
    limit: 60,
    windowSec: 600,
  });

  const sp = new URL(req.url).searchParams;
  rejectDuplicateQueryParams(sp, ["limit", "collection"]);
  const limit = Math.min(50, Math.max(1, Number.parseInt(sp.get("limit") || "25", 10) || 25));
  const filterCol = sp.get("collection") as DlqCollection | null;

  if (filterCol && !DLQ_COLLECTIONS.includes(filterCol)) {
    throw new ApiError(400, "INVALID_COLLECTION", "Tên hàng đợi DLQ không hợp lệ.");
  }

  const targetCollections = filterCol ? [filterCol] : [...DLQ_COLLECTIONS];

  const [alertsSnap, ...queueSnaps] = await Promise.all([
    adminDb.collection("deadLetterAlerts").where("status", "==", "open").limit(limit).get(),
    ...targetCollections.map((col) =>
      adminDb.collection(col).where("deadLetter", "==", true).limit(limit).get()
    ),
  ]);

  const queues: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {};
  targetCollections.forEach((col, i) => {
    queues[col] = queueSnaps[i].docs.map((d) => ({
      id: d.id,
      data: d.data(),
    }));
  });

  return noStore(
    NextResponse.json({
      success: true,
      openAlerts: alertsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      queues,
    })
  );
});

export const POST = withApi(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  await consumeRateLimit({
    scope: "admin_dlq_action",
    key: admin.uid,
    limit: 30,
    windowSec: 600,
  });

  const body = await readJson(req, 16 * 1024);
  const data = dlqActionSchema.parse(body);

  const jobRef = adminDb.collection(data.collection).doc(data.docId);
  const snap = await jobRef.get();
  if (!snap.exists) {
    throw new ApiError(404, "DLQ_JOB_NOT_FOUND", "Không tìm thấy job trong hàng đợi.");
  }

  const jobData = snap.data() || {};
  const alertId = `${data.collection}_${data.docId}`.slice(0, 120);
  const alertRef = adminDb.collection("deadLetterAlerts").doc(alertId);

  if (data.action === "replay") {
    if (jobData.status === "completed") {
      throw new ApiError(
        409,
        "JOB_ALREADY_COMPLETED",
        "Job này đã hoàn tất thành công và không thể replay lại."
      );
    }
    await Promise.all([
      jobRef.update({
        deadLetter: false,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        replayedBy: admin.uid,
        replayedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }),
      alertRef
        .set(
          {
            status: "replayed",
            resolvedBy: admin.uid,
            resolvedNote: data.note || null,
            resolvedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        .catch(() => undefined),
    ]);
  } else {
    const quarantineOps: Array<Promise<unknown>> = [
      jobRef.update({
        deadLetter: true,
        status: "quarantined",
        nextAttemptAt: null,
        leaseOwner: null,
        leaseUntil: null,
        quarantinedBy: admin.uid,
        quarantineNote: data.note || null,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      alertRef
        .set(
          {
            status: "quarantined",
            resolvedBy: admin.uid,
            resolvedNote: data.note || null,
            resolvedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        .catch(() => undefined),
    ];

    // Nếu cách ly một listingOperationJob, gỡ operationStatus trên tin đăng để không bị kẹt vĩnh viễn
    if (data.collection === "listingOperationJobs" && typeof jobData.listingId === "string" && jobData.listingId) {
      const lRef = adminDb.collection("listings").doc(jobData.listingId);
      quarantineOps.push(
        adminDb
          .runTransaction(async (tx) => {
            const lSnap = await tx.get(lRef);
            if (!lSnap.exists) return;
            if (lSnap.data()?.activeJobId === data.docId) {
              tx.update(lRef, {
                operationStatus: FieldValue.delete(),
                activeJobId: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
          })
          .catch(() => undefined)
      );
    }

    await Promise.all(quarantineOps);
  }

  await adminDb.collection("adminLogs").add({
    action: data.action === "replay" ? "DLQ_REPLAY_JOB" : "DLQ_QUARANTINE_JOB",
    adminUid: admin.uid,
    adminEmail: admin.email || "admin",
    targetCollection: data.collection,
    targetDocId: data.docId,
    note: data.note || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  return noStore(
    NextResponse.json({
      success: true,
      collection: data.collection,
      docId: data.docId,
      action: data.action,
      message:
        data.action === "replay"
          ? "Đã đưa job trở lại hàng đợi thực thi."
          : "Đã cách ly job vào trạng thái quarantined.",
    })
  );
});
