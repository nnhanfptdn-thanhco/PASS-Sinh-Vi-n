import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, adminAuth, FieldValue } from "@/lib/firebase/admin";
import { containsContactInfo } from "@/lib/utils/contact-filter";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(2, "Tên hiển thị tối thiểu 2 ký tự").max(60, "Tên hiển thị tối đa 60 ký tự").optional(),
    photoURL: z
      .string()
      .trim()
      .max(500, "Đường dẫn ảnh đại diện quá dài")
      .refine(
        (url) =>
          url === "" ||
          url.startsWith("https://lh3.googleusercontent.com/") ||
          url.startsWith("https://firebasestorage.googleapis.com/"),
        {
          message: "Ảnh đại diện chỉ chấp nhận từ Google hoặc Firebase Storage của hệ thống.",
        }
      )
      .nullable()
      .optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
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
    if (containsContactInfo(data.displayName)) {
      throw new ApiError(
        400,
        "CONTACT_INFO_FORBIDDEN",
        "Tên hiển thị không được chứa số điện thoại, Zalo hoặc liên kết mạng xã hội."
      );
    }
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  const authUpdates: { displayName?: string; photoURL?: string } = {};

  if (data.displayName !== undefined) {
    updates.displayName = data.displayName;
    authUpdates.displayName = data.displayName;
  }

  if (data.photoURL !== undefined) {
    updates.photoURL = data.photoURL || null;
    authUpdates.photoURL = data.photoURL || undefined;
  }

  await adminDb.collection("users").doc(userId).set(updates, { merge: true });

  if (Object.keys(authUpdates).length > 0) {
    try {
      await adminAuth.updateUser(userId, authUpdates);
    } catch (authErr) {
      console.warn("Không thể đồng bộ profile sang Firebase Auth:", authErr);
    }
  }

  return NextResponse.json({
    success: true,
    message: "Cập nhật hồ sơ thành công.",
  });
});
