import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

const appealSchema = z.object({
  targetType: z.enum(["account", "listing"]),
  targetId: z.string().min(1, "Thiếu targetId"),
  appealReason: z.string().min(1, "Thiếu lý do kháng nghị"),
  note: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const userId = token.uid;
    const userEmail = token.email || "";

    const body = await req.json();
    const parsed = appealSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { targetType, targetId, appealReason, note } = parsed.data;

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
      message: "Kháng nghị của bạn đã được ghi nhận. Quản trị viên sẽ xem xét lại và phản hồi qua email.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
