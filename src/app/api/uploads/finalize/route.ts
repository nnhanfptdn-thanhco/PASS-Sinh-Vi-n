import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser, requireApprovedStudent } from "@/lib/server/auth-guard";
import { withApi, readJson, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, adminStorage, FieldValue } from "@/lib/firebase/admin";
import { UPLOAD_POLICIES, type UploadKind } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const finalizeUploadSchema = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Mã phiên upload không hợp lệ"),
    paths: z
      .array(z.string().min(1).max(300))
      .min(1, "Cần ít nhất 1 đường dẫn để xác nhận")
      .max(20, "Tối đa 20 đường dẫn"),
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
  const auth = await requireActiveUser(req);
  const body = await readJson(req, 32 * 1024);
  const data = finalizeUploadSchema.parse(body);

  await consumeRateLimit({
    scope: "upload_finalize",
    key: auth.uid,
    limit: 40,
    windowSec: 600,
    customMessage: "Bạn xác nhận tải ảnh quá nhanh. Vui lòng thử lại sau.",
  });

  const sessionRef = adminDb.collection("uploadSessions").doc(data.sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new ApiError(404, "UPLOAD_SESSION_NOT_FOUND", "Không tìm thấy phiên tải ảnh.");
  }

  const session = sessionSnap.data() || {};
  if (session.ownerUid !== auth.uid) {
    throw new ApiError(403, "SESSION_FORBIDDEN", "Phiên tải ảnh không thuộc về bạn.");
  }

  const kind = String(session.kind || "") as UploadKind;
  const policy = UPLOAD_POLICIES[kind];
  if (!policy) {
    throw new ApiError(400, "INVALID_SESSION_KIND", "Loại phiên tải ảnh không hợp lệ.");
  }

  if (policy.requiresVerified) {
    await requireApprovedStudent(req);
  }

  if (session.claimed === true || session.status === "claimed" || session.status === "cleaned") {
    throw new ApiError(409, "SESSION_ALREADY_CLOSED", "Phiên tải ảnh đã được đóng trước đó.");
  }

  const expiryMs = toMs(session.expiresAt);
  if (expiryMs > 0 && expiryMs <= Date.now()) {
    throw new ApiError(409, "SESSION_EXPIRED", "Phiên tải ảnh đã hết hạn.");
  }

  const allowedSet = new Set<string>(
    Array.isArray(session.allowedPaths) ? (session.allowedPaths as string[]) : []
  );

  const uniquePaths = Array.from(new Set(data.paths));
  for (const path of uniquePaths) {
    if (!allowedSet.has(path)) {
      throw new ApiError(
        403,
        "UPLOAD_PATH_NOT_ALLOWED",
        "Đường dẫn ảnh không nằm trong phiên được cấp phép."
      );
    }
  }

  const bucket = adminStorage.bucket();
  const verifiedFiles: Array<{ path: string; sizeBytes: number; contentType: string }> = [];
  let totalVerifiedBytes = 0;

  for (const path of uniquePaths) {
    try {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) {
        throw new ApiError(400, "UPLOAD_FILE_MISSING", "Tệp ảnh chưa được tải lên Storage hoàn tất.");
      }
      const [meta] = await file.getMetadata();
      const contentType = String(meta.contentType || "");
      const sizeBytes = Number(meta.size || 0);
      const customSessionId = (meta.metadata as Record<string, string> | undefined)?.sessionId;

      if (!/^image\/(webp|jpeg)$/.test(contentType)) {
        throw new ApiError(400, "INVALID_UPLOAD_CONTENT_TYPE", "Định dạng ảnh trên Storage không hợp lệ.");
      }
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > policy.maxFileBytes) {
        throw new ApiError(400, "INVALID_UPLOAD_SIZE", "Dung lượng ảnh vượt quá giới hạn cho phép.");
      }
      if (customSessionId && customSessionId !== data.sessionId) {
        throw new ApiError(400, "SESSION_METADATA_MISMATCH", "Metadata phiên upload không khớp.");
      }

      totalVerifiedBytes += sizeBytes;
      verifiedFiles.push({ path, sizeBytes, contentType });
    } catch (err: unknown) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        503,
        "STORAGE_UNAVAILABLE",
        "Không thể xác minh tệp ảnh trên hệ thống lưu trữ lúc này."
      );
    }
  }

  const totalSessionBytes = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) {
      throw new ApiError(404, "UPLOAD_SESSION_NOT_FOUND", "Không tìm thấy phiên tải ảnh.");
    }
    const cur = snap.data() || {};
    if (cur.claimed === true || cur.status === "claimed" || cur.status === "cleaned") {
      throw new ApiError(409, "SESSION_ALREADY_CLOSED", "Phiên tải ảnh đã được đóng trước đó.");
    }
    const existingBytesMap =
      cur.uploadedFileBytes && typeof cur.uploadedFileBytes === "object"
        ? { ...(cur.uploadedFileBytes as Record<string, number>) }
        : {};
    for (const vf of verifiedFiles) {
      existingBytesMap[vf.path] = vf.sizeBytes;
    }
    const accumulatedBytes = Object.values(existingBytesMap).reduce(
      (sum, v) => sum + (Number.isFinite(Number(v)) ? Number(v) : 0),
      0
    );
    const mergedUploaded = Array.from(
      new Set([
        ...(Array.isArray(cur.uploadedPaths) ? (cur.uploadedPaths as string[]) : []),
        ...uniquePaths,
      ])
    );

    tx.update(sessionRef, {
      uploadedPaths: mergedUploaded,
      uploadedFileBytes: existingBytesMap,
      actualBytes: accumulatedBytes,
      status: "finalized",
      updatedAt: FieldValue.serverTimestamp(),
    });
    return accumulatedBytes;
  });

  return NextResponse.json({
    success: true,
    sessionId: data.sessionId,
    files: verifiedFiles,
    totalVerifiedBytes,
    actualBytes: totalSessionBytes,
  });
});
