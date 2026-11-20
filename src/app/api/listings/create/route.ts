import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireApprovedStudent } from "@/lib/auth/server";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { createListingSchema } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { normalizeVi, buildSearchTokens } from "@/lib/search/normalize";
import { containsContactInfo } from "@/lib/utils/contact-filter";
import { toPublicListingDTO } from "@/lib/services/listings";
import { MAX_ACTIVE_LISTINGS_PER_SELLER } from "@/lib/constants/listing";
import universitiesData from "@/data/universities_vietnam.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực sinh viên đã duyệt thẻ (Nguồn sự thật: Firestore)
  const { token, verification, userDoc } = await requireApprovedStudent(req);
  const sellerId = token.uid;

  // 2. Đọc và xác thực dữ liệu gửi lên (hỗ trợ tối đa 2MB cho tin đăng có ảnh WebP dự phòng)
  const body = await readJson(req, 2 * 1024 * 1024);
  const data = createListingSchema.parse(body);

  // 3. Xử lý Idempotency (Loại bỏ key chứa '/')
  const rawKey =
    req.headers.get("idempotency-key") ||
    data.clientRequestId ||
    data.draftId ||
    "";
  const idempotencyKey = /^[A-Za-z0-9_-]{8,100}$/.test(rawKey) ? rawKey : "";
  const idemRef = idempotencyKey
    ? adminDb.collection("idempotency").doc(`${sellerId}_${idempotencyKey}`)
    : null;

  if (idemRef) {
    const s = await idemRef.get();
    if (s.exists) {
      return NextResponse.json(s.data()?.responseBody || { success: true }, {
        status: 200,
      });
    }
  }

  // 4. Rate limiting: SAU validation và idempotency để không đốt quota vô ích
  await consumeRateLimit({
    scope: "create_listing",
    key: sellerId,
    limit: 5,
    windowSec: 3600,
    customMessage:
      "Bạn đã đăng 5 tin trong vòng 1 giờ. Vui lòng quay lại sau để đăng thêm.",
  });

  // 5. Chặn số điện thoại, Zalo, link mạng xã hội trong các trường văn bản công khai
  const publicTextFields = [
    data.title,
    data.description,
    data.defects,
    data.brandModel,
    data.usageTime,
    data.publicMeetingPoint,
    data.shippingMethods.shipFeeNote,
  ];

  for (const text of publicTextFields) {
    if (text && containsContactInfo(text)) {
      throw new ApiError(
        400,
        "CONTACT_INFO_IN_PUBLIC_TEXT",
        "Nội dung không được chứa số điện thoại, Zalo hoặc liên kết. Thông tin liên hệ sẽ hiện cho người mua đã xác minh."
      );
    }
  }

  // 6. Kiểm tra tính hợp lệ của ảnh (chỉ nhận URL Storage của chính người bán)
  const BUCKET =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    "";
  function isOwnListingImage(url: string, uid: string): boolean {
    if (url.startsWith("data:image/")) return true;
    try {
      const u = new URL(url);
      if (
        u.protocol !== "https:" ||
        u.hostname !== "firebasestorage.googleapis.com"
      )
        return false;
      const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(u.pathname);
      if (!m || (BUCKET && m[1] !== BUCKET)) return false;
      const objectPath = decodeURIComponent(m[2]);
      return new RegExp(
        `^public/listings/${uid}/[A-Za-z0-9_-]{8,64}/[A-Za-z0-9_-]{4,64}\\.(webp|jpg)$`
      ).test(objectPath);
    } catch {
      return false;
    }
  }

  for (const imgUrl of [...data.images, ...(data.thumbs ?? [])]) {
    if (!isOwnListingImage(imgUrl, sellerId)) {
      throw new ApiError(
        400,
        "INVALID_IMAGE_URL",
        "Ảnh phải được tải lên qua hệ thống của Chợ Pass."
      );
    }
  }

  // Loại bỏ ảnh trùng lặp
  const uniqueImages = Array.from(new Set(data.images));
  if (uniqueImages.length < 1) {
    throw new ApiError(
      400,
      "MIN_IMAGES_REQUIRED",
      "Tin đăng phải có tối thiểu 1 ảnh thực tế."
    );
  }

  // 7. Trường học và địa phương ép buộc từ hồ sơ đã duyệt ở server
  const verifiedSchoolCode =
    (verification.schoolCode as string) ||
    (userDoc.schoolCode as string) ||
    data.schoolCode ||
    "";

  const matchedSchool = (
    universitiesData as Array<{
      code: string;
      name: string;
      provinceCode: string;
      wardCode: string;
      campuses: Array<{ id: string; name: string }>;
    }>
  ).find((u) => u.code === verifiedSchoolCode);

  const schoolCode = verifiedSchoolCode;
  const schoolName =
    matchedSchool?.name || (verification.schoolName as string) || "";
  const provinceCode = matchedSchool?.provinceCode || data.provinceCode || "";
  const wardCode = matchedSchool?.wardCode || data.wardCode || "";
  const campusId = data.campusId || matchedSchool?.campuses[0]?.id || "c1";
  const campusName =
    matchedSchool?.campuses.find((c) => c.id === campusId)?.name || "";

  // 8. ID xác định theo (seller, draft) -> không ai squat được draftId của người khác
  const listingId = data.draftId
    ? `${sellerId}_${data.draftId}`
    : `l_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const listingRef = adminDb.collection("listings").doc(listingId);
  const listingPrivateRef = adminDb.collection("listingsPrivate").doc(listingId);

  const titleNormalized = normalizeVi(data.title);
  const searchTokens = buildSearchTokens(data.title, [
    data.brandModel,
    data.subcategory,
  ]);

  // 9. Thực thi Transaction nguyên tử
  const result = await adminDb.runTransaction(async (transaction) => {
    // ===== READ PHASE =====
    if (idemRef) {
      const txIdemSnap = await transaction.get(idemRef);
      if (txIdemSnap.exists) {
        return txIdemSnap.data()?.responseBody;
      }
    }

    const existingSnap = await transaction.get(listingRef);
    if (existingSnap.exists) {
      throw new ApiError(
        409,
        "LISTING_EXISTS",
        "Mã tin đăng này đã tồn tại trên hệ thống."
      );
    }

    const activeQuery = adminDb
      .collection("listings")
      .where("sellerId", "==", sellerId)
      .where("status", "in", ["active", "reserved"]);

    const activeListingsSnap = await transaction.get(activeQuery);
    if (activeListingsSnap.size >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
      throw new ApiError(
        429,
        "MAX_SLOTS_REACHED",
        `Bạn đang có ${activeListingsSnap.size} tin đang hoạt động. Mỗi tài khoản chỉ được mở tối đa ${MAX_ACTIVE_LISTINGS_PER_SELLER} tin cùng lúc.`
      );
    }

    // ===== WRITE PHASE =====
    for (const doc of activeListingsSnap.docs) {
      const activeData = doc.data();
      const existingTitleNorm = normalizeVi(activeData.title as string);

      const isExactDuplicate = existingTitleNorm === titleNormalized;
      const isSubDuplicate =
        titleNormalized.length >= 15 &&
        (existingTitleNorm.includes(titleNormalized) ||
          titleNormalized.includes(existingTitleNorm));

      if (isExactDuplicate || isSubDuplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_TITLE",
          "Bạn đã có một tin đăng tương tự đang hoạt động. Vui lòng không đăng tin trùng lặp."
        );
      }
    }

    const coverImage = uniqueImages[0];
    const thumbs =
      data.thumbs && data.thumbs.length > 0 ? data.thumbs : undefined;
    const coverThumb = thumbs?.[0] || coverImage;

    const publicListingData: Record<string, unknown> = {
      id: listingId,
      sellerId,
      title: data.title,
      titleNormalized,
      searchTokens,
      categoryId: data.categoryId,
      subcategory: data.subcategory || null,
      condition: data.condition,
      brandModel: data.brandModel || null,
      usageTime: data.usageTime || null,
      defects: data.defects || null,
      noDefects: Boolean(data.noDefects),
      description: data.description || "",
      price: data.price,
      originalPrice: data.originalPrice || null,
      negotiationType: data.negotiationType,
      urgentPass: Boolean(data.urgentPass),
      passDeadline: data.passDeadline,
      schoolCode,
      schoolName,
      campusId,
      campusName,
      provinceCode,
      wardCode,
      publicMeetingPoint: data.publicMeetingPoint,
      shippingMethods: data.shippingMethods,
      itemDimensions: data.itemDimensions || null,
      images: uniqueImages,
      thumbs: thumbs || null,
      coverImage,
      coverThumb,
      status: "active",
      viewsCount: 0,
      favoritesCount: 0,
      chatsCount: 0,
      clientRequestId: idempotencyKey || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const privateListingData = {
      listingId,
      sellerId,
      exactAddress: data.exactAddress || "",
      detailedSchedule: data.detailedSchedule || "",
      confirmedBuyerId: null,
      createdAt: FieldValue.serverTimestamp(),
    };

    transaction.set(listingRef, publicListingData);
    transaction.set(listingPrivateRef, privateListingData);

    const dto = toPublicListingDTO(publicListingData, listingId);
    const responsePayload = {
      success: true,
      listingId,
      listing: dto,
    };

    if (idemRef) {
      transaction.set(idemRef, {
        responseBody: responsePayload,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });
    }

    return responsePayload;
  });

  return NextResponse.json(result, { status: 200 });
});
