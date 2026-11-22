import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

const reportSchema = z
  .object({
    targetType: z.enum(["listing", "user", "conversation"]),
    targetId: z.string().regex(ID_RE, "targetId không hợp lệ"),
    reason: z.enum(["scam", "wrong_description", "banned_goods", "duplicate", "spam", "other"]),
    details: z.string().max(1000).optional(),
    // Tương thích client cũ: được chấp nhận nhưng BỊ BỎ QUA. Bằng chứng luôn do server lấy.
    attachedMessages: z.unknown().optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireAuth(req);
  const reporterId = auth.uid;
  const { targetType, targetId, reason, details } = reportSchema.parse(await readJson(req));

  if (targetType === "user" && targetId === reporterId) {
    throw new ApiError(400, "CANNOT_REPORT_SELF", "Bạn không thể tự báo cáo chính mình.");
  }

  await consumeRateLimit({
    scope: "report",
    key: reporterId,
    limit: 10,
    windowSec: 3600,
    customMessage: "Bạn đã gửi báo cáo quá nhiều lần trong 1 giờ qua. Vui lòng thử lại sau.",
  });

  let reportedUserId: string | null = null;
  let evidence: Array<{ id: string; senderId: string; text: string; createdAtMs: number | null }> = [];

  if (targetType === "listing") {
    const snap = await adminDb.collection("listings").doc(targetId).get();
    if (!snap.exists) throw new ApiError(404, "TARGET_NOT_FOUND", "Tin đăng được báo cáo không tồn tại.");
    reportedUserId = (snap.data()?.sellerId as string) || null;
    if (reportedUserId === reporterId) {
      throw new ApiError(400, "CANNOT_REPORT_SELF", "Bạn không thể báo cáo tin đăng của chính mình.");
    }
  } else if (targetType === "user") {
    const snap = await adminDb.collection("users").doc(targetId).get();
    if (!snap.exists) throw new ApiError(404, "TARGET_NOT_FOUND", "Người dùng được báo cáo không tồn tại.");
    reportedUserId = targetId;
  } else {
    const convRef = adminDb.collection("conversations").doc(targetId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) throw new ApiError(404, "TARGET_NOT_FOUND", "Hội thoại được báo cáo không tồn tại.");
    const participantIds = (convSnap.data()?.participantIds as string[]) || [];
    if (!participantIds.includes(reporterId)) {
      throw new ApiError(403, "NOT_PARTICIPANT", "Bạn không thuộc hội thoại này nên không thể báo cáo.");
    }
    reportedUserId = participantIds.find((id) => id !== reporterId) ?? null;
    const msgSnap = await convRef.collection("messages").orderBy("createdAt", "desc").limit(20).get();
    evidence = msgSnap.docs
      .map((d) => {
        const m = d.data();
        return {
          id: d.id,
          senderId: String(m.senderId || ""),
          text: String(m.text || "").slice(0, 1000),
          createdAtMs: m.createdAt?.toMillis?.() ?? null,
        };
      })
      .reverse();
  }

  const reportDocId = `${reporterId}_${targetType}_${targetId}`;
  try {
    await adminDb.collection("reports").doc(reportDocId).create({
      id: reportDocId,
      reporterId,
      reportedUserId,
      targetType,
      targetId,
      reason,
      details: details || "",
      evidenceMessages: evidence, // do server lấy, không phải dữ liệu client
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e?.code === 6 || e?.message?.includes("already exists")) {
      throw new ApiError(409, "ALREADY_REPORTED", "Bạn đã báo cáo mục này rồi.");
    }
    throw err;
  }

  return NextResponse.json({
    success: true,
    message: "Cảm ơn bạn đã báo cáo. Đội ngũ quản trị viên sẽ kiểm tra và xử lý trong thời gian sớm nhất.",
  });
});
