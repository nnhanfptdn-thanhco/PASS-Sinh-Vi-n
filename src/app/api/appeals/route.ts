import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const { userId, userEmail, targetType, targetId, appealReason, note } =
      await req.json();

    if (!userId || !targetType || !targetId || !appealReason) {
      return NextResponse.json({ error: "Thiếu thông tin kháng nghị" }, { status: 400 });
    }

    const appealRef = adminDb.collection("appeals").doc();
    await appealRef.set({
      id: appealRef.id,
      userId,
      userEmail: userEmail || "",
      targetType, // "account" | "listing"
      targetId,
      appealReason,
      note: note || "",
      status: "pending", // "pending" | "approved" | "rejected"
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      message: "Kháng nghị của bạn đã được ghi nhận. Quản trị viên sẽ xem xét lại và phản hồi qua email.",
    });
  } catch (err) {
    console.error("Lỗi gửi kháng nghị:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
