import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/auth/server";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";
import { MAX_ACTIVE_LISTINGS_PER_SELLER } from "@/lib/constants/listing";
import { todayVN, addDaysVN, isPastDeadline } from "@/lib/utils/date";
import {
  validateManageListingAction,
  ListingStatus,
  ManageAction,
} from "@/lib/domain/listing-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const manageListingSchema = z
  .object({
    listingId: z
      .string()
      .min(1, "Thiếu listingId")
      .max(128, "listingId quá dài")
      .regex(/^[A-Za-z0-9_-]+$/, "listingId không hợp lệ"),
    action: z.enum(["hide", "show", "mark_sold", "renew"]),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const { token } = await requireApprovedStudent(req);
  const callerUid = token.uid;
  const isAdmin = token.admin === true || token.role === "admin";

  const body = await readJson(req);
  const { listingId, action } = manageListingSchema.parse(body);

  const listingRef = adminDb.collection("listings").doc(listingId);
  const privateRef = adminDb.collection("listingsPrivate").doc(listingId);

  const result = await adminDb.runTransaction(async (transaction) => {
    // 1. Đọc tin đăng
    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Tin đăng không tồn tại.");
    }

    const listingData = listingSnap.data() as Record<string, unknown>;
    const sellerId = listingData.sellerId as string;
    const currentStatus = (listingData.status as ListingStatus) || "active";
    const passDeadline = (listingData.passDeadline as string) || "";

    // 2. Kiểm tra quyền sở hữu
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

    // 3. Kiểm tra tính hợp lệ của chuyển đổi trạng thái theo Bảng 2.3
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

    // 4. Thực thi từng hành động
    if (action === "show") {
      // Đếm số slot đang chiếm
      const activeSnap = await transaction.get(
        adminDb
          .collection("listings")
          .where("sellerId", "==", sellerId)
          .where("status", "in", ["active", "reserved"])
      );

      if (activeSnap.size >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
        throw new ApiError(
          429,
          "SLOT_LIMIT_REACHED",
          `Bạn đã đạt giới hạn tối đa ${MAX_ACTIVE_LISTINGS_PER_SELLER} tin đang hiển thị và giữ chỗ.`
        );
      }

      transaction.update(listingRef, {
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        status: "active",
        message: "Đã hiển thị lại tin đăng thành công!",
      };
    }

    if (action === "hide") {
      const isModeration = isAdmin && sellerId !== callerUid;
      // Admin kiểm duyệt phải hủy CẢ giữ chỗ đã xác nhận để thu hồi quyền xem địa chỉ
      const openStatuses = isModeration
        ? ["pending", "waitlisted", "confirmed"]
        : ["pending", "waitlisted"];

      // ===== READ PHASE =====
      const openResSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "in", openStatuses)
      );
      const openReportsSnap = isModeration
        ? await transaction.get(
            adminDb
              .collection("reports")
              .where("targetType", "==", "listing")
              .where("targetId", "==", listingId)
              .where("status", "==", "pending")
          )
        : null;

      // ===== WRITE PHASE =====
      const hideStatus = isModeration ? "hidden_by_admin" : "hidden_by_seller";
      transaction.update(listingRef, {
        status: hideStatus,
        updatedAt: FieldValue.serverTimestamp(),
        ...(isModeration
          ? { moderatedAt: FieldValue.serverTimestamp(), moderatedBy: callerUid }
          : {}),
      });

      if (isModeration) {
        // Thu hồi quyền xem địa chỉ chính xác của người mua đã chốt
        transaction.set(privateRef, { confirmedBuyerId: FieldValue.delete() }, { merge: true });
      }

      const cancelledBy = isModeration ? "admin" : "seller";
      const cancelReason = isModeration
        ? "Tin đăng đã bị Quản trị viên ẩn do có dấu hiệu vi phạm quy định"
        : "Người bán đã tạm ẩn tin đăng";
      const buyerBody = isModeration
        ? "Tin đăng bạn đang giữ chỗ đã bị Quản trị viên ẩn vì có dấu hiệu vi phạm quy định."
        : "Người bán đã tạm ẩn món đồ bạn đang đặt giữ chỗ.";

      openResSnap.forEach((doc) => {
        const r = doc.data();
        transaction.update(doc.ref, {
          status: "cancelled",
          cancelledBy,
          cancelReason,
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(adminDb.collection("notifications").doc(), {
          userId: r.buyerId,
          title: "Giữ chỗ đã bị hủy",
          body: buyerBody,
          type: "reservation_cancelled",
          targetId: listingId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      if (isModeration) {
        transaction.set(adminDb.collection("notifications").doc(), {
          userId: sellerId,
          title: "Tin đăng của bạn đã bị ẩn",
          body: "Tin đăng đã bị Quản trị viên ẩn vì có dấu hiệu vi phạm. Bạn có thể gửi khiếu nại nếu cho rằng đây là nhầm lẫn.",
          type: "listing_moderated",
          targetId: listingId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        transaction.set(adminDb.collection("adminLogs").doc(), {
          adminUid: callerUid,
          adminEmail: token.email || "admin",
          action: "HIDE_LISTING_BY_ADMIN",
          targetListingId: listingId,
          targetUserId: sellerId,
          cancelledReservations: openResSnap.size,
          timestamp: FieldValue.serverTimestamp(),
        });
        openReportsSnap?.forEach((doc) => {
          transaction.update(doc.ref, {
            status: "resolved",
            resolution: "listing_hidden_by_admin",
            resolvedBy: callerUid,
            resolvedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      }

      return {
        status: hideStatus,
        message: "Đã tạm ẩn tin đăng thành công.",
      };
    }

    if (action === "mark_sold") {
      // Đọc tất cả giữ chỗ chờ/danh sách đợi của tin (tin reserved đã bị chặn ở bước validate)
      const openResSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "in", ["pending", "waitlisted"])
      );

      transaction.update(listingRef, {
        status: "sold",
        soldAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Xóa thông tin người mua xác nhận trong listingsPrivate nếu có
      transaction.set(
        privateRef,
        { confirmedBuyerId: FieldValue.delete() },
        { merge: true }
      );

      // Hủy tất cả giữ chỗ đang mở
      openResSnap.forEach((doc) => {
        const resData = doc.data();
        transaction.update(doc.ref, {
          status: "cancelled",
          cancelledBy: "seller",
          cancelReason: "Người bán đã bán món đồ này",
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const notifRef = adminDb.collection("notifications").doc();
        transaction.set(notifRef, {
          userId: resData.buyerId,
          title: "Tin đăng đã được bán",
          body: "Món đồ bạn đang quan tâm đã được người bán đánh dấu đã bán.",
          type: "reservation_cancelled",
          targetId: listingId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      return {
        status: "sold",
        message: "Đã đánh dấu bán thành công! Tin đăng sẽ ẩn khỏi mọi nơi công khai.",
      };
    }

    if (action === "renew") {
      const today = todayVN();
      const wasExpiredStatus = currentStatus === "expired"; // chỉ trạng thái expired mới CHƯA chiếm slot

      if (wasExpiredStatus) {
        // Kiểm tra số slot nếu chuyển từ expired -> active
        const activeSnap = await transaction.get(
          adminDb
            .collection("listings")
            .where("sellerId", "==", sellerId)
            .where("status", "in", ["active", "reserved"])
        );

        if (activeSnap.size >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
          throw new ApiError(
            429,
            "SLOT_LIMIT_REACHED",
            `Bạn đã đạt giới hạn tối đa ${MAX_ACTIVE_LISTINGS_PER_SELLER} tin đang hiển thị và giữ chỗ.`
          );
        }
      }

      const maxDeadline = addDaysVN(today, 30);
      const plus7 = addDaysVN(today, 7);
      const current = passDeadline && !isPastDeadline(passDeadline) ? passDeadline : today;
      let newDeadline = current > plus7 ? current : plus7; // không bao giờ rút ngắn
      if (newDeadline > maxDeadline) newDeadline = maxDeadline;

      const newStatus = wasExpiredStatus ? "active" : currentStatus; // reserved giữ reserved, active giữ active

      transaction.update(listingRef, {
        passDeadline: newDeadline,
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
        renewedAt: FieldValue.serverTimestamp(),
      });

      return {
        status: newStatus,
        passDeadline: newDeadline,
        message: `Đã gia hạn tin đăng đến ${newDeadline} thành công!`,
      };
    }

    throw new ApiError(400, "INVALID_ACTION", "Hành động không hợp lệ.");
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
});
