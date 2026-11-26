import "server-only";
import crypto from "crypto";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { redactErrorMessage } from "@/lib/server/request-utils";

export function computeBackoffWithJitter(
  attempt: number,
  baseMs = 60_000,
  maxMs = 60 * 60 * 1000
): Date {
  const expMs = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitterMs = Math.floor(Math.random() * Math.min(30_000, Math.max(5_000, expMs * 0.25)));
  return new Date(Date.now() + expMs + jitterMs);
}

export function extractErrorCode(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const rec = err as { code?: unknown; name?: unknown };
    if (typeof rec.code === "string" && rec.code) return rec.code.slice(0, 64);
    if (typeof rec.name === "string" && rec.name) return rec.name.slice(0, 64);
  }
  return "INTERNAL_ERROR";
}

function toMs(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const ts = val as { toMillis?: () => number };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  return 0;
}

export async function acquireDocLease(
  ref: FirebaseFirestore.DocumentReference,
  leaseOwner: string,
  leaseMs = 5 * 60 * 1000
): Promise<{ acquired: boolean; data?: Record<string, unknown> }> {
  const nowMs = Date.now();
  const leaseUntil = new Date(nowMs + leaseMs);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { acquired: false };
    const data = (snap.data() || {}) as Record<string, unknown>;
    if (data.deadLetter === true) return { acquired: false };

    const activeLeaseMs = toMs(data.leaseUntil);
    if (activeLeaseMs > nowMs && data.leaseOwner !== leaseOwner) {
      return { acquired: false };
    }

    tx.update(ref, {
      leaseOwner,
      leaseUntil,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { acquired: true, data };
  });
}

export async function recordDeadLetterAlert(params: {
  sourceCollection: string;
  sourceDocId: string;
  step: string;
  error: unknown;
  attempts: number;
  dataToResume?: Record<string, unknown>;
}): Promise<void> {
  try {
    const alertId = `${params.sourceCollection}_${params.sourceDocId}`.slice(0, 120);
    const errorCode = extractErrorCode(params.error);
    const errorMessage = redactErrorMessage(params.error);
    const stackRaw = params.error instanceof Error ? params.error.stack || "" : "";
    const stackFingerprint = stackRaw
      ? crypto.createHash("sha256").update(redactErrorMessage(stackRaw)).digest("hex").slice(0, 16)
      : null;

    const alertRef = adminDb.collection("deadLetterAlerts").doc(alertId);
    const existingAlertSnap =
      typeof alertRef.get === "function"
        ? await alertRef.get().catch(() => null)
        : null;
    const alertPayload: Record<string, unknown> = {
      alertId,
      sourceCollection: params.sourceCollection,
      sourceDocId: params.sourceDocId,
      step: params.step,
      errorCode,
      lastError: errorMessage,
      stackFingerprint,
      attempts: params.attempts,
      status: "open",
      dataToResume: params.dataToResume || {},
      lastFailedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!existingAlertSnap?.exists) {
      alertPayload.firstFailedAt = FieldValue.serverTimestamp();
    }

    await Promise.all([
      alertRef.set(alertPayload, { merge: true }),
      adminDb
        .collection("adminLogs")
        .doc(`dlq_${alertId}`)
        .set(
          {
            action: "DEAD_LETTER_ALERT",
            severity: "critical",
            sourceCollection: params.sourceCollection,
            sourceDocId: params.sourceDocId,
            step: params.step,
            errorCode,
            lastError: errorMessage,
            timestamp: FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
    ]);
  } catch (alertErr: unknown) {
    console.error("[DLQ] Failed to record dead letter alert:", redactErrorMessage(alertErr));
  }
}
