import { describe, it, expect } from "vitest";
import { normalizeVi, buildSearchTokens } from "../src/lib/search/normalize";

describe("Vietnamese Search Normalization (WP-2A.6, 3A.4)", () => {
  it("normalizeVi chuẩn hóa đúng chữ có dấu, chữ đ, chữ hoa và emoji", () => {
    expect(normalizeVi("Quạt Đứng Lifan")).toBe("quat dung lifan");
    expect(normalizeVi("ĐỒ BẾP")).toBe("do bep");
    expect(normalizeVi("Vợ Chồng Cu Đen 🔥")).toBe("vo chong cu den");
    expect(normalizeVi("")).toBe("");
    expect(normalizeVi(null)).toBe("");
    expect(normalizeVi(undefined)).toBe("");
  });

  it("buildSearchTokens sinh token và prefix từ 2 đến 10 ký tự", () => {
    const tokens = buildSearchTokens("Quạt Senko", ["DR1608", "Quạt bàn"]);
    expect(tokens).toContain("quat");
    expect(tokens).toContain("senko");
    expect(tokens).toContain("sen");
    expect(tokens).toContain("dr1608");
    expect(tokens.length).toBeLessThanOrEqual(60);
  });
});
