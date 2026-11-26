import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireApprovedStudent } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { FIRESTORE_ID_SCHEMA } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";
import { MAX_ACTIVE_LISTINGS_PER_SELLER } from "@/lib/constants/listing";
import { todayVN, addDaysVN, isPastDeadline } from "@/lib/utils/date";
import { normalizeVi } from "@/lib/search/normalize";
import { processListingOperationJob } from "@/lib/server/listing-jobs";
import { sellerListingStatsRef, sellerTitleLockRef } from "@/lib/server/stats";
import {
  validateManageListingAction,
  ListingStatus,
  ManageAction,
} from "@/lib/domain/listing-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const manageListingSchema = z
  .object({
    listingId: FIRESTORE_ID_SCHEMA,
    action: z.enum(["hide", "show", "mark_sold", "renew"]),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const auth = await requireApprovedStudent(req);
  const callerUid = auth.uid;
  const isAdmin = auth.isAdmin;

  await consumeRateLimit({
    scope: "manage_listing",
    key: callerUid,
    limit: 30,
    windowSec: 60,
    customMessage: "Bạn thao tác quản lý tin quá nhanh. Vui lòng thử lại sau 1 phút.",
  });

  const body = await readJson(req);
  const { listingId, action } = manageListingSchema.parse(body);

  const listingRef = adminDb.collection("listings").doc(listingId);
  const privateRef = adminDb.collection("listingsPrivate").doc(listingId);

  const txOutcome = await adminDb.runTransaction(async (transaction) => {
    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Tin đăng không tồn tại.");
    }

    const listingData = listingSnap.data() as Record<string, unknown>;
    if (listingData.operationStatus) {
      throw new ApiError(
        409,
        "LISTING_PROCESSING",
        "Tin đăng đang được hệ thống xử lý chuyển trạng thái. Vui lòng thử lại sau giây lát."
      );
    }

    const sellerId = listingData.sellerId as string;
    const currentStatus = (listingData.status as ListingStatus) || "active";
    const passDeadline = (listingData.passDeadline as string) || "";
    const titleNormalized =
      (listingData.titleNormalized as string) || normalizeVi(String(listingData.title || ""));

    if (sellerId !== callerUid && !isAdmin) {
      throw new ApiError(403, "FORBIDDEN", "Bạn không có quyền quản lý tin đăng này.");
    }

    if (!isAdmin && currentStatus === "hidden_by_admin") {
      throw new ApiError(
        403,
        "HIDDEN_BY_ADMIN",
        "Tin đăng đã bị Quản trị viên ẩn nên bạn không thể tự hiển thị, gia hạn hoặc đánh dấu đã bán. Vui lòng gửi khiếu nại."
      );
    }

    const validation = validateManageListingAction(action as ManageAction, {
      currentStatus,
      passDeadline,
      now: new Date(),
      isAdmin,
    });

    if (!validation.valid) {
      throw new ApiError(
        validation.statusCode || 409,
        "INVALID_TRANSITION",
        validation.error || "Không thể thực hiện hành động này."
      );
    }

    // --- 1. SHOW / RENEW (cập nhật khóa aggregate sellerListingStats + sellerTitleLock trong cùng transaction) ---
    if (action === "show" || action === "renew") {
      const statsRef = sellerListingStatsRef(sellerId);
      const titleLockRef = sellerTitleLockRef(sellerId, titleNormalized);
      const needsNewSlot =
        action === "show" ||
        currentStatus === "expired" ||
        (action === "renew" && currentStatus === "hidden_by_seller");

      const [statsSnap, activeSnap, titleLockSnap] = await Promise.all([
        transaction.get(statsRef),
        needsNewSlot
          ? transaction.get(
              adminDb
                .collection("listings")
                .where("sellerId", "==", sellerId)
                .where("status", "in", ["active", "reserved"])
            )
          : Promise.resolve(null),
        titleNormalized ? transaction.get(titleLockRef) : Promise.resolve(null),
      ]);

      if (needsNewSlot) {
        const storedCount = statsSnap.exists ? Math.max(0, Number(statsSnap.data()?.activeCount ?? 0)) : 0;
        const queriedCount = activeSnap ? activeSnap.size : 0;
        const currentActiveCount = Math.max(storedCount, queriedCount);

        if (currentActiveCount >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
          throw new ApiError(
            429,
            "SLOT_LIMIT_REACHED",
            `Bạn đã đạt giới hạn tối đa ${MAX_ACTIVE_LISTINGS_PER_SELLER} tin đang hiển thị và giữ chỗ.`
          );
        }

        if (
          titleLockSnap &&
          titleLockSnap.exists &&
          titleLockSnap.data()?.listingId !== listingId
        ) {
          throw new ApiError(
            409,
            "DUPLICATE_TITLE",
            "Bạn đã có một tin đăng khác trùng tiêu đề đang hoạt động."
          );
        }

        transaction.set(
          statsRef,
          {
            activeCount: currentActiveCount + 1,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        if (titleLockSnap && !titleLockSnap.exists && titleNormalized) {
          transaction.create(titleLockRef, {
            listingId,
            sellerId,
            titleNormalized,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      if (action === "show") {
        transaction.update(listingRef, {
          status: "active",
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          jobId: null as string | null,
          payload: {
            status: "active",
            message: "Đã hiển thị lại tin đăng thành công!",
          },
        };
      }

      // action === "renew"
      const today = todayVN();
      const maxDeadline = addDaysVN(today, 60);
      const plus7 = addDaysVN(today, 7);
      const current = passDeadline && !isPastDeadline(passDeadline) ? passDeadline : today;
      let newDeadline = current > plus7 ? current : plus7;
      if (newDeadline > maxDeadline) newDeadline = maxDeadline;

      const newStatus =
        currentStatus === "expired" || currentStatus === "hidden_by_seller"
          ? "active"
          : currentStatus;
      transaction.update(listingRef, {
        passDeadline: newDeadline,
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
        renewedAt: FieldValue.serverTimestamp(),
      });

      return {
        jobId: null as string | null,
        payload: {
          status: newStatus,
          passDeadline: newDeadline,
          message: `Đã gia hạn tin đăng đến ${newDeadline} thành công!`,
        },
      };
    }

    // --- 2. HIDE & MARK_SOLD (Chống >500 writes bằng lock listing + durable job) ---
    if (action === "hide") {
      const isModeration = isAdmin && sellerId !== callerUid;
      const shouldCancelConfirmed = isModeration || (isAdmin && currentStatus === "reserved");
      const finalStatus = isModeration ? "hidden_by_admin" : "hidden_by_seller";
      const jobId = `op_hide_${listingId}_${crypto.randomUUID().slice(0, 8)}`;

      transaction.update(listingRef, {
        operationStatus: isModeration ? "moderation_processing" : "finalizing",
        activeJobId: jobId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Thu hồi tức thì quyền xem địa chỉ nếu hủy cả confirmed reservation
      if (shouldCancelConfirmed) {
        transaction.set(
          privateRef,
          {
            confirmedBuyerId: FieldValue.delete(),
            confirmedReservationId: FieldValue.delete(),
            confirmedUntil: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      transaction.set(adminDb.collection("listingOperationJobs").doc(jobId), {
        id: jobId,
        type: "hide",
        listingId,
        listingTitle: String(listingData.title || ""),
        titleNormalized,
        sellerId,
        previousStatus: currentStatus,
        finalStatus,
        initiatorUid: callerUid,
        initiatorEmail: auth.email || "admin",
        isModeration,
        excludeReservationId: null,
        targetStatuses: shouldCancelConfirmed
          ? ["pending", "waitlisted", "confirmed"]
          : ["pending", "waitlisted"],
        cancelledBy: isModeration ? "admin" : "seller",
        cancelReason: isModeration
          ? "Tin đăng đã bị Quản trị viên ẩn do có dấu hiệu vi phạm quy định"
          : "Người bán đã tạm ẩn tin đăng",
        buyerNotifTitle: "Giữ chỗ đã bị hủy",
        buyerNotifBody: isModeration
          ? "Tin đăng bạn đang giữ chỗ đã bị Quản trị viên ẩn vì có dấu hiệu vi phạm quy định."
          : "Người bán đã tạm ẩn món đồ bạn đang đặt giữ chỗ.",
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
          status: finalStatus,
          message: "Đã tạm ẩn tin đăng thành công.",
        },
      };
    }

    if (action === "mark_sold") {
      const jobId = `op_sold_${listingId}_${crypto.randomUUID().slice(0, 8)}`;

      transaction.update(listingRef, {
        operationStatus: "finalizing",
        activeJobId: jobId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(
        privateRef,
        {
          confirmedBuyerId: FieldValue.delete(),
          confirmedReservationId: FieldValue.delete(),
          confirmedUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      transaction.set(adminDb.collection("listingOperationJobs").doc(jobId), {
        id: jobId,
        type: "mark_sold",
        listingId,
        listingTitle: String(listingData.title || ""),
        titleNormalized,
        sellerId,
        previousStatus: currentStatus,
        finalStatus: "sold",
        initiatorUid: callerUid,
        initiatorEmail: auth.email || "user",
        isModeration: false,
        excludeReservationId: null,
        targetStatuses: ["pending", "waitlisted"],
        cancelledBy: "seller",
        cancelReason: "Người bán đã bán món đồ này",
        buyerNotifTitle: "Tin đăng đã được bán",
        buyerNotifBody: "Món đồ bạn đang quan tâm đã được người bán đánh dấu đã bán.",
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
          status: "sold",
          message: "Đã đánh dấu bán thành công! Tin đăng sẽ ẩn khỏi mọi nơi công khai.",
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
