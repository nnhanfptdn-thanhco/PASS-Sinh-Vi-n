import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const appealSchema = z
  .object({
    targetType: z.enum(["account", "listing"]),
    targetId: z.string().min(1, "Thiếu targetId"),
    appealReason: z.string().min(1, "Thiếu lý do kháng nghị"),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const userId = auth.uid;
  const userEmail = auth.email || "";

  const body = await readJson(req);
  const { targetType, targetId, appealReason, note } = appealSchema.parse(body);

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
      "Kháng nghị của bạn đã được ghi nhận. Quản trị viên sẽ xem xét lại và phản hồi qua email.",
  });
});
