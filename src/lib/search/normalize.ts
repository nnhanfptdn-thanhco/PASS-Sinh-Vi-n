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
 * Ưu tiên toàn bộ từ đầy đủ (title + brandModel + subcategory) trước,
 * sau đó mới sinh cụm 2 từ và prefix 2-10 ký tự để tránh cắt mất brandModel/subcategory khi giới hạn 60 tokens.
 */
export function buildSearchTokens(
  title: string,
  extra: Array<string | undefined | null> = []
): string[] {
  const combined = [title, ...extra].filter(Boolean).join(" ");
  const normalized = normalizeVi(combined);
  const words = normalized.split(/\s+/).filter((w) => w.length >= 2);

  const tokenSet = new Set<string>();

  // 1. Ưu tiên mọi từ đầy đủ (kể cả từ trong brandModel & subcategory)
  for (const word of words) {
    tokenSet.add(word);
  }

  // 2. Thêm cụm từ 2 từ liền nhau
  for (let i = 0; i < words.length - 1; i++) {
    tokenSet.add(`${words[i]} ${words[i + 1]}`);
  }

  // 3. Sinh prefix từ 2 đến 10 ký tự cho đến trần 60 tokens
  for (const word of words) {
    if (tokenSet.size >= 60) break;
    const maxLen = Math.min(10, word.length);
    for (let len = 2; len < maxLen; len++) {
      if (tokenSet.size >= 60) break;
      tokenSet.add(word.substring(0, len));
    }
  }

  return Array.from(tokenSet).slice(0, 60);
}
