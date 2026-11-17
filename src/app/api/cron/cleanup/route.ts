import { NextRequest, NextResponse } from "next/server";
import { runScheduledCleanup } from "@/lib/services/cleanup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    // Có thể cấu hình CRON_SECRET bảo vệ endpoint khi deploy lên Vercel / Cloud Scheduler
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
