import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser, requireApprovedStudent } from "@/lib/server/auth-guard";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { todayVN } from "@/lib/utils/date";
import {
  buildUploadSessionPlan,
  getDailyQuotaDocRef,
  GLOBAL_DAILY_BYTES_LIMIT,
  GLOBAL_DAILY_FILES_LIMIT,
  normalizeUploadSessionId,
  recordUploadQuotaAlert,
  UPLOAD_POLICIES,
  UPLOAD_SESSION_TTL_MS,
  type UploadKind,
} from "@/lib/server/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uploadIntentSchema = z
  .object({
    kind: z.enum(["card", "listing", "avatar", "chat"]),
    sessionId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, "Mã phiên upload không hợp lệ")
      .optional(),
    targetId: FIRESTORE_ID_SCHEMA.optional(),
    files: z
      .array(
        z
          .object({
            name: z.string().max(80).optional(),
            contentType: z.enum(["image/webp", "image/jpeg"]),
            sizeBytes: z.number().int().positive().max(15 * 1024 * 1024),
          })
          .strict()
      )
      .min(1, "Cần ít nhất 1 tệp để cấp quyền upload")
      .max(20, "Tối đa 20 tệp mỗi lần yêu cầu"),
  })
  .strict();

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const ts = value as { toMillis?: () => number } | null | undefined;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

export const POST = withApi(async (req: NextRequest) => {
  const body = await readJson(req, 32 * 1024);
  const data = uploadIntentSchema.parse(body);
  const kind: UploadKind = data.kind;
  const policy = UPLOAD_POLICIES[kind];

  const auth = policy.requiresVerified
    ? await requireApprovedStudent(req)
    : await requireActiveUser(req);

  const uid = auth.uid;

  await consumeRateLimit({
    scope: `upload_intent_${kind}`,
    key: uid,
    limit: 25,
    windowSec: 600,
    customMessage: "Bạn yêu cầu cấp phiên tải ảnh quá nhanh. Vui lòng thử lại sau ít phút.",
  });

  const sessionId = normalizeUploadSessionId(data.sessionId);
  const plan = buildUploadSessionPlan({
    uid,
    kind,
    sessionId,
    targetId: data.targetId,
    files: data.files,
  });

  const dateStr = todayVN();
  const nowMs = Date.now();
  const expiresAt = new Date(nowMs + UPLOAD_SESSION_TTL_MS);

  const sessionRef = adminDb.collection("uploadSessions").doc(sessionId);
  const quotaRef = getDailyQuotaDocRef(uid, dateStr);
  const verifRef = kind === "card" ? adminDb.collection("verifications").doc(uid) : null;
  const chatRef =
    kind === "chat" && plan.targetId
      ? adminDb.collection("conversations").doc(plan.targetId)
      : null;

  try {
    const txResult = await adminDb.runTransaction(async (tx) => {
      const activeSessionsQuery = adminDb
        .collection("uploadSessions")
        .where("ownerUid", "==", uid)
        .where("kind", "==", kind)
        .where("status", "in", ["pending", "finalized"])
        .limit(policy.maxActiveSessions + 10);

      const [existingSessionSnap, quotaSnap, pendingSnap, verifSnap, chatSnap] =
        await Promise.all([
          tx.get(sessionRef),
          tx.get(quotaRef),
          tx.get(activeSessionsQuery),
          verifRef ? tx.get(verifRef) : Promise.resolve(null),
          chatRef ? tx.get(chatRef) : Promise.resolve(null),
        ]);

      if (kind === "card" && verifSnap?.exists) {
        const verifStatus = verifSnap.data()?.status;
        if (verifStatus === "approved") {
          throw new ApiError(
            409,
            "ALREADY_VERIFIED",
            "Tài khoản đã xác minh thành công, không thể tải thêm ảnh thẻ sinh viên."
          );
        }
        if (verifStatus === "pending") {
          throw new ApiError(
            409,
            "VERIFICATION_PENDING",
            "Hồ sơ đang chờ duyệt, không thể tải lại ảnh thẻ lúc này."
          );
        }
      }

      if (kind === "chat") {
        if (!chatSnap?.exists) {
          throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
        }
        const chatData = chatSnap.data() || {};
        const participants = Array.isArray(chatData.participantIds)
          ? (chatData.participantIds as string[])
          : [];
        if (!participants.includes(uid)) {
          throw new ApiError(403, "FORBIDDEN_CONVERSATION", "Bạn không thuộc hội thoại này.");
        }
        if (chatData.status !== "active") {
          throw new ApiError(403, "CONVERSATION_INACTIVE", "Hội thoại này đã bị khóa hoặc kết thúc.");
        }
        const blockedBy = (chatData.blockedBy || {}) as Record<string, boolean>;
        if (Object.values(blockedBy).some(Boolean)) {
          throw new ApiError(403, "CONVERSATION_BLOCKED", "Hội thoại đang bị chặn giữa hai người dùng.");
        }
      }

      let existingAllowed: string[] = [];
      let isAppendingListingDraft = false;

      if (existingSessionSnap.exists) {
        const sData = existingSessionSnap.data() || {};
        if (sData.ownerUid !== uid || sData.kind !== kind) {
          throw new ApiError(403, "SESSION_OWNERSHIP_MISMATCH", "Phiên tải ảnh không hợp lệ.");
        }
        if (sData.claimed === true || sData.status === "claimed" || sData.status === "cleaned") {
          throw new ApiError(409, "SESSION_ALREADY_CLOSED", "Phiên tải ảnh đã hoàn tất hoặc đã đóng.");
        }
        const existingExpiryMs = toMs(sData.expiresAt);
        if (existingExpiryMs > 0 && existingExpiryMs <= nowMs) {
          throw new ApiError(409, "SESSION_EXPIRED", "Phiên tải ảnh nháp đã hết hạn. Vui lòng tạo lại bản nháp.");
        }
        if (kind !== "listing") {
          throw new ApiError(409, "SESSION_EXISTS", "Mã phiên upload này đã tồn tại.");
        }
        existingAllowed = Array.isArray(sData.allowedPaths)
          ? (sData.allowedPaths as string[])
          : [];
        if (existingAllowed.length + plan.issuedFiles.length > policy.maxFilesPerSession) {
          throw new ApiError(
            400,
            "INVALID_UPLOAD_COUNT",
            `Bản nháp chỉ được tối đa ${policy.maxFilesPerSession} tệp ảnh.`
          );
        }
        isAppendingListingDraft = true;
      }

      const activePendingCount = pendingSnap.docs.filter((doc) => {
        if (doc.id === sessionId) return false;
        const d = doc.data() || {};
        if (d.claimed === true) return false;
        return toMs(d.expiresAt) > nowMs;
      }).length;

      if (!isAppendingListingDraft && activePendingCount >= policy.maxActiveSessions) {
        throw new ApiError(
          429,
          "UPLOAD_QUOTA_EXCEEDED",
          `Bạn đang có quá nhiều phiên tải ảnh nháp (${kind}) chưa hoàn tất. Vui lòng hoàn tất hoặc xóa bớt.`
        );
      }

      const quotaData = quotaSnap.exists ? quotaSnap.data() || {} : {};
      const totalFilesUsed = Number(quotaData.totalFiles || 0);
      const totalBytesUsed = Number(quotaData.totalBytes || 0);
      const byKind = (quotaData.byKind || {}) as Record<string, { files?: number; bytes?: number }>;
      const kindFilesUsed = Number(byKind[kind]?.files || 0);
      const kindBytesUsed = Number(byKind[kind]?.bytes || 0);

      const addedFiles = plan.issuedFiles.length;
      const addedBytes = plan.totalBytesExpected;

      if (
        totalFilesUsed + addedFiles > GLOBAL_DAILY_FILES_LIMIT ||
        totalBytesUsed + addedBytes > GLOBAL_DAILY_BYTES_LIMIT
      ) {
        throw new ApiError(
          429,
          "UPLOAD_QUOTA_EXCEEDED",
          "Bạn đã vượt quá hạn mức tải ảnh tổng cộng trong ngày hôm nay."
        );
      }

      if (
        kindFilesUsed + addedFiles > policy.dailyFileLimit ||
        kindBytesUsed + addedBytes > policy.dailyBytesLimit
      ) {
        throw new ApiError(
          429,
          "UPLOAD_QUOTA_EXCEEDED",
          `Bạn đã vượt quá hạn mức tải ảnh (${kind}) trong ngày hôm nay.`
        );
      }

      const mergedAllowedPaths = Array.from(
        new Set([...existingAllowed, ...plan.issuedFiles.map((f) => f.path)])
      );

      if (isAppendingListingDraft) {
        tx.update(sessionRef, {
          allowedPaths: mergedAllowedPaths,
          totalBytesExpected: FieldValue.increment(addedBytes),
          fileCountExpected: FieldValue.increment(addedFiles),
          status: "pending",
          expiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.set(sessionRef, {
          sessionId,
          ownerUid: uid,
          kind,
          targetId: plan.targetId,
          prefix: plan.prefix,
          allowedPaths: mergedAllowedPaths,
          uploadedPaths: [],
          maxFileBytes: policy.maxFileBytes,
          totalBytesExpected: addedBytes,
          actualBytes: 0,
          fileCountExpected: addedFiles,
          status: "pending",
          claimed: false,
          expiresAt,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(
        quotaRef,
        {
          uid,
          date: dateStr,
          totalFiles: FieldValue.increment(addedFiles),
          totalBytes: FieldValue.increment(addedBytes),
          byKind: {
            [kind]: {
              files: FieldValue.increment(addedFiles),
              bytes: FieldValue.increment(addedBytes),
            },
          },
          expiresAt: new Date(nowMs + 7 * 24 * 3600 * 1000),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        sessionId,
        kind,
        targetId: plan.targetId,
        prefix: plan.prefix,
        expiresAt: expiresAt.toISOString(),
        files: plan.issuedFiles,
      };
    });

    return NextResponse.json({
      success: true,
      ...txResult,
    });
  } catch (err: unknown) {
    if (err instanceof ApiError && err.code === "UPLOAD_QUOTA_EXCEEDED") {
      await recordUploadQuotaAlert({
        uid,
        kind,
        reason: err.message,
        date: dateStr,
      });
    }
    throw err;
  }
});
