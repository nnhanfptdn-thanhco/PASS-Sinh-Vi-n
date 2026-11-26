"use client";

import { storage } from "@/lib/firebase/client";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

export interface UploadTargetDescriptor {
  provider: "cloudinary" | "firebase";
  url?: string;
  fields?: Record<string, string>;
}

export interface IssuedIntentFile {
  name?: string;
  path: string;
  contentType?: string;
  maxBytes?: number;
  upload?: UploadTargetDescriptor;
}

/**
 * Tải Blob ảnh trực tiếp lên Cloudinary (signed FormData) hoặc Firebase Storage (fallback)
 * với timeout thực sự bằng AbortController / task.cancel().
 */
export async function uploadMediaBlobWithTimeout(params: {
  file: IssuedIntentFile;
  blob: Blob;
  contentType: "image/webp" | "image/jpeg";
  sessionId: string;
  timeoutMs?: number;
  needPublicUrl?: boolean;
}): Promise<{ path: string; publicUrl?: string }> {
  const { file, blob, contentType, sessionId, timeoutMs = 20_000, needPublicUrl = false } = params;

  if (file.upload?.provider === "cloudinary" && file.upload.url && file.upload.fields) {
    const formData = new FormData();
    for (const [k, v] of Object.entries(file.upload.fields)) {
      formData.append(k, v);
    }
    const filename = file.name || (contentType === "image/jpeg" ? "image.jpg" : "image.webp");
    formData.append("file", blob, filename);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(file.upload.url, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as {
        secure_url?: string;
        error?: { message?: string };
      } | null;

      if (!res.ok || !json?.secure_url) {
        throw new Error(
          json?.error?.message || `Tải ảnh lên lưu trữ đám mây thất bại (HTTP ${res.status}).`
        );
      }

      return {
        path: file.path,
        publicUrl: needPublicUrl ? json.secure_url : undefined,
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("Quá thời gian tải ảnh lên hệ thống. Vui lòng thử lại với mạng ổn định hơn.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Fallback Firebase Storage
  const uploadedRef = await new Promise<ReturnType<typeof ref>>((resolve, reject) => {
    const fileRef = ref(storage, file.path);
    const task = uploadBytesResumable(fileRef, blob, {
      contentType,
      customMetadata: { sessionId },
    });
    const timer = setTimeout(() => {
      task.cancel();
      reject(new Error("Quá thời gian tải ảnh lên hệ thống. Vui lòng thử lại với mạng ổn định hơn."));
    }, timeoutMs);
    task.on(
      "state_changed",
      undefined,
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      () => {
        clearTimeout(timer);
        resolve(task.snapshot.ref);
      }
    );
  });

  const publicUrl = needPublicUrl ? await getDownloadURL(uploadedRef) : undefined;
  return { path: file.path, publicUrl };
}
