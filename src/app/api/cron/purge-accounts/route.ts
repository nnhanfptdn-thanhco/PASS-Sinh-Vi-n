import { NextRequest, NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/server/cron";
import { withApi } from "@/lib/server/http";
import { adminDb } from "@/lib/firebase/admin";
import { purgeUserData } from "@/lib/services/account-purge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withApi(async (req: NextRequest) => {
  verifyCronRequest(req);

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const pendingSnap = await adminDb
    .collection("pendingDeletions")
    .where("startedAt", "<=", tenMinAgo)
    .limit(20)
    .get();

  let purgedCount = 0;
  for (const doc of pendingSnap.docs) {
    const uid = doc.id;
    const hash = (doc.data()?.studentIdHash as string) || null;
    try {
      await purgeUserData(uid, hash);
      purgedCount++;
    } catch (err) {
      console.error(`[PurgeAccountsCron] Lỗi khi dọn tài khoản treo ${uid}:`, err);
    }
  }

  return NextResponse.json({
    success: true,
    message: `Đã xử lý ${purgedCount}/${pendingSnap.docs.length} tài khoản trong hàng đợi xóa dở dang.`,
    purgedCount,
  });
});
