import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/auth/server";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import type { QuerySnapshot, DocumentData } from "firebase-admin/firestore";
import { z } from "zod";
import { isPastDeadline } from "@/lib/utils/date";
import { NO_SHOW_MIN_WAIT_MINUTES } from "@/lib/constants/listing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reservationActionSchema = z
  .object({
    reservationId: z.string().min(1, "Thiếu reservationId"),
    action: z.enum(["confirm", "reject", "cancel", "complete", "no_show"]),
    reason: z.string().max(300, "Lý do tối đa 300 ký tự").optional(),
  })
  .strict();

export const POST = withApi(async (req: NextRequest) => {
  const { token } = await requireApprovedStudent(req);
  const callerUid = token.uid;
  const isAdmin = token.admin === true || token.role === "admin";

  const body = await readJson(req);
  const { reservationId, action, reason } = reservationActionSchema.parse(body);

  const resRef = adminDb.collection("reservations").doc(reservationId);

  const result = await adminDb.runTransaction(async (transaction) => {
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

    // 2. Đọc tin đăng liên quan
    const listingRef = adminDb.collection("listings").doc(listingId);
    const listingPrivateRef = adminDb.collection("listingsPrivate").doc(listingId);

    const listingSnap = await transaction.get(listingRef);
    if (!listingSnap.exists) {
      throw new ApiError(404, "LISTING_NOT_FOUND", "Tin đăng tương ứng không tồn tại.");
    }

    const listingData = listingSnap.data() as Record<string, unknown>;
    const currentListingStatus = listingData.status as string;
    const passDeadline = (listingData.passDeadline as string) || "";

    // ===== READ PHASE: TOÀN BỘ transaction.get PHẢI Ở ĐÂY, TRƯỚC MỌI GHI =====
    const resCol = adminDb.collection("reservations");
    const privateSnap = await transaction.get(listingPrivateRef);

    let otherPendingSnap: QuerySnapshot<DocumentData> | null = null;
    let waitlistedSnap: QuerySnapshot<DocumentData> | null = null;
    let remainingSnap: QuerySnapshot<DocumentData> | null = null;

    if (action === "confirm") {
      otherPendingSnap = await transaction.get(
        resCol.where("listingId", "==", listingId).where("status", "==", "pending")
      );
    }
    if ((action === "cancel" && currentResStatus === "confirmed") || action === "no_show") {
      waitlistedSnap = await transaction.get(
        resCol
          .where("listingId", "==", listingId)
          .where("status", "==", "waitlisted")
          .orderBy("createdAt", "asc")
          .limit(1)
      );
    }
    if (action === "complete") {
      remainingSnap = await transaction.get(
        resCol
          .where("listingId", "==", listingId)
          .where("status", "in", ["pending", "waitlisted"])
      );
    }
    // ===== HẾT READ PHASE — từ đây CHỈ ghi =====

    const sanitizedReason = reason?.trim().slice(0, 300);

    // 3. THỰC HIỆN HÀNH ĐỘNG THEO BẢNG 2.4

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

      // Kiểm tra tin đăng có còn active không
      if (currentListingStatus !== "active") {
        throw new ApiError(
          409,
          "LISTING_NOT_AVAILABLE",
          `Món đồ này hiện không ở trạng thái sẵn sàng để giữ chỗ (trạng thái: ${currentListingStatus}).`
        );
      }

      // Kiểm tra hạn pass của tin
      if (isPastDeadline(passDeadline)) {
        throw new ApiError(
          409,
          "LISTING_EXPIRED",
          "Món đồ này đã quá hạn pass đồ, không thể xác nhận giữ chỗ."
        );
      }

      // Xác nhận giữ chỗ: 72 giờ (3 ngày) để 2 bên gặp gỡ
      const confirmedExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

      transaction.update(resRef, {
        status: "confirmed",
        confirmedAt: FieldValue.serverTimestamp(),
        expiresAt: confirmedExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Chuyển tin đăng sang reserved
      transaction.update(listingRef, {
        status: "reserved",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Lưu confirmedBuyerId vào listingsPrivate
      transaction.set(
        listingPrivateRef,
        {
          confirmedBuyerId: buyerId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Đẩy tất cả các yêu cầu pending khác của tin này sang hàng chờ dự phòng (waitlisted)
      if (otherPendingSnap) {
        otherPendingSnap.forEach((doc) => {
          if (doc.id !== reservationId) {
            transaction.update(doc.ref, {
              status: "waitlisted",
              updatedAt: FieldValue.serverTimestamp(),
            });

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

      // Thông báo cho người mua: Đã được xác nhận giữ chỗ thành công + Xem địa chỉ chính xác
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
        message: "Đã xác nhận giữ chỗ thành công trong 72 giờ.",
        expiresAt: confirmedExpiresAt,
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
        updatedAt: FieldValue.serverTimestamp(),
      });

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

      return { message: "Đã từ chối yêu cầu giữ chỗ." };
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

      // Nếu đang là pending hoặc waitlisted: Người mua hoặc người bán hủy không ảnh hưởng tin đăng
      if (currentResStatus === "pending" || currentResStatus === "waitlisted") {
        transaction.update(resRef, {
          status: "cancelled",
          cancelledBy: cancelledByRole,
          cancelReason: sanitizedReason || (isBuyer ? "Người mua đã hủy yêu cầu" : isSeller ? "Người bán đã hủy" : "Quản trị viên đã hủy yêu cầu"),
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        if (isAdmin && !isBuyer && !isSeller) {
          const notifBuyer = adminDb.collection("notifications").doc();
          transaction.set(notifBuyer, {
            userId: buyerId,
            type: "reservation_cancelled",
            title: "Yêu cầu giữ chỗ đã bị hủy",
            body: `Quản trị viên đã hủy yêu cầu giữ chỗ món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
            targetId: reservationId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
          const notifSeller = adminDb.collection("notifications").doc();
          transaction.set(notifSeller, {
            userId: sellerId,
            type: "reservation_cancelled",
            title: "Yêu cầu giữ chỗ đã bị hủy",
            body: `Quản trị viên đã hủy yêu cầu giữ chỗ món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
            targetId: reservationId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        } else {
          const targetNotifyUid = isBuyer ? sellerId : buyerId;
          const notifRef = adminDb.collection("notifications").doc();
          transaction.set(notifRef, {
            userId: targetNotifyUid,
            type: "reservation_cancelled",
            title: "Yêu cầu giữ chỗ đã bị hủy",
            body: `${isBuyer ? "Người mua" : "Người bán"} đã hủy yêu cầu giữ chỗ món đồ "${listingData.title}".`,
            targetId: reservationId,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }

        return { message: "Đã hủy yêu cầu giữ chỗ thành công." };
      }

      // Nếu đang là confirmed: Người mua hoặc người bán hủy
      // Kiểm tra: Chỉ đưa tin về active nếu confirmedBuyerId trùng với người mua này
      const confirmedBuyerId = privateSnap.data()?.confirmedBuyerId;

      transaction.update(resRef, {
        status: "cancelled",
        cancelledBy: cancelledByRole,
        cancelReason: sanitizedReason || (isBuyer ? "Người mua đã hủy giao dịch" : isSeller ? "Người bán đã hủy giao dịch" : "Quản trị viên đã hủy giao dịch"),
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (confirmedBuyerId === buyerId) {
        // Chỉ mở lại tin nếu nó đang thực sự ở trạng thái reserved
        if (currentListingStatus === "reserved") {
          const isExpired = isPastDeadline(passDeadline);
          transaction.update(listingRef, {
            status: isExpired ? "expired" : "active",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // Khóa lại địa chỉ chính xác
        transaction.set(
          listingPrivateRef,
          { confirmedBuyerId: FieldValue.delete() },
          { merge: true }
        );

        // Đẩy bạn sớm nhất trong waitlisted lên pending với HẠN 24H MỚI
        if (waitlistedSnap && !waitlistedSnap.empty) {
          const nextReq = waitlistedSnap.docs[0];
          const nextBuyerId = nextReq.data().buyerId;
          const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

          transaction.update(nextReq.ref, {
            status: "pending",
            expiresAt: newExpiresAt,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Báo cho bạn được đôn lên
          const nextBuyerNotif = adminDb.collection("notifications").doc();
          transaction.set(nextBuyerNotif, {
            userId: nextBuyerId,
            type: "waitlist_promoted",
            title: "Bạn đã được chuyển lên hàng đầu! 🎉",
            body: `Do giao dịch trước đó đã bị hủy, yêu cầu của bạn cho món đồ "${listingData.title}" đã được chuyển lên cho người bán xác nhận trong 24 giờ tới.`,
            targetId: nextReq.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });

          // Báo cho người bán
          const sellerWaitlistNotif = adminDb.collection("notifications").doc();
          transaction.set(sellerWaitlistNotif, {
            userId: sellerId,
            type: "waitlist_promoted",
            title: "Hàng chờ dự phòng: Có bạn sinh viên tiếp theo!",
            body: `Do người mua trước hủy, yêu cầu của bạn sinh viên tiếp theo cho món đồ "${listingData.title}" đã được đưa lên chờ bạn xác nhận.`,
            targetId: nextReq.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }

      // Thông báo cho bên còn lại
      if (isAdmin && !isBuyer && !isSeller) {
        const notifBuyer = adminDb.collection("notifications").doc();
        transaction.set(notifBuyer, {
          userId: buyerId,
          type: "reservation_cancelled",
          title: "Giao dịch giữ chỗ đã bị hủy ❌",
          body: `Quản trị viên đã hủy giao dịch giữ chỗ cho món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
          targetId: reservationId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        const notifSeller = adminDb.collection("notifications").doc();
        transaction.set(notifSeller, {
          userId: sellerId,
          type: "reservation_cancelled",
          title: "Giao dịch giữ chỗ đã bị hủy ❌",
          body: `Quản trị viên đã hủy giao dịch giữ chỗ cho món đồ "${listingData.title}". ${sanitizedReason ? `Lý do: ${sanitizedReason}` : ""}`,
          targetId: reservationId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        const targetNotifyUid = isBuyer ? sellerId : buyerId;
        const cancelNotif = adminDb.collection("notifications").doc();
        transaction.set(cancelNotif, {
          userId: targetNotifyUid,
          type: "reservation_cancelled",
          title: "Giao dịch giữ chỗ đã bị hủy",
          body: `${isBuyer ? "Người mua" : "Người bán"} đã hủy giao dịch giữ chỗ món đồ "${listingData.title}".`,
          targetId: reservationId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return { message: "Đã hủy giao dịch giữ chỗ thành công." };
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

      const confirmedAtMs =
        (resData.confirmedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
      if (
        confirmedAtMs &&
        Date.now() - confirmedAtMs < NO_SHOW_MIN_WAIT_MINUTES * 60_000 &&
        !isAdmin
      ) {
        throw new ApiError(
          409,
          "NO_SHOW_TOO_EARLY",
          `Chỉ được báo vắng mặt sau ${NO_SHOW_MIN_WAIT_MINUTES} phút kể từ khi xác nhận giữ chỗ.`
        );
      }

      transaction.update(resRef, {
        status: "no_show",
        cancelReason: sanitizedReason || "Người mua không đến theo hẹn",
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Tăng số lần noShowCount của người mua (bom hẹn)
      const buyerUserRef = adminDb.collection("users").doc(buyerId);
      transaction.set(
        buyerUserRef,
        {
          noShowCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Đưa tin về active nếu còn hạn và tin đang ở trạng thái reserved
      if (currentListingStatus === "reserved") {
        const isExpired = isPastDeadline(passDeadline);
        transaction.update(listingRef, {
          status: isExpired ? "expired" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      // Khóa lại địa chỉ chính xác
      transaction.set(
        listingPrivateRef,
        { confirmedBuyerId: FieldValue.delete() },
        { merge: true }
      );

      // Đẩy waitlist lên pending
      if (waitlistedSnap && !waitlistedSnap.empty) {
        const nextReq = waitlistedSnap.docs[0];
        const nextBuyerId = nextReq.data().buyerId;
        const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        transaction.update(nextReq.ref, {
          status: "pending",
          expiresAt: newExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        });

        const nextNotif = adminDb.collection("notifications").doc();
        transaction.set(nextNotif, {
          userId: nextBuyerId,
          type: "waitlist_promoted",
          title: "Bạn đã được chuyển lên hàng đầu! 🎉",
          body: `Do giao dịch trước đó không thành công, bạn đã được đưa lên cho người bán xác nhận món đồ "${listingData.title}" trong 24 giờ tới.`,
          targetId: nextReq.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Thông báo cho người mua bị đánh dấu no-show
      const noShowNotif = adminDb.collection("notifications").doc();
      transaction.set(noShowNotif, {
        userId: buyerId,
        type: "reservation_no_show",
        title: "Ghi nhận vắng mặt trong giao dịch hẹn ⚠️",
        body: `Người bán đã báo bạn không đến điểm hẹn nhận món đồ "${listingData.title}". Tài khoản của bạn đã bị ghi nhận 1 lần vắng mặt.`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        message: "Đã ghi nhận người mua vắng mặt và mở lại tin đăng thành công.",
      };
    }

    // --- 3.5 HOÀN TẤT GIAO DỊCH (COMPLETE) ---
    if (action === "complete") {
      if (!isSeller && !isAdmin) {
        throw new ApiError(403, "FORBIDDEN", "Chỉ người bán mới có quyền hoàn tất giao dịch.");
      }

      // Chỉ cho phép complete từ trạng thái confirmed! (Khắc phục lỗi cho complete từ pending)
      if (currentResStatus !== "confirmed") {
        throw new ApiError(
          409,
          "INVALID_STATUS",
          "Chỉ có thể hoàn tất giao dịch sau khi người bán đã xác nhận giữ chỗ."
        );
      }

      // Cập nhật giao dịch thành completed
      transaction.update(resRef, {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Chuyển tin đăng sang sold (biến mất khỏi nơi công khai)
      transaction.update(listingRef, {
        status: "sold",
        soldAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Xóa confirmedBuyerId trong listingsPrivate
      transaction.set(
        listingPrivateRef,
        { confirmedBuyerId: FieldValue.delete() },
        { merge: true }
      );

      // Hủy tất cả các yêu cầu còn lại (waitlisted / pending khác)
      if (remainingSnap) {
        remainingSnap.forEach((doc) => {
          transaction.update(doc.ref, {
            status: "cancelled",
            cancelledBy: "system",
            cancelReason: "Món đồ đã được pass thành công cho người khác",
            cancelledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          const cancelNotif = adminDb.collection("notifications").doc();
          transaction.set(cancelNotif, {
            userId: doc.data().buyerId,
            type: "reservation_cancelled",
            title: "Món đồ đã được pass cho người khác",
            body: `Món đồ "${listingData.title}" bạn đang chờ đã được bán thành công cho bạn sinh viên trước.`,
            targetId: doc.id,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        });
      }

      // Tăng completedDealsCount của người bán
      const sellerUserRef = adminDb.collection("users").doc(sellerId);
      transaction.set(
        sellerUserRef,
        {
          completedDealsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Mời CẢ HAI BÊN (người mua và người bán) đánh giá lẫn nhau (Tuân thủ SPEC)
      const buyerReviewNotif = adminDb.collection("notifications").doc();
      transaction.set(buyerReviewNotif, {
        userId: buyerId,
        type: "review_request",
        title: "Giao dịch hoàn tất! Mời bạn đánh giá người bán ⭐",
        body: `Bạn đã nhận được món đồ "${listingData.title}" chưa? Hãy để lại 1-5 sao nhận xét để xây dựng cộng đồng sinh viên uy tín nhé!`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      const sellerReviewNotif = adminDb.collection("notifications").doc();
      transaction.set(sellerReviewNotif, {
        userId: sellerId,
        type: "review_request",
        title: "Giao dịch hoàn tất! Mời bạn đánh giá người mua ⭐",
        body: `Bạn thấy quá trình giao dịch món đồ "${listingData.title}" với người mua thế nào? Hãy đánh giá cho bạn ấy nhé!`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        message: "Chúc mừng bạn đã pass đồ thành công! Cả hai bên đã nhận được lời mời đánh giá.",
      };
    }

    throw new ApiError(400, "INVALID_ACTION", "Hành động không hợp lệ.");
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
});
