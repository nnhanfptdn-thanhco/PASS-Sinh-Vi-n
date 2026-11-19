import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireApprovedStudent } from "@/lib/auth/server";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";
import { isPastDeadline } from "@/lib/utils/date";

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

      // Kiểm tra hạn 24h của yêu cầu pending
      const expiresAt = resData.expiresAt ? new Date(resData.expiresAt as string).getTime() : 0;
      if (expiresAt > 0 && Date.now() > expiresAt) {
        throw new ApiError(
          409,
          "RESERVATION_EXPIRED",
          "Yêu cầu giữ chỗ này đã quá hạn 24 giờ và không thể xác nhận."
        );
      }

      // Kiểm tra tin còn active và chưa quá hạn
      if (currentListingStatus !== "active" || isPastDeadline(passDeadline)) {
        throw new ApiError(
          409,
          "LISTING_NOT_ACTIVE",
          "Món đồ hiện không còn khả dụng hoặc đã có người khác được xác nhận giữ chỗ trước."
        );
      }

      // Chuyển giữ chỗ sang confirmed và đặt hạn giữ 72h
      const holdExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
      transaction.update(resRef, {
        status: "confirmed",
        confirmedAt: FieldValue.serverTimestamp(),
        holdExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Đổi trạng thái tin sang reserved
      transaction.update(listingRef, {
        status: "reserved",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Mở quyền xem địa chỉ chính xác cho người mua được duyệt trong listingsPrivate
      transaction.set(
        listingPrivateRef,
        {
          confirmedBuyerId: buyerId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // Đẩy tất cả các yêu cầu pending khác của tin này sang hàng chờ dự phòng (waitlisted)
      const otherPendingSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "==", "pending")
      );

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

      // Thông báo cho người mua được xác nhận
      const confirmNotifRef = adminDb.collection("notifications").doc();
      transaction.set(confirmNotifRef, {
        userId: buyerId,
        type: "reservation_confirmed",
        title: "Lời giữ chỗ của bạn ĐÃ ĐƯỢC XÁC NHẬN! 🎉",
        body: `Người bán đã đồng ý giữ chỗ món đồ "${listingData.title}" cho bạn. Thông tin liên hệ và địa chỉ chính xác đã được mở tại mục Giữ chỗ.`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        message: "Đã xác nhận giữ chỗ thành công! Tin đăng chuyển sang trạng thái đã có người giữ.",
      };
    }

    // --- 3.2 TỪ CHỐI (REJECT) ---
    if (action === "reject") {
      if (!isSeller && !isAdmin) {
        throw new ApiError(403, "FORBIDDEN", "Chỉ người bán mới có quyền từ chối giữ chỗ.");
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
        cancelReason: reason || "Người bán đã từ chối yêu cầu",
        updatedAt: FieldValue.serverTimestamp(),
      });

      const rejectNotif = adminDb.collection("notifications").doc();
      transaction.set(rejectNotif, {
        userId: buyerId,
        type: "reservation_rejected",
        title: "Yêu cầu giữ chỗ đã bị từ chối",
        body: `Người bán đã từ chối yêu cầu giữ chỗ cho món đồ "${listingData.title}". ${reason ? `Lý do: ${reason}` : ""}`,
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

      // Nếu đang là pending hoặc waitlisted: Người mua hoặc người bán hủy không ảnh hưởng tin đăng
      if (currentResStatus === "pending" || currentResStatus === "waitlisted") {
        transaction.update(resRef, {
          status: "cancelled",
          cancelledBy: isBuyer ? "buyer" : "seller",
          cancelReason: reason || (isBuyer ? "Người mua đã hủy yêu cầu" : "Người bán đã hủy"),
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Báo cho bên còn lại
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

        return { message: "Đã hủy yêu cầu giữ chỗ thành công." };
      }

      // Nếu đang là confirmed: Người mua hoặc người bán hủy
      // Kiểm tra: Chỉ đưa tin về active nếu confirmedBuyerId trùng với người mua này
      const privateSnap = await transaction.get(listingPrivateRef);
      const confirmedBuyerId = privateSnap.data()?.confirmedBuyerId;

      transaction.update(resRef, {
        status: "cancelled",
        cancelledBy: isBuyer ? "buyer" : "seller",
        cancelReason: reason || (isBuyer ? "Người mua đã hủy giao dịch" : "Người bán đã hủy giao dịch"),
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (confirmedBuyerId === buyerId) {
        // Đưa tin về active nếu còn hạn
        const isExpired = isPastDeadline(passDeadline);
        transaction.update(listingRef, {
          status: isExpired ? "expired" : "active",
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Khóa lại địa chỉ chính xác
        transaction.set(
          listingPrivateRef,
          { confirmedBuyerId: FieldValue.delete() },
          { merge: true }
        );

        // Đẩy bạn sớm nhất trong waitlisted lên pending với HẠN 24H MỚI
        const waitlistedSnap = await transaction.get(
          adminDb
            .collection("reservations")
            .where("listingId", "==", listingId)
            .where("status", "==", "waitlisted")
            .orderBy("createdAt", "asc")
            .limit(1)
        );

        if (!waitlistedSnap.empty) {
          const nextReq = waitlistedSnap.docs[0];
          const nextBuyerId = nextReq.data().buyerId;
          const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

          transaction.update(nextReq.ref, {
            status: "pending",
            expiresAt: newExpiresAt,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Báo cho người mua kế tiếp
          const nextBuyerNotif = adminDb.collection("notifications").doc();
          transaction.set(nextBuyerNotif, {
            userId: nextBuyerId,
            type: "waitlist_promoted",
            title: "Cơ hội nhận đồ pass: Bạn đã lên hàng đầu! 🎉",
            body: `Do giao dịch trước đã bị hủy, yêu cầu của bạn cho món đồ "${listingData.title}" đã được đưa lên cho người bán xác nhận. Hạn duyệt là 24 giờ tới.`,
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

      transaction.update(resRef, {
        status: "no_show",
        cancelReason: reason || "Người mua không đến theo hẹn",
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

      // Đưa tin về active nếu còn hạn
      const isExpired = isPastDeadline(passDeadline);
      transaction.update(listingRef, {
        status: isExpired ? "expired" : "active",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Khóa lại địa chỉ chính xác
      transaction.set(
        listingPrivateRef,
        { confirmedBuyerId: FieldValue.delete() },
        { merge: true }
      );

      // Đẩy waitlist lên pending
      const waitlistedSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "==", "waitlisted")
          .orderBy("createdAt", "asc")
          .limit(1)
      );

      if (!waitlistedSnap.empty) {
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
          title: "Cơ hội nhận đồ pass: Bạn đã lên hàng đầu! 🎉",
          body: `Món đồ "${listingData.title}" đã mở lại. Yêu cầu của bạn đã được đưa lên hàng đầu chờ người bán duyệt.`,
          targetId: nextReq.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Thông báo cho người mua bị đánh dấu no_show
      const buyerNoShowNotif = adminDb.collection("notifications").doc();
      transaction.set(buyerNoShowNotif, {
        userId: buyerId,
        type: "reservation_no_show",
        title: "Cảnh báo vắng mặt không đến nhận đồ ⚠️",
        body: `Người bán đã ghi nhận bạn không đến điểm hẹn nhận món đồ "${listingData.title}". Việc vắng mặt nhiều lần có thể làm giảm uy tín tài khoản của bạn.`,
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { message: "Đã ghi nhận người mua không đến và đưa tin về trạng thái mở." };
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
      const remainingSnap = await transaction.get(
        adminDb
          .collection("reservations")
          .where("listingId", "==", listingId)
          .where("status", "in", ["pending", "waitlisted"])
      );

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
