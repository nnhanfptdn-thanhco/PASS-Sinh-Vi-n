/**
 * KIỂM TRA EMAIL SINH VIÊN CHUẨN XÁC VÀ BẢO MẬT (PROMPT 5)
 * - Yêu cầu bắt buộc emailVerified === true
 * - Chuẩn hóa chữ thường, loại bỏ khoảng trắng
 * - Kiểm tra định dạng RFC: đúng 1 dấu @, không chứa ký tự lạ, không có khoảng trắng
 * - Chống bypass tên miền: .edu.vn không được theo sau bởi .evil.com, không bị tiền tố evil-edu.vn
 * - Chống homoglyph (ký tự giả mạo unicode) và Punycode xn--
 */

export interface StudentEmailCheckOptions {
  email: string | null | undefined;
  emailVerified: boolean | null | undefined;
  allowedSuffixes?: string[];
}

export interface StudentEmailCheckResult {
  isValid: boolean;
  domain: string | null;
  reason?: string;
}

const RFC_EMAIL_PATTERN = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isStudentEmail(
  options: StudentEmailCheckOptions
): StudentEmailCheckResult {
  const { email, emailVerified, allowedSuffixes } = options;

  if (!email || typeof email !== "string") {
    return { isValid: false, domain: null, reason: "Email không được để trống" };
  }

  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return { isValid: false, domain: null, reason: "Email không được để trống" };
  }

  // Bắt buộc email đã được xác minh bởi Firebase Auth / Google
  if (emailVerified !== true) {
    return {
      isValid: false,
      domain: null,
      reason: "Email trường chưa được xác minh quyền sở hữu (emailVerified = false)",
    };
  }

  // Kiểm tra không có khoảng trắng nội bộ
  if (/\s/.test(trimmed)) {
    return { isValid: false, domain: null, reason: "Email chứa khoảng trắng" };
  }

  // Chỉ cho phép đúng 1 dấu @
  const atParts = trimmed.split("@");
  if (atParts.length !== 2 || !atParts[0] || !atParts[1]) {
    return { isValid: false, domain: null, reason: "Định dạng email không hợp lệ" };
  }

  const domain = atParts[1].toLowerCase();

  // Chống homoglyph / ký tự phi ASCII
  if (/[^\x20-\x7E]/.test(domain) || domain.includes("xn--")) {
    return { isValid: false, domain, reason: "Tên miền chứa ký tự không hợp lệ hoặc mã hóa giả mạo" };
  }

  // Tên miền không được kết thúc bằng dấu chấm
  if (domain.endsWith(".")) {
    return { isValid: false, domain, reason: "Tên miền không được kết thúc bằng dấu chấm" };
  }

  // Kiểm tra định dạng cơ bản của email
  if (!RFC_EMAIL_PATTERN.test(trimmed)) {
    return { isValid: false, domain, reason: "Định dạng email không hợp lệ theo chuẩn RFC" };
  }

  // Nếu có danh sách allowlist cụ thể (các trường)
  if (allowedSuffixes && allowedSuffixes.length > 0) {
    const matched = allowedSuffixes.some((s) => {
      const cleanSuffix = s.toLowerCase().trim().replace(/^@/, "");
      return domain === cleanSuffix || domain.endsWith(`.${cleanSuffix}`);
    });

    if (matched) {
      return { isValid: true, domain };
    }
  }

  // Mặc định: kiểm tra tên miền đuôi .edu.vn
  // Phải bằng chính xác 'edu.vn' (rất hiếm) hoặc kết thúc bằng '.edu.vn'
  // Đảm bảo không dính evil-edu.vn hoặc edu.vn.evil.com
  const isEduVn = domain === "edu.vn" || domain.endsWith(".edu.vn");

  if (!isEduVn) {
    return {
      isValid: false,
      domain,
      reason: "Tên miền email không thuộc hệ thống giáo dục Việt Nam (.edu.vn)",
    };
  }

  return { isValid: true, domain };
}
