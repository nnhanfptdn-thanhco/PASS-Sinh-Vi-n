import { adminDb, hasAdminCredentials } from "@/lib/firebase/admin";
import { todayVN, isPastDeadline } from "@/lib/utils/date";

export interface PublicListingDTO {
  id: string;
  sellerId: string;
  title: string;
  titleNormalized: string;
  categoryId: string;
  subcategory?: string | null;
  condition: string;
  brandModel?: string | null;
  usageTime?: string | null;
  defects?: string | null;
  noDefects: boolean;
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
  rating: number | null;
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

  // Xử lý chuyển đổi Firestore Timestamp sang ISO string an toàn
  const rawCreatedAt = docData.createdAt as { toDate?: () => Date } | string | undefined;
  let createdAtStr = "";
  if (rawCreatedAt && typeof rawCreatedAt === "object" && typeof rawCreatedAt.toDate === "function") {
    createdAtStr = rawCreatedAt.toDate().toISOString();
  } else if (typeof rawCreatedAt === "string") {
    createdAtStr = rawCreatedAt;
  } else {
    createdAtStr = new Date().toISOString();
  }

  const rawUpdatedAt = docData.updatedAt as { toDate?: () => Date } | string | undefined;
  let updatedAtStr: string | undefined = undefined;
  if (rawUpdatedAt && typeof rawUpdatedAt === "object" && typeof rawUpdatedAt.toDate === "function") {
    updatedAtStr = rawUpdatedAt.toDate().toISOString();
  } else if (typeof rawUpdatedAt === "string") {
    updatedAtStr = rawUpdatedAt;
  }

  return {
    id: (docData.id as string) || id,
    sellerId: (docData.sellerId as string) || "",
    title: (docData.title as string) || "",
    titleNormalized: (docData.titleNormalized as string) || "",
    categoryId: (docData.categoryId as string) || "",
    subcategory: (docData.subcategory as string) || null,
    condition: (docData.condition as string) || "used",
    brandModel: (docData.brandModel as string) || null,
    usageTime: (docData.usageTime as string) || null,
    defects: (docData.defects as string) || null,
    noDefects: Boolean(docData.noDefects),
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
    shippingMethods: (docData.shippingMethods as PublicListingDTO["shippingMethods"]) || {
      pickup: true,
      sellerDelivery: false,
      carrierShipping: false,
    },
    itemDimensions: (docData.itemDimensions as PublicListingDTO["itemDimensions"]) || null,
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
 * Kiểm tra xem một tin đăng có được phép hiển thị công khai hay không
 * Theo Ma trận hiển thị mục 2.2:
 * - active & passDeadline >= today -> Hiển thị bình thường
 * - reserved & passDeadline >= today -> Hiển thị công khai nhưng có badge "Đã có người giữ chỗ"
 * - expired, sold, hidden -> Không hiển thị công khai (404 / Ẩn khỏi tìm kiếm)
 */
export function isListingPubliclyVisible(
  listing: { status: string; passDeadline?: string; operationStatus?: unknown },
  now: Date = new Date()
): boolean {
  if (listing.operationStatus) {
    return false;
  }
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
  if (!hasAdminCredentials) {
    return null;
  }
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
    rating: data.rating == null ? null : Number(data.rating),
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
 */
export async function getPublicListingById(
  id: string,
  now: Date = new Date()
): Promise<{ listing: PublicListingDTO; seller: PublicSellerProfile } | null> {
  if (!hasAdminCredentials) {
    return null;
  }
  const docSnap = await adminDb.collection("listings").doc(id).get();
  if (!docSnap.exists) {
    return null;
  }

  const data = docSnap.data() as Record<string, unknown>;
  if (
    !isListingPubliclyVisible(
      {
        status: data.status as string,
        passDeadline: data.passDeadline as string,
        operationStatus: data.operationStatus,
      },
      now
    )
  ) {
    return null;
  }

  const listingDTO = toPublicListingDTO(data, docSnap.id);
  const seller = await getSellerPublicProfile(listingDTO.sellerId);

  return {
    listing: listingDTO,
    seller: seller || {
      id: listingDTO.sellerId,
      displayName: "Sinh viên",
      photoURL: "",
      verified: false,
      rating: null,
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
  if (!hasAdminCredentials) {
    return [];
  }
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
    if (!data.operationStatus && passDeadline >= currentToday) {
      validListings.push(toPublicListingDTO(data, doc.id));
    }
  });

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
 * Lấy các đánh giá gần nhất của người dùng (F15)
 */
export async function getSellerRecentReviews(
  targetUserId: string,
  limitCount = 5
): Promise<PublicReviewDTO[]> {
  if (!hasAdminCredentials) {
    return [];
  }
  try {
    const snap = await adminDb
      .collection("reviews")
      .where("targetUserId", "==", targetUserId)
      .orderBy("createdAt", "desc")
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
 * Tìm kiếm tin đăng toàn diện (WP-3A, F16)
 * - Quét lặp nhiều batch (BATCH_SIZE = 100, MAX_SCANNED = 500) để chống trang rỗng khi lọc in-memory
 * - Phân trang theo cursor chính xác
 * - Hỗ trợ fallback khi thiếu composite index
 */
export async function searchListings(
  params: SearchListingsParams,
  now: Date = new Date()
): Promise<SearchListingsResult> {
  if (!hasAdminCredentials) {
    return { items: [] };
  }
  const currentToday = todayVN(now);
  const limitCount = Math.min(50, Math.max(1, params.limit || 20));
  const sortMode = params.sort || "relevant";

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

  let cursorSnap: FirebaseFirestore.DocumentSnapshot | undefined = undefined;
  if (params.cursor) {
    const c = await adminDb.collection("listings").doc(params.cursor).get();
    if (c.exists) {
      cursorSnap = c;
    }
  }

  async function runPage(useCompound: boolean, afterDoc?: FirebaseFirestore.DocumentSnapshot) {
    let query = adminDb.collection("listings").where("status", "==", "active");

    if (useCompound) {
      if (sortMode === "price_asc") {
        query = query.orderBy("price", "asc");
      } else if (sortMode === "price_desc") {
        query = query.orderBy("price", "desc");
      } else {
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
      query = query.orderBy("createdAt", "desc");
    }

    if (afterDoc) {
      query = query.startAfter(afterDoc);
    }

    return await query.limit(BATCH_SIZE).get();
  }

  let useCompound = true;
  const matchedItems: PublicListingDTO[] = [];
  let scanned = 0;
  let lastMatchedDocId: string | undefined = undefined;
  let lastScannedDocSnap: FirebaseFirestore.DocumentSnapshot | undefined = undefined;
  let hasMoreMatches = false;
  let exhausted = false;
  let currentAfter = cursorSnap;

  // Thu thập tới limitCount + 1 bản ghi khớp để biết chính xác còn trang tiếp theo hay không,
  // tránh lỗi đặt exhausted = true khi vòng lặp dừng sớm lúc snap.docs.length < BATCH_SIZE.
  while (matchedItems.length <= limitCount && scanned < MAX_SCANNED && !exhausted) {
    let snap: FirebaseFirestore.QuerySnapshot | undefined;
    try {
      snap = await runPage(useCompound, currentAfter);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorCode = (err as { code?: number })?.code;
      if (
        useCompound &&
        (errorCode === 9 ||
          errorMsg.includes("FAILED_PRECONDITION") ||
          errorMsg.includes("requires an index"))
      ) {
        useCompound = false;
        snap = await runPage(false, currentAfter);
      } else {
        throw err;
      }
    }

    if (!snap || snap.empty) {
      exhausted = true;
      break;
    }

    let brokeEarly = false;
    for (let i = 0; i < snap.docs.length; i++) {
      const doc = snap.docs[i];
      scanned++;
      lastScannedDocSnap = doc;
      const data = doc.data() as Record<string, unknown>;
      const passDeadline = (data.passDeadline as string) || "";

      if (data.operationStatus) continue;
      if (passDeadline < currentToday) continue;
      if (params.category && data.categoryId !== params.category) continue;
      if (params.school && data.schoolCode !== params.school) continue;
      if (params.province && data.provinceCode !== params.province) continue;
      if (params.urgent && !data.urgentPass) continue;
      if (params.shipping) {
        const ship = (data.shippingMethods || {}) as Record<string, unknown>;
        if (!ship.sellerDelivery && !ship.carrierShipping && !ship.campusDelivery) continue;
      }
      const price = Number(data.price) || 0;
      if (params.minPrice !== undefined && price < params.minPrice) continue;
      if (params.maxPrice !== undefined && price > params.maxPrice) continue;

      if (normalizedKeywords.length > 0) {
        const titleNorm =
          (data.titleNormalized as string) ||
          ((data.title as string) || "")
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
        if (!matchesAllKeywords) continue;
      }

      if (matchedItems.length < limitCount) {
        matchedItems.push(toPublicListingDTO(data, doc.id));
        lastMatchedDocId = doc.id;
      } else {
        hasMoreMatches = true;
        brokeEarly = true;
        break;
      }
    }

    if (brokeEarly) {
      break;
    }

    if (snap.docs.length < BATCH_SIZE) {
      exhausted = true;
      break;
    }
    currentAfter = lastScannedDocSnap;
  }

  // Sắp xếp lại in-memory nếu fallback không dùng compound index
  if (!useCompound) {
    if (sortMode === "price_asc") {
      matchedItems.sort((a, b) => a.price - b.price);
    } else if (sortMode === "price_desc") {
      matchedItems.sort((a, b) => b.price - a.price);
    } else if (sortMode === "newest") {
      matchedItems.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
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

  const nextCursor = hasMoreMatches
    ? lastMatchedDocId
    : !exhausted && lastScannedDocSnap
    ? lastScannedDocSnap.id
    : undefined;

  return {
    items: matchedItems,
    nextCursor,
  };
}
