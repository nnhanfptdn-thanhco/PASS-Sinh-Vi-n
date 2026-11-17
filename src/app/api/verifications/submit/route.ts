import { NextRequest, NextResponse } from "next/server";
import { adminDb, computeStudentIdHash, FieldValue } from "@/lib/firebase/admin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      userEmail,
      realName,
      displayName,
      schoolCode,
      campusId,
      faculty,
      studentClass,
      studentId,
      zaloPhone,
      altPhone,
      provinceCode,
      wardCode,
      dormOrAddress,
      isGraduating,
      cardImageBase64,
    } = body;

    if (!userId || !studentId || !schoolCode || !realName || !zaloPhone) {
      return NextResponse.json(
        { error: "Vui lòng điền đầy đủ các thông tin bắt buộc" },
        { status: 400 }
      );
    }

    // 1. Tính mã băm HMAC-SHA256 kết hợp mã trường và MSSV
    const studentIdHash = computeStudentIdHash(schoolCode, studentId);

    // 2. Chống đăng ký trùng thẻ: kiểm tra mã băm trong Firestore
    const existingSnap = await adminDb
      .collection("verifications")
      .where("studentIdHash", "==", studentIdHash)
      .where("status", "in", ["approved", "pending"])
      .get();

    // Nếu tìm thấy và không phải của chính user này
    const isDuplicate = existingSnap.docs.some((doc) => doc.id !== userId);
    if (isDuplicate) {
      return NextResponse.json(
        {
          error:
            "Mã thẻ sinh viên này đã được đăng ký trên hệ thống. Một thẻ sinh viên chỉ được gắn với một tài khoản duy nhất.",
        },
        { status: 409 }
      );
    }

    // 3. Kiểm tra email trường (.edu.vn) để ưu tiên xếp đầu hàng đợi
    const isEduEmail =
      userEmail &&
      (userEmail.endsWith(".edu.vn") || userEmail.endsWith(".vn"));

    // 4. Lưu vào collection verifications
    const verificationRef = adminDb.collection("verifications").doc(userId);
    await verificationRef.set(
      {
        userId,
        userEmail,
        realName,
        schoolCode,
        campusId,
        faculty,
        studentClass,
        studentIdLast4: studentId.slice(-4), // Chỉ lưu 4 số cuối
        studentIdHash,
        status: "pending",
        isEduEmail: Boolean(isEduEmail),
        isGraduating: Boolean(isGraduating),
        cardImagePath: `private/cards/${userId}/front.webp`,
        // Lưu tạm base64 cho local demo / emulator
        cardImagePreviewUrl: cardImageBase64,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // 5. Lưu vào collection usersPrivate (chỉ chủ tài khoản và admin đọc được)
    await adminDb.collection("usersPrivate").doc(userId).set(
      {
        realName,
        zaloPhone,
        altPhone: altPhone || null,
        email: userEmail,
        provinceCode,
        wardCode,
        dormOrAddress: dormOrAddress || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // 6. Cập nhật hồ sơ công khai trong collection users
    await adminDb.collection("users").doc(userId).set(
      {
        displayName: displayName || realName,
        schoolCode,
        campusId,
        provinceCode,
        wardCode,
        isGraduating: Boolean(isGraduating),
        verified: false,
        rating: 5.0,
        completedDealsCount: 0,
        activeListingsCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      message: "Hồ sơ xác minh đã được tiếp nhận và đưa vào hàng đợi duyệt.",
    });
  } catch (err) {
    console.error("Lỗi gửi hồ sơ xác minh:", err);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi nội bộ máy chủ khi gửi hồ sơ" },
      { status: 500 }
    );
  }
}
