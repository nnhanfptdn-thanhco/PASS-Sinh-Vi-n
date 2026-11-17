import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

export const dynamic = "force-dynamic";

// Tải về toàn bộ dữ liệu cá nhân (Quyền của chủ thể dữ liệu theo Luật BV Dữ liệu cá nhân 2025)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "Thiếu userId" }, { status: 400 });
    }

    const [userDoc, userPrivateDoc, verifDoc, listingsSnap, reservationsSnap] =
      await Promise.all([
        adminDb.collection("users").doc(userId).get(),
        adminDb.collection("usersPrivate").doc(userId).get(),
        adminDb.collection("verifications").doc(userId).get(),
        adminDb.collection("listings").where("sellerId", "==", userId).get(),
        adminDb.collection("reservations").where("buyerId", "==", userId).get(),
      ]);

    const exportData = {
      exportDate: new Date().toISOString(),
      publicProfile: userDoc.data() || null,
      privateProfile: userPrivateDoc.data() || null,
      verificationRecord: verifDoc.data() || null,
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
    console.error("Lỗi xuất dữ liệu:", err);
    return NextResponse.json({ error: "Lỗi nội bộ máy chủ" }, { status: 500 });
  }
}
