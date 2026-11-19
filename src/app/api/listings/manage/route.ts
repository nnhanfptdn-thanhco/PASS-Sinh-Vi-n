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
    listingId: z.string().min(1, "Thiếu listingId"),
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
      // Đọc các giữ chỗ đang chờ để hủy
      const pendingResSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "in", ["pending", "waitlisted"])
      );

      transaction.update(listingRef, {
        status: "hidden_by_seller",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Hủy mọi giữ chỗ pending/waitlisted và thông báo cho người mua
      pendingResSnap.forEach((doc) => {
        const resData = doc.data();
        transaction.update(doc.ref, {
          status: "cancelled",
          cancelledBy: "seller",
          cancelReason: "Người bán đã tạm ẩn tin đăng",
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const notifRef = adminDb.collection("notifications").doc();
        transaction.set(notifRef, {
          userId: resData.buyerId,
          title: "Giữ chỗ đã bị hủy",
          body: "Người bán đã tạm ẩn món đồ bạn đang đặt giữ chỗ.",
          type: "reservation_cancelled",
          targetId: listingId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      return {
        status: "hidden_by_seller",
        message: "Đã tạm ẩn tin đăng thành công.",
      };
    }

    if (action === "mark_sold") {
      // Đọc tất cả giữ chỗ còn mở của tin
      const openResSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "in", ["pending", "waitlisted", "confirmed"])
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

      // Tăng số lượng completedDealsCount của người bán (nguyên tử)
      const userRef = adminDb.collection("users").doc(sellerId);
      transaction.set(
        userRef,
        {
          completedDealsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        status: "sold",
        message: "Đã đánh dấu bán thành công! Tin đăng sẽ ẩn khỏi mọi nơi công khai.",
      };
    }

    if (action === "renew") {
      const today = todayVN();
      const isExpired = currentStatus === "expired" || isPastDeadline(passDeadline);

      if (isExpired) {
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

      const calculatedDeadline = addDaysVN(today, 7);
      const maxDeadline = addDaysVN(today, 30);
      const newDeadline =
        calculatedDeadline > maxDeadline ? maxDeadline : calculatedDeadline;

      const newStatus = isExpired ? "active" : currentStatus;

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
