import { describe, it, expect } from "vitest";
import { containsContactInfo } from "../src/lib/utils/contact-filter";

describe("Contact Info Filter (WP-0.3 / Section 3.9)", () => {
  it("BẮT BUỘC PHẢI CHẶN tất cả các hình thức lách thông tin liên hệ", () => {
    // SĐT các định dạng chuẩn và phân cách
    expect(containsContactInfo("0912345678")).toBe(true);
    expect(containsContactInfo("0912 345 678")).toBe(true);
    expect(containsContactInfo("0912.345.678")).toBe(true);
    expect(containsContactInfo("0912-345-678")).toBe(true);
    expect(containsContactInfo("+84 912 345 678")).toBe(true);
    expect(containsContactInfo("84912345678")).toBe(true);

    // Zalo có số
    expect(containsContactInfo("zalo 0912345678")).toBe(true);
    // z.a.l.o có số cách
    expect(containsContactInfo("z.a.l.o 09 12 34 56 78")).toBe(true);
    // Chữ số viết bằng chữ tiếng Việt
    expect(containsContactInfo("không chín một hai ba bốn năm sáu bảy tám")).toBe(true);
    // Chữ o thay số 0 ở đầu
    expect(containsContactInfo("o912345678")).toBe(true);
    // Số full-width (Unicode ０-９)
    expect(containsContactInfo("09１２345678")).toBe(true);
    // Zalo handle chỉ tên
    expect(containsContactInfo("zalo: abc")).toBe(true);
    // Link rút gọn mạng xã hội
    expect(containsContactInfo("t.me/abc")).toBe(true);
    expect(containsContactInfo("fb.com/abc")).toBe(true);
    // Email
    expect(containsContactInfo("abc@gmail.com")).toBe(true);
  });

  it("BẮT BUỘC KHÔNG ĐƯỢC CHẶN các thông tin sản phẩm, mã, giá, thông số kỹ thuật", () => {
    expect(containsContactInfo("iPhone 13 128GB giá 15.000.000đ")).toBe(false);
    expect(containsContactInfo("Mã SP 20240105")).toBe(false);
    expect(containsContactInfo("Dell Latitude 7490 i5-8350U 16GB")).toBe(false);
    expect(containsContactInfo("Model AB1234567")).toBe(false);
    expect(containsContactInfo("Sách Giải tích 1 tái bản 2023")).toBe(false);
    expect(containsContactInfo("Giá 1.200.000 đ")).toBe(false);
    expect(containsContactInfo("Tủ lạnh 150L còn 80%")).toBe(false);
    expect(containsContactInfo("Size 39-40")).toBe(false);
    expect(containsContactInfo("ISBN 9786041234567")).toBe(false);
    expect(containsContactInfo("Túi messenger bag đen")).toBe(false);
    expect(containsContactInfo("Quạt Senko DR1608 giá 150000")).toBe(false);
    expect(containsContactInfo("Bàn 120x60cm")).toBe(false);
    expect(containsContactInfo("")).toBe(false);
    expect(containsContactInfo(null)).toBe(false);
    expect(containsContactInfo(undefined)).toBe(false);
  });
});
