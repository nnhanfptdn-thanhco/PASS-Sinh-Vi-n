/**
 * HẰNG SỐ NGHIỆP VỤ TIN ĐĂNG VÀ GIỮ CHỖ (WP-0.1)
 * Dùng chung cho cả Client và Server
 */

export const LISTING_CONDITIONS = [
  { value: "new_with_tag", label: "Mới 100% (nguyên tem/hộp)" },
  { value: "like_new", label: "Như mới (95-99%)" },
  { value: "good", label: "Dùng tốt (80-90%)" },
  { value: "fair", label: "Dùng được (50-70%)" },
] as const;

export type ListingCondition = typeof LISTING_CONDITIONS[number]["value"];

// Giới hạn số lượng
export const MAX_ACTIVE_LISTINGS_PER_SELLER = 10; // Giới hạn 10 tin active + reserved / seller
export const MIN_LISTING_IMAGES = 3; // Bắt buộc tối thiểu 3 ảnh
export const MAX_LISTING_IMAGES = 10; // Tối đa 10 ảnh

// Giới hạn giữ chỗ
export const MAX_PENDING_RESERVATIONS_PER_LISTING = 3; // Tối đa 3 pending/tin
export const MAX_PENDING_RESERVATIONS_PER_BUYER = 5; // Tối đa 5 pending/người mua
export const PENDING_RESERVATION_EXPIRY_HOURS = 24; // Hạn chờ xác nhận: 24h
export const CONFIRMED_HOLD_EXPIRY_HOURS = 72; // Hạn giữ sau khi xác nhận: 72h
export const NO_SHOW_MIN_WAIT_MINUTES = 60; // Thời gian chờ tối thiểu trước khi báo vắng mặt (60 phút)

// Hạn pass đồ
export const MAX_PASS_DEADLINE_DAYS = 30; // Hạn pass tối đa 30 ngày từ hôm nay

// Giới hạn độ dài trường văn bản
export const TITLE_MIN_LENGTH = 10;
export const TITLE_MAX_LENGTH = 80;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const DEFECTS_MAX_LENGTH = 500;
export const BRAND_MODEL_MAX_LENGTH = 80;
export const USAGE_TIME_MAX_LENGTH = 50;
export const PUBLIC_MEETING_POINT_MAX_LENGTH = 120;
export const EXACT_ADDRESS_MAX_LENGTH = 200;
export const DETAILED_SCHEDULE_MAX_LENGTH = 300;
export const SHIP_FEE_NOTE_MAX_LENGTH = 200;
export const PREFERRED_SCHEDULE_MAX_LENGTH = 100;

// Giới hạn giá (VND)
export const MIN_PRICE_VND = 0; // 0 = Tặng miễn phí
export const MAX_PRICE_VND = 500_000_000;
