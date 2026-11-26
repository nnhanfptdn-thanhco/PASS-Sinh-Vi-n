import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { contactRequestSchema } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { isPastDeadline } from "@/lib/utils/date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseExpiryMs(v: unknown): number | null {
  if (typeof v === "string" && v.trim().length > 0) {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  const ts = v as { toMillis?: () => number } | null | undefined;
  if (typeof ts?.toMillis === "function") {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function isListingUnavailableStatus(listing: Record<string, unknown>, nowMs: number): boolean {
  const status = String(listing.status || "active");
  const passDeadline = String(listing.passDeadline || "");
  if (listing.operationStatus) return true;
  if (
    status === "sold" ||
    status === "hidden_by_seller" ||
    status === "hidden_by_admin" ||
    status === "expired"
  ) {
    return true;
  }
  return passDeadline ? isPastDeadline(passDeadline, new Date(nowMs)) : false;
}

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực sinh viên đã duyệt thẻ (live Firestore + active account check + revoked token check)
  const auth = await requireApprovedStudent(req);
  const viewerId = auth.uid;
  const isAdmin = auth.isAdmin;

  // 2. Đọc payload (chỉ tin listingId từ client)
  const body = await readJson(req);
  const { listingId } = contactRequestSchema.parse(body);

  const logDocId = `${viewerId}_${listingId}`;
  const logRef = adminDb.collection("contactViewLogs").doc(logDocId);

  // 3. Kiểm tra pre-flight (KHÔNG đốt quota rate limit nếu bị từ chối ở Cổng Bảo Mật Option A)
  const [existingLogSnap, listingSnap, privateSnap] = await Promise.all([
    logRef.get(),
    adminDb.collection("listings").doc(listingId).get(),
    adminDb.collection("listingsPrivate").doc(listingId).get(),
  ]);

  const alreadyViewed = existingLogSnap.exists;
  if (!listingSnap.exists) {
    throw new ApiError(404, "LISTING_NOT_FOUND", "Không tìm thấy thông tin món đồ.");
  }

  const nowMs = Date.now();
  const listing = (listingSnap.data() || {}) as Record<string, unknown>;
  const sellerId = String(listing.sellerId || "");
  const listingStatus = String(listing.status || "active");

  if (sellerId === viewerId) {
    throw new ApiError(400, "CANNOT_VIEW_SELF", "Bạn là người bán của món đồ này.");
  }

  const privateData = (privateSnap.data() || {}) as Record<string, unknown>;
  const confirmedBuyerId =
    typeof privateData.confirmedBuyerId === "string" ? privateData.confirmedBuyerId : null;
  const confirmedReservationId =
    typeof privateData.confirmedReservationId === "string"
      ? privateData.confirmedReservationId
      : null;

  const isConfirmedBuyer = Boolean(confirmedBuyerId && viewerId === confirmedBuyerId);
  const isAdminModerationOnly = isAdmin && !isConfirmedBuyer;

  // Admin kiểm duyệt có thể tra cứu liên hệ người bán trên tin bị ẩn/hết hạn (ghi audit log);
  // mọi người mua (kể cả Admin đóng vai trò người mua đã giữ chỗ) bắt buộc tin còn khả dụng.
  if (!isAdminModerationOnly && isListingUnavailableStatus(listing, nowMs)) {
    throw new ApiError(
      404,
      "LISTING_NOT_AVAILABLE",
      "Tin đăng này hiện không còn khả dụng để xem thông tin liên hệ."
    );
  }

  // OPTION A FAIL-CLOSED GATE (đặt trước rate-limit & audit log):
  // Chỉ người mua đã được người bán xác nhận giữ chỗ (hoặc Admin theo chính sách kiểm duyệt có audit log)
  if (!isConfirmedBuyer && !isAdmin) {
    throw new ApiError(
      403,
      "RESERVATION_CONFIRMATION_REQUIRED",
      "Thông tin liên hệ Zalo/SĐT và địa chỉ hẹn của người bán chỉ được cung cấp sau khi người bán đã xác nhận giữ chỗ cho bạn."
    );
  }

  // Người mua (kể cả Admin khi mua hàng muốn mở privateDetails) BẮT BUỘC thỏa trạng thái reserved & hạn 72h
  if (!isAdminModerationOnly) {
    if (listingStatus !== "reserved") {
      throw new ApiError(
        403,
        "RESERVATION_CONFIRMATION_REQUIRED",
        "Chỉ được xem thông tin liên hệ khi tin đang ở trạng thái đã xác nhận giữ chỗ cho bạn."
      );
    }

    const confirmedResSnap = await adminDb
      .collection("reservations")
      .where("listingId", "==", listingId)
      .where("status", "==", "confirmed")
      .limit(1)
      .get();

    // Fail-closed nếu không tìm thấy bản ghi giữ chỗ confirmed
    if (confirmedResSnap.empty) {
      throw new ApiError(
        404,
        "LISTING_NOT_AVAILABLE",
        "Không tìm thấy xác nhận giữ chỗ hợp lệ cho món đồ này."
      );
    }

    const confirmedDoc = confirmedResSnap.docs[0];
    const confirmedData = confirmedDoc.data() || {};

    if (confirmedData.buyerId !== viewerId) {
      throw new ApiError(
        403,
        "RESERVATION_CONFIRMATION_REQUIRED",
        "Bạn không phải người mua được xác nhận giữ chỗ cho món đồ này."
      );
    }

    if (confirmedReservationId && confirmedDoc.id !== confirmedReservationId) {
      throw new ApiError(
        403,
        "RESERVATION_CONFIRMATION_REQUIRED",
        "Trạng thái xác nhận giữ chỗ không đồng nhất. Vui lòng kiểm tra lại trong mục Giữ chỗ."
      );
    }

    // Kiểm tra hạn 72 giờ trên `holdExpiresAt` (FAIL-CLOSED khi thiếu/null/invalid/quá hạn)
    const holdExpiresMs = parseExpiryMs(confirmedData.holdExpiresAt);
    if (holdExpiresMs === null || holdExpiresMs <= nowMs) {
      throw new ApiError(
        404,
        "LISTING_NOT_AVAILABLE",
        "Thời gian giữ chỗ 72 giờ của món đồ này đã kết thúc hoặc thiếu thông tin hiệu lực."
      );
    }

    // Kiểm tra chéo `listingsPrivate.confirmedUntil` nếu có
    if (privateData.confirmedUntil !== undefined && privateData.confirmedUntil !== null) {
      const confirmedUntilMs = parseExpiryMs(privateData.confirmedUntil);
      if (confirmedUntilMs === null || confirmedUntilMs <= nowMs) {
        throw new ApiError(
          404,
          "LISTING_NOT_AVAILABLE",
          "Quyền truy cập liên hệ giữ chỗ đã hết hiệu lực."
        );
      }
    }
  }

  // 4. Tiêu thụ quota rate-limit SAU khi đã vượt qua cổng Option A
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

  // 5. Đọc nhất quán + Ghi nhận log trong Transaction để chống TOCTOU race với cancel/hide/expire
  const listingRef = adminDb.collection("listings").doc(listingId);
  const privateRef = adminDb.collection("listingsPrivate").doc(listingId);
  const sellerPrivateRef = adminDb.collection("usersPrivate").doc(sellerId);

  const responsePayload = await adminDb.runTransaction(async (tx) => {
    const [txListingSnap, txPrivateSnap, txSellerPrivateSnap, txLogSnap] = await Promise.all([
      tx.get(listingRef),
      tx.get(privateRef),
      tx.get(sellerPrivateRef),
      tx.get(logRef),
    ]);

    if (!txListingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Không tìm thấy thông tin món đồ.");
    }

    const txNowMs = Date.now();
    const txListing = (txListingSnap.data() || {}) as Record<string, unknown>;
    const txPrivate = (txPrivateSnap.data() || {}) as Record<string, unknown>;

    const txConfirmedBuyer = txPrivate.confirmedBuyerId === viewerId;
    const txAdminModerationOnly = isAdmin && !txConfirmedBuyer;

    if (!txAdminModerationOnly && isListingUnavailableStatus(txListing, txNowMs)) {
      throw new ApiError(
        404,
        "LISTING_NOT_AVAILABLE",
        "Tin đăng này hiện không còn khả dụng để xem thông tin liên hệ."
      );
    }

    if (!txAdminModerationOnly) {
      if (txListing.status !== "reserved" || !txConfirmedBuyer) {
        throw new ApiError(
          403,
          "RESERVATION_CONFIRMATION_REQUIRED",
          "Quyền xem thông tin liên hệ đã bị thu hồi hoặc giao dịch đã thay đổi trạng thái."
        );
      }

      if (txPrivate.confirmedUntil !== undefined && txPrivate.confirmedUntil !== null) {
        const txUntilMs = parseExpiryMs(txPrivate.confirmedUntil);
        if (txUntilMs === null || txUntilMs <= txNowMs) {
          throw new ApiError(
            404,
            "LISTING_NOT_AVAILABLE",
            "Thời gian giữ chỗ 72 giờ của món đồ này đã kết thúc."
          );
        }
      }
    }

    if (!txSellerPrivateSnap.exists) {
      throw new ApiError(404, "CONTACT_NOT_FOUND", "Không tìm thấy thông tin liên hệ của người bán.");
    }

    const sellerPrivate = txSellerPrivateSnap.data() || {};

    if (!txLogSnap.exists) {
      tx.set(logRef, {
        viewerId,
        sellerId,
        listingId,
        firstViewedAt: FieldValue.serverTimestamp(),
        lastViewedAt: FieldValue.serverTimestamp(),
        viewCount: 1,
      });
    } else {
      tx.update(logRef, {
        lastViewedAt: FieldValue.serverTimestamp(),
        viewCount: FieldValue.increment(1),
      });
    }

    // Admin truy cập được ghi vào audit log; KHÔNG trả exactAddress/detailedSchedule cho admin trừ khi admin chính là confirmed buyer
    if (isAdmin && !txConfirmedBuyer) {
      tx.set(adminDb.collection("adminLogs").doc(), {
        adminUid: viewerId,
        adminEmail: auth.email || "admin",
        action: "VIEW_LISTING_CONTACT_ADMIN",
        targetListingId: listingId,
        targetUserId: sellerId,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    return {
      contact: {
        realName: sellerPrivate.realName || "Sinh viên",
        zaloPhone: sellerPrivate.zaloPhone || null,
        altPhone: sellerPrivate.altPhone || null,
      },
      privateDetails: txConfirmedBuyer
        ? {
            exactAddress: (txPrivate.exactAddress as string) || null,
            detailedSchedule: (txPrivate.detailedSchedule as string) || null,
          }
        : undefined,
    };
  });

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, private, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
});
