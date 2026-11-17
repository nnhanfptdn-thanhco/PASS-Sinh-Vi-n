import { NextRequest, NextResponse } from "next/server";
import { runScheduledCleanup } from "@/lib/services/cleanup";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "Biến môi trường CRON_SECRET chưa được thiết lập trên hệ thống." },
        { status: 500 }
      );
    }

    const authHeader = req.headers.get("authorization") || "";
    const match = /^Bearer (.+)$/i.exec(authHeader);
    const receivedToken = match ? match[1] : "";

    const expectedBuffer = Buffer.from(cronSecret);
    const receivedBuffer = Buffer.from(receivedToken);

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      return NextResponse.json({ error: "Không có quyền truy cập" }, { status: 401 });
    }

    const result = await runScheduledCleanup();
    return NextResponse.json({
      success: true,
      message: "Hoàn tất chu kỳ dọn dẹp hệ thống định kỳ.",
      result,
    });
  } catch (err) {
    console.error("Lỗi chạy cron dọn dẹp:", err);
    return NextResponse.json({ error: "Lỗi chạy chu kỳ dọn dẹp" }, { status: 500 });
  }
}
