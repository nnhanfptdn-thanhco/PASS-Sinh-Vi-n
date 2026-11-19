import { describe, it, expect } from "vitest";
import { containsContactInfo } from "../src/lib/utils/contact-filter";

describe("Contact Info Filter (WP-0.3)", () => {
  it("phải từ chối các chuỗi chứa số điện thoại hoặc Zalo dưới mọi định dạng", () => {
    // SĐT liền
    expect(containsContactInfo("0905123456")).toBe(true);
    // SĐT có khoảng cách
    expect(containsContactInfo("090 512 3456")).toBe(true);
    // SĐT có dấu chấm
    expect(containsContactInfo("0905.123.456")).toBe(true);
    // SĐT đầu +84 có khoảng cách
    expect(containsContactInfo("+84 905 123 456")).toBe(true);
    // SĐT đầu 84 liền
    expect(containsContactInfo("84905123456")).toBe(true);
    // Từ khóa Zalo kèm số
    expect(containsContactInfo("zalo 0905123456")).toBe(true);
    expect(containsContactInfo("Nhắn qua Zalo để xem đồ nhé")).toBe(true);
    // Liên kết mạng xã hội
    expect(containsContactInfo("liên hệ fb.com/abc")).toBe(true);
    expect(containsContactInfo("inbox facebook để chốt")).toBe(true);
    // Email
    expect(containsContactInfo("abc@gmail.com")).toBe(true);
    expect(containsContactInfo("Gửi mail vào student@hust.edu.vn")).toBe(true);
    // URL
    expect(containsContactInfo("Xem chi tiết tại https://example.com/item")).toBe(true);
  });

  it("phải chấp nhận các nội dung mô tả đồ dùng sinh viên hợp lệ", () => {
    expect(containsContactInfo("Quạt Senko DR1608 giá 150000")).toBe(false);
    expect(containsContactInfo("Máy 1500W 2 chiếc năm 2023")).toBe(false);
    expect(containsContactInfo("Giáo trình Giải tích 1 tập 2")).toBe(false);
    expect(containsContactInfo("Bàn 120x60cm")).toBe(false);
    expect(containsContactInfo("Còn bảo hành 12 tháng")).toBe(false);
    expect(containsContactInfo("Nồi cơm điện Cuckoo 1.8L còn dùng tốt")).toBe(false);
    expect(containsContactInfo("Ghế xoay công thái học cũ")).toBe(false);
    expect(containsContactInfo("")).toBe(false);
    expect(containsContactInfo(null)).toBe(false);
    expect(containsContactInfo(undefined)).toBe(false);
  });
});
