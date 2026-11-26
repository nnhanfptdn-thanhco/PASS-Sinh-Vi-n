import "server-only";
import crypto from "crypto";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { ApiError } from "@/lib/server/http";
import { isValidFirestoreId } from "@/lib/server/request-utils";
import { todayVN } from "@/lib/utils/date";

export type UploadKind = "card" | "listing" | "avatar" | "chat";

export interface UploadKindPolicy {
  maxFileBytes: number;
  maxFilesPerSession: number;
  dailyFileLimit: number;
  dailyBytesLimit: number;
  maxActiveSessions: number;
  requiresVerified: boolean;
}

export const GLOBAL_DAILY_FILES_LIMIT = 80;
export const GLOBAL_DAILY_BYTES_LIMIT = 150 * 1024 * 1024;
export const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000; // 1 giờ

export const UPLOAD_POLICIES: Record<UploadKind, UploadKindPolicy> = {
  card: {
    maxFileBytes: 10 * 1024 * 1024,
    maxFilesPerSession: 1,
    dailyFileLimit: 6,
    dailyBytesLimit: 25 * 1024 * 1024,
    maxActiveSessions: 3,
    requiresVerified: false,
  },
  listing: {
    maxFileBytes: 5 * 1024 * 1024,
    maxFilesPerSession: 20, // tối đa 10 ảnh x (main + thumb)
    dailyFileLimit: 60,
    dailyBytesLimit: 100 * 1024 * 1024,
    maxActiveSessions: 5,
    requiresVerified: true,
  },
  avatar: {
    maxFileBytes: 2 * 1024 * 1024,
    maxFilesPerSession: 1,
    dailyFileLimit: 5,
    dailyBytesLimit: 10 * 1024 * 1024,
    maxActiveSessions: 2,
    requiresVerified: true,
  },
  chat: {
    maxFileBytes: 3 * 1024 * 1024,
    maxFilesPerSession: 4,
    dailyFileLimit: 40,
    dailyBytesLimit: 60 * 1024 * 1024,
    maxActiveSessions: 10,
    requiresVerified: true,
  },
};

export interface RequestedUploadFile {
  name?: string;
  contentType: "image/webp" | "image/jpeg";
  sizeBytes: number;
}

export interface IssuedUploadFile {
  name: string;
  path: string;
  contentType: "image/webp" | "image/jpeg";
  maxBytes: number;
}

const SAFE_BASENAME_RE = /^[A-Za-z0-9_-]{4,64}\.(webp|jpg)$/;

export function extensionForContentType(contentType: "image/webp" | "image/jpeg"): "webp" | "jpg" {
  return contentType === "image/jpeg" ? "jpg" : "webp";
}

export function normalizeUploadSessionId(rawId?: string): string {
  if (rawId && isValidFirestoreId(rawId) && rawId.length >= 8 && rawId.length <= 64) {
    return rawId;
  }
  return `u_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function buildUploadSessionPlan(params: {
  uid: string;
  kind: UploadKind;
  sessionId: string;
  targetId?: string;
  files: RequestedUploadFile[];
}): {
  prefix: string;
  targetId: string;
  issuedFiles: IssuedUploadFile[];
  totalBytesExpected: number;
} {
  const { uid, kind, sessionId, targetId, files } = params;
  const policy = UPLOAD_POLICIES[kind];

  if (files.length < 1 || files.length > policy.maxFilesPerSession) {
    throw new ApiError(
      400,
      "INVALID_UPLOAD_COUNT",
      `Số lượng tệp mỗi phiên cho loại "${kind}" phải từ 1 đến ${policy.maxFilesPerSession}.`
    );
  }

  let totalBytesExpected = 0;
  for (const f of files) {
    if (!Number.isFinite(f.sizeBytes) || f.sizeBytes <= 0 || f.sizeBytes > policy.maxFileBytes) {
      throw new ApiError(
        400,
        "UPLOAD_FILE_TOO_LARGE",
        `Dung lượng mỗi tệp (${kind}) phải lớn hơn 0 và không vượt quá ${Math.round(policy.maxFileBytes / (1024 * 1024))}MB.`
      );
    }
    totalBytesExpected += Math.ceil(f.sizeBytes);
  }

  if (kind === "card") {
    const ext = extensionForContentType(files[0].contentType);
    const fileName = `${sessionId}.${ext}`;
    const prefix = `private/cards/${uid}/`;
    return {
      prefix,
      targetId: uid,
      totalBytesExpected,
      issuedFiles: [
        {
          name: fileName,
          path: `${prefix}${fileName}`,
          contentType: files[0].contentType,
          maxBytes: policy.maxFileBytes,
        },
      ],
    };
  }

  if (kind === "avatar") {
    const ext = extensionForContentType(files[0].contentType);
    const fileName = `avatar.${ext}`;
    const prefix = `public/avatars/${uid}/`;
    return {
      prefix,
      targetId: uid,
      totalBytesExpected,
      issuedFiles: [
        {
          name: fileName,
          path: `${prefix}${fileName}`,
          contentType: files[0].contentType,
          maxBytes: policy.maxFileBytes,
        },
      ],
    };
  }

  if (kind === "chat") {
    if (!targetId || !isValidFirestoreId(targetId)) {
      throw new ApiError(400, "INVALID_CHAT_ID", "Thiếu hoặc sai mã hội thoại cho ảnh đính kèm.");
    }
    const prefix = `private/chats/${targetId}/`;
    const issuedFiles = files.map((f, idx) => {
      const ext = extensionForContentType(f.contentType);
      const fileName = `${sessionId}_${idx}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
      return {
        name: fileName,
        path: `${prefix}${fileName}`,
        contentType: f.contentType,
        maxBytes: policy.maxFileBytes,
      };
    });
    return {
      prefix,
      targetId,
      totalBytesExpected,
      issuedFiles,
    };
  }

  // kind === "listing"
  const prefix = `public/listings/${uid}/${sessionId}/`;
  const usedNames = new Set<string>();
  const issuedFiles = files.map((f, idx) => {
    const ext = extensionForContentType(f.contentType);
    const preferred =
      f.name && SAFE_BASENAME_RE.test(f.name) && f.name.endsWith(`.${ext}`)
        ? f.name
        : `img_${idx}_${crypto.randomBytes(3).toString("hex")}.${ext}`;
    const finalName = usedNames.has(preferred)
      ? `img_${idx}_${crypto.randomBytes(3).toString("hex")}.${ext}`
      : preferred;
    usedNames.add(finalName);
    return {
      name: finalName,
      path: `${prefix}${finalName}`,
      contentType: f.contentType,
      maxBytes: policy.maxFileBytes,
    };
  });

  return {
    prefix,
    targetId: sessionId,
    totalBytesExpected,
    issuedFiles,
  };
}

export async function recordUploadQuotaAlert(params: {
  uid: string;
  kind: UploadKind;
  reason: string;
  date: string;
}): Promise<void> {
  try {
    const alertId = `upload_quota_${params.uid}_${params.kind}_${params.date}`;
    await adminDb.collection("adminLogs").doc(alertId).set(
      {
        action: "upload_quota_exceeded",
        severity: "warning",
        uid: params.uid,
        kind: params.kind,
        reason: params.reason,
        date: params.date,
        occurrences: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // Non-blocking anomaly logging
  }
}

export function getDailyQuotaDocRef(uid: string, dateStr = todayVN()) {
  return adminDb.collection("userUploadQuotas").doc(`${uid}_${dateStr}`);
}
