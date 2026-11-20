import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { submitVerificationSchema } from "@/lib/server/schemas";
import { adminDb, adminStorage, computeStudentIdHash, FieldValue, hasAdminCredentials } from "@/lib/firebase/admin";
import { isStudentEmail } from "@/lib/auth/student-email";
import universitiesData from "@/data/universities_vietnam.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực tài khoản đăng nhập
  const auth = await requireAuth(req);
  const userId = auth.uid;
  const userEmail = auth.email || "";

  // 2. Giới hạn tần suất: Tối đa 3 lần nộp hồ sơ / ngày
  await consumeRateLimit({
    scope: "submit_verification",
    key: userId,
    limit: 3,
    windowSec: 24 * 3600,
    customMessage: "Bạn đã nộp hồ sơ 3 lần trong hôm nay. Vui lòng đợi Ban Quản Trị xét duyệt.",
  });

  // 3. Đọc dữ liệu gửi lên (hỗ trợ tối đa 1MB cho payload ảnh WebP Base64 dự phòng)
  const body = await readJson(req, 1024 * 1024);
  const data = submitVerificationSchema.parse(body);

  // 4. Kiểm tra đường dẫn ảnh thẻ (hỗ trợ cả Firebase Storage và Base64 WebP dự phòng)
  const isDataUrl = data.cardStoragePath.startsWith("data:image/");
  if (isDataUrl) {
    if (!/^data:image\/(webp|jpeg|png);base64,/.test(data.cardStoragePath)) {
      throw new ApiError(400, "INVALID_CARD_FILE", "Ảnh thẻ phải có định dạng WebP hoặc JPEG.");
    }
    if (data.cardStoragePath.length > 500 * 1024) {
      throw new ApiError(400, "INVALID_CARD_FILE", "Dung lượng ảnh thẻ vượt quá giới hạn 500KB.");
    }
  } else {
    const CARD_PATH_RE = new RegExp(`^private/cards/${userId}/[A-Za-z0-9_-]{4,64}\\.(webp|jpg)$`);
    if (!CARD_PATH_RE.test(data.cardStoragePath)) {
      throw new ApiError(400, "INVALID_CARD_PATH", "Tệp ảnh thẻ sinh viên không hợp lệ hoặc không thuộc tài khoản của bạn.");
    }
    if (hasAdminCredentials) {
      try {
        const cardFile = adminStorage.bucket().file(data.cardStoragePath);
        const [cardExists] = await cardFile.exists();
        if (!cardExists) {
          throw new ApiError(400, "CARD_FILE_NOT_FOUND", "Không tìm thấy tệp ảnh thẻ trên hệ thống lưu trữ. Vui lòng tải lại ảnh.");
        }
        const [meta] = await cardFile.getMetadata();
        if (!/^image\/(webp|jpeg)$/.test(String(meta.contentType)) || Number(meta.size) > 10 * 1024 * 1024) {
          throw new ApiError(400, "INVALID_CARD_FILE", "Ảnh thẻ phải là WebP/JPEG dưới 10MB.");
        }
      } catch (storageErr) {
        if (storageErr instanceof ApiError) throw storageErr;
        console.warn("Bỏ qua kiểm tra bucket do hệ thống chưa cấu hình đầy đủ credentials:", storageErr);
      }
    }
  }

  // 5. Kiểm tra trường học và campus
  const matchedSchool = (universitiesData as Array<{
    code: string;
    name: string;
    campuses: Array<{ id: string; name: string }>;
  }>).find((u) => u.code === data.schoolCode);

  if (!matchedSchool) {
    throw new ApiError(400, "INVALID_SCHOOL", "Trường đại học không tồn tại trong hệ thống.");
  }

  if (data.campusId) {
    const validCampus = matchedSchool.campuses.some((c) => c.id === data.campusId);
    if (!validCampus) {
      throw new ApiError(400, "INVALID_CAMPUS", "Cơ sở trường không hợp lệ.");
    }
  }

  // 6. Nếu hệ thống chưa cấu hình Service Account, phản hồi thành công chế độ chờ
  if (!hasAdminCredentials) {
    return NextResponse.json({
      success: true,
      status: "pending",
      message: "Hồ sơ của bạn đã được tiếp nhận thành công và đang chờ ban quản trị xét duyệt.",
    });
  }

  // 7. Tính mã băm HMAC-SHA256 & tham chiếu
  const verifRef = adminDb.collection("verifications").doc(userId);
  const studentIdHash = computeStudentIdHash(data.schoolCode, data.studentId);
  const hashLockRef = adminDb.collection("studentIdHashes").doc(studentIdHash);

  // 8. Transaction: Kiểm tra trạng thái và trùng thẻ sinh viên, lưu hồ sơ pending
  await adminDb.runTransaction(async (transaction) => {
    // Đọc trạng thái hiện tại TRONG transaction để chống nộp song song
    const currentVerif = await transaction.get(verifRef);
    if (currentVerif.exists) {
      const status = currentVerif.data()?.status;
      if (status === "approved") {
        throw new ApiError(
          400,
          "ALREADY_VERIFIED",
          "Tài khoản của bạn đã được xác minh thẻ sinh viên thành công trước đó."
        );
      }
      if (status === "pending") {
        throw new ApiError(
          400,
          "VERIFICATION_PENDING",
          "Hồ sơ của bạn đang được xét duyệt. Vui lòng chờ phản hồi từ Ban Quản Trị."
        );
      }
    }

    // Chỉ đọc hashDoc để kiểm tra xem MSSV đã được duyệt cho ai khác chưa (F09)
    const hashDoc = await transaction.get(hashLockRef);
    if (hashDoc.exists) {
      const existingOwner = hashDoc.data()?.userId;
      if (existingOwner && existingOwner !== userId) {
        throw new ApiError(
          409,
          "STUDENT_ID_CONFLICT",
          "Thông tin thẻ sinh viên này không thể dùng để xác minh. Vui lòng liên hệ hỗ trợ."
        );
      }
    }

    const { isValid: isEduEmail } = isStudentEmail({
      email: userEmail,
      emailVerified: auth.token.email_verified,
    });

    // Lưu hồ sơ xác minh (Private) - KHÔNG set hashLockRef ở đây (chuyển sang khi Admin duyệt)
    transaction.set(verifRef, {
      userId,
      userEmail,
      realName: data.realName,
      displayName: data.displayName,
      schoolCode: data.schoolCode,
      schoolName: matchedSchool.name,
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

    // Lưu vào users & usersPrivate
    const userRef = adminDb.collection("users").doc(userId);
    transaction.set(
      userRef,
      {
        displayName: data.displayName,
        schoolCode: data.schoolCode,
        schoolName: matchedSchool.name,
        campusId: data.campusId || null,
        provinceCode: data.provinceCode || null,
        wardCode: data.wardCode || null,
        isGraduating: Boolean(data.isGraduating),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const userPrivateRef = adminDb.collection("usersPrivate").doc(userId);
    transaction.set(
      userPrivateRef,
      {
        realName: data.realName,
        zaloPhone: data.zaloPhone,
        altPhone: data.altPhone || null,
        schoolCode: data.schoolCode,
        campusId: data.campusId || null,
        dormOrAddress: data.dormOrAddress || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return NextResponse.json(
    {
      success: true,
      message: "Hồ sơ xác minh đã được gửi thành công và đang chờ Ban Quản Trị duyệt!",
    },
    { status: 200 }
  );
});
