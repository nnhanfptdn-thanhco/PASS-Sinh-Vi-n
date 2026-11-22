/**
 * BỘ LỌC CHẶN THÔNG TIN LIÊN HỆ CÔNG KHAI (WP-0.3)
 * Ngăn chặn việc lộ SĐT, Zalo, mạng xã hội, email trong nội dung tin đăng công khai.
 * Thông tin liên hệ chỉ được tiết lộ sau khi người bán chấp nhận giữ chỗ của sinh viên đã xác minh.
 */

// Regex kiểm tra số điện thoại VN sau khi loại bỏ dấu phân cách
// 0 hoặc 84 hoặc +84 tiếp theo là 3, 5, 7, 8, 9 và 8 chữ số nữa (lookbehind/lookahead chống bắt nhầm mã sản phẩm dài)
const VN_PHONE_REGEX = /(?<![\d])(?:(?:\+84|84|0)[35789]\d{8})(?!\d)/;

// URL & Email
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/i;
const SOCIAL_DOMAIN_REGEX = /\b(?:fb\.com|facebook\.com|t\.me)\/[a-zA-Z0-9_.-]+/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Từ khóa mạng xã hội nhạy cảm kèm dấu hiệu liên hệ (hỗ trợ cả z.a.l.o, z a l o, loại trừ 'messenger bag')
const OBFUSCATED_ZALO_REGEX = /\bz[\s._-]*a[\s._-]*l[\s._-]*o\b/i;
const SOCIAL_KEYWORD_REGEX =
  /(?:fb\.com|facebook|messenger(?!\s*bag)|telegram|t\.me|tiktok|viber|skype|wechat)\b/i;

// Các từ khóa nhắn tin riêng / trao đổi riêng kèm thông tin hoặc handle
const PRIVATE_CONTACT_INTENT_REGEX =
  /\b(?:ib|inbox|liên hệ|nhắn tin|call|gọi|lh|sđt|sdt|hotline)[\s:]*(?:qua|tại|vào|cho)?[\s:]*(?:zalo|fb|facebook|số|\d)/i;

const ZALO_HANDLE_REGEX = /\bz[\s._-]*a[\s._-]*l[\s._-]*o\s*:\s*[a-zA-Z0-9_.-]+/i;

// Bảng ánh xạ số tiếng Việt thành chữ số
const VN_WORD_DIGITS: Record<string, string> = {
  "không": "0", "khong": "0",
  "một": "1", "mot": "1",
  "hai": "2",
  "ba": "3",
  "bốn": "4", "bon": "4", "tư": "4", "tu": "4",
  "năm": "5", "nam": "5",
  "sáu": "6", "sau": "6",
  "bảy": "7", "bay": "7",
  "tám": "8", "tam": "8",
  "chín": "9", "chin": "9",
};

/** Chuyển đổi các chữ số tiếng Việt đọc bằng chữ sang dạng số để kiểm tra */
function normalizeWordDigits(text: string): string {
  const words = text.split(/[\s,.-]+/);
  let converted = "";
  for (const w of words) {
    const lower = w.toLowerCase();
    if (VN_WORD_DIGITS[lower] !== undefined) {
      converted += VN_WORD_DIGITS[lower];
    } else {
      converted += " ";
    }
  }
  return converted;
}

/**
 * Kiểm tra xem chuỗi văn bản có chứa thông tin liên hệ hay không
 */
export function containsContactInfo(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }

  // Chuẩn hóa Unicode NFKC (đưa số full-width ０-９ về 0-9)
  let normalized = text.normalize("NFKC").toLowerCase().trim();
  if (!normalized) return false;

  // 1. Kiểm tra Email
  if (EMAIL_REGEX.test(normalized)) {
    return true;
  }

  // 2. Kiểm tra URL web hoặc domain mạng xã hội (t.me/abc, fb.com/abc)
  if (URL_REGEX.test(normalized) || SOCIAL_DOMAIN_REGEX.test(normalized)) {
    return true;
  }

  // 3. Kiểm tra Zalo dạng viết rời (z.a.l.o, z a l o) hoặc dạng handle (zalo: abc)
  if (OBFUSCATED_ZALO_REGEX.test(normalized) || ZALO_HANDLE_REGEX.test(normalized)) {
    return true;
  }

  // 4. Kiểm tra từ khóa mạng xã hội khác
  if (SOCIAL_KEYWORD_REGEX.test(normalized)) {
    return true;
  }

  // 5. Kiểm tra ý định liên hệ riêng
  if (PRIVATE_CONTACT_INTENT_REGEX.test(normalized)) {
    return true;
  }

  // 6. Kiểm tra số điện thoại viết bằng chữ (ví dụ: không chín một hai ba bốn...)
  const wordsAsDigits = normalizeWordDigits(normalized);
  if (VN_PHONE_REGEX.test(wordsAsDigits.replace(/\s+/g, ""))) {
    return true;
  }

  // 7. Thay thế ký tự 'o' / 'O' khi dùng thay số 0 ở đầu dãy số điện thoại (ví dụ: o912345678)
  normalized = normalized.replace(/\b[oO](?=[35789])/g, "0");

  // 8. Kiểm tra số điện thoại Việt Nam chuẩn
  if (VN_PHONE_REGEX.test(normalized)) {
    return true;
  }

  // 9. Chuẩn hóa loại bỏ các ký tự phân cách giữa các chữ số: "090 512 3456", "0905.123.456", "+84 905-123-456"
  const digitsWithDelimitersRemoved = normalized.replace(
    /(?<=\d)[\s.\-_/()]+(?=\d)/g,
    ""
  );

  const cleanWithPlus = digitsWithDelimitersRemoved.replace(
    /(?<=\+84)[\s.\-_/()]+(?=\d)/g,
    ""
  );

  if (VN_PHONE_REGEX.test(cleanWithPlus)) {
    return true;
  }

  // 10. Kiểm tra chuỗi chỉ giữ lại chữ số & dấu cộng
  const strippedNonDigits = normalized.replace(/[^\d+]/g, "");
  if (VN_PHONE_REGEX.test(strippedNonDigits)) {
    const match = strippedNonDigits.match(VN_PHONE_REGEX);
    if (match) {
      const matchedDigits = match[0].replace("+", "");
      if (cleanWithPlus.includes(matchedDigits) || cleanWithPlus.includes("+" + matchedDigits)) {
        return true;
      }
    }
  }

  return false;
}
