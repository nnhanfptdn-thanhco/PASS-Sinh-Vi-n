import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/auth/server";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { contactRequestSchema } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { isPastDeadline } from "@/lib/utils/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực sinh viên đã duyệt thẻ (hoặc admin)
  const { token } = await requireApprovedStudent(req);
  const viewerId = token.uid;
  const isAdmin = token.admin === true || token.role === "admin";

  // 2. Đọc payload
  const body = await readJson(req);
  const { listingId } = contactRequestSchema.parse(body);

  const logDocId = `${viewerId}_${listingId}`;
  const logRef = adminDb.collection("contactViewLogs").doc(logDocId);

  // 3. Kiểm tra xem đã từng xem liên hệ của tin này chưa
  const existingLogSnap = await logRef.get();
  const alreadyViewed = existingLogSnap.exists;

  // 4. Kiểm tra tin đăng và quyền xem
  const listingSnap = await adminDb.collection("listings").doc(listingId).get();
  if (!listingSnap.exists) {
    throw new ApiError(404, "LISTING_NOT_FOUND", "Không tìm thấy thông tin món đồ.");
  }

  const listing = listingSnap.data() || {};
  const sellerId = listing.sellerId as string;
  const listingStatus = (listing.status as string) || "active";
  const passDeadline = (listing.passDeadline as string) || "";
  const isOverdue = isPastDeadline(passDeadline);

  // Không cho tự xem chính mình
  if (sellerId === viewerId) {
    throw new ApiError(400, "CANNOT_VIEW_SELF", "Bạn là người bán của món đồ này.");
  }

  // Tin đã bán, ẩn, hoặc hết hạn -> 404
  if (
    listingStatus === "sold" ||
    listingStatus === "hidden_by_seller" ||
    listingStatus === "hidden_by_admin" ||
    listingStatus === "expired" ||
    isOverdue
  ) {
    throw new ApiError(
      404,
      "LISTING_NOT_AVAILABLE",
      "Tin đăng này hiện không còn khả dụng để xem thông tin liên hệ."
    );
  }

  // Đọc listingsPrivate để kiểm tra người mua đã xác nhận giữ chỗ
  const privateSnap = await adminDb.collection("listingsPrivate").doc(listingId).get();
  const privateData = privateSnap.data() || {};
  const confirmedBuyerId = privateData.confirmedBuyerId as string | undefined;

  const isConfirmedBuyer = viewerId === confirmedBuyerId || isAdmin;

  // PHƯƠNG ÁN A (CỔNG BẢO MẬT ĐẶT TRƯỚC RATE LIMIT & LOG):
  // Khóa toàn bộ thông tin Zalo/SĐT và địa chỉ cho tới khi người bán đã xác nhận giữ chỗ (confirmed)
  if (!isConfirmedBuyer) {
    throw new ApiError(
      403,
      "RESERVATION_CONFIRMATION_REQUIRED",
      "Thông tin liên hệ Zalo/SĐT và địa chỉ hẹn của người bán chỉ được cung cấp sau khi người bán đã xác nhận giữ chỗ cho bạn."
    );
  }

  // Nếu tin đang ở trạng thái reserved: Kiểm tra lười hạn giữ chỗ 72 giờ
  if (listingStatus === "reserved" && !isAdmin) {
    const confirmedResSnap = await adminDb
      .collection("reservations")
      .where("listingId", "==", listingId)
      .where("status", "==", "confirmed")
      .limit(1)
      .get();

    if (!confirmedResSnap.empty) {
      const holdExpiresAtStr = confirmedResSnap.docs[0].data()?.holdExpiresAt as string | undefined;
      if (holdExpiresAtStr) {
        const holdMs = Date.parse(holdExpiresAtStr);
        if (Number.isFinite(holdMs) && holdMs < Date.now()) {
          throw new ApiError(
            404,
            "LISTING_NOT_AVAILABLE",
            "Thời gian giữ chỗ 72 giờ của món đồ này đã kết thúc."
          );
        }
      }
    }
  }

  // Tiêu thụ quota 10 lượt/giờ và trần tối đa 30 lượt/ngày CHỈ KHI ĐÃ QUA CỔNG BẢO MẬT (F11)
  if (!alreadyViewed && !isAdmin) {
    await consumeRateLimit({
      scope: "contact_view",
      key: `${viewerId}_hourly`,
      limit: 10,
      windowSec: 3600,
      customMessage:
        "Bạn đã xem liên hệ 10 tin trong 1 giờ qua. Vui lòng quay lại sau nhằm bảo vệ quyền riêng tư của sinh viên.",
    });
    await consumeRateLimit({
      scope: "contact_view",
      key: `${viewerId}_daily`,
      limit: 30,
      windowSec: 86400,
      customMessage:
        "Bạn đã đạt giới hạn xem liên hệ tối đa 30 tin trong ngày hôm nay. Vui lòng quay lại vào ngày mai nhằm bảo vệ quyền riêng tư của sinh viên.",
    });
  }

  // 5. Đọc thông tin liên hệ bảo mật từ usersPrivate của người bán
  const sellerPrivateSnap = await adminDb.collection("usersPrivate").doc(sellerId).get();
  if (!sellerPrivateSnap.exists) {
    throw new ApiError(404, "CONTACT_NOT_FOUND", "Không tìm thấy thông tin liên hệ của người bán.");
  }

  const sellerPrivate = sellerPrivateSnap.data() || {};

  // 6. Ghi nhận log xem liên hệ (tránh spam)
  if (!alreadyViewed) {
    await logRef.set({
      viewerId,
      sellerId,
      listingId,
      firstViewedAt: FieldValue.serverTimestamp(),
      lastViewedAt: FieldValue.serverTimestamp(),
      viewCount: 1,
    });
  } else {
    await logRef.update({
      lastViewedAt: FieldValue.serverTimestamp(),
      viewCount: FieldValue.increment(1),
    });
  }

  // 7. Phản hồi luôn có Header Cache-Control: no-store
  // QUY TẮC BẢO MẬT PDP:
  // - Người mua thông thường xem tin active: chỉ nhận tên + SĐT Zalo.
  // - Địa chỉ chính xác (exactAddress/detailedSchedule) CHỈ trả về cho confirmedBuyerId!
  return NextResponse.json(
    {
      contact: {
        realName: sellerPrivate.realName || "Sinh viên",
        zaloPhone: sellerPrivate.zaloPhone || null,
        altPhone: sellerPrivate.altPhone || null,
      },
      privateDetails: isConfirmedBuyer
        ? {
            exactAddress: (privateData.exactAddress as string) || null,
            detailedSchedule: (privateData.detailedSchedule as string) || null,
          }
        : undefined,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
});
