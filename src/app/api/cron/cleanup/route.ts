import { NextRequest, NextResponse } from "next/server";
import { runScheduledCleanup } from "@/lib/services/cleanup";
import { verifyCronRequest } from "@/lib/server/cron";
import { withApi } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (req: NextRequest) => {
  verifyCronRequest(req);
  const result = await runScheduledCleanup();

  if (result.partialFailure) {
    await adminDb
      .collection("adminLogs")
      .doc(`cron_cleanup_partial_${Date.now()}`)
      .set({
        action: "CRON_CLEANUP_PARTIAL_FAILURE",
        severity: "critical",
        errorsCount: result.errors.length,
        errors: result.errors.slice(0, 20),
        timestamp: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined);

    return NextResponse.json(
      {
        success: false,
        partialFailure: true,
        message: "Chu kỳ dọn dẹp hoàn tất một phần nhưng có lỗi tại giai đoạn trọng yếu.",
        result,
      },
      { status: 207 }
    );
  }

  return NextResponse.json({
    success: true,
    partialFailure: false,
    message: "Hoàn tất chu kỳ dọn dẹp hệ thống định kỳ.",
    result,
  });
});
