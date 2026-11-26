import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { redactErrorMessage } from "@/lib/server/request-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cleanupUploadSchema = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Mã phiên upload không hợp lệ"),
    paths: z.array(z.string().min(1).max(300)).max(20).optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);
  const body = await readJson(req, 16 * 1024);
  const data = cleanupUploadSchema.parse(body);

  await consumeRateLimit({
    scope: "upload_cleanup",
    key: auth.uid,
    limit: 40,
    windowSec: 600,
    customMessage: "Bạn gửi yêu cầu dọn ảnh nháp quá nhanh. Vui lòng thử lại sau.",
  });

  const sessionRef = adminDb.collection("uploadSessions").doc(data.sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new ApiError(404, "UPLOAD_SESSION_NOT_FOUND", "Không tìm thấy phiên tải ảnh.");
  }

  const session = sessionSnap.data() || {};
  if (session.ownerUid !== auth.uid && !auth.isAdmin) {
    throw new ApiError(403, "SESSION_FORBIDDEN", "Bạn không có quyền dọn phiên tải ảnh này.");
  }

  if (session.claimed === true || session.status === "claimed") {
    throw new ApiError(
      409,
      "SESSION_ALREADY_CLAIMED",
      "Ảnh của phiên này đã được gắn với bản ghi chính thức và không thể xóa theo luồng nháp."
    );
  }

  // Bảo vệ bổ sung cho tin đăng: kiểm tra listing theo đúng ownerUid của session (kể cả khi Admin dọn hộ)
  const sessionOwnerUid = String(session.ownerUid || auth.uid);
  if (session.kind === "listing") {
    const deterministicListingSnap = await adminDb
      .collection("listings")
      .doc(`${sessionOwnerUid}_${data.sessionId}`)
      .get();
    if (deterministicListingSnap.exists) {
      throw new ApiError(
        409,
        "LISTING_ALREADY_CREATED",
        "Tin đăng tương ứng với bản nháp này đã tồn tại."
      );
    }
  }

  const allowedPaths = Array.isArray(session.allowedPaths)
    ? (session.allowedPaths as string[])
    : [];
  const allowedSet = new Set(allowedPaths);

  const targetPaths = data.paths && data.paths.length > 0
    ? Array.from(new Set(data.paths))
    : allowedPaths;

  for (const path of targetPaths) {
    if (!allowedSet.has(path)) {
      throw new ApiError(
        403,
        "UPLOAD_PATH_NOT_ALLOWED",
        "Đường dẫn ảnh không nằm trong phiên tải ảnh này."
      );
    }
  }

  const bucket = adminStorage.bucket();
  const deleted: string[] = [];
  const queued: string[] = [];

  for (const path of targetPaths) {
    try {
      await bucket.file(path).delete({ ignoreNotFound: true });
      deleted.push(path);
    } catch (err: unknown) {
      const pathDigest = crypto.createHash("sha256").update(path).digest("hex").slice(0, 24);
      const jobId = `draft_${data.sessionId}_${pathDigest}`;
      await adminDb.collection("storageCleanupJobs").doc(jobId).set(
        {
          jobId,
          kind: "object",
          targetPath: path,
          sessionId: data.sessionId,
          ownerUid: sessionOwnerUid,
          reason: "draft_cleanup_failed",
          status: "pending",
          attempts: 0,
          deadLetter: false,
          lastError: redactErrorMessage(err),
          nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      queued.push(path);
    }
  }

  // Chỉ đóng session thành 'cleaned' khi caller chủ đích xóa toàn bộ phiên (không truyền paths cụ thể).
  // Khi người dùng xóa 1 ảnh đơn lẻ trên bản nháp (/listings/new), giữ nguyên phiên mở để vẫn tải tiếp ảnh mới.
  const cleaningWholeSession = !data.paths || data.paths.length === 0;
  if (cleaningWholeSession) {
    await sessionRef.update({
      status: queued.length > 0 ? "cleanup_pending" : "cleaned",
      uploadedPaths: [],
      actualBytes: 0,
      uploadedFileBytes: {},
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else if (deleted.length > 0) {
    await adminDb.runTransaction(async (tx) => {
      const curSnap = await tx.get(sessionRef);
      if (!curSnap.exists) return;
      const cur = curSnap.data() || {};
      const deletedSet = new Set(deleted);
      const remainingUploaded = (
        Array.isArray(cur.uploadedPaths) ? (cur.uploadedPaths as string[]) : []
      ).filter((p) => !deletedSet.has(p));
      const nextBytesMap =
        cur.uploadedFileBytes && typeof cur.uploadedFileBytes === "object"
          ? { ...(cur.uploadedFileBytes as Record<string, number>) }
          : {};
      for (const p of deleted) {
        delete nextBytesMap[p];
      }
      const nextActualBytes = Object.values(nextBytesMap).reduce(
        (sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0),
        0
      );
      tx.update(sessionRef, {
        uploadedPaths: remainingUploaded,
        uploadedFileBytes: nextBytesMap,
        actualBytes: nextActualBytes,
        status: remainingUploaded.length > 0 ? "finalized" : "pending",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  return NextResponse.json({
    success: true,
    deletedCount: deleted.length,
    queuedCount: queued.length,
    status: cleaningWholeSession
      ? queued.length > 0
        ? "cleanup_pending"
        : "cleaned"
      : "open",
  });
});
