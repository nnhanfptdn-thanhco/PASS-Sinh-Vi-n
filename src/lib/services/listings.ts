import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { isPastDeadline, todayVN } from "@/lib/utils/date";

export interface PublicListingDTO {
  id: string;
  sellerId: string;
  title: string;
  categoryId: string;
  subcategory: string;
  condition: string;
  brandModel?: string;
  usageTime?: string;
  defects?: string;
  description: string;
  price: number;
  originalPrice?: number;
  negotiationType?: "fixed" | "slight" | "flexible";
  urgentPass: boolean;
  passDeadline: string;
  schoolCode: string;
  schoolName: string;
  campusId?: string;
  campusName?: string;
  provinceCode: string;
  provinceName?: string;
  wardCode?: string;
  publicMeetingPoint: string;
  shippingMethods: {
    pickup: boolean;
    sellerDelivery: boolean;
    carrierShipping: boolean;
    campusDelivery?: boolean;
    shipFeeNote?: string;
  };
  itemDimensions?: { weight?: string; dimensions?: string } | null;
  images: string[];
  thumbs?: string[];
  coverImage: string;
  coverThumb: string;
  status: "active" | "reserved" | "sold" | "hidden_by_seller" | "hidden_by_admin" | "expired";
  viewsCount: number;
  favoritesCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface PublicSellerProfile {
  id: string;
  displayName: string;
  photoURL: string;
  verified: boolean;
  rating: number;
  reviewsCount: number;
  completedDealsCount: number;
  joinDate: string;
  schoolName?: string;
  provinceName?: string;
  isGraduating?: boolean;
}

/**
 * Lọc whitelist các trường công khai của tin đăng, chuyển đổi Timestamp thành ISO string
 */
export function toPublicListingDTO(
  docData: Record<string, unknown>,
  id: string
): PublicListingDTO {
  const images = Array.isArray(docData.images) ? (docData.images as string[]) : [];
  const thumbs = Array.isArray(docData.thumbs) ? (docData.thumbs as string[]) : undefined;
  const cover = (docData.coverImage as string) || images[0] || "";
  const coverThumb = (docData.coverThumb as string) || thumbs?.[0] || cover;

  const rawCreatedAt = docData.createdAt as { toDate?: () => Date } | string | undefined;
  let createdAtStr = new Date().toISOString();
  if (rawCreatedAt && typeof rawCreatedAt === "object" && typeof rawCreatedAt.toDate === "function") {
    createdAtStr = rawCreatedAt.toDate().toISOString();
  } else if (typeof rawCreatedAt === "string") {
    createdAtStr = rawCreatedAt;
  }

  const rawUpdatedAt = docData.updatedAt as { toDate?: () => Date } | string | undefined;
  let updatedAtStr: string | undefined = undefined;
  if (rawUpdatedAt && typeof rawUpdatedAt === "object" && typeof rawUpdatedAt.toDate === "function") {
    updatedAtStr = rawUpdatedAt.toDate().toISOString();
  } else if (typeof rawUpdatedAt === "string") {
    updatedAtStr = rawUpdatedAt;
  }

  const shipping = (docData.shippingMethods || {}) as Record<string, unknown>;

  return {
    id,
    sellerId: (docData.sellerId as string) || "",
    title: (docData.title as string) || "",
    categoryId: (docData.categoryId as string) || "",
    subcategory: (docData.subcategory as string) || "",
    condition: (docData.condition as string) || "good",
    brandModel: (docData.brandModel as string) || undefined,
    usageTime: (docData.usageTime as string) || undefined,
    defects: (docData.defects as string) || undefined,
    description: (docData.description as string) || "",
    price: Number(docData.price) || 0,
    originalPrice: docData.originalPrice ? Number(docData.originalPrice) : undefined,
    negotiationType: (docData.negotiationType as "fixed" | "slight" | "flexible") || "slight",
    urgentPass: Boolean(docData.urgentPass),
    passDeadline: (docData.passDeadline as string) || "",
    schoolCode: (docData.schoolCode as string) || "",
    schoolName: (docData.schoolName as string) || "",
    campusId: (docData.campusId as string) || undefined,
    campusName: (docData.campusName as string) || undefined,
    provinceCode: (docData.provinceCode as string) || "",
    provinceName: (docData.provinceName as string) || undefined,
    wardCode: (docData.wardCode as string) || undefined,
    publicMeetingPoint: (docData.publicMeetingPoint as string) || "",
    shippingMethods: {
      pickup: Boolean(shipping.pickup ?? true),
      sellerDelivery: Boolean(shipping.sellerDelivery),
      carrierShipping: Boolean(shipping.carrierShipping),
      campusDelivery: Boolean(shipping.campusDelivery),
      shipFeeNote: (shipping.shipFeeNote as string) || undefined,
    },
    itemDimensions: (docData.itemDimensions as { weight?: string; dimensions?: string }) || null,
    images,
    thumbs,
    coverImage: cover,
    coverThumb,
    status: (docData.status as PublicListingDTO["status"]) || "active",
    viewsCount: Number(docData.viewsCount) || 0,
    favoritesCount: Number(docData.favoritesCount) || 0,
    createdAt: createdAtStr,
    updatedAt: updatedAtStr,
  };
}

/**
 * Kiểm tra xem tin có được hiển thị công khai ở trang chi tiết không (active hoặc reserved và chưa quá hạn)
 */
export function isListingPubliclyVisible(
  listing: { status: string; passDeadline?: string },
  now: Date = new Date()
): boolean {
  if (listing.status !== "active" && listing.status !== "reserved") {
    return false;
  }
  if (listing.passDeadline && isPastDeadline(listing.passDeadline, now)) {
    return false;
  }
  return true;
}

/**
 * Lấy hồ sơ công khai của người bán (Không chứa PII)
 */
export async function getSellerPublicProfile(uid: string): Promise<PublicSellerProfile | null> {
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }

  const data = userSnap.data() as Record<string, unknown>;
  const rawCreatedAt = data.createdAt as { toDate?: () => Date } | string | undefined;
  let joinDate = "Thành viên";
  if (rawCreatedAt && typeof rawCreatedAt === "object" && typeof rawCreatedAt.toDate === "function") {
    const d = rawCreatedAt.toDate();
    joinDate = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
  }

  return {
    id: uid,
    displayName: (data.displayName as string) || "Sinh viên",
    photoURL: (data.photoURL as string) || "",
    verified: Boolean(data.verified),
    rating: Number(data.rating) || 5.0,
    reviewsCount: Number(data.reviewsCount) || 0,
    completedDealsCount: Number(data.completedDealsCount) || 0,
    joinDate,
    schoolName: (data.schoolName as string) || undefined,
    provinceName: (data.provinceName as string) || undefined,
    isGraduating: Boolean(data.isGraduating),
  };
}

/**
 * Lấy chi tiết tin đăng công khai theo ID
 * Tuân thủ Ma trận 2.2:
 * - active & chưa quá hạn: trả về DTO
 * - reserved & chưa quá hạn: trả về DTO (UI hiện banner đã có người giữ chỗ)
 * - sold / hidden / expired / quá hạn: trả về null (404)
 */
export async function getPublicListingById(
  id: string,
  now: Date = new Date()
): Promise<{ listing: PublicListingDTO; seller: PublicSellerProfile } | null> {
  const docSnap = await adminDb.collection("listings").doc(id).get();
  if (!docSnap.exists) {
    return null;
  }

  const data = docSnap.data() as Record<string, unknown>;
  if (!isListingPubliclyVisible({ status: data.status as string, passDeadline: data.passDeadline as string }, now)) {
    return null;
  }

  const listingDTO = toPublicListingDTO(data, docSnap.id);
  const seller = await getSellerPublicProfile(listingDTO.sellerId);

  return {
    listing: listingDTO,
    seller: seller || {
      id: listingDTO.sellerId,
      displayName: listingDTO.schoolName || "Sinh viên",
      photoURL: "",
      verified: true,
      rating: 5.0,
      reviewsCount: 0,
      completedDealsCount: 0,
      joinDate: "Thành viên",
    },
  };
}

/**
 * Lấy danh sách tin đang bán còn hiệu lực của một người bán
 */
export async function getSellerActiveListings(
  sellerId: string,
  now: Date = new Date()
): Promise<PublicListingDTO[]> {
  const currentToday = todayVN(now);
  const querySnap = await adminDb
    .collection("listings")
    .where("sellerId", "==", sellerId)
    .where("status", "==", "active")
    .get();

  const validListings: PublicListingDTO[] = [];
  querySnap.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const passDeadline = (data.passDeadline as string) || "";
    if (passDeadline >= currentToday) {
      validListings.push(toPublicListingDTO(data, doc.id));
    }
  });

  // Sắp xếp tin mới nhất lên đầu
  validListings.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return validListings;
}

export interface PublicReviewDTO {
  id: string;
  rating: number;
  comment: string;
  reviewerName: string;
  createdAt: string;
}

/**
 * Lấy các đánh giá gần nhất của người dùng
 */
export async function getSellerRecentReviews(
  targetUserId: string,
  limitCount = 5
): Promise<PublicReviewDTO[]> {
  try {
    const snap = await adminDb
      .collection("reviews")
      .where("targetUserId", "==", targetUserId)
      .limit(limitCount)
      .get();

    const reviews: PublicReviewDTO[] = [];
    snap.forEach((doc) => {
      const data = doc.data();
      const rawCreatedAt = data.createdAt as { toDate?: () => Date } | string | undefined;
      let createdAtStr = "";
      if (rawCreatedAt && typeof rawCreatedAt === "object" && typeof rawCreatedAt.toDate === "function") {
        createdAtStr = rawCreatedAt.toDate().toISOString();
      }
      reviews.push({
        id: doc.id,
        rating: Number(data.rating) || 5,
        comment: (data.comment as string) || "",
        reviewerName: (data.reviewerName as string) || "Sinh viên",
        createdAt: createdAtStr,
      });
    });

    reviews.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    return reviews;
  } catch (err) {
    console.warn("Failed to fetch seller reviews:", err);
    return [];
  }
}

export interface SearchListingsParams {
  q?: string;
  category?: string;
  school?: string;
  province?: string;
  urgent?: boolean;
  shipping?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: "relevant" | "newest" | "price_asc" | "price_desc";
  cursor?: string;
  limit?: number;
  viewerSchool?: string;
  viewerProvince?: string;
}

export interface SearchListingsResult {
  items: PublicListingDTO[];
  nextCursor?: string;
  total?: number;
}

/**
 * Tìm kiếm tin đăng toàn diện (WP-3A)
 * - Luôn where status == active
 * - Lọc isPastDeadline ngay lúc đọc
 * - Phân trang theo cursor
 * - Tìm kiếm không dấu đa từ
 * - Fallback tự động khi thiếu Firestore composite index
 */
export async function searchListings(
  params: SearchListingsParams,
  now: Date = new Date()
): Promise<SearchListingsResult> {
  const currentToday = todayVN(now);
  const limitCount = Math.min(50, Math.max(1, params.limit || 20));
  const sortMode = params.sort || "relevant";

  // Chuẩn hóa từ khóa tìm kiếm
  const normalizedKeywords = params.q
    ? params.q
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "d")
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0)
    : [];

  const BATCH_SIZE = 100;
  const MAX_SCANNED = 500;

  async function executeQuery(useCompoundFilter: boolean) {
    let query = adminDb.collection("listings").where("status", "==", "active");

    if (useCompoundFilter) {
      if (sortMode === "price_asc") {
        query = query.orderBy("price", "asc");
      } else if (sortMode === "price_desc") {
        query = query.orderBy("price", "desc");
      } else {
        // Sort newest hoặc relevant: đẩy tối đa 1 equality filter
        if (params.school) {
          query = query.where("schoolCode", "==", params.school);
        } else if (params.category) {
          query = query.where("categoryId", "==", params.category);
        } else if (params.province) {
          query = query.where("provinceCode", "==", params.province);
        }
        query = query.orderBy("createdAt", "desc");
      }
    } else {
      // Fallback: chỉ orderBy createdAt desc
      query = query.orderBy("createdAt", "desc");
    }

    if (params.cursor) {
      const cursorSnap = await adminDb.collection("listings").doc(params.cursor).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }

    return await query.limit(BATCH_SIZE).get();
  }

  let snapshot;
  try {
    snapshot = await executeQuery(true);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorCode = (err as { code?: number })?.code;
    // FAILED_PRECONDITION (code 9) do thiếu composite index
    if (errorCode === 9 || errorMsg.includes("FAILED_PRECONDITION") || errorMsg.includes("requires an index")) {
      console.warn("[SEARCH_INDEX_FALLBACK] Truy vấn thiếu Composite Index trên Firestore, kích hoạt fallback cơ bản:", errorMsg);
      try {
        snapshot = await executeQuery(false);
      } catch (fallbackErr) {
        console.error("[SEARCH_INDEX_FALLBACK_ERROR] Fallback cũng gặp lỗi:", fallbackErr);
        return { items: [], nextCursor: undefined };
      }
    } else {
      console.error("[SEARCH_LISTINGS_ERROR] Lỗi kết nối Firestore:", errorMsg);
      return { items: [], nextCursor: undefined };
    }
  }

  const matchedItems: PublicListingDTO[] = [];
  let lastScannedDocId: string | undefined = undefined;
  let scannedCount = 0;

  for (const doc of snapshot.docs) {
    scannedCount++;
    lastScannedDocId = doc.id;
    if (scannedCount > MAX_SCANNED) break;

    const data = doc.data() as Record<string, unknown>;
    const passDeadline = (data.passDeadline as string) || "";

    // 1. Lọc hết hạn
    if (passDeadline < currentToday) {
      continue;
    }

    // 2. Lọc danh mục
    if (params.category && data.categoryId !== params.category) {
      continue;
    }

    // 3. Lọc trường học
    if (params.school && data.schoolCode !== params.school) {
      continue;
    }

    // 4. Lọc tỉnh / thành
    if (params.province && data.provinceCode !== params.province) {
      continue;
    }

    // 5. Lọc gấp (urgentPass)
    if (params.urgent && !data.urgentPass) {
      continue;
    }

    // 6. Lọc có ship
    if (params.shipping) {
      const ship = (data.shippingMethods || {}) as Record<string, unknown>;
      if (!ship.sellerDelivery && !ship.carrierShipping && !ship.campusDelivery) {
        continue;
      }
    }

    // 7. Lọc khoảng giá
    const price = Number(data.price) || 0;
    if (params.minPrice !== undefined && price < params.minPrice) {
      continue;
    }
    if (params.maxPrice !== undefined && price > params.maxPrice) {
      continue;
    }

    // 8. Lọc từ khóa tìm kiếm không dấu
    if (normalizedKeywords.length > 0) {
      const titleNorm = (data.titleNormalized as string) ||
        (data.title as string || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "d")
          .replace(/[^\w\s]/g, " ");

      const tokens = Array.isArray(data.searchTokens) ? (data.searchTokens as string[]) : [];

      const matchesAllKeywords = normalizedKeywords.every((kw) => {
        return titleNorm.includes(kw) || tokens.some((t) => t.includes(kw));
      });

      if (!matchesAllKeywords) {
        continue;
      }
    }

    matchedItems.push(toPublicListingDTO(data, doc.id));
    if (matchedItems.length >= limitCount) {
      break;
    }
  }

  // Sắp xếp relevant nếu có thông tin trường/vùng người xem
  if (sortMode === "relevant" && (params.viewerSchool || params.viewerProvince)) {
    matchedItems.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      if (params.viewerSchool) {
        if (a.schoolCode === params.viewerSchool) scoreA += 2;
        if (b.schoolCode === params.viewerSchool) scoreB += 2;
      }
      if (params.viewerProvince) {
        if (a.provinceCode === params.viewerProvince) scoreA += 1;
        if (b.provinceCode === params.viewerProvince) scoreB += 1;
      }

      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return b.createdAt > a.createdAt ? 1 : -1;
    });
  }

  const nextCursor =
    snapshot.docs.length >= limitCount && lastScannedDocId ? lastScannedDocId : undefined;

  return {
    items: matchedItems,
    nextCursor,
  };
}
