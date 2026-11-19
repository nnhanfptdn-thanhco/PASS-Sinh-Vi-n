import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportSchema = z
  .object({
    targetType: z.enum(["listing", "user", "conversation"]),
    targetId: z.string().min(1, "Thiếu targetId"),
    reason: z.enum(["scam", "wrong_description", "banned_goods", "duplicate", "spam", "other"]),
    details: z.string().max(1000).optional(),
    attachedMessages: z.array(z.any()).optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const reporterId = auth.uid;

  const body = await readJson(req);
  const { targetType, targetId, reason, details, attachedMessages } = reportSchema.parse(body);

  const reportRef = adminDb.collection("reports").doc();
  await reportRef.set({
    id: reportRef.id,
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

  return NextResponse.json({
    success: true,
    message:
      "Cảm ơn bạn đã báo cáo. Đội ngũ quản trị viên sẽ kiểm tra và xử lý trong thời gian sớm nhất.",
  });
});
