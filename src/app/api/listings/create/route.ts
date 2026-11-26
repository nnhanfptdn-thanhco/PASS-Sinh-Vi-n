import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireApprovedStudent } from "@/lib/server/auth-guard";
import { readJson, withApi, ApiError } from "@/lib/server/http";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { createListingSchema } from "@/lib/server/schemas";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { isAllowedCloudinaryPublicUrl } from "@/lib/server/storage-provider";
import { normalizeVi, buildSearchTokens } from "@/lib/search/normalize";
import { containsContactInfo } from "@/lib/utils/contact-filter";
import { toPublicListingDTO } from "@/lib/services/listings";
import { sellerListingStatsRef, sellerTitleLockRef } from "@/lib/server/stats";
import { MAX_ACTIVE_LISTINGS_PER_SELLER } from "@/lib/constants/listing";
import universitiesData from "@/data/universities_vietnam.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi(async (req: NextRequest) => {
  // 1. Xác thực sinh viên đã duyệt thẻ (Canonical guard + live Firestore)
  const { token, verification, userDoc } = await requireApprovedStudent(req);
  const sellerId = token.uid;

  // 2. Đọc và xác thực dữ liệu gửi lên
  const body = await readJson(req, 2 * 1024 * 1024);
  const data = createListingSchema.parse(body);

  // 3. Xử lý Idempotency
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

  // 4. Rate limiting: SAU validation và idempotency
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
    data.subcategory,
    data.condition,
    data.description,
    data.defects,
    data.brandModel,
    data.usageTime,
    data.publicMeetingPoint,
    data.shippingMethods.shipFeeNote,
    data.itemDimensions?.dimensions,
    data.itemDimensions?.weight !== undefined ? String(data.itemDimensions.weight) : undefined,
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

  const combinedPublicText = publicTextFields.filter(Boolean).join(" | ");
  if (containsContactInfo(combinedPublicText)) {
    throw new ApiError(
      400,
      "CONTACT_INFO_IN_PUBLIC_TEXT",
      "Phát hiện thông tin liên hệ được chia nhỏ giữa các trường thông tin. Vui lòng xóa trước khi đăng."
    );
  }

  // 6. Kiểm tra tính hợp lệ của ảnh (chỉ nhận URL/đường dẫn Storage của chính người bán, chặn hoàn toàn data:image/)
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    "cho-pass-sv";
  const ALLOWED_BUCKETS = new Set(
    [
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      process.env.FIREBASE_STORAGE_BUCKET,
      `${projectId}.firebasestorage.app`,
      `${projectId}.appspot.com`,
    ].filter((b): b is string => Boolean(b && b.trim()))
  );
  function isOwnListingImage(url: string, uid: string): boolean {
    if (!url || typeof url !== "string") return false;
    if (url.startsWith("data:image/")) return false;

    const expectedObjRe = new RegExp(
      `^public/listings/${uid}/[A-Za-z0-9_-]{4,64}/[A-Za-z0-9_-]{4,64}\\.(webp|jpg)$`
    );

    if (url.startsWith(`public/listings/${uid}/`)) {
      return expectedObjRe.test(url);
    }

    if (isAllowedCloudinaryPublicUrl(url, expectedObjRe)) {
      return true;
    }

    try {
      const u = new URL(url);
      if (u.protocol !== "https:" || u.hostname !== "firebasestorage.googleapis.com") {
        return false;
      }
      const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(u.pathname);
      if (!m || (ALLOWED_BUCKETS.size > 0 && !ALLOWED_BUCKETS.has(m[1]))) return false;
      const objectPath = decodeURIComponent(m[2]);
      return expectedObjRe.test(objectPath);
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
    (userDoc?.schoolCode as string) ||
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
  const statsRef = sellerListingStatsRef(sellerId);

  const titleNormalized = normalizeVi(data.title);
  const searchTokens = buildSearchTokens(data.title, [
    data.brandModel,
    data.subcategory,
  ]);
  const titleLockRef = sellerTitleLockRef(sellerId, titleNormalized);
  const uploadSessionRef = data.draftId
    ? adminDb.collection("uploadSessions").doc(data.draftId)
    : null;

  // 9. Thực thi Transaction nguyên tử + aggregate counter lock
  const result = await adminDb.runTransaction(async (transaction) => {
    // ===== READ PHASE =====
    const [txIdemSnap, existingSnap, statsSnap, titleLockSnap, activeListingsSnap, sessionSnap] =
      await Promise.all([
        idemRef ? transaction.get(idemRef) : Promise.resolve(null),
        transaction.get(listingRef),
        transaction.get(statsRef),
        transaction.get(titleLockRef),
        transaction.get(
          adminDb
            .collection("listings")
            .where("sellerId", "==", sellerId)
            .where("status", "in", ["active", "reserved"])
        ),
        uploadSessionRef ? transaction.get(uploadSessionRef) : Promise.resolve(null),
      ]);

    if (txIdemSnap && txIdemSnap.exists) {
      return txIdemSnap.data()?.responseBody;
    }

    if (existingSnap.exists) {
      throw new ApiError(
        409,
        "LISTING_EXISTS",
        "Mã tin đăng này đã tồn tại trên hệ thống."
      );
    }

    const storedActiveCount = statsSnap.exists ? Math.max(0, Number(statsSnap.data()?.activeCount ?? 0)) : 0;
    const currentActiveCount = Math.max(storedActiveCount, activeListingsSnap.size);

    if (currentActiveCount >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
      throw new ApiError(
        429,
        "MAX_SLOTS_REACHED",
        `Bạn đang có ${currentActiveCount} tin đang hoạt động. Mỗi tài khoản chỉ được mở tối đa ${MAX_ACTIVE_LISTINGS_PER_SELLER} tin cùng lúc.`
      );
    }

    if (titleLockSnap.exists) {
      throw new ApiError(
        409,
        "DUPLICATE_TITLE",
        "Bạn đã có một tin đăng tương tự đang hoạt động. Vui lòng không đăng tin trùng lặp."
      );
    }

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

    // ===== WRITE PHASE =====
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
      confirmedReservationId: null,
      confirmedUntil: null,
      createdAt: FieldValue.serverTimestamp(),
    };

    transaction.set(listingRef, publicListingData);
    transaction.set(listingPrivateRef, privateListingData);
    transaction.set(
      statsRef,
      {
        activeCount: currentActiveCount + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    transaction.create(titleLockRef, {
      listingId,
      sellerId,
      titleNormalized,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (uploadSessionRef && sessionSnap?.exists && sessionSnap.data()?.ownerUid === sellerId) {
      transaction.update(uploadSessionRef, {
        claimed: true,
        listingId,
        status: "claimed",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const rawDto = toPublicListingDTO(publicListingData, listingId);
    const dto = JSON.parse(JSON.stringify(rawDto));
    const responsePayload = {
      success: true,
      listingId,
      listing: dto,
    };

    if (idemRef) {
      transaction.create(idemRef, {
        responseBody: responsePayload,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });
    }

    return responsePayload;
  });

  return NextResponse.json(result, { status: 200 });
});
