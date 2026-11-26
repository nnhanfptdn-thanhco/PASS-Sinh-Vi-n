import "server-only";
import crypto from "crypto";
import { adminStorage } from "@/lib/firebase/admin";
import type { UploadKind } from "@/lib/server/uploads";

export type StorageProviderKind = "cloudinary" | "firebase";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface SignedUploadDescriptor {
  provider: StorageProviderKind;
  url?: string;
  fields?: Record<string, string>;
}

export interface StorageObjectMetadata {
  exists: boolean;
  contentType: string;
  sizeBytes: number;
  sessionId?: string;
  createdAtMs?: number;
  secureUrl?: string;
}

export interface ListedStorageObject {
  path: string;
  createdAtMs?: number;
}

const PRIVATE_PATH_RE =
  /^private\/(cards|chats)\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{4,64}\.(webp|jpg)$/;

export function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = (
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
    ""
  ).trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || "").trim();

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }
  return { cloudName, apiKey, apiSecret };
}

export function getActiveStorageProvider(): StorageProviderKind {
  return getCloudinaryConfig() ? "cloudinary" : "firebase";
}

export function signCloudinaryParams(
  params: Record<string, string | number | boolean | undefined | null>,
  apiSecret: string
): string {
  const toSign = Object.keys(params)
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && String(v) !== "";
    })
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${toSign}${apiSecret}`)
    .digest("hex");
}

export function parseStoragePathForCloudinary(storagePath: string): {
  publicId: string;
  format: "webp" | "jpg";
  deliveryType: "upload" | "authenticated";
} {
  const cleanPath = storagePath.replace(/^\/+/, "");
  const deliveryType = cleanPath.startsWith("private/") ? "authenticated" : "upload";
  const extMatch = /\.(webp|jpg|jpeg)$/i.exec(cleanPath);
  const rawExt = (extMatch?.[1] || "webp").toLowerCase();
  const format: "webp" | "jpg" = rawExt === "jpg" || rawExt === "jpeg" ? "jpg" : "webp";
  const publicId = extMatch ? cleanPath.slice(0, -extMatch[0].length) : cleanPath;

  return { publicId, format, deliveryType };
}

export function cloudinaryResourceToStoragePath(publicId: string, format?: string): string {
  const cleanId = publicId.replace(/^\/+/, "");
  if (/\.(webp|jpg)$/i.test(cleanId)) return cleanId;
  const fmtLower = (format || "webp").toLowerCase();
  const ext = fmtLower === "jpeg" || fmtLower === "jpg" ? "jpg" : "webp";
  return `${cleanId}.${ext}`;
}

function encodePublicIdSegments(publicId: string): string {
  return publicId
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function cloudinaryBasicAuthHeader(cfg: CloudinaryConfig): string {
  return `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString("base64")}`;
}

/**
 * Tạo tham số upload trực tiếp có chữ ký cho trình duyệt (dùng trong /api/uploads/intent).
 */
export function createUploadDescriptor(params: {
  storagePath: string;
  kind: UploadKind;
  sessionId: string;
  nowSec?: number;
}): SignedUploadDescriptor {
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return { provider: "firebase" };
  }

  const { publicId, deliveryType } = parseStoragePathForCloudinary(params.storagePath);
  const timestamp = String(params.nowSec ?? Math.floor(Date.now() / 1000));
  const overwrite = params.kind === "avatar" ? "true" : "false";
  const allowedFormats = "webp,jpg,jpeg";
  const context = `sessionId=${params.sessionId}`;

  const signedParams: Record<string, string> = {
    allowed_formats: allowedFormats,
    context,
    overwrite,
    public_id: publicId,
    timestamp,
    type: deliveryType,
  };

  const signature = signCloudinaryParams(signedParams, cfg.apiSecret);

  return {
    provider: "cloudinary",
    url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/upload`,
    fields: {
      api_key: cfg.apiKey,
      ...signedParams,
      signature,
    },
  };
}

/**
 * Kiểm tra xem URL công khai (tin đăng / avatar) có thuộc Cloudinary account của hệ thống và đúng thư mục user hay không.
 */
export function isAllowedCloudinaryPublicUrl(
  url: string,
  expectedObjectRegex: RegExp
): boolean {
  const cfg = getCloudinaryConfig();
  const cloudName =
    cfg?.cloudName ||
    (
      process.env.CLOUDINARY_CLOUD_NAME ||
      process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
      ""
    ).trim();
  if (!cloudName) return false;

  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.hostname !== "res.cloudinary.com") {
      return false;
    }
    const prefix = `/${cloudName}/image/upload/`;
    if (!u.pathname.startsWith(prefix)) {
      return false;
    }
    let remainder = decodeURIComponent(u.pathname.slice(prefix.length));
    // Bỏ segment version tùy chọn (vd: v1764123456/)
    remainder = remainder.replace(/^v\d+\//, "");
    if (remainder.includes("..") || remainder.includes("\\")) {
      return false;
    }
    return expectedObjectRegex.test(remainder);
  } catch {
    return false;
  }
}

/**
 * Lấy metadata thực tế của đối tượng đã tải lên (dùng để xác minh size & contentType phía server).
 */
export async function getStorageObjectMetadata(
  storagePath: string
): Promise<StorageObjectMetadata> {
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    const file = adminStorage.bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return { exists: false, contentType: "", sizeBytes: 0 };
    }
    const [meta] = await file.getMetadata();
    const contentType = String(meta.contentType || "");
    const sizeBytes = Number(meta.size || 0);
    const customSessionId = (meta.metadata as Record<string, string> | undefined)?.sessionId;
    const createdAtMs = meta.timeCreated ? Date.parse(String(meta.timeCreated)) : undefined;
    return {
      exists: true,
      contentType,
      sizeBytes,
      sessionId: customSessionId,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
    };
  }

  const { publicId, deliveryType } = parseStoragePathForCloudinary(storagePath);
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    cfg.cloudName
  )}/resources/image/${deliveryType}/${encodePublicIdSegments(publicId)}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: cloudinaryBasicAuthHeader(cfg),
    },
    cache: "no-store",
  });

  if (res.status === 404) {
    return { exists: false, contentType: "", sizeBytes: 0 };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`CLOUDINARY_META_ERROR:${res.status}:${bodyText.slice(0, 120)}`);
  }

  const json = (await res.json()) as {
    format?: string;
    bytes?: number;
    created_at?: string;
    secure_url?: string;
    context?: { custom?: Record<string, string> };
  };

  const fmt = (json.format || "").toLowerCase();
  const contentType =
    fmt === "webp"
      ? "image/webp"
      : fmt === "jpg" || fmt === "jpeg"
      ? "image/jpeg"
      : fmt
      ? `image/${fmt}`
      : "";
  const sizeBytes = Number(json.bytes || 0);
  const createdAtMs = json.created_at ? Date.parse(json.created_at) : undefined;

  return {
    exists: true,
    contentType,
    sizeBytes,
    sessionId: json.context?.custom?.sessionId,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
    secureUrl: typeof json.secure_url === "string" ? json.secure_url : undefined,
  };
}

/**
 * Xóa 1 tệp ảnh theo đường dẫn logic (idempotent nếu không tồn tại).
 */
export async function deleteStorageObject(storagePath: string): Promise<void> {
  if (!storagePath) return;

  const cfg = getCloudinaryConfig();
  if (!cfg) {
    await adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true });
    return;
  }

  const { publicId, deliveryType } = parseStoragePathForCloudinary(storagePath);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signedParams: Record<string, string> = {
    invalidate: "true",
    public_id: publicId,
    timestamp,
    type: deliveryType,
  };
  const signature = signCloudinaryParams(signedParams, cfg.apiSecret);

  const form = new URLSearchParams({
    ...signedParams,
    api_key: cfg.apiKey,
    signature,
  });

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(cfg.cloudName)}/image/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CLOUDINARY_DESTROY_ERROR:${res.status}:${txt.slice(0, 120)}`);
  }

  const json = (await res.json().catch(() => ({}))) as { result?: string };
  if (json.result && json.result !== "ok" && json.result !== "not found") {
    throw new Error(`CLOUDINARY_DESTROY_RESULT:${json.result}`);
  }
}

/**
 * Liệt kê danh sách đối tượng theo prefix (có phân trang).
 */
export async function listStorageObjectsByPrefix(
  prefix: string,
  options?: { maxResults?: number; pageToken?: string }
): Promise<{ items: ListedStorageObject[]; nextPageToken?: string }> {
  const maxResults = Math.min(500, Math.max(1, options?.maxResults ?? 100));
  const cfg = getCloudinaryConfig();

  if (!cfg) {
    const bucket = adminStorage.bucket();
    if (typeof bucket.getFiles !== "function") {
      return { items: [] };
    }
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      maxResults,
      ...(options?.pageToken ? { pageToken: options.pageToken } : {}),
    });
    const items: ListedStorageObject[] = (files || [])
      .filter((f) => Boolean(f.name) && !f.name.endsWith("/"))
      .map((f) => {
        const createdAtMs = f.metadata?.timeCreated
          ? Date.parse(String(f.metadata.timeCreated))
          : undefined;
        return {
          path: f.name,
          createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
        };
      });
    const nextPageToken =
      nextQuery && typeof (nextQuery as { pageToken?: unknown }).pageToken === "string"
        ? String((nextQuery as { pageToken: string }).pageToken)
        : undefined;
    return { items, nextPageToken };
  }

  const cleanPrefix = prefix.replace(/^\/+/, "");
  const deliveryType = cleanPrefix.startsWith("private/") ? "authenticated" : "upload";
  const qs = new URLSearchParams({
    prefix: cleanPrefix,
    max_results: String(maxResults),
  });
  if (options?.pageToken) {
    qs.set("next_cursor", options.pageToken);
  }

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cfg.cloudName
    )}/resources/image/${deliveryType}?${qs.toString()}`,
    {
      method: "GET",
      headers: { Authorization: cloudinaryBasicAuthHeader(cfg) },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CLOUDINARY_LIST_ERROR:${res.status}:${txt.slice(0, 120)}`);
  }

  const json = (await res.json()) as {
    resources?: Array<{ public_id: string; format?: string; created_at?: string }>;
    next_cursor?: string;
  };

  const items: ListedStorageObject[] = (json.resources || []).map((r) => {
    const createdAtMs = r.created_at ? Date.parse(r.created_at) : undefined;
    return {
      path: cloudinaryResourceToStoragePath(r.public_id, r.format),
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
    };
  });

  return {
    items,
    nextPageToken: typeof json.next_cursor === "string" && json.next_cursor ? json.next_cursor : undefined,
  };
}

/**
 * Xóa toàn bộ tệp theo prefix và xác minh prefix đã trống hoàn toàn.
 */
export async function deleteStoragePrefixAndCheckEmpty(prefix: string): Promise<void> {
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    const bucket = adminStorage.bucket();
    await bucket.deleteFiles({ prefix, force: true });
    const [remaining] = await bucket.getFiles({ prefix, maxResults: 1 });
    if (remaining.length > 0) {
      throw new Error(`STORAGE_PREFIX_NOT_EMPTY:${prefix}`);
    }
    return;
  }

  const cleanPrefix = prefix.replace(/^\/+/, "");
  const deliveryType = cleanPrefix.startsWith("private/") ? "authenticated" : "upload";

  for (let round = 0; round < 10; round++) {
    const qs = new URLSearchParams({
      prefix: cleanPrefix,
      invalidate: "true",
    });
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(
        cfg.cloudName
      )}/resources/image/${deliveryType}?${qs.toString()}`,
      {
        method: "DELETE",
        headers: { Authorization: cloudinaryBasicAuthHeader(cfg) },
        cache: "no-store",
      }
    );
    if (!res.ok && res.status !== 404) {
      const txt = await res.text().catch(() => "");
      throw new Error(`CLOUDINARY_DELETE_PREFIX_ERROR:${res.status}:${txt.slice(0, 120)}`);
    }
    const json = (await res.json().catch(() => ({}))) as { partial?: boolean };
    if (!json.partial) {
      break;
    }
  }

  const check = await listStorageObjectsByPrefix(cleanPrefix, { maxResults: 1 });
  if (check.items.length > 0) {
    throw new Error(`STORAGE_PREFIX_NOT_EMPTY:${prefix}`);
  }
}

function getPrivateMediaSigningKey(): string {
  const cfg = getCloudinaryConfig();
  if (cfg?.apiSecret) return cfg.apiSecret;
  const fallback = (process.env.STUDENT_ID_HMAC_SECRET || "").trim();
  if (fallback) return fallback;
  throw new Error("PRIVATE_MEDIA_SIGNING_SECRET_MISSING");
}

/**
 * Ký token HMAC-SHA256 thời hạn ngắn (mặc định 5 phút) để trình duyệt đọc ảnh riêng tư qua /api/media/private.
 */
export function mintPrivateMediaToken(
  storagePath: string,
  ttlMs = 5 * 60 * 1000,
  nowMs = Date.now()
): string {
  if (!PRIVATE_PATH_RE.test(storagePath)) {
    throw new Error("INVALID_PRIVATE_MEDIA_PATH");
  }
  const secret = getPrivateMediaSigningKey();
  const payload = Buffer.from(
    JSON.stringify({ p: storagePath, e: nowMs + ttlMs }),
    "utf-8"
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPrivateMediaToken(
  token: string,
  nowMs = Date.now()
): { valid: true; path: string } | { valid: false; reason: string } {
  if (!token || typeof token !== "string" || token.length > 1024) {
    return { valid: false, reason: "MALFORMED_TOKEN" };
  }
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) {
    return { valid: false, reason: "MALFORMED_TOKEN" };
  }

  const payload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);

  let secret: string;
  try {
    secret = getPrivateMediaSigningKey();
  } catch {
    return { valid: false, reason: "SIGNING_SECRET_MISSING" };
  }

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(providedSig, "utf-8");
  const b = Buffer.from(expectedSig, "utf-8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as {
      p?: unknown;
      e?: unknown;
    };
    if (typeof parsed.p !== "string" || typeof parsed.e !== "number") {
      return { valid: false, reason: "INVALID_PAYLOAD" };
    }
    if (parsed.e <= nowMs) {
      return { valid: false, reason: "TOKEN_EXPIRED" };
    }
    if (!PRIVATE_PATH_RE.test(parsed.p)) {
      return { valid: false, reason: "INVALID_PATH" };
    }
    return { valid: true, path: parsed.p };
  } catch {
    return { valid: false, reason: "INVALID_JSON" };
  }
}

/**
 * Tạo URL đọc có chữ ký thời hạn ngắn cho ảnh riêng tư (ảnh thẻ SV / ảnh chat 1-1).
 */
export async function getSignedStorageReadUrl(
  storagePath: string,
  ttlMs = 5 * 60 * 1000
): Promise<string | null> {
  if (!PRIVATE_PATH_RE.test(storagePath)) {
    return null;
  }

  const cfg = getCloudinaryConfig();
  if (cfg) {
    const token = mintPrivateMediaToken(storagePath, ttlMs);
    return `/api/media/private?t=${encodeURIComponent(token)}`;
  }

  const file = adminStorage.bucket().file(storagePath);
  if (typeof file.getSignedUrl !== "function") {
    return null;
  }
  const [signed] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + ttlMs,
  });
  return signed;
}

/**
 * Tạo Cloudinary private_download_url có thời hạn ngắn (chỉ dùng phía server trong /api/media/private).
 */
export function buildCloudinaryPrivateDownloadUrl(
  storagePath: string,
  ttlSec = 60,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    throw new Error("CLOUDINARY_NOT_CONFIGURED");
  }
  const { publicId, format, deliveryType } = parseStoragePathForCloudinary(storagePath);
  const expiresAt = String(nowSec + ttlSec);
  const timestamp = String(nowSec);

  const signedParams: Record<string, string> = {
    expires_at: expiresAt,
    format,
    public_id: publicId,
    timestamp,
    type: deliveryType,
  };
  const signature = signCloudinaryParams(signedParams, cfg.apiSecret);

  const qs = new URLSearchParams({
    ...signedParams,
    api_key: cfg.apiKey,
    signature,
  });

  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    cfg.cloudName
  )}/image/download?${qs.toString()}`;
}

/**
 * Tải nội dung nhị phân ảnh riêng tư từ Cloudinary phía server (không tốn Admin API quota ở luồng chính).
 */
export async function fetchPrivateCloudinaryImage(
  storagePath: string
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const cfg = getCloudinaryConfig();
  if (!cfg) return null;

  const { format } = parseStoragePathForCloudinary(storagePath);
  const fallbackMime = format === "jpg" ? "image/jpeg" : "image/webp";

  const downloadUrl = buildCloudinaryPrivateDownloadUrl(storagePath, 60);
  const res = await fetch(downloadUrl, { method: "GET", cache: "no-store" });
  if (res.ok) {
    const rawCt = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const contentType =
      rawCt === "image/webp" || rawCt === "image/jpeg" ? rawCt : fallbackMime;
    return {
      bytes: await res.arrayBuffer(),
      contentType,
    };
  }

  // Fallback qua Admin API secure_url nếu định dạng lưu thực tế khác đuôi mở rộng
  const meta = await getStorageObjectMetadata(storagePath).catch(() => null);
  if (meta?.exists && meta.secureUrl) {
    const fallbackRes = await fetch(meta.secureUrl, { method: "GET", cache: "no-store" });
    if (fallbackRes.ok) {
      return {
        bytes: await fallbackRes.arrayBuffer(),
        contentType: meta.contentType || fallbackMime,
      };
    }
  }

  return null;
}
