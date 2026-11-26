import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireApprovedStudent } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import type { QuerySnapshot, DocumentData } from "firebase-admin/firestore";
import { z } from "zod";
import { isPastDeadline } from "@/lib/utils/date";
import { normalizeVi } from "@/lib/search/normalize";
import { NO_SHOW_MIN_WAIT_MINUTES } from "@/lib/constants/listing";
import { processListingOperationJob } from "@/lib/server/listing-jobs";
import {
  activeReservationLockRef,
  listingReservationStatsRef,
  sellerListingStatsRef,
  sellerTitleLockRef,
  userReservationStatsRef,
} from "@/lib/server/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMs(v: unknown): number | null {
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number") return v;
  const ts = v as { toMillis?: () => number } | null | undefined;
  return typeof ts?.toMillis === "function" ? ts.toMillis() : null;
}

const reservationActionSchema = z
  .object({
    reservationId: FIRESTORE_ID_SCHEMA,
    action: z.enum(["confirm", "reject", "cancel", "complete", "no_show"]),
    reason: z.string().max(300, "Lý do tối đa 300 ký tự").optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireApprovedStudent(req);
  const callerUid = auth.uid;
  const isAdmin = auth.isAdmin;

  const body = await readJson(req);
  const { reservationId, action, reason } = reservationActionSchema.parse(body);

  // Rate limit theo UID và theo reservation để chống spam thao tác
  await consumeRateLimit({
    scope: "reservation_action_user",
    key: callerUid,
    limit: 30,
    windowSec: 60,
    customMessage: "Bạn thao tác giữ chỗ quá nhanh. Vui lòng thử lại sau 1 phút.",
  });
  await consumeRateLimit({
    scope: "reservation_action_item",
    key: `${callerUid}_${reservationId}`,
    limit: 15,
    windowSec: 60,
    customMessage: "Bạn thao tác trên giao dịch này quá nhanh. Vui lòng chờ giây lát.",
  });

  const resRef = adminDb.collection("reservations").doc(reservationId);

  const txOutcome = await adminDb.runTransaction(async (transaction) => {
    // 1. Đọc yêu cầu giữ chỗ
    const resSnap = await transaction.get(resRef);
    if (!resSnap.exists) {
      throw new ApiError(404, "RESERVATION_NOT_FOUND", "Không tìm thấy yêu cầu giữ chỗ.");
    }

    const resData = resSnap.data() as Record<string, unknown>;
    const listingId = resData.listingId as string;
    const buyerId = resData.buyerId as string;
    const sellerId = resData.sellerId as string;
    const currentResStatus = resData.status as string;

    const isSeller = sellerId === callerUid;
    const isBuyer = buyerId === callerUid;

    if (!isSeller && !isBuyer && !isAdmin) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Bạn không có quyền can thiệp vào giao dịch giữ chỗ này."
      );
    }

    // 2. Đọc tin đăng & stats liên quan (READ PHASE TRƯỚC MỌI WRITE)
    const listingRef = adminDb.collection("listings").doc(listingId);
    const listingPrivateRef = adminDb.collection("listingsPrivate").doc(listingId);
    const listingResStatRef = listingReservationStatsRef(listingId);
    const buyerResStatRef = userReservationStatsRef(buyerId);
    const buyerActiveLockRef = activeReservationLockRef(listingId, buyerId);

    const [listingSnap, privateSnap, listingStatSnap, buyerStatSnap] = await Promise.all([
      transaction.get(listingRef),
      transaction.get(listingPrivateRef),
      transaction.get(listingResStatRef),
      transaction.get(buyerResStatRef),
    ]);

    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Tin đăng tương ứng không tồn tại.");
    }

    const listingData = listingSnap.data() as Record<string, unknown>;
    if (listingData.operationStatus) {
      throw new ApiError(
        409,
        "LISTING_PROCESSING",
        "Tin đăng đang được xử lý đóng/kiểm duyệt. Vui lòng thử lại sau giây lát."
      );
    }

    const currentListingStatus = listingData.status as string;
    const passDeadline = (listingData.passDeadline as string) || "";
    const titleNormalized =
      (listingData.titleNormalized as string) || normalizeVi(String(listingData.title || ""));
    const resCol = adminDb.collection("reservations");

    let otherPendingSnap: QuerySnapshot<DocumentData> | null = null;
    let waitlistedSnap: QuerySnapshot<DocumentData> | null = null;
    let buyerPendingDelSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    let sellerListingStatSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    let sellerTitleLockSnap: FirebaseFirestore.DocumentSnapshot | null = null;
    const waitlistedStatRefs: Map<string, FirebaseFirestore.DocumentSnapshot> = new Map();

    const sellerStatRef = sellerListingStatsRef(sellerId);
    const sellerLockRef = titleNormalized ? sellerTitleLockRef(sellerId, titleNormalized) : null;

    if (action === "confirm") {
      // Hạn pending/confirm trên tin tối đa <= 10 theo quota; đọc đồng thời trạng thái pendingDeletions của buyer
      const [otherPending, buyerDelSnap] = await Promise.all([
        transaction.get(
          resCol.where("listingId", "==", listingId).where("status", "==", "pending").limit(50)
        ),
        transaction.get(adminDb.collection("pendingDeletions").doc(buyerId)),
      ]);
      otherPendingSnap = otherPending;
      buyerPendingDelSnap = buyerDelSnap;
    }

    const shouldCheckWaitlist =
      (action === "cancel" && (currentResStatus === "confirmed" || currentResStatus === "pending")) ||
      action === "no_show" ||
      (action === "reject" && currentResStatus === "pending");

    if (shouldCheckWaitlist) {
      const reads: Array<Promise<unknown>> = [
        transaction.get(
          resCol
            .where("listingId", "==", listingId)
            .where("status", "==", "waitlisted")
            .orderBy("createdAt", "asc")
            .limit(1)
        ),
      ];
      const mayExpireReservedListing =
        currentListingStatus === "reserved" &&
        ((action === "cancel" && currentResStatus === "confirmed") || action === "no_show");
      if (mayExpireReservedListing) {
        reads.push(transaction.get(sellerStatRef));
        if (sellerLockRef) {
          reads.push(transaction.get(sellerLockRef));
        }
      }

      const [wSnap, sStatSnap, sLockSnap] = await Promise.all(reads);
      waitlistedSnap = wSnap as QuerySnapshot<DocumentData>;
      if (mayExpireReservedListing) {
        sellerListingStatSnap = (sStatSnap as FirebaseFirestore.DocumentSnapshot) || null;
        sellerTitleLockSnap = (sLockSnap as FirebaseFirestore.DocumentSnapshot) || null;
      }

      if (!waitlistedSnap.empty) {
        const nextBuyerId = waitlistedSnap.docs[0].data().buyerId as string;
        if (nextBuyerId && nextBuyerId !== buyerId) {
          waitlistedStatRefs.set(
            nextBuyerId,
            await transaction.get(userReservationStatsRef(nextBuyerId))
          );
        }
      }
    }

    // Bootstrap bộ đếm pendingCount hiện tại của listing (luôn clamp >= 0 chống âm)
    let currentListingPending = listingStatSnap.exists
      ? Math.max(0, Number(listingStatSnap.data()?.pendingCount ?? 0))
      : currentResStatus === "pending"
      ? 1
      : 0;
    const currentBuyerPending = buyerStatSnap.exists
      ? Math.max(0, Number(buyerStatSnap.data()?.pendingCount ?? 0))
      : currentResStatus === "pending"
      ? 1
      : 0;

    if (action === "confirm" && otherPendingSnap && !listingStatSnap.exists) {
      currentListingPending = Math.max(currentListingPending, otherPendingSnap.size);
    }

    // ===== WRITE PHASE =====
    const sanitizedReason = reason?.trim().slice(0, 300);

    // --- 3.1 XÁC NHẬN GIỮ CHỖ (CONFIRM) ---
    if (action === "confirm") {
      if (!isSeller && !isAdmin) {
        throw new ApiError(403, "FORBIDDEN", "Chỉ người bán mới có quyền xác nhận giữ chỗ.");
      }

      if (currentResStatus !== "pending") {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          `Yêu cầu giữ chỗ này đang ở trạng thái "${currentResStatus}", không thể xác nhận.`
        );
      }

      const resExpiresMs = toMs(resData.expiresAt);
      if (resExpiresMs !== null && resExpiresMs < Date.now()) {
        throw new ApiError(409, "RESERVATION_EXPIRED", "Yêu cầu giữ chỗ này đã hết hạn.");
      }

      if (currentListingStatus !== "active") {
        throw new ApiError(
          409,
          "LISTING_NOT_AVAILABLE",
          `Món đồ này hiện không ở trạng thái sẵn sàng để giữ chỗ (trạng thái: ${currentListingStatus}).`
        );
      }

      if (buyerPendingDelSnap?.exists) {
        throw new ApiError(
          409,
          "BUYER_ACCOUNT_DELETING",
          "Tài khoản của người mua này đang trong quá trình xóa vĩnh viễn nên không thể xác nhận giữ chỗ."
        );
      }

      if (isPastDeadline(passDeadline)) {
        throw new ApiError(
          409,
          "LISTING_EXPIRED",
          "Món đồ này đã quá hạn pass đồ, không thể xác nhận giữ chỗ."
        );
      }

      // Chuẩn hóa schema 72h: dùng holdExpiresAt cho confirmed, xóa expiresAt (24h pending)
      const holdExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

      transaction.update(resRef, {
        status: "confirmed",
        confirmedAt: FieldValue.serverTimestamp(),
        holdExpiresAt,
        expiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(listingRef, {
        status: "reserved",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Ghi confirmedBuyerId, confirmedReservationId và confirmedUntil vào listingsPrivate
      transaction.set(
        listingPrivateRef,
        {
          confirmedBuyerId: buyerId,
          confirmedReservationId: reservationId,
          confirmedUntil: holdExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      let movedPendingCount = 1; // bản ghi hiện tại rời trạng thái pending -> confirmed
      if (currentBuyerPending > 0) {
        transaction.set(
          buyerResStatRef,
          { pendingCount: Math.max(0, currentBuyerPending - 1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }

      if (otherPendingSnap) {
        otherPendingSnap.forEach((doc) => {
          if (doc.id !== reservationId) {
            movedPendingCount++;
            transaction.update(doc.ref, {
              status: "waitlisted",
              expiresAt: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            });

            const otherBuyerId = doc.data().buyerId as string | undefined;
            if (otherBuyerId && otherBuyerId !== buyerId) {
              transaction.set(
                userReservationStatsRef(otherBuyerId),
                { pendingCount: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() },
                { merge: true }
              );
            }

            const notifRef = adminDb.collection("notifications").doc();
            transaction.set(notifRef, {
              userId: doc.data().buyerId,
              type: "reservation_waitlisted",
              title: "Cập nhật yêu cầu giữ chỗ 📋",
              body: `Món đồ "${listingData.title}" đã được người bán đồng ý giữ cho bạn sinh viên gửi trước. Bạn đã được chuyển vào hàng chờ dự phòng tự động.`,
              targetId: doc.id,
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
        });
      }

      transaction.set(
        listingResStatRef,
        {
          pendingCount: Math.max(0, currentListingPending - movedPendingCount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const buyerNotifRef = adminDb.collection("notifications").doc();
      transaction.set(buyerNotifRef, {
        userId: buyerId,
        type: "reservation_confirmed",
        title: "Yêu cầu giữ chỗ đã được xác nhận! 🎉",
        body: `Người bán đã xác nhận giữ món đồ "${listingData.title}" cho bạn trong 72 giờ tới. Bạn có thể xem địa chỉ hẹn chính xác ngay bây giờ!`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        jobId: null as string | null,
        payload: {
          message: "Đã xác nhận giữ chỗ thành công trong 72 giờ.",
          holdExpiresAt,
        },
      };
    }

    // --- 3.2 TỪ CHỐI GIỮ CHỖ (REJECT) ---
    if (action === "reject") {
      if (!isSeller && !isAdmin) {
        throw new ApiError(403, "FORBIDDEN", "Chỉ người bán mới có quyền từ chối yêu cầu giữ chỗ.");
      }

      if (currentResStatus !== "pending" && currentResStatus !== "waitlisted") {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          `Không thể từ chối yêu cầu ở trạng thái "${currentResStatus}".`
        );
      }

      transaction.update(resRef, {
        status: "rejected",
        cancelReason: sanitizedReason || "Người bán đã từ chối yêu cầu",
        expiresAt: FieldValue.delete(),
        holdExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.delete(buyerActiveLockRef);

      if (currentResStatus === "pending") {
        const shouldPromoteWaitlisted =
          currentListingStatus === "active" &&
          !isPastDeadline(passDeadline) &&
          waitlistedSnap &&
          !waitlistedSnap.empty;

        const listingPendingDelta = shouldPromoteWaitlisted ? 0 : -1;
        transaction.set(
          listingResStatRef,
          {
            pendingCount: Math.max(0, currentListingPending + listingPendingDelta),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        transaction.set(
          buyerResStatRef,
          { pendingCount: Math.max(0, currentBuyerPending - 1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );

        if (shouldPromoteWaitlisted && waitlistedSnap) {
          const nextReq = waitlistedSnap.docs[0];
          const nextBuyerId = nextReq.data().buyerId as string;
          const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          transaction.update(nextReq.ref, {
            status: "pending",
            expiresAt: newExpiresAt,
            holdExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (nextBuyerId) {
            const nextSnap = waitlistedStatRefs.get(nextBuyerId);
            const nextPrevCount = nextSnap?.exists
              ? Math.max(0, Number(nextSnap.data()?.pendingCount ?? 0))
              : 0;
            transaction.set(
              userReservationStatsRef(nextBuyerId),
              { pendingCount: nextPrevCount + 1, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }
          transaction.set(adminDb.collection("notifications").doc(), {
            userId: nextBuyerId,
            type: "waitlist_promoted",
            title: "Bạn đã được chuyển lên hàng đầu! 🎉",
            body: `Yêu cầu của bạn cho món đồ "${listingData.title}" đã được đưa lên hàng chờ xác nhận trong 24 giờ tới.`,
            targetId: nextReq.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      const rejectNotif = adminDb.collection("notifications").doc();
      transaction.set(rejectNotif, {
        userId: buyerId,
        type: "reservation_rejected",
        title: "Yêu cầu giữ chỗ đã bị từ chối",
        body: `Người bán đã từ chối yêu cầu giữ chỗ cho món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { jobId: null, payload: { message: "Đã từ chối yêu cầu giữ chỗ." } };
    }

    // --- 3.3 HỦY GIỮ CHỖ (CANCEL) ---
    if (action === "cancel") {
      if (
        currentResStatus !== "pending" &&
        currentResStatus !== "waitlisted" &&
        currentResStatus !== "confirmed"
      ) {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          `Không thể hủy yêu cầu ở trạng thái "${currentResStatus}".`
        );
      }

      const cancelledByRole = isBuyer ? "buyer" : isSeller ? "seller" : "admin";

      if (currentResStatus === "pending" || currentResStatus === "waitlisted") {
        transaction.update(resRef, {
          status: "cancelled",
          cancelledBy: cancelledByRole,
          cancelReason:
            sanitizedReason ||
            (isBuyer ? "Người mua đã hủy yêu cầu" : isSeller ? "Người bán đã hủy" : "Quản trị viên đã hủy yêu cầu"),
          cancelledAt: FieldValue.serverTimestamp(),
          expiresAt: FieldValue.delete(),
          holdExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.delete(buyerActiveLockRef);

        if (currentResStatus === "pending") {
          const shouldPromoteWaitlisted =
            currentListingStatus === "active" &&
            !isPastDeadline(passDeadline) &&
            waitlistedSnap &&
            !waitlistedSnap.empty;

          transaction.set(
            listingResStatRef,
            {
              pendingCount: Math.max(0, currentListingPending + (shouldPromoteWaitlisted ? 0 : -1)),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          transaction.set(
            buyerResStatRef,
            { pendingCount: Math.max(0, currentBuyerPending - 1), updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );

          if (shouldPromoteWaitlisted && waitlistedSnap) {
            const nextReq = waitlistedSnap.docs[0];
            const nextBuyerId = nextReq.data().buyerId as string;
            const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            transaction.update(nextReq.ref, {
              status: "pending",
              expiresAt: newExpiresAt,
              holdExpiresAt: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            });
            if (nextBuyerId) {
              const nextSnap = waitlistedStatRefs.get(nextBuyerId);
              const nextPrevCount = nextSnap?.exists
                ? Math.max(0, Number(nextSnap.data()?.pendingCount ?? 0))
                : 0;
              transaction.set(
                userReservationStatsRef(nextBuyerId),
                { pendingCount: nextPrevCount + 1, updatedAt: FieldValue.serverTimestamp() },
                { merge: true }
              );
            }
            transaction.set(adminDb.collection("notifications").doc(), {
              userId: nextBuyerId,
              type: "waitlist_promoted",
              title: "Bạn đã được chuyển lên hàng đầu! 🎉",
              body: `Do yêu cầu trước đó đã bị hủy, yêu cầu của bạn cho món đồ "${listingData.title}" đã được đưa lên chờ người bán xác nhận trong 24 giờ tới.`,
              targetId: nextReq.id,
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });
          }
        }

        if (isAdmin && !isBuyer && !isSeller) {
          transaction.set(adminDb.collection("notifications").doc(), {
            userId: buyerId,
            type: "reservation_cancelled",
            title: "Yêu cầu giữ chỗ đã bị hủy",
            body: `Quản trị viên đã hủy yêu cầu giữ chỗ món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
            targetId: reservationId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
          transaction.set(adminDb.collection("notifications").doc(), {
            userId: sellerId,
            type: "reservation_cancelled",
            title: "Yêu cầu giữ chỗ đã bị hủy",
            body: `Quản trị viên đã hủy yêu cầu giữ chỗ món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
            targetId: reservationId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        } else {
          transaction.set(adminDb.collection("notifications").doc(), {
            userId: isBuyer ? sellerId : buyerId,
            type: "reservation_cancelled",
            title: "Yêu cầu giữ chỗ đã bị hủy",
            body: `${isBuyer ? "Người mua" : "Người bán"} đã hủy yêu cầu giữ chỗ món đồ "${listingData.title}".`,
            targetId: reservationId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        return { jobId: null, payload: { message: "Đã hủy yêu cầu giữ chỗ thành công." } };
      }

      // Đang là confirmed -> thu hồi liên hệ + mở lại tin nếu cần
      const confirmedBuyerId = privateSnap.data()?.confirmedBuyerId;

      transaction.update(resRef, {
        status: "cancelled",
        cancelledBy: cancelledByRole,
        cancelReason:
          sanitizedReason ||
          (isBuyer ? "Người mua đã hủy giao dịch" : isSeller ? "Người bán đã hủy giao dịch" : "Quản trị viên đã hủy giao dịch"),
        cancelledAt: FieldValue.serverTimestamp(),
        holdExpiresAt: FieldValue.delete(),
        expiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.delete(buyerActiveLockRef);

      if (confirmedBuyerId === buyerId) {
        const isExpired = isPastDeadline(passDeadline);
        if (currentListingStatus === "reserved") {
          transaction.update(listingRef, {
            status: isExpired ? "expired" : "active",
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Nếu tin chuyển từ reserved -> expired, giải phóng slot người bán & khóa trùng tiêu đề
          if (isExpired) {
            const curSellerActive = sellerListingStatSnap?.exists
              ? Math.max(0, Number(sellerListingStatSnap.data()?.activeCount ?? 0))
              : 0;
            transaction.set(
              sellerStatRef,
              {
                activeCount: Math.max(0, curSellerActive - 1),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            if (
              sellerLockRef &&
              sellerTitleLockSnap?.exists &&
              sellerTitleLockSnap.data()?.listingId === listingId
            ) {
              transaction.delete(sellerLockRef);
            }
          }
        }

        transaction.set(
          listingPrivateRef,
          {
            confirmedBuyerId: FieldValue.delete(),
            confirmedReservationId: FieldValue.delete(),
            confirmedUntil: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        if (!isExpired && waitlistedSnap && !waitlistedSnap.empty) {
          const nextReq = waitlistedSnap.docs[0];
          const nextBuyerId = nextReq.data().buyerId as string;
          const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

          transaction.update(nextReq.ref, {
            status: "pending",
            expiresAt: newExpiresAt,
            holdExpiresAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          transaction.set(
            listingResStatRef,
            { pendingCount: Math.max(0, currentListingPending) + 1, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          if (nextBuyerId) {
            const nextSnap = waitlistedStatRefs.get(nextBuyerId);
            const nextPrevCount = nextSnap?.exists
              ? Math.max(0, Number(nextSnap.data()?.pendingCount ?? 0))
              : 0;
            transaction.set(
              userReservationStatsRef(nextBuyerId),
              { pendingCount: nextPrevCount + 1, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          }

          transaction.set(adminDb.collection("notifications").doc(), {
            userId: nextBuyerId,
            type: "waitlist_promoted",
            title: "Bạn đã được chuyển lên hàng đầu! 🎉",
            body: `Do giao dịch trước đó đã bị hủy, yêu cầu của bạn cho món đồ "${listingData.title}" đã được chuyển lên cho người bán xác nhận trong 24 giờ tới.`,
            targetId: nextReq.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });

          transaction.set(adminDb.collection("notifications").doc(), {
            userId: sellerId,
            type: "waitlist_promoted",
            title: "Hàng chờ dự phòng: Có bạn sinh viên tiếp theo!",
            body: `Do người mua trước hủy, yêu cầu của bạn sinh viên tiếp theo cho món đồ "${listingData.title}" đã được đưa lên chờ bạn xác nhận.`,
            targetId: nextReq.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        } else if (isExpired && waitlistedSnap && !waitlistedSnap.empty) {
          const nextReq = waitlistedSnap.docs[0];
          const nextBuyerId = nextReq.data().buyerId as string;
          transaction.update(nextReq.ref, {
            status: "cancelled",
            cancelledBy: "system",
            cancelReason: "Tin đăng đã quá hạn pass đồ",
            cancelledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          if (nextBuyerId) {
            transaction.delete(activeReservationLockRef(listingId, nextBuyerId));
          }
        }
      }

      if (isAdmin && !isBuyer && !isSeller) {
        transaction.set(adminDb.collection("notifications").doc(), {
          userId: buyerId,
          type: "reservation_cancelled",
          title: "Giao dịch giữ chỗ đã bị hủy ❌",
          body: `Quản trị viên đã hủy giao dịch giữ chỗ cho món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
          targetId: reservationId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.set(adminDb.collection("notifications").doc(), {
          userId: sellerId,
          type: "reservation_cancelled",
          title: "Giao dịch giữ chỗ đã bị hủy ❌",
          body: `Quản trị viên đã hủy giao dịch giữ chỗ cho món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
          targetId: reservationId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(adminDb.collection("notifications").doc(), {
          userId: isBuyer ? sellerId : buyerId,
          type: "reservation_cancelled",
          title: "Giao dịch giữ chỗ đã bị hủy",
          body: `${isBuyer ? "Người mua" : "Người bán"} đã hủy giao dịch giữ chỗ món đồ "${listingData.title}".`,
          targetId: reservationId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return { jobId: null, payload: { message: "Đã hủy giao dịch giữ chỗ thành công." } };
    }

    // --- 3.4 NGƯỜI MUA KHÔNG ĐẾN (NO_SHOW) ---
    if (action === "no_show") {
      if (!isSeller && !isAdmin) {
        throw new ApiError(403, "FORBIDDEN", "Chỉ người bán mới có quyền báo người mua không đến.");
      }

      if (currentResStatus !== "confirmed") {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          "Chỉ có thể ghi nhận vắng mặt đối với giao dịch đã xác nhận giữ chỗ."
        );
      }

      if (!isAdmin) {
        const confirmedAtMs = toMs(resData.confirmedAt);
        if (confirmedAtMs === null) {
          throw new ApiError(
            409,
            "CONFIRMED_AT_MISSING",
            "Không xác định được thời điểm xác nhận giữ chỗ. Vui lòng liên hệ quản trị viên."
          );
        }
        if (Date.now() - confirmedAtMs < NO_SHOW_MIN_WAIT_MINUTES * 60_000) {
          throw new ApiError(
            409,
            "NO_SHOW_TOO_EARLY",
            `Chỉ được báo vắng mặt sau ${NO_SHOW_MIN_WAIT_MINUTES} phút kể từ khi xác nhận giữ chỗ.`
          );
        }
      }

      transaction.update(resRef, {
        status: "no_show",
        cancelReason: sanitizedReason || "Người mua không đến theo hẹn",
        cancelledAt: FieldValue.serverTimestamp(),
        holdExpiresAt: FieldValue.delete(),
        expiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.delete(buyerActiveLockRef);

      transaction.set(
        adminDb.collection("users").doc(buyerId),
        {
          noShowCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const isExpiredOnNoShow = isPastDeadline(passDeadline);
      if (currentListingStatus === "reserved") {
        transaction.update(listingRef, {
          status: isExpiredOnNoShow ? "expired" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (isExpiredOnNoShow) {
          const curSellerActive = sellerListingStatSnap?.exists
            ? Math.max(0, Number(sellerListingStatSnap.data()?.activeCount ?? 0))
            : 0;
          transaction.set(
            sellerStatRef,
            {
              activeCount: Math.max(0, curSellerActive - 1),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          if (
            sellerLockRef &&
            sellerTitleLockSnap?.exists &&
            sellerTitleLockSnap.data()?.listingId === listingId
          ) {
            transaction.delete(sellerLockRef);
          }
        }
      }

      transaction.set(
        listingPrivateRef,
        {
          confirmedBuyerId: FieldValue.delete(),
          confirmedReservationId: FieldValue.delete(),
          confirmedUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      if (!isExpiredOnNoShow && waitlistedSnap && !waitlistedSnap.empty) {
        const nextReq = waitlistedSnap.docs[0];
        const nextBuyerId = nextReq.data().buyerId as string;
        const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        transaction.update(nextReq.ref, {
          status: "pending",
          expiresAt: newExpiresAt,
          holdExpiresAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.set(
          listingResStatRef,
          { pendingCount: Math.max(0, currentListingPending) + 1, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        if (nextBuyerId) {
          const nextSnap = waitlistedStatRefs.get(nextBuyerId);
          const nextPrevCount = nextSnap?.exists
            ? Math.max(0, Number(nextSnap.data()?.pendingCount ?? 0))
            : 0;
          transaction.set(
            userReservationStatsRef(nextBuyerId),
            { pendingCount: nextPrevCount + 1, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }

        transaction.set(adminDb.collection("notifications").doc(), {
          userId: nextBuyerId,
          type: "waitlist_promoted",
          title: "Bạn đã được chuyển lên hàng đầu! 🎉",
          body: `Do giao dịch trước đó không thành công, bạn đã được đưa lên cho người bán xác nhận món đồ "${listingData.title}" trong 24 giờ tới.`,
          targetId: nextReq.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else if (isExpiredOnNoShow && waitlistedSnap && !waitlistedSnap.empty) {
        const nextReq = waitlistedSnap.docs[0];
        const nextBuyerId = nextReq.data().buyerId as string;
        transaction.update(nextReq.ref, {
          status: "cancelled",
          cancelledBy: "system",
          cancelReason: "Tin đăng đã quá hạn pass đồ",
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (nextBuyerId) {
          transaction.delete(activeReservationLockRef(listingId, nextBuyerId));
        }
      }

      transaction.set(adminDb.collection("notifications").doc(), {
        userId: buyerId,
        type: "reservation_no_show",
        title: "Ghi nhận vắng mặt trong giao dịch hẹn ⚠️",
        body: `Người bán đã báo bạn không đến điểm hẹn nhận món đồ "${listingData.title}". Tài khoản của bạn đã bị ghi nhận 1 lần vắng mặt.`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        jobId: null,
        payload: {
          message: "Đã ghi nhận người mua vắng mặt và mở lại tin đăng thành công.",
        },
      };
    }

    // --- 3.5 HOÀN TẤT GIAO DỊCH (COMPLETE) — CHỐNG VƯỢT 500 WRITES BẰNG DURABLE JOB ---
    if (action === "complete") {
      if (!isSeller && !isAdmin) {
        throw new ApiError(403, "FORBIDDEN", "Chỉ người bán mới có quyền hoàn tất giao dịch.");
      }

      if (currentResStatus !== "confirmed") {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          "Chỉ có thể hoàn tất giao dịch sau khi người bán đã xác nhận giữ chỗ."
        );
      }

      if (currentListingStatus !== "reserved") {
        throw new ApiError(
          409,
          "LISTING_NOT_RESERVED",
          `Tin đăng đang ở trạng thái "${currentListingStatus}" nên không thể hoàn tất giao dịch.`
        );
      }
      if (privateSnap.data()?.confirmedBuyerId !== buyerId) {
        throw new ApiError(409, "BUYER_MISMATCH", "Người mua đã chốt không khớp với yêu cầu này.");
      }

      const jobId = `op_complete_${reservationId}_${crypto.randomUUID().slice(0, 8)}`;

      // Transaction chỉ thực hiện ~7 writes cố định: chốt reservation, khóa listing processing, thu hồi private access & tạo durable job
      transaction.update(resRef, {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        holdExpiresAt: FieldValue.delete(),
        expiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.delete(buyerActiveLockRef);

      transaction.update(listingRef, {
        operationStatus: "finalizing",
        activeJobId: jobId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(
        listingPrivateRef,
        {
          confirmedBuyerId: FieldValue.delete(),
          confirmedReservationId: FieldValue.delete(),
          confirmedUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      transaction.set(
        adminDb.collection("users").doc(sellerId),
        {
          completedDealsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      transaction.set(adminDb.collection("notifications").doc(`res_${reservationId}_review_buyer`), {
        userId: buyerId,
        type: "review_request",
        title: "Giao dịch hoàn tất! Mời bạn đánh giá người bán ⭐",
        body: `Bạn đã nhận được món đồ "${listingData.title}" chưa? Hãy để lại 1-5 sao nhận xét để xây dựng cộng đồng sinh viên uy tín nhé!`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      transaction.set(adminDb.collection("notifications").doc(`res_${reservationId}_review_seller`), {
        userId: sellerId,
        type: "review_request",
        title: "Giao dịch hoàn tất! Mời bạn đánh giá người mua ⭐",
        body: `Bạn thấy quá trình giao dịch món đồ "${listingData.title}" với người mua thế nào? Hãy đánh giá cho bạn ấy nhé!`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      transaction.set(adminDb.collection("listingOperationJobs").doc(jobId), {
        id: jobId,
        type: "complete",
        listingId,
        listingTitle: String(listingData.title || ""),
        titleNormalized: String(listingData.titleNormalized || ""),
        sellerId,
        previousStatus: currentListingStatus,
        finalStatus: "sold",
        initiatorUid: callerUid,
        initiatorEmail: auth.email || "user",
        isModeration: false,
        excludeReservationId: reservationId,
        targetStatuses: ["pending", "waitlisted"],
        cancelledBy: "system",
        cancelReason: "Món đồ đã được pass thành công cho người khác",
        buyerNotifTitle: "Món đồ đã được pass cho người khác",
        buyerNotifBody: `Món đồ "${listingData.title}" bạn đang chờ đã được bán thành công cho bạn sinh viên trước.`,
        status: "pending",
        attempts: 0,
        deadLetter: false,
        leaseUntil: null,
        nextAttemptAt: new Date(),
        lastError: null,
        processedReservations: 0,
        processedReports: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        jobId,
        payload: {
          message: "Chúc mừng bạn đã pass đồ thành công! Cả hai bên đã nhận được lời mời đánh giá.",
        },
      };
    }

    throw new ApiError(400, "INVALID_ACTION", "Hành động không hợp lệ.");
  });

  if (txOutcome.jobId) {
    const jobRes = await processListingOperationJob(txOutcome.jobId);
    if (!jobRes.completed) {
      return NextResponse.json(
        {
          success: true,
          pending: true,
          jobId: txOutcome.jobId,
          ...txOutcome.payload,
        },
        { status: 202 }
      );
    }
  }

  return NextResponse.json({
    success: true,
    ...txOutcome.payload,
  });
});
