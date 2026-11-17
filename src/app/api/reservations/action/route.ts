import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const { reservationId, userId, action, reason } = await req.json();

    if (!reservationId || !userId || !action) {
      return NextResponse.json({ error: "Thiếu thông tin thao tác" }, { status: 400 });
    }

    const resRef = adminDb.collection("reservations").doc(reservationId);
    const snap = await resRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Không tìm thấy yêu cầu giữ chỗ" }, { status: 404 });
    }

    const resData = snap.data();
    const isSeller = resData?.sellerId === userId;
    const isBuyer = resData?.buyerId === userId;

    if (!isSeller && !isBuyer) {
      return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
    }

    const listingId = resData?.listingId;
    const listingRef = adminDb.collection("listings").doc(listingId);
    const listingPrivateRef = adminDb.collection("listingsPrivate").doc(listingId);

    // 1. NGƯỜI BÁN XÁC NHẬN GIỮ CHỖ (CONFIRM)
    if (action === "confirm" && isSeller) {
      await resRef.update({
        status: "confirmed",
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Cập nhật tin sang "reserved" (Đã có người giữ)
      await listingRef.update({
        status: "reserved",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Mở quyền xem địa chỉ chính xác cho đúng người mua này trong listingsPrivate
      await listingPrivateRef.update({
        confirmedBuyerId: resData?.buyerId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Chuyển các yêu cầu pending khác của tin này sang hàng chờ dự phòng (waitlisted)
      const otherPendingSnap = await adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("status", "==", "pending")
        .get();

      const batch = adminDb.batch();
      for (const doc of otherPendingSnap.docs) {
        if (doc.id !== reservationId) {
          batch.update(doc.ref, {
            status: "waitlisted",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      await batch.commit();

      // Thông báo cho người mua
      await adminDb.collection("notifications").add({
        userId: resData?.buyerId,
        type: "reservation_confirmed",
        title: "Lời giữ chỗ của bạn ĐÃ ĐƯỢC XÁC NHẬN! 🎉",
        message: "Người bán đã đồng ý giữ chỗ cho bạn. Địa chỉ chính xác và số liên hệ đã được mở. Hãy nhắn tin để hẹn giờ nhận đồ nhé!",
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        success: true,
        message: "Đã xác nhận giữ chỗ cho người mua thành công.",
      });
    }

    // 2. NGƯỜI BÁN HOẶC NGƯỜI MUA TỪ CHỐI / HỦY (REJECT / CANCEL)
    if (action === "reject" || action === "cancel") {
      const newStatus = action === "reject" ? "rejected" : "cancelled";
      await resRef.update({
        status: newStatus,
        cancelReason: reason || null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Tin quay về trạng thái active (Đang bán)
      await listingRef.update({
        status: "active",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Khóa lại địa chỉ chính xác
      await listingPrivateRef.update({
        confirmedBuyerId: null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Chuyển yêu cầu sớm nhất trong hàng chờ dự phòng (waitlisted) lên pending theo SPEC
      const waitlistedSnap = await adminDb
        .collection("reservations")
        .where("listingId", "==", listingId)
        .where("status", "==", "waitlisted")
        .orderBy("createdAt", "asc")
        .limit(1)
        .get();

      if (!waitlistedSnap.empty) {
        const nextReq = waitlistedSnap.docs[0];
        await nextReq.ref.update({
          status: "pending",
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Báo cho người bán biết có người trong hàng chờ được đưa lên
        await adminDb.collection("notifications").add({
          userId: resData?.sellerId,
          type: "waitlist_promoted",
          title: "Hàng chờ dự phòng: Có bạn sinh viên tiếp theo!",
          message: "Do giao dịch trước bị hủy, bạn sinh viên trong hàng chờ dự phòng đã được chuyển lên để bạn xác nhận.",
          targetId: nextReq.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      return NextResponse.json({
        success: true,
        message: action === "reject" ? "Đã từ chối lời giữ chỗ" : "Đã hủy giữ chỗ",
      });
    }

    // 3. HOÀN TẤT GIAO DỊCH (COMPLETED - ĐÃ BÁN THÀNH CÔNG)
    if (action === "complete" && isSeller) {
      await resRef.update({
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      await listingRef.update({
        status: "sold",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Tăng số món đã pass thành công của người bán
      await adminDb
        .collection("users")
        .doc(resData?.sellerId)
        .update({
          completedDealsCount: FieldValue.increment(1),
          activeListingsCount: FieldValue.increment(-1),
          updatedAt: FieldValue.serverTimestamp(),
        });

      // Mời cả 2 bên đánh giá nhau
      await adminDb.collection("notifications").add({
        userId: resData?.buyerId,
        type: "review_request",
        title: "Giao dịch hoàn tất! Mời bạn đánh giá người bán ⭐",
        message: "Bạn đã nhận được món đồ chưa? Hãy chia sẻ 1 - 5 sao và nhận xét để xây dựng cộng đồng sinh viên uy tín nhé.",
        targetId: reservationId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return NextResponse.json({
        success: true,
        message: "Chúc mừng bạn đã pass đồ thành công!",
      });
    }

    return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
  } catch (err) {
    console.error("Lỗi xử lý yêu cầu giữ chỗ:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
