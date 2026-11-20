import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportSchema = z
  .object({
    targetType: z.enum(["listing", "user", "conversation"]),
    targetId: z.string().min(1, "Thiếu targetId").max(128),
    reason: z.enum(["scam", "wrong_description", "banned_goods", "duplicate", "spam", "other"]),
    details: z.string().max(1000).optional(),
    attachedMessages: z
      .array(
        z.object({
          senderId: z.string().max(128),
          text: z.string().max(1000),
          createdAt: z.union([z.string(), z.number()]).optional(),
        })
      )
      .max(20)
      .optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const reporterId = auth.uid;

  const body = await readJson(req);
  const { targetType, targetId, reason, details, attachedMessages } = reportSchema.parse(body);

  if (targetType === "user" && targetId === reporterId) {
    throw new ApiError(400, "CANNOT_REPORT_SELF", "Bạn không thể tự báo cáo chính mình.");
  }

  // Kiểm tra targetId tồn tại
  if (targetType === "listing") {
    const listingSnap = await adminDb.collection("listings").doc(targetId).get();
    if (!listingSnap.exists) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Tin đăng được báo cáo không tồn tại.");
    }
  } else if (targetType === "user") {
    const userSnap = await adminDb.collection("users").doc(targetId).get();
    if (!userSnap.exists) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Người dùng được báo cáo không tồn tại.");
    }
  } else if (targetType === "conversation") {
    const convSnap = await adminDb.collection("conversations").doc(targetId).get();
    if (!convSnap.exists) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Hội thoại được báo cáo không tồn tại.");
    }
  }

  await consumeRateLimit({
    scope: "report",
    key: reporterId,
    limit: 10,
    windowSec: 3600,
    customMessage: "Bạn đã gửi báo cáo quá nhiều lần trong 1 giờ qua. Vui lòng thử lại sau.",
  });

  const reportDocId = `${reporterId}_${targetType}_${targetId}`;
  const reportRef = adminDb.collection("reports").doc(reportDocId);

  try {
    await reportRef.create({
      id: reportDocId,
      reporterId,
      targetType,
      targetId,
      reason,
      details: details || "",
      attachedMessages: attachedMessages || [],
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err: unknown) {
    const errorObj = err as { code?: number; message?: string };
    if (errorObj?.code === 6 || errorObj?.message?.includes("already exists")) {
      throw new ApiError(409, "ALREADY_REPORTED", "Bạn đã báo cáo mục này rồi.");
    }
    throw err;
  }

  return NextResponse.json({
    success: true,
    message:
      "Cảm ơn bạn đã báo cáo. Đội ngũ quản trị viên sẽ kiểm tra và xử lý trong thời gian sớm nhất.",
  });
});
