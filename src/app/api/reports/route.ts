import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const {
      reporterId,
      targetType, // "listing" | "user" | "conversation"
      targetId,
      reason, // "scam" | "wrong_description" | "banned_goods" | "duplicate" | "spam" | "other"
      details,
      attachedMessages,
    } = await req.json();

    if (!reporterId || !targetType || !targetId || !reason) {
      return NextResponse.json({ error: "Thiếu thông tin báo cáo" }, { status: 400 });
    }

    const reportRef = adminDb.collection("reports").doc();
    await reportRef.set({
      id: reportRef.id,
      reporterId,
      targetType,
      targetId,
      reason,
      details: details || "",
      // Quản trị viên chỉ đọc các tin nhắn được người báo cáo đính kèm, không tự mở cuộc trò chuyện riêng tư
      attachedMessages: attachedMessages || [],
      status: "pending", // "pending" | "investigating" | "resolved" | "dismissed"
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: "Cảm ơn bạn đã báo cáo. Đội ngũ quản trị viên sẽ kiểm tra và xử lý trong thời gian sớm nhất.",
    });
  } catch (err) {
    console.error("Lỗi gửi báo cáo:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
