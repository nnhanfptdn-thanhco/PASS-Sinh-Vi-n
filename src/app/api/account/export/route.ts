import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

// Tải về toàn bộ dữ liệu cá nhân (Quyền của chủ thể dữ liệu theo Luật BV Dữ liệu cá nhân 2025)
export async function GET(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const userId = token.uid;

    const [userDoc, userPrivateDoc, verifDoc, listingsSnap, reservationsSnap] =
      await Promise.all([
        adminDb.collection("users").doc(userId).get(),
        adminDb.collection("usersPrivate").doc(userId).get(),
        adminDb.collection("verifications").doc(userId).get(),
        adminDb.collection("listings").where("sellerId", "==", userId).get(),
        adminDb.collection("reservations").where("buyerId", "==", userId).get(),
      ]);

    const rawVerif = verifDoc.data() || {};
    // Loại bỏ ảnh thẻ và đường dẫn file nhạy cảm khỏi tệp xuất
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cardImagePreviewUrl, cardStoragePath, cardImagePath, ...safeVerif } = rawVerif;

    const exportData = {
      exportDate: new Date().toISOString(),
      userId,
      publicProfile: userDoc.data() || null,
      privateProfile: userPrivateDoc.data() || null,
      verificationRecord: verifDoc.exists ? safeVerif : null,
      myListings: listingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      myReservations: reservationsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })),
      legalNotice:
        "Dữ liệu được xuất theo yêu cầu của bạn, tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025.",
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="chopass-data-${userId}.json"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
