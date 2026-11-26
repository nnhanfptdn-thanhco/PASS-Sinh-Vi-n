import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth-guard";
import { withApi, ApiError } from "@/lib/server/http";
import { assertAdminSdkReady } from "@/lib/server/admin-ready";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { isValidFirestoreId, rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { getSignedStorageReadUrl } from "@/lib/server/storage-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = withApi(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  assertAdminSdkReady();

  await consumeRateLimit({
    scope: "admin_card_view",
    key: admin.uid,
    limit: 60,
    windowSec: 600,
  });

  const sp = new URL(req.url).searchParams;
  rejectDuplicateQueryParams(sp, ["userId"]);
  const userId = sp.get("userId") || "";
  if (!isValidFirestoreId(userId)) {
    throw new ApiError(400, "INVALID_USER_ID", "userId không hợp lệ.");
  }

  const snap = await adminDb.collection("verifications").doc(userId).get();
  if (!snap.exists) throw new ApiError(404, "VERIFICATION_NOT_FOUND", "Không tìm thấy hồ sơ.");
  const v = snap.data()!;
  const path = typeof v.cardStoragePath === "string" ? v.cardStoragePath : null;
  if (!path || v.cardDeleted) {
    throw new ApiError(404, "CARD_NOT_AVAILABLE", "Ảnh thẻ đã được xóa hoặc chưa có.");
  }

  let url: string;
  if (path.startsWith("data:image/")) {
    url = path; // 1 ảnh ≤ 500KB, an toàn với giới hạn response của Vercel
  } else if (path.startsWith(`private/cards/${userId}/`)) {
    try {
      const signed = await getSignedStorageReadUrl(path, 5 * 60 * 1000);
      if (!signed) {
        throw new Error("EMPTY_SIGNED_URL");
      }
      url = signed;
    } catch (e) {
      console.error("[ADMIN_CARD] sign failed", e instanceof Error ? e.message : "unknown");
      throw new ApiError(
        502,
        "CARD_SIGN_FAILED",
        "Không tạo được liên kết xem ảnh (kiểm tra cấu hình Cloudinary hoặc quyền Service Account Storage)."
      );
    }
  } else {
    throw new ApiError(422, "CARD_PATH_INVALID", "Đường dẫn ảnh thẻ không hợp lệ.");
  }

  await adminDb.collection("adminLogs").add({
    adminUid: admin.uid,
    adminEmail: admin.email || "admin",
    action: "VIEW_STUDENT_CARD",
    targetUserId: userId,
    timestamp: FieldValue.serverTimestamp(),
  });

  const res = NextResponse.json({ url });
  res.headers.set("Cache-Control", "no-store, private");
  return res;
});
