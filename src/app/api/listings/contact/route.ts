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

  // Nếu chưa từng xem tin này -> Tiêu thụ quota 10 lượt/giờ
  if (!alreadyViewed && !isAdmin) {
    await consumeRateLimit({
      scope: "contact_view",
      key: viewerId,
      limit: 10,
      windowSec: 3600,
      customMessage:
        "Bạn đã xem liên hệ 10 tin trong 1 giờ qua. Vui lòng quay lại sau nhằm bảo vệ quyền riêng tư của sinh viên.",
    });
  }

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

  // Nếu tin đang ở trạng thái reserved: CHỈ người mua đã được xác nhận (hoặc admin) mới được xem
  if (listingStatus === "reserved") {
    if (viewerId !== confirmedBuyerId && !isAdmin) {
      throw new ApiError(
        404,
        "LISTING_NOT_AVAILABLE",
        "Món đồ này hiện đã có người giữ chỗ và đang khóa thông tin liên hệ."
      );
    }
  }

  const isConfirmedBuyer = viewerId === confirmedBuyerId || isAdmin;

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
