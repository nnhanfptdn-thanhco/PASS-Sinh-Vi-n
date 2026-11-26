import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { redactErrorMessage } from "@/lib/server/request-utils";
import { adminDb, adminAuth, FieldValue } from "@/lib/firebase/admin";
import { validateDisplayName } from "@/lib/utils/contact-filter";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileUpdateSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, "Tên hiển thị tối thiểu 2 ký tự")
      .max(60, "Tên hiển thị tối đa 60 ký tự")
      .optional(),
    photoURL: z
      .string()
      .trim()
      .max(500, "Đường dẫn ảnh đại diện quá dài")
      .nullable()
      .optional(),
    avatarSessionId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, "Mã phiên ảnh đại diện không hợp lệ")
      .optional(),
    notifyApp: z.boolean().optional(),
    notifyEmail: z.boolean().optional(),
  })
  .strict();

function getAllowedStorageBuckets(): string[] {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "cho-pass-sv";
  return Array.from(
    new Set(
      [
        process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        process.env.FIREBASE_STORAGE_BUCKET,
        `${projectId}.firebasestorage.app`,
        `${projectId}.appspot.com`,
      ].filter((b): b is string => Boolean(b && b.trim()))
    )
  );
}

function isAllowedAvatarUrl(url: string, userId: string): boolean {
  if (url.startsWith("https://lh3.googleusercontent.com/")) {
    return true;
  }
  const buckets = getAllowedStorageBuckets();
  for (const bucket of buckets) {
    for (const ext of ["webp", "jpg"]) {
      const prefix = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/public%2Favatars%2F${userId}%2Favatar.${ext}`;
      if (url === prefix || url.startsWith(`${prefix}?`)) {
        return true;
      }
    }
  }
  return false;
}

export const GET = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);
  const userId = auth.uid;

  const [userSnap, privateSnap] = await Promise.all([
    adminDb.collection("users").doc(userId).get(),
    adminDb.collection("usersPrivate").doc(userId).get(),
  ]);

  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const privData = privateSnap.exists ? privateSnap.data() || {} : {};

  return NextResponse.json({
    displayName: (userData.displayName as string) || auth.name || "",
    photoURL: (userData.photoURL as string | null) ?? null,
    notifyApp: typeof privData.notifyApp === "boolean" ? privData.notifyApp : true,
    notifyEmail: typeof privData.notifyEmail === "boolean" ? privData.notifyEmail : true,
  });
});

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireActiveUser(req);
  const userId = auth.uid;

  await consumeRateLimit({
    scope: "profile_update",
    key: userId,
    limit: 10,
    windowSec: 60,
    customMessage: "Bạn thao tác quá thường xuyên. Vui lòng thử lại sau 1 phút.",
  });

  const body = await readJson(req);
  const data = profileUpdateSchema.parse(body);

  if (data.displayName !== undefined) {
    const nameCheck = validateDisplayName(data.displayName);
    if (!nameCheck.valid) {
      throw new ApiError(400, "INVALID_DISPLAY_NAME", nameCheck.error!);
    }
  }

  let isStorageAvatar = false;
  if (data.photoURL) {
    if (!isAllowedAvatarUrl(data.photoURL, userId)) {
      throw new ApiError(
        400,
        "INVALID_PHOTO_URL",
        "Ảnh đại diện chỉ chấp nhận từ Google hoặc tệp avatar hợp lệ trong bucket của hệ thống."
      );
    }
    isStorageAvatar = data.photoURL.startsWith("https://firebasestorage.googleapis.com/");
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  const privateUpdates: Record<string, unknown> = {};
  const authUpdates: { displayName?: string; photoURL?: string | null } = {};

  if (data.displayName !== undefined) {
    updates.displayName = data.displayName;
    authUpdates.displayName = data.displayName;
  }

  if (data.photoURL !== undefined) {
    updates.photoURL = data.photoURL || null;
    authUpdates.photoURL = data.photoURL ? data.photoURL : null;
  }

  if (data.notifyApp !== undefined) {
    privateUpdates.notifyApp = data.notifyApp;
  }
  if (data.notifyEmail !== undefined) {
    privateUpdates.notifyEmail = data.notifyEmail;
  }

  const writes: Array<Promise<unknown>> = [];
  if (data.displayName !== undefined || data.photoURL !== undefined) {
    writes.push(adminDb.collection("users").doc(userId).set(updates, { merge: true }));
  }
  if (Object.keys(privateUpdates).length > 0) {
    privateUpdates.updatedAt = FieldValue.serverTimestamp();
    writes.push(adminDb.collection("usersPrivate").doc(userId).set(privateUpdates, { merge: true }));
  }

  // Đánh dấu claimed cho uploadSession avatar để cron Phase 9 không xóa nhầm ảnh đại diện đang dùng
  if (isStorageAvatar) {
    if (data.avatarSessionId) {
      const sRef = adminDb.collection("uploadSessions").doc(data.avatarSessionId);
      writes.push(
        sRef.get().then((snap) => {
          if (snap.exists && snap.data()?.ownerUid === userId && snap.data()?.kind === "avatar") {
            return sRef.update({
              claimed: true,
              status: "claimed",
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          return undefined;
        }).catch(() => undefined)
      );
    } else {
      writes.push(
        adminDb
          .collection("uploadSessions")
          .where("ownerUid", "==", userId)
          .where("kind", "==", "avatar")
          .where("status", "in", ["pending", "finalized"])
          .limit(5)
          .get()
          .then(async (snap) => {
            if (snap.empty) return;
            const batch = adminDb.batch();
            for (const doc of snap.docs) {
              batch.update(doc.ref, {
                claimed: true,
                status: "claimed",
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
            await batch.commit();
          })
          .catch(() => undefined)
      );
    }
  }

  await Promise.all(writes);

  let authSynced = true;
  if (Object.keys(authUpdates).length > 0) {
    try {
      await adminAuth.updateUser(userId, authUpdates);
    } catch (authErr) {
      authSynced = false;
      console.warn("Không thể đồng bộ profile sang Firebase Auth:", redactErrorMessage(authErr));
    }
  }

  return NextResponse.json({
    success: true,
    authSynced,
    message: authSynced
      ? "Cập nhật hồ sơ thành công."
      : "Đã cập nhật hồ sơ công khai, đồng bộ Firebase Auth sẽ thử lại sau.",
  });
});
