import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { adminDb, computeStudentIdHash, FieldValue } from "@/lib/firebase/admin";
import { z } from "zod";

const submitVerificationSchema = z.object({
  realName: z.string().min(2, "Họ và tên phải từ 2 ký tự trở lên"),
  displayName: z.string().min(2, "Tên hiển thị phải từ 2 ký tự trở lên"),
  schoolCode: z.string().min(1, "Vui lòng chọn trường học"),
  campusId: z.string().optional(),
  faculty: z.string().optional(),
  studentClass: z.string().optional(),
  studentId: z.string().min(4, "Mã số sinh viên không hợp lệ"),
  zaloPhone: z.string().regex(/^(0|\+84)[3|5|7|8|9][0-9]{8}$/, "Số điện thoại Zalo không hợp lệ"),
  altPhone: z.string().optional(),
  provinceCode: z.string().optional(),
  wardCode: z.string().optional(),
  dormOrAddress: z.string().optional(),
  isGraduating: z.boolean().optional(),
  cardStoragePath: z.string().min(1, "Thiếu đường dẫn tệp ảnh thẻ"),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireUser(req);
    const userId = token.uid;
    const userEmail = token.email || "";

    const body = await req.json();
    const parsed = submitVerificationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // 1. Kiểm tra trạng thái hiện tại: Chặn nộp lại nếu đang 'pending' hoặc đã 'approved'
    const verificationRef = adminDb.collection("verifications").doc(userId);
    const existingVerifSnap = await verificationRef.get();

    if (existingVerifSnap.exists) {
      const currentStatus = existingVerifSnap.data()?.status;
      if (currentStatus === "approved") {
        return NextResponse.json(
          { error: "Tài khoản của bạn đã được xác minh thẻ sinh viên thành công trước đó." },
          { status: 400 }
        );
      }
      if (currentStatus === "pending") {
        return NextResponse.json(
          { error: "Hồ sơ của bạn đang được xét duyệt. Vui lòng chờ phản hồi từ Ban Quản Trị." },
          { status: 400 }
        );
      }
    }

    // 2. Tính mã băm HMAC-SHA256 kết hợp mã trường và MSSV
    const studentIdHash = computeStudentIdHash(data.schoolCode, data.studentId);

    // 3. Chống đăng ký trùng thẻ: kiểm tra mã băm trong Firestore
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

    // 4. Kiểm tra email trường (.edu.vn) VÀ email đã được verify bởi Google
    const isEduEmail = Boolean(
      token.email_verified &&
      userEmail.toLowerCase().endsWith(".edu.vn")
    );

    // 5. Lưu vào collection verifications (Chỉ lưu đường dẫn Storage, tuyệt đối không lưu base64)
    await verificationRef.set({
      userId,
      userEmail,
      realName: data.realName,
      schoolCode: data.schoolCode,
      campusId: data.campusId || null,
      faculty: data.faculty || null,
      studentClass: data.studentClass || null,
      studentIdLast4: data.studentId.trim().slice(-4),
      studentIdHash,
      status: "pending",
      isEduEmail,
      isGraduating: Boolean(data.isGraduating),
      cardStoragePath: data.cardStoragePath,
      rejectReason: null,
      rejectNote: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 6. Lưu vào collection usersPrivate (chỉ chủ tài khoản và admin đọc được)
    await adminDb.collection("usersPrivate").doc(userId).set(
      {
        realName: data.realName,
        zaloPhone: data.zaloPhone,
        altPhone: data.altPhone || null,
        email: userEmail,
        provinceCode: data.provinceCode || null,
        wardCode: data.wardCode || null,
        dormOrAddress: data.dormOrAddress || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // 7. Cập nhật hồ sơ công khai trong collection users
    await adminDb.collection("users").doc(userId).set(
      {
        displayName: data.displayName,
        schoolCode: data.schoolCode,
        campusId: data.campusId || null,
        provinceCode: data.provinceCode || null,
        wardCode: data.wardCode || null,
        isGraduating: Boolean(data.isGraduating),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      message: "Hồ sơ xác minh đã được gửi duyệt thành công.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
