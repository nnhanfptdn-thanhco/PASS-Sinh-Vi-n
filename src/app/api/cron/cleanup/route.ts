import { NextRequest, NextResponse } from "next/server";
import { runScheduledCleanup } from "@/lib/services/cleanup";
import { verifyCronRequest } from "@/lib/server/cron";
import { withApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (req: NextRequest) => {
  verifyCronRequest(req);
  const result = await runScheduledCleanup();
  return NextResponse.json({
    success: true,
    message: "Hoàn tất chu kỳ dọn dẹp hệ thống định kỳ.",
    result,
  });
});
