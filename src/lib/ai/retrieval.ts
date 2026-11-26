import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { isValidFirestoreId } from "@/lib/server/request-utils";
import { normalizeVi } from "@/lib/search/normalize";
import { isPastDeadline } from "@/lib/utils/date";
import categoriesData from "@/data/categories.json";
import universitiesData from "@/data/universities_vietnam.json";

/**
 * Danh sách tuyệt đối các collection/ngữ cảnh bí mật mà NnhanAI BỊ CẤM truy cập.
 */
export const AI_DENYLIST_COLLECTIONS = [
  "usersPrivate",
  "verifications",
  "studentIdHashes",
  "listingsPrivate",
  "reservations",
  "contactViewLogs",
  "conversations",
  "messages",
  "reports",
  "appeals",
  "notifications",
  "adminLogs",
  "pendingDeletions",
  "rateLimits",
  "idempotency",
  "claimsSyncJobs",
  "storageCleanupJobs",
  "listingOperationJobs",
  "uploadSessions",
  "userUploadQuotas",
  "userAiQuotas",
  "deadLetterAlerts",
  "systemState",
  "systemMeta",
  "activeReservationLocks",
  "sellerTitleLocks",
  "appealPendingLocks",
] as const;

export interface AIPublicListingDTO {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  price: number;
  originalPrice: number | null;
  negotiationType: string;
  urgentPass: boolean;
  passDeadline: string;
  schoolCode: string | null;
  schoolName: string | null;
  campusName: string | null;
  publicMeetingPoint: string | null;
  coverThumb: string | null;
  shippingMethods: Record<string, boolean>;
  status: "active";
  url: string;
}

export interface AIPublicCitation {
  kind: "listing" | "help";
  id: string;
  title: string;
  url: string;
}

export interface AIHelpDoc {
  id: string;
  title: string;
  url: string;
  summary: string;
  keywords: string[];
}

const PUBLIC_HELP_DOCS: AIHelpDoc[] = [
  {
    id: "guide-create-listing",
    title: "Hướng dẫn đăng tin pass đồ cho sinh viên",
    url: "/listings/new",
    summary:
      "Sau khi xác minh thẻ sinh viên thành công, bạn vào mục Đăng tin (/listings/new), tải lên tối thiểu 1 ảnh thực tế rõ nét (WebP/JPEG), chọn danh mục, giá mong muốn, hạn pass tối đa 60 ngày và điểm giao dịch công khai tại cổng trường/ký túc xá. Không ghi SĐT, Zalo hoặc liên kết cá nhân vào tiêu đề hay mô tả công khai.",
    keywords: ["đăng tin", "dang tin", "bán đồ", "tạo bài", "hướng dẫn đăng", "mô tả"],
  },
  {
    id: "guide-reservation-option-a",
    title: "Quy trình giữ chỗ 24h / 72h và mở liên hệ bảo mật (Option A)",
    url: "/reservations",
    summary:
      "Bước 1: Người mua nhấn 'Giữ Chỗ Món Đồ Này' để gửi yêu cầu (hết hạn sau 24 giờ nếu người bán chưa phản hồi). Bước 2: Người bán xác nhận giữ chỗ cho 1 người mua (giữ chỗ tối đa 72 giờ). Bước 3: Chỉ người mua đã được xác nhận trong thời hạn 72 giờ mới xem được Zalo/địa chỉ chi tiết qua luồng Option A. Sau giao dịch, hai bên đánh giá và xác nhận hoàn tất.",
    keywords: ["giữ chỗ", "giu cho", "xác nhận", "liên hệ", "option a", "72h", "24h", "đặt chỗ"],
  },
  {
    id: "guide-safety-antiscam",
    title: "Chính sách an toàn & phòng tránh lừa đảo khi mua bán",
    url: "/messages",
    summary:
      "Tuyệt đối không chuyển khoản đặt cọc trước qua mạng khi chưa gặp kiểm tra đồ trực tiếp; không chia sẻ OTP, mật khẩu hay bấm link lạ. Ưu tiên hẹn gặp ban ngày tại nơi đông người như cổng trường, sảnh KTX hoặc thư viện. Nếu phát hiện nghi vấn, hãy dùng nút Báo cáo & Chặn ngay trong trang Chat hoặc chi tiết tin.",
    keywords: ["lừa đảo", "lua dao", "an toàn", "an toan", "cọc", "báo cáo", "cổng trường", "otp"],
  },
  {
    id: "guide-onboarding-verification",
    title: "Hướng dẫn xác minh sinh viên & quyền dữ liệu (Settings)",
    url: "/auth/onboarding",
    summary:
      "Tài khoản mới cần gửi ảnh thẻ sinh viên tại /auth/onboarding để Ban Quản Trị đối chiếu. Ảnh thẻ được lưu riêng tư và tự động xóa sau 30 ngày kể từ lúc duyệt/từ chối. Bạn có thể xem, xuất dữ liệu JSON hoặc yêu cầu xóa tài khoản tại /settings.",
    keywords: ["xác minh", "thẻ sinh viên", "onboarding", "cài đặt", "xuất dữ liệu", "xóa tài khoản"],
  },
  {
    id: "guide-marketplace-search",
    title: "Tìm đồ theo danh mục, ngân sách và trường học",
    url: "/search",
    summary:
      "Bạn có thể lọc tin đăng công khai theo từ khóa, danh mục (Giáo trình, Điện máy, Gia dụng, Xe cộ...), mức giá min/max, ưu tiên trường học hoặc khu vực ngay tại trang Tìm kiếm (/search).",
    keywords: ["tìm", "ngân sách", "giá", "rẻ", "mua", "danh mục", "tìm kiếm", "trường"],
  },
];

function stripHtmlAndTruncate(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Chỉ map các trường ĐÃ ALLOWLIST từ `listings` công khai. Tuyệt đối không đính kèm field nhạy cảm.
 */
export function toPublicAIListingDTO(
  id: string,
  raw: Record<string, unknown>
): AIPublicListingDTO | null {
  if (raw.status !== "active") return null;
  if (raw.operationStatus) return null;
  const passDeadlineRaw = typeof raw.passDeadline === "string" ? raw.passDeadline : "";
  if (passDeadlineRaw && isPastDeadline(passDeadlineRaw)) return null;

  const rawShipping = (raw.shippingMethods || {}) as Record<string, unknown>;
  const safeShipping: Record<string, boolean> = {
    pickup: Boolean(rawShipping.pickup),
    sellerDelivery: Boolean(rawShipping.sellerDelivery),
    carrierShipping: Boolean(rawShipping.carrierShipping),
    campusDelivery: Boolean(rawShipping.campusDelivery),
  };

  return {
    id,
    title: stripHtmlAndTruncate(raw.title, 100),
    description: stripHtmlAndTruncate(raw.description, 320),
    categoryId: stripHtmlAndTruncate(raw.categoryId, 64),
    condition: stripHtmlAndTruncate(raw.condition, 80),
    price: typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : 0,
    originalPrice:
      typeof raw.originalPrice === "number" && Number.isFinite(raw.originalPrice)
        ? raw.originalPrice
        : null,
    negotiationType: stripHtmlAndTruncate(raw.negotiationType || "slight", 32),
    urgentPass: Boolean(raw.urgentPass),
    passDeadline: stripHtmlAndTruncate(raw.passDeadline, 16),
    schoolCode: typeof raw.schoolCode === "string" ? stripHtmlAndTruncate(raw.schoolCode, 32) : null,
    schoolName: typeof raw.schoolName === "string" ? stripHtmlAndTruncate(raw.schoolName, 120) : null,
    campusName: typeof raw.campusName === "string" ? stripHtmlAndTruncate(raw.campusName, 120) : null,
    publicMeetingPoint:
      typeof raw.publicMeetingPoint === "string"
        ? stripHtmlAndTruncate(raw.publicMeetingPoint, 120)
        : null,
    coverThumb:
      typeof raw.coverThumb === "string" && raw.coverThumb.startsWith("https://")
        ? raw.coverThumb
        : null,
    shippingMethods: safeShipping,
    status: "active",
    url: `/listings/${id}`,
  };
}

const AI_SEARCH_STOPWORDS = new Set([
  "tim",
  "mua",
  "pass",
  "duoi",
  "tren",
  "tam",
  "khoang",
  "gia",
  "re",
  "cho",
  "minh",
  "toi",
  "xem",
  "co",
  "do",
  "mon",
  "gi",
  "khong",
  "nao",
  "voi",
  "cua",
  "tai",
  "sinh",
  "vien",
  "sv",
  "trieu",
  "nghin",
  "ngan",
  "dong",
  "vnd",
  "giup",
  "goi",
  "y",
]);

/**
 * Trích ngân sách VNĐ từ truy vấn tiếng Việt (giữ nguyên dấu '.' / ',' thập phân trước khi strip dấu).
 * Ví dụ: "1.5 triệu" -> 1_500_000, "1,2tr" -> 1_200_000, "500k" -> 500_000.
 */
export function parseBudgetVnd(query: string): number | undefined {
  const accentStripped = (query || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

  const trMatch = accentStripped.match(/(\d+(?:[.,]\d+)?)\s*(?:tr|trieu)\b/);
  if (trMatch) {
    const val = Number(trMatch[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0) return Math.round(val * 1_000_000);
  }
  const kMatch = accentStripped.match(/(\d+(?:[.,]\d+)?)\s*(?:k|nghin|ngan)\b/);
  if (kMatch) {
    const val = Number(kMatch[1].replace(",", "."));
    if (Number.isFinite(val) && val > 0) return Math.round(val * 1_000);
  }
  const vndMatch = accentStripped.match(/(\d{1,3}(?:[.,]\d{3})+)\s*(?:d|đ|vnd|dong)\b/);
  if (vndMatch) {
    const val = Number(vndMatch[1].replace(/[.,]/g, ""));
    if (Number.isFinite(val) && val > 0) return val;
  }
  return undefined;
}

export async function getPublicListingByIdForAI(
  listingId: string
): Promise<AIPublicListingDTO | null> {
  if (!isValidFirestoreId(listingId)) return null;
  const snap = await adminDb.collection("listings").doc(listingId).get();
  if (!snap.exists) return null;
  return toPublicAIListingDTO(snap.id, (snap.data() || {}) as Record<string, unknown>);
}

export async function searchPublicListingsForAI(params: {
  query: string;
  maxPrice?: number;
  limit?: number;
}): Promise<AIPublicListingDTO[]> {
  const limitCount = Math.min(8, Math.max(1, params.limit || 5));
  const budget = params.maxPrice ?? parseBudgetVnd(params.query);
  const tokens = normalizeVi(params.query)
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 2 &&
        !/^\d+(?:k|tr|trieu|nghin|ngan|vnd|d)?$/.test(t) &&
        !AI_SEARCH_STOPWORDS.has(t)
    );

  try {
    const baseQuery = adminDb.collection("listings").where("status", "==", "active");
    let snap: FirebaseFirestore.QuerySnapshot;
    if (typeof baseQuery.orderBy === "function") {
      try {
        snap = await baseQuery.orderBy("createdAt", "desc").limit(60).get();
      } catch {
        snap = await baseQuery.limit(60).get();
      }
    } else {
      snap = await baseQuery.limit(60).get();
    }

    const scored: Array<{ dto: AIPublicListingDTO; score: number }> = [];
    for (const doc of snap.docs) {
      const dto = toPublicAIListingDTO(doc.id, (doc.data() || {}) as Record<string, unknown>);
      if (!dto) continue;
      if (budget !== undefined && dto.price > budget) continue;

      const haystack = normalizeVi(
        `${dto.title} ${dto.description} ${dto.categoryId} ${dto.schoolName || ""}`
      );
      let keywordHits = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) keywordHits += 2;
      }

      // Khi người dùng chỉ định từ khóa món đồ cụ thể (vd "laptop dưới 5tr"), không đẩy món không liên quan (score=0)
      if (tokens.length > 0 && keywordHits === 0) {
        continue;
      }

      const score = keywordHits + (dto.urgentPass ? 0.5 : 0);
      scored.push({ dto, score });
    }

    scored.sort((a, b) => b.score - a.score || a.dto.price - b.dto.price);
    return scored.slice(0, limitCount).map((s) => s.dto);
  } catch {
    return [];
  }
}

export function searchPublicHelpDocsForAI(query: string): AIHelpDoc[] {
  const norm = normalizeVi(query);
  const scored = PUBLIC_HELP_DOCS.map((doc) => {
    let score = 0;
    for (const kw of doc.keywords) {
      if (norm.includes(normalizeVi(kw))) score += 2;
    }
    if (norm.includes(normalizeVi(doc.title))) score += 3;
    return { doc, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return (scored.length > 0 ? scored.map((s) => s.doc) : PUBLIC_HELP_DOCS.slice(0, 2)).slice(0, 3);
}

export function getPublicCatalogSummaryForAI() {
  const categories = (categoriesData as Array<{ id: string; name: string }>).map((c) => ({
    id: c.id,
    name: c.name,
  }));
  const universitiesCount = Array.isArray(universitiesData) ? universitiesData.length : 0;
  return { categories, universitiesCount };
}

export async function retrievePublicContextForAI(params: {
  query: string;
  listingId?: string;
}): Promise<{
  listings: AIPublicListingDTO[];
  helpDocs: AIHelpDoc[];
  citations: AIPublicCitation[];
}> {
  const helpDocs = searchPublicHelpDocsForAI(params.query);
  const focusListing = params.listingId ? await getPublicListingByIdForAI(params.listingId) : null;

  const normQuery = normalizeVi(params.query);
  const shouldSearchListings =
    Boolean(params.listingId) ||
    Boolean(parseBudgetVnd(params.query)) ||
    /\b(tim|mua|gia|pass|quat|giao trinh|sach|xe|ban|tu|laptop|noi|ban phim|giay|ao)\b/.test(
      normQuery
    );

  const searchedListings = shouldSearchListings
    ? await searchPublicListingsForAI({ query: params.query, limit: 5 })
    : [];

  const listingMap = new Map<string, AIPublicListingDTO>();
  if (focusListing) listingMap.set(focusListing.id, focusListing);
  for (const item of searchedListings) {
    if (!listingMap.has(item.id)) listingMap.set(item.id, item);
  }
  const listings = Array.from(listingMap.values()).slice(0, 5);

  const citations: AIPublicCitation[] = [
    ...listings.map((l) => ({
      kind: "listing" as const,
      id: l.id,
      title: `${l.title} (${l.price.toLocaleString("vi-VN")} đ)`,
      url: l.url,
    })),
    ...helpDocs.map((h) => ({
      kind: "help" as const,
      id: h.id,
      title: h.title,
      url: h.url,
    })),
  ];

  return { listings, helpDocs, citations };
}
