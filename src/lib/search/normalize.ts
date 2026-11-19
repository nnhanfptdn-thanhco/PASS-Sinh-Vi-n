/**
 * CHUẨN HÓA TIẾNG VIỆT VÀ SINH SEARCH TOKENS (WP-2A.6 & WP-3A.4)
 */

export function normalizeVi(str: string | null | undefined): string {
  if (!str) return "";

  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Bỏ dấu thanh tổ hợp
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/[^\w\s]/g, " ") // Bỏ ký tự đặc biệt, emoji
    .replace(/\s+/g, " ") // Gộp nhiều khoảng trắng
    .trim();
}

/**
 * Sinh search tokens cho Firestore từ title, brandModel, subcategory.
 * Bao gồm các từ đơn và prefix 2-10 ký tự của mỗi từ để tìm kiếm gõ dở.
 * Giới hạn tối đa 60 tokens để vừa kích thước index.
 */
export function buildSearchTokens(
  title: string,
  extra: Array<string | undefined | null> = []
): string[] {
  const combined = [title, ...extra].filter(Boolean).join(" ");
  const normalized = normalizeVi(combined);
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);

  const tokenSet = new Set<string>();

  for (const word of words) {
    tokenSet.add(word);
    // Sinh prefix từ 2 đến 10 ký tự
    const maxLen = Math.min(10, word.length);
    for (let len = 2; len < maxLen; len++) {
      tokenSet.add(word.substring(0, len));
    }
  }

  // Thêm cụm từ 2 từ liền nhau nếu có
  for (let i = 0; i < words.length - 1; i++) {
    tokenSet.add(`${words[i]} ${words[i + 1]}`);
  }

  return Array.from(tokenSet).slice(0, 60);
}
