import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appealSchema = z
  .object({
    targetType: z.enum(["account", "listing"]),
    targetId: z.string().min(1, "Thiếu targetId").max(128),
    appealReason: z.string().trim().min(5, "Lý do kháng nghị từ 5 đến 500 ký tự").max(500, "Lý do kháng nghị từ 5 đến 500 ký tự"),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const userId = auth.uid;
  const userEmail = auth.email || "";

  const body = await readJson(req);
  const { targetType, targetId, appealReason, note } = appealSchema.parse(body);

  if (targetType === "account" && targetId !== userId) {
    throw new ApiError(403, "FORBIDDEN_APPEAL", "Bạn chỉ có thể gửi kháng nghị cho chính tài khoản của bạn.");
  }

  if (targetType === "listing") {
    const listingSnap = await adminDb.collection("listings").doc(targetId).get();
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Không tìm thấy tin đăng cần kháng nghị.");
    }
    if (listingSnap.data()?.sellerId !== userId) {
      throw new ApiError(403, "FORBIDDEN_APPEAL", "Bạn chỉ có thể gửi kháng nghị cho tin đăng của chính bạn.");
    }
  }

  // Chặn trùng appeal đang pending cho cùng target (F19)
  const existingPendingSnap = await adminDb
    .collection("appeals")
    .where("targetType", "==", targetType)
    .where("targetId", "==", targetId)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!existingPendingSnap.empty) {
    throw new ApiError(409, "APPEAL_ALREADY_PENDING", "Kháng nghị của bạn cho mục này đang chờ xét duyệt.");
  }

  await consumeRateLimit({
    scope: "appeal",
    key: userId,
    limit: 5,
    windowSec: 86400,
    customMessage: "Bạn chỉ có thể gửi tối đa 5 yêu cầu kháng nghị mỗi ngày.",
  });

  const appealRef = adminDb.collection("appeals").doc();
  await appealRef.set({
    id: appealRef.id,
    userId,
    userEmail,
    targetType,
    targetId,
    appealReason,
    note: note || "",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    success: true,
    message:
      "Kháng nghị của bạn đã được ghi nhận. Quản trị viên sẽ xem xét lại và phản hồi qua thông báo hệ thống.",
  });
});
