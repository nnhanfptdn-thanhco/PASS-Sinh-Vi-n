import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { appealPendingLockRef } from "@/lib/server/stats";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appealSchema = z
  .object({
    targetType: z.enum(["account", "listing"]),
    targetId: FIRESTORE_ID_SCHEMA,
    appealReason: z
      .string()
      .trim()
      .min(5, "Lý do kháng nghị từ 5 đến 500 ký tự")
      .max(500, "Lý do kháng nghị từ 5 đến 500 ký tự"),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  // Cho phép tài khoản bị khóa/vô hiệu hóa (banned/disabled) gửi kháng nghị mở khóa,
  // nhưng vẫn chặn tài khoản đang xóa hoặc đã xóa vĩnh viễn.
  const auth = await requireAuth(req, { allowInactiveAccount: true });
  if (auth.accountStatus === "deleting") {
    throw new ApiError(
      423,
      "ACCOUNT_DELETING",
      "Tài khoản đang trong quá trình xóa vĩnh viễn và không thể gửi kháng nghị."
    );
  }
  if (auth.accountStatus === "deleted") {
    throw new ApiError(
      403,
      "ACCOUNT_DELETED",
      "Tài khoản đã bị xóa khỏi hệ thống."
    );
  }

  const userId = auth.uid;
  const userEmail = auth.email || "";

  const body = await readJson(req);
  const { targetType, targetId, appealReason, note } = appealSchema.parse(body);

  if (targetType === "listing" && auth.accountStatus !== "active") {
    throw new ApiError(
      403,
      "ACCOUNT_INACTIVE",
      "Tài khoản đang bị khóa; vui lòng gửi kháng nghị cho tài khoản trước."
    );
  }

  if (targetType === "account" && targetId !== userId) {
    throw new ApiError(403, "FORBIDDEN_APPEAL", "Bạn chỉ có thể gửi kháng nghị cho chính tài khoản của bạn.");
  }

  await consumeRateLimit({
    scope: "appeal",
    key: userId,
    limit: 5,
    windowSec: 86400,
    customMessage: "Bạn chỉ có thể gửi tối đa 5 yêu cầu kháng nghị mỗi ngày.",
  });

  const lockRef = appealPendingLockRef(userId, targetType, targetId);
  const appealRef = adminDb.collection("appeals").doc();

  await adminDb.runTransaction(async (tx) => {
    const [lockSnap, existingPendingSnap, listingSnap] = await Promise.all([
      tx.get(lockRef),
      tx.get(
        adminDb
          .collection("appeals")
          .where("targetType", "==", targetType)
          .where("targetId", "==", targetId)
          .where("status", "==", "pending")
          .limit(1)
      ),
      targetType === "listing"
        ? tx.get(adminDb.collection("listings").doc(targetId))
        : Promise.resolve(null),
    ]);

    if (targetType === "listing") {
      if (!listingSnap || !listingSnap.exists) {
        throw new ApiError(404, "LISTING_NOT_FOUND", "Không tìm thấy tin đăng cần kháng nghị.");
      }
      if (listingSnap.data()?.sellerId !== userId) {
        throw new ApiError(403, "FORBIDDEN_APPEAL", "Bạn chỉ có thể gửi kháng nghị cho tin đăng của chính bạn.");
      }
    }

    if (lockSnap.exists || !existingPendingSnap.empty) {
      throw new ApiError(409, "APPEAL_ALREADY_PENDING", "Kháng nghị của bạn cho mục này đang chờ xét duyệt.");
    }

    tx.create(lockRef, {
      appealId: appealRef.id,
      userId,
      targetType,
      targetId,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.create(appealRef, {
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
  });

  return NextResponse.json({
    success: true,
    appealId: appealRef.id,
    message:
      "Kháng nghị của bạn đã được ghi nhận. Quản trị viên sẽ xem xét lại và phản hồi qua thông báo hệ thống.",
  });
});
