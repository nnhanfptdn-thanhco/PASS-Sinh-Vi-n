/**
 * BỘ LỌC CHẶN THÔNG TIN LIÊN HỆ CÔNG KHAI (WP-0.3)
 * Ngăn chặn việc lộ SĐT, Zalo, mạng xã hội, email trong nội dung tin đăng công khai.
 * Thông tin liên hệ chỉ được tiết lộ sau khi người bán chấp nhận giữ chỗ của sinh viên đã xác minh.
 */

// Regex kiểm tra số điện thoại VN sau khi loại bỏ dấu phân cách
// 0 hoặc 84 hoặc +84 tiếp theo là 3, 5, 7, 8, 9 và 8 chữ số nữa (tổng 10 số với 0 hoặc 11-12 ký tự với 84/+84)
const VN_PHONE_REGEX = /(?:(?:\+84|84|0)[35789]\d{8})\b/;

// URL & Email
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/i;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Từ khóa mạng xã hội nhạy cảm kèm dấu hiệu liên hệ
const SOCIAL_KEYWORD_REGEX =
  /(?:zalo|fb\.com|facebook|messenger|telegram|t\.me|tiktok|viber|skype|wechat)\b/i;

// Các từ khóa nhắn tin riêng / trao đổi riêng kèm thông tin
const PRIVATE_CONTACT_INTENT_REGEX = /\b(?:ib|inbox|liên hệ|nhắn tin|call|gọi|lh|sđt|sdt|hotline)[\s:]*(?:qua|tại|vào|cho)?[\s:]*(?:zalo|fb|facebook|số|\d)/i;

/**
 * Kiểm tra xem chuỗi văn bản có chứa thông tin liên hệ hay không
 */
export function containsContactInfo(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") {
    return false;
  }

  const normalized = text.normalize("NFKC").toLowerCase().trim();
  if (!normalized) return false;

  // 1. Kiểm tra Email
  if (EMAIL_REGEX.test(normalized)) {
    return true;
  }

  // 2. Kiểm tra URL web
  if (URL_REGEX.test(normalized)) {
    return true;
  }

  // 3. Kiểm tra từ khóa mạng xã hội
  if (SOCIAL_KEYWORD_REGEX.test(normalized)) {
    return true;
  }

  // 4. Kiểm tra ý định liên hệ riêng
  if (PRIVATE_CONTACT_INTENT_REGEX.test(normalized)) {
    return true;
  }

  // 5. Kiểm tra số điện thoại Việt Nam
  // Thử kiểm tra chuỗi thô
  if (VN_PHONE_REGEX.test(normalized)) {
    return true;
  }

  // Chuẩn hóa loại bỏ các ký tự phân cách thông dụng giữa các số (dấu chấm, khoảng trắng, gạch nối, dấu ngoặc)
  // Chỉ loại bỏ ký tự phân cách nằm GIỮA CÁC CHỮ SỐ để không gộp các số độc lập trong câu
  // Ví dụ: "120x60cm" -> không tạo thành số điện thoại.
  // "090 512 3456" -> "0905123456"
  // "0905.123.456" -> "0905123456"
  // "+84 905 123 456" -> "+84905123456"
  const digitsWithDelimitersRemoved = normalized.replace(
    /(?<=\d)[\s.\-_/()]+(?=\d)/g,
    ""
  );

  // Cũng cần xử lý "+84 905" -> "+84905"
  const cleanWithPlus = digitsWithDelimitersRemoved.replace(
    /(?<=\+84)[\s.\-_/()]+(?=\d)/g,
    ""
  );

  if (VN_PHONE_REGEX.test(cleanWithPlus)) {
    return true;
  }

  // Kiểm tra trường hợp người dùng cố tình chèn chữ hoặc ký tự giữa số:
  // "không chín không năm..." hoặc dãy số dài liên tục >= 10 số có đầu 0/84
  const strippedNonDigits = normalized.replace(/[^\d+]/g, "");
  if (VN_PHONE_REGEX.test(strippedNonDigits)) {
    // Đảm bảo không bắt nhầm chuỗi không phải số điện thoại, kiểm tra lại xem có chuỗi gốc chứa đầu số SĐT không
    const match = strippedNonDigits.match(VN_PHONE_REGEX);
    if (match) {
      // Tìm xem match có xuất hiện trong ngữ cảnh hợp lý không
      const matchedDigits = match[0].replace("+", "");
      // Nếu chuỗi chứa liên tiếp các số này
      if (cleanWithPlus.includes(matchedDigits) || cleanWithPlus.includes("+" + matchedDigits)) {
        return true;
      }
    }
  }

  return false;
}
