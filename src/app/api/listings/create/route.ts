import "server-only";
import { NextRequest, NextResponse } from "next/server";
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

  // 2. Rate limiting: Tối đa 5 tin/giờ/uid
  await consumeRateLimit({
    scope: "create_listing",
    key: sellerId,
    limit: 5,
    windowSec: 3600,
    customMessage: "Bạn đã đăng 5 tin trong vòng 1 giờ. Vui lòng quay lại sau để đăng thêm.",
  });

  // 3. Đọc dữ liệu gửi lên
  const body = await readJson(req, 64 * 1024);
  const data = createListingSchema.parse(body);

  // Xử lý Idempotency
  const idempotencyKey =
    req.headers.get("idempotency-key") ||
    data.clientRequestId ||
    data.draftId;

  if (idempotencyKey) {
    const idemRef = adminDb.collection("idempotency").doc(`${sellerId}_${idempotencyKey}`);
    const idemSnap = await idemRef.get();
    if (idemSnap.exists) {
      const savedData = idemSnap.data();
      return NextResponse.json(savedData?.responseBody || { success: true }, { status: 200 });
    }
  }

  // 4. Chặn số điện thoại, Zalo, link mạng xã hội trong các trường văn bản công khai
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

  // 5. Kiểm tra tính hợp lệ của ảnh
  // Tối thiểu 3 ảnh, không chấp nhận data: base64
  for (const imgUrl of data.images) {
    if (imgUrl.startsWith("data:") || imgUrl.length > 2000) {
      throw new ApiError(
        400,
        "INVALID_IMAGE_URL",
        "Ảnh phải được tải lên hệ thống lưu trữ Cloud Storage trước khi đăng tin. Không chấp nhận ảnh dạng base64."
      );
    }

    // Đảm bảo ảnh thuộc thư mục public/listings/{sellerId}/
    const hasValidUidPath =
      imgUrl.includes(`public/listings/${sellerId}/`) ||
      imgUrl.includes(`public%2Flistings%2F${sellerId}%2F`);

    if (!hasValidUidPath) {
      throw new ApiError(
        400,
        "INVALID_IMAGE_OWNER",
        "Đường dẫn tệp ảnh không hợp lệ hoặc không thuộc tài khoản của bạn."
      );
    }
  }

  // Loại bỏ ảnh trùng lặp
  const uniqueImages = Array.from(new Set(data.images));
  if (uniqueImages.length < 3) {
    throw new ApiError(400, "MIN_IMAGES_REQUIRED", "Tin đăng phải có tối thiểu 3 ảnh thực tế khác nhau.");
  }

  // 6. Trường học và địa phương ép buộc từ hồ sơ đã duyệt ở server
  const verifiedSchoolCode =
    (verification.schoolCode as string) ||
    (userDoc.schoolCode as string) ||
    data.schoolCode ||
    "";

  const matchedSchool = (universitiesData as Array<{
    code: string;
    name: string;
    provinceCode: string;
    wardCode: string;
    campuses: Array<{ id: string; name: string }>;
  }>).find((u) => u.code === verifiedSchoolCode);

  const schoolCode = verifiedSchoolCode;
  const schoolName = matchedSchool?.name || (verification.schoolName as string) || "";
  const provinceCode = matchedSchool?.provinceCode || data.provinceCode || "";
  const wardCode = matchedSchool?.wardCode || data.wardCode || "";
  const campusId = data.campusId || matchedSchool?.campuses[0]?.id || "c1";
  const campusName = matchedSchool?.campuses.find((c) => c.id === campusId)?.name || "";

  // Sinh ID tin đăng
  const listingId = data.draftId || `l_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const listingRef = adminDb.collection("listings").doc(listingId);
  const listingPrivateRef = adminDb.collection("listingsPrivate").doc(listingId);

  const titleNormalized = normalizeVi(data.title);
  const searchTokens = buildSearchTokens(data.title, [data.brandModel, data.subcategory]);

  // 7. Thực thi Transaction nguyên tử
  const createdListingDTO = await adminDb.runTransaction(async (transaction) => {
    // A. Kiểm tra trùng ID
    const existingSnap = await transaction.get(listingRef);
    if (existingSnap.exists) {
      throw new ApiError(409, "LISTING_EXISTS", "Mã tin đăng này đã tồn tại trên hệ thống.");
    }

    // B. Kiểm tra giới hạn 10 slot (status in ["active", "reserved"])
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

    // C. Kiểm tra trùng tiêu đề với tin đang bán của cùng người bán
    for (const doc of activeListingsSnap.docs) {
      const activeData = doc.data();
      const existingTitleNorm = normalizeVi(activeData.title as string);

      const isExactDuplicate = existingTitleNorm === titleNormalized;
      const isSubDuplicate =
        titleNormalized.length >= 15 &&
        (existingTitleNorm.includes(titleNormalized) || titleNormalized.includes(existingTitleNorm));

      if (isExactDuplicate || isSubDuplicate) {
        throw new ApiError(
          409,
          "DUPLICATE_TITLE",
          "Bạn đã có một tin đăng tương tự đang hoạt động. Vui lòng không đăng tin trùng lặp."
        );
      }
    }

    // D. Dữ liệu công khai
    const coverImage = uniqueImages[0];
    const thumbs = data.thumbs && data.thumbs.length > 0 ? data.thumbs : undefined;
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

    // E. Dữ liệu riêng tư
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

    return toPublicListingDTO(publicListingData, listingId);
  });

  // Lưu Idempotency cache nếu có key
  if (idempotencyKey) {
    await adminDb.collection("idempotency").doc(`${sellerId}_${idempotencyKey}`).set({
      responseBody: {
        success: true,
        listingId,
        listing: createdListingDTO,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return NextResponse.json(
    {
      success: true,
      listingId,
      listing: createdListingDTO,
    },
    { status: 200 }
  );
});
