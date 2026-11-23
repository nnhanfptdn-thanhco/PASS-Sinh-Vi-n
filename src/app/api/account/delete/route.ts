import { NextRequest, NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth/server";
import { adminAuth, adminDb, FieldValue } from "@/lib/firebase/admin";
import { purgeUserData } from "@/lib/services/account-purge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const userId = token.uid;

    // Yêu cầu auth_time gần đây (trong vòng 5 phút = 300 giây) để chống tấn công CSRF / phiên bị chiếm đoạt
    const authTime = token.auth_time || 0;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (nowInSeconds - authTime > 300) {
      throw new HttpError(
        403,
        "Vì lý do an toàn, vui lòng đăng nhập lại Google trước khi thực hiện xóa vĩnh viễn tài khoản."
      );
    }

    // 1. Kiểm tra điều kiện tiên quyết: còn giao dịch confirmed hoặc tin đang reserved -> trả 400 (CHƯA KHÓA GÌ)
    const [buyerConfirmedSnap, sellerConfirmedSnap, reservedListingsSnap] = await Promise.all([
      adminDb
        .collection("reservations")
        .where("buyerId", "==", userId)
        .where("status", "==", "confirmed")
        .get(),
      adminDb
        .collection("reservations")
        .where("sellerId", "==", userId)
        .where("status", "==", "confirmed")
        .get(),
      adminDb
        .collection("listings")
        .where("sellerId", "==", userId)
        .where("status", "==", "reserved")
        .get(),
    ]);

    if (!buyerConfirmedSnap.empty || !sellerConfirmedSnap.empty || !reservedListingsSnap.empty) {
      return NextResponse.json(
        {
          error:
            "Bạn vẫn còn món đồ hoặc giao dịch đang ở trạng thái 'Đã xác nhận giữ chỗ'. Vui lòng hoàn tất hoặc hủy giao dịch với đối tác trước khi xóa tài khoản.",
        },
        { status: 400 }
      );
    }

    // 1b. Đọc studentIdHash TRƯỚC KHI khóa tài khoản và lưu vào marker pendingDeletions
    const verifSnap = await adminDb.collection("verifications").doc(userId).get();
    const studentIdHash = (verifSnap.data()?.studentIdHash as string | undefined) || null;

    // Ghi marker pendingDeletions với studentIdHash để sweeper có thể tái xử lý nếu xảy ra crash giữa chừng
    await adminDb.collection("pendingDeletions").doc(userId).set({
      userId,
      studentIdHash,
      startedAt: FieldValue.serverTimestamp(),
    });

    try {
      await adminAuth.updateUser(userId, { disabled: true });
      await adminAuth.revokeRefreshTokens(userId);
    } catch (disableErr: unknown) {
      const errCode = (disableErr as { code?: string })?.code;
      if (errCode !== "auth/user-not-found") {
        throw new HttpError(
          500,
          "Không thể khóa tài khoản để bắt đầu quy trình xóa dữ liệu. Vui lòng thử lại sau."
        );
      }
    }

    try {
      // 2-8. Gọi hàm purgeUserData idempotent
      await purgeUserData(userId, studentIdHash);
    } catch (purgeErr) {
      console.error("Lỗi trong quá trình purgeUserData:", purgeErr);
      // Khi tài khoản đã bị vô hiệu hóa và marker pendingDeletions đã ghi:
      // Trả HTTP 202 Accepted để thông báo yêu cầu đã được chấp nhận và sweeper cron sẽ hoàn tất
      return NextResponse.json(
        {
          success: true,
          pending: true,
          message:
            "Tài khoản đã được vô hiệu hóa an toàn. Quá trình dọn dẹp dữ liệu đang diễn ra và sẽ được hệ thống hoàn tất tự động.",
        },
        { status: 202 }
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Tài khoản và toàn bộ dữ liệu cá nhân của bạn đã được xóa hoàn toàn khỏi hệ thống.",
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Lỗi xóa tài khoản:", err);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi khi xóa tài khoản. Vui lòng thử lại sau." },
      { status: 500 }
    );
  }
}
