import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireActiveUser } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { submitVerificationSchema } from "@/lib/server/schemas";
import { adminDb, computeStudentIdHash, FieldValue, hasAdminCredentials } from "@/lib/firebase/admin";
import {
  deleteStorageObject,
  getStorageObjectMetadata,
} from "@/lib/server/storage-provider";
import { isStudentEmail } from "@/lib/auth/student-email";
import { validateDisplayName } from "@/lib/utils/contact-filter";
import { redactErrorMessage } from "@/lib/server/request-utils";
import universitiesData from "@/data/universities_vietnam.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực tài khoản đăng nhập đang active
  const auth = await requireActiveUser(req);
  const userId = auth.uid;
  const userEmail = auth.email || "";

  // 2. Chặn ngay nếu máy chủ chưa cấu hình Service Account (P0-4)
  if (!hasAdminCredentials) {
    if (process.env.NODE_ENV !== "production" && process.env.ALLOW_MOCK_VERIFICATION === "1") {
      return NextResponse.json({
        success: true,
        mock: true,
        status: "pending",
        message: "[DEV] Chế độ giả lập: hồ sơ KHÔNG được lưu vào Firestore.",
      });
    }
    throw new ApiError(
      503,
      "ADMIN_SDK_NOT_CONFIGURED",
      "Hệ thống tạm thời chưa nhận được hồ sơ. Vui lòng thử lại sau ít phút."
    );
  }

  // 3. Đọc dữ liệu gửi lên (hỗ trợ tối đa 1MB cho payload ảnh WebP Base64 dự phòng)
  const body = await readJson(req, 1024 * 1024);
  const data = submitVerificationSchema.parse(body);

  // 3b. Kiểm tra tên hiển thị: cấm SĐT/Zalo/Link và cấm giả mạo Ban Quản Trị
  const nameValidation = validateDisplayName(data.displayName);
  if (!nameValidation.valid) {
    throw new ApiError(400, "INVALID_DISPLAY_NAME", nameValidation.error!);
  }

  // 4. Kiểm tra đường dẫn ảnh thẻ (Bắt buộc Cloud Storage private/cards/{userId}/...)
  const CARD_PATH_RE = new RegExp(`^private/cards/${userId}/[A-Za-z0-9_-]{4,64}\\.(webp|jpg)$`);
  if (!CARD_PATH_RE.test(data.cardStoragePath)) {
    throw new ApiError(400, "INVALID_CARD_PATH", "Tệp ảnh thẻ sinh viên không hợp lệ hoặc không thuộc tài khoản của bạn.");
  }
  try {
    const meta = await getStorageObjectMetadata(data.cardStoragePath);
    if (!meta.exists) {
      throw new ApiError(400, "CARD_FILE_NOT_FOUND", "Không tìm thấy tệp ảnh thẻ trên hệ thống lưu trữ. Vui lòng tải lại ảnh.");
    }
    if (!/^image\/(webp|jpeg)$/.test(meta.contentType) || meta.sizeBytes > 10 * 1024 * 1024) {
      throw new ApiError(400, "INVALID_CARD_FILE", "Ảnh thẻ phải là WebP/JPEG dưới 10MB.");
    }
  } catch (storageErr) {
    if (storageErr instanceof ApiError) throw storageErr;
    console.error("Lỗi kiểm tra tệp thẻ trên Storage:", storageErr);
    throw new ApiError(503, "STORAGE_UNAVAILABLE", "Không thể xác minh tệp thẻ trên hệ thống lưu trữ. Vui lòng thử lại sau.");
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

  // 6. Chặn nhanh trước khi tiêu thụ lượt rate-limit (P2-1)
  const existing = await adminDb.collection("verifications").doc(userId).get();
  const st = existing.exists ? existing.data()?.status : null;
  if (st === "approved") {
    throw new ApiError(400, "ALREADY_VERIFIED", "Tài khoản của bạn đã được xác minh thẻ sinh viên thành công trước đó.");
  }
  if (st === "pending") {
    throw new ApiError(400, "VERIFICATION_PENDING", "Hồ sơ của bạn đang được xét duyệt. Vui lòng chờ phản hồi từ Ban Quản Trị.");
  }

  // 7. Giới hạn tần suất: Tối đa 3 lần nộp hồ sơ / ngày (chỉ trừ lượt sau khi payload hợp lệ)
  await consumeRateLimit({
    scope: "submit_verification",
    key: userId,
    limit: 3,
    windowSec: 24 * 3600,
    customMessage: "Bạn đã nộp hồ sơ 3 lần trong hôm nay. Vui lòng đợi Ban Quản Trị xét duyệt.",
  });

  // 8. Tính mã băm HMAC-SHA256 & tham chiếu
  const verifRef = adminDb.collection("verifications").doc(userId);
  const studentIdHash = computeStudentIdHash(data.schoolCode, data.studentId);
  const hashLockRef = adminDb.collection("studentIdHashes").doc(studentIdHash);
  const cardFileName = data.cardStoragePath.split("/").pop() || "";
  const uploadSessionId = cardFileName.replace(/\.(webp|jpg)$/, "");
  const uploadSessionRef = /^[A-Za-z0-9_-]{8,64}$/.test(uploadSessionId)
    ? adminDb.collection("uploadSessions").doc(uploadSessionId)
    : null;

  // 9. Transaction: Kiểm tra trạng thái và trùng thẻ sinh viên, lưu hồ sơ pending
  let previousCardPathToDelete: string | null = null;
  await adminDb.runTransaction(async (transaction) => {
    // Đọc trạng thái hiện tại TRONG transaction để chống nộp song song
    const [currentVerif, hashDoc, sessionSnap] = await Promise.all([
      transaction.get(verifRef),
      transaction.get(hashLockRef),
      uploadSessionRef ? transaction.get(uploadSessionRef) : Promise.resolve(null),
    ]);
    if (currentVerif.exists) {
      const curData = currentVerif.data() || {};
      const status = curData.status;
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
      const prevPath =
        typeof curData.cardStoragePath === "string"
          ? curData.cardStoragePath
          : typeof curData.cardImagePath === "string"
          ? curData.cardImagePath
          : null;
      if (prevPath && !curData.cardDeleted && prevPath !== data.cardStoragePath && !prevPath.startsWith("data:")) {
        previousCardPathToDelete = prevPath;
      }
    }

    // Chỉ đọc hashDoc để kiểm tra xem MSSV đã được duyệt cho ai khác chưa (F09)
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
      cardDeleted: false,
      rejectReason: null,
      rejectNote: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Lưu vào users & usersPrivate: chỉ ghi displayName và địa phương, trường học chỉ ghi khi Admin duyệt chính thức
    const userRef = adminDb.collection("users").doc(userId);
    transaction.set(
      userRef,
      {
        displayName: data.displayName,
        provinceCode: data.provinceCode || null,
        wardCode: data.wardCode || null,
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

    if (
      uploadSessionRef &&
      sessionSnap?.exists &&
      sessionSnap.data()?.ownerUid === userId &&
      sessionSnap.data()?.kind === "card"
    ) {
      transaction.update(uploadSessionRef, {
        claimed: true,
        status: "claimed",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  // Dọn tệp ảnh thẻ cũ khi sinh viên nộp lại hồ sơ sau khi bị từ chối/hết hạn
  if (previousCardPathToDelete) {
    const oldPath: string = previousCardPathToDelete;
    try {
      await deleteStorageObject(oldPath);
    } catch (cleanErr) {
      const digest = crypto.createHash("sha256").update(oldPath).digest("hex").slice(0, 24);
      const jobId = `oldcard_${userId}_${digest}`;
      await adminDb
        .collection("storageCleanupJobs")
        .doc(jobId)
        .set(
          {
            jobId,
            kind: "object",
            targetPath: oldPath,
            ownerUid: userId,
            reason: "verification_resubmit_cleanup",
            status: "pending",
            attempts: 0,
            deadLetter: false,
            lastError: redactErrorMessage(cleanErr),
            nextAttemptAt: new Date(Date.now() + 2 * 60 * 1000),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
        .catch(() => undefined);
    }
  }

  return NextResponse.json(
    {
      success: true,
      message: "Hồ sơ xác minh đã được gửi thành công và đang chờ Ban Quản Trị duyệt!",
    },
    { status: 200 }
  );
});
