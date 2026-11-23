import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError } from "@/lib/auth/server";
import { adminDb } from "@/lib/firebase/admin";
import { consumeRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// Tải về toàn bộ dữ liệu cá nhân (Quyền của chủ thể dữ liệu theo Nghị định 13/2023/NĐ-CP)
export async function GET(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const userId = token.uid;

    // Yêu cầu xác thực mới trong vòng 5 phút (300s)
    const authTime = token.auth_time || 0;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (nowInSeconds - authTime > 300) {
      throw new HttpError(
        403,
        "Vì lý do an toàn bảo mật dữ liệu cá nhân, vui lòng đăng nhập lại Google trước khi thực hiện xuất dữ liệu."
      );
    }

    // Rate limit: tối đa 1 lần / giờ
    await consumeRateLimit({
      scope: "export_data",
      key: userId,
      limit: 1,
      windowSec: 3600,
      customMessage: "Bạn chỉ được xuất toàn bộ dữ liệu cá nhân tối đa 1 lần mỗi giờ.",
    });

    const [
      userDoc,
      userPrivateDoc,
      verifDoc,
      listingsSnap,
      buyerResSnap,
      sellerResSnap,
      sentReviewsSnap,
      receivedReviewsSnap,
      favoritesSnap,
      conversationsSnap,
    ] = await Promise.all([
      adminDb.collection("users").doc(userId).get(),
      adminDb.collection("usersPrivate").doc(userId).get(),
      adminDb.collection("verifications").doc(userId).get(),
      adminDb.collection("listings").where("sellerId", "==", userId).get(),
      adminDb.collection("reservations").where("buyerId", "==", userId).get(),
      adminDb.collection("reservations").where("sellerId", "==", userId).get(),
      adminDb.collection("reviews").where("reviewerId", "==", userId).get(),
      adminDb.collection("reviews").where("targetUserId", "==", userId).get(),
      adminDb.collection("favorites").where("userId", "==", userId).get(),
      adminDb.collection("conversations").where("participantIds", "array-contains", userId).get(),
    ]);

    const rawVerif = verifDoc.data() || {};
    // Loại bỏ ảnh thẻ và đường dẫn file nhạy cảm khỏi tệp xuất
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cardImagePreviewUrl, cardStoragePath, cardImagePath, ...safeVerif } = rawVerif;

    // Trích xuất tin nhắn của từng hội thoại
    const conversationsWithMessages = await Promise.all(
      conversationsSnap.docs.map(async (cDoc) => {
        const msgsSnap = await cDoc.ref
          .collection("messages")
          .orderBy("createdAt", "asc")
          .limit(200)
          .get();
        return {
          id: cDoc.id,
          ...cDoc.data(),
          messages: msgsSnap.docs.map((m) => ({ id: m.id, ...m.data() })),
        };
      })
    );

    const exportData = {
      exportDate: new Date().toISOString(),
      userId,
      publicProfile: userDoc.data() || null,
      privateProfile: userPrivateDoc.data() || null,
      verificationRecord: verifDoc.exists ? safeVerif : null,
      myListings: listingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      myReservationsAsBuyer: buyerResSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      myReservationsAsSeller: sellerResSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      reviewsWritten: sentReviewsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      reviewsReceived: receivedReviewsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      favorites: favoritesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      conversations: conversationsWithMessages,
      legalNotice:
        "Dữ liệu được xuất theo yêu cầu của bạn căn cứ quyền của chủ thể dữ liệu tại Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân.",
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Disposition": `attachment; filename="chopass-data-${userId}.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
