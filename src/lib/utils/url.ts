/**
 * Xác thực và chuẩn hóa tham số điều hướng 'next' (Return URL).
 * CHỐNG OPEN REDIRECT:
 * - Chỉ chấp nhận đường dẫn nội bộ bắt đầu bằng '/'
 * - Tuyệt đối không chấp nhận bắt đầu bằng '//' hoặc '/\'
 * - Không chứa scheme '://' hoặc ký tự điều khiển
 */
export function safeNext(url: string | null | undefined): string {
  if (!url || typeof url !== "string") {
    return "/";
  }

  const trimmed = url.trim();

  // Bắt buộc phải bắt đầu bằng '/'
  if (!trimmed.startsWith("/")) {
    return "/";
  }

  // Chặn protocol-relative URL '//evil.com' hoặc '/\evil.com'
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return "/";
  }

  // Chặn scheme tuyệt đối 'https://...' hoặc ký tự điều khiển
  if (trimmed.includes("://") || /[\x00-\x1f\x7f]/.test(trimmed)) {
    return "/";
  }

  return trimmed;
}
