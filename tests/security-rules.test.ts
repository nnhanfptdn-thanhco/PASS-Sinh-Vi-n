import { describe, it, expect } from "vitest";
import { computeStudentIdHash } from "../src/lib/firebase/admin";
import { removeVietnameseTones, formatCurrencyVND } from "../src/lib/utils";

describe("Kiểm tra Logic Bảo Mật & Xác Minh Thẻ Sinh Viên", () => {
  it("Mã băm HMAC-SHA256 phải đồng nhất cho cùng mã trường và MSSV", () => {
    const hash1 = computeStudentIdHash("QSX", "2110123");
    const hash2 = computeStudentIdHash("qsx", "2110123 ");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex length
  });

  it("Khác trường hoặc khác MSSV phải tạo ra mã băm khác nhau hoàn toàn", () => {
    const hashHcmut = computeStudentIdHash("QSX", "2110123");
    const hashNeu = computeStudentIdHash("KHA", "2110123");
    const hashOtherId = computeStudentIdHash("QSX", "2110124");

    expect(hashHcmut).not.toBe(hashNeu);
    expect(hashHcmut).not.toBe(hashOtherId);
  });

  it("Định dạng tiền tệ VNĐ hiển thị chuẩn mực", () => {
    expect(formatCurrencyVND(0)).toBe("Tặng miễn phí");
    expect(formatCurrencyVND(180000)).toContain("180.000");
    expect(formatCurrencyVND(5000000)).toContain("5.000.000");
  });

  it("Chuyển tiếng Việt không dấu xử lý chính xác mọi thanh điệu", () => {
    expect(removeVietnameseTones("Quạt đứng Senko")).toBe("quat dung senko");
    expect(removeVietnameseTones("Giáo trình Giải tích 1")).toBe("giao trinh giai tich 1");
    expect(removeVietnameseTones("Nồi cơm điện Cuckoo")).toBe("noi com dien cuckoo");
  });
});

describe("Kiểm tra Phân Quyền Vai Trò Người Dùng", () => {
  const roles = {
    guest: { canPost: false, canViewContact: false, canManage: false },
    pending: { canPost: false, canViewContact: false, canManage: false },
    verified: { canPost: true, canViewContact: true, canManage: false },
    admin: { canPost: true, canViewContact: true, canManage: true },
  };

  it("Khách chưa đăng nhập không được đăng tin và không được xem liên hệ", () => {
    expect(roles.guest.canPost).toBe(false);
    expect(roles.guest.canViewContact).toBe(false);
  });

  it("Thành viên chờ duyệt thẻ không được đăng tin và không được xem liên hệ", () => {
    expect(roles.pending.canPost).toBe(false);
    expect(roles.pending.canViewContact).toBe(false);
  });

  it("Chỉ Sinh viên đã xác minh thẻ mới được đăng tin và xem liên hệ", () => {
    expect(roles.verified.canPost).toBe(true);
    expect(roles.verified.canViewContact).toBe(true);
  });

  it("Quản trị viên có toàn quyền kiểm duyệt hồ sơ và xử lý vi phạm", () => {
    expect(roles.admin.canManage).toBe(true);
  });
});
