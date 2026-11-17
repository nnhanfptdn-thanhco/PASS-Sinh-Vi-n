import { NextRequest, NextResponse } from "next/server";
import { requireVerified, errorResponse } from "@/lib/auth/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

const MAX_CONTACT_VIEWS_PER_HOUR = 10;

const contactRequestSchema = z.object({
  listingId: z.string().min(1, "Thiếu listingId"),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireVerified(req);
    const buyerId = token.uid;

    const body = await req.json();
    const parsed = contactRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { listingId } = parsed.data;

    // 1. Đối chiếu trạng thái xác minh từ verifications/{uid}
    const verifDoc = await adminDb.collection("verifications").doc(buyerId).get();
    if (!verifDoc.exists || verifDoc.data()?.status !== "approved") {
      return NextResponse.json(
        {
          error:
            "Chỉ sinh viên đã được phê duyệt thẻ mới được xem thông tin liên hệ của người bán.",
        },
        { status: 403 }
      );
    }

    // 2. Kiểm tra tin đăng tồn tại và đang hoạt động
    const listingDoc = await adminDb.collection("listings").doc(listingId).get();
    if (!listingDoc.exists) {
      return NextResponse.json(
        { error: "Không tìm thấy tin đăng này trên hệ thống." },
        { status: 404 }
      );
    }

    const listingData = listingDoc.data() || {};
    const sellerId = listingData.sellerId;

    if (listingData.status !== "active") {
      return NextResponse.json(
        { error: "Tin đăng này đã ẩn hoặc đã hoàn tất giao dịch." },
        { status: 400 }
      );
    }

    if (sellerId === buyerId) {
      return NextResponse.json(
        { error: "Bạn là người bán của tin đăng này." },
        { status: 400 }
      );
    }

    // 3. Kiểm tra giới hạn tần suất xem số (Rate Limiting trong 1 giờ)
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

    // 4. Lấy thông tin liên hệ từ usersPrivate của người bán
    const sellerPrivateDoc = await adminDb.collection("usersPrivate").doc(sellerId).get();
    if (!sellerPrivateDoc.exists) {
      return NextResponse.json(
        { error: "Không tìm thấy thông tin liên hệ của người bán" },
        { status: 404 }
      );
    }

    const sellerPrivate = sellerPrivateDoc.data();

    // 5. Ghi log lịch sử xem liên hệ
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
    return errorResponse(err);
  }
}
