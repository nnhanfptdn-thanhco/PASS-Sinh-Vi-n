import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";

// Giới hạn xem liên hệ: tối đa 10 lượt mỗi giờ cho mỗi sinh viên để chống cào số điện thoại hàng loạt
const MAX_CONTACT_VIEWS_PER_HOUR = 10;

export async function POST(req: NextRequest) {
  try {
    const { buyerId, listingId, sellerId } = await req.json();

    if (!buyerId || !listingId || !sellerId) {
      return NextResponse.json({ error: "Thiếu thông tin yêu cầu" }, { status: 400 });
    }

    // 1. Kiểm tra quyền của người mua (Phải là sinh viên đã xác minh)
    const buyerDoc = await adminDb.collection("users").doc(buyerId).get();
    if (!buyerDoc.exists || !buyerDoc.data()?.verified) {
      return NextResponse.json(
        {
          error:
            "Chỉ sinh viên đã xác minh thẻ mới được xem thông tin liên hệ của người bán.",
        },
        { status: 403 }
      );
    }

    // 2. Kiểm tra giới hạn tần suất xem số (Rate Limiting trong 1 giờ)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentViewsSnap = await adminDb
      .collection("contactViewLogs")
      .where("buyerId", "==", buyerId)
      .where("timestamp", ">=", oneHourAgo)
      .get();

    if (recentViewsSnap.size >= MAX_CONTACT_VIEWS_PER_HOUR) {
      return NextResponse.json(
        {
          error:
            "Bạn đã đạt giới hạn xem liên hệ (tối đa 10 lượt/giờ) nhằm bảo vệ thông tin sinh viên. Vui lòng quay lại sau 1 giờ.",
        },
        { status: 429 }
      );
    }

    // 3. Lấy thông tin liên hệ từ usersPrivate của người bán
    const sellerPrivateDoc = await adminDb.collection("usersPrivate").doc(sellerId).get();
    if (!sellerPrivateDoc.exists) {
      return NextResponse.json(
        { error: "Không tìm thấy thông tin liên hệ của người bán" },
        { status: 404 }
      );
    }

    const sellerPrivate = sellerPrivateDoc.data();

    // 4. Ghi log lịch sử xem liên hệ
    await adminDb.collection("contactViewLogs").add({
      buyerId,
      sellerId,
      listingId,
      timestamp: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      contact: {
        zaloPhone: sellerPrivate?.zaloPhone || "Liên hệ qua chat trong app",
        altPhone: sellerPrivate?.altPhone || null,
        dormOrAddress: sellerPrivate?.dormOrAddress || "Xem chi tiết khi giữ chỗ",
      },
    });
  } catch (err) {
    console.error("Lỗi lấy thông tin liên hệ:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
