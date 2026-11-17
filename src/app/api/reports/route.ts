import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

const reportSchema = z.object({
  targetType: z.enum(["listing", "user", "conversation"]),
  targetId: z.string().min(1, "Thiếu targetId"),
  reason: z.enum(["scam", "wrong_description", "banned_goods", "duplicate", "spam", "other"]),
  details: z.string().max(1000).optional(),
  attachedMessages: z.array(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const reporterId = token.uid;

    const body = await req.json();
    const parsed = reportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { targetType, targetId, reason, details, attachedMessages } = parsed.data;

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
      message: "Cảm ơn bạn đã báo cáo. Đội ngũ quản trị viên sẽ kiểm tra và xử lý trong thời gian sớm nhất.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
