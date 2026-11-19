import { describe, it, expect } from "vitest";
import { isStudentEmail } from "../src/lib/auth/student-email";

describe("isStudentEmail Safeguards (Prompt 5)", () => {
  it("chấp nhận email .edu.vn hợp lệ khi emailVerified = true", () => {
    const r1 = isStudentEmail({ email: "student@hust.edu.vn", emailVerified: true });
    expect(r1.isValid).toBe(true);
    expect(r1.domain).toBe("hust.edu.vn");

    const r2 = isStudentEmail({ email: "nhan@student.hcmus.edu.vn", emailVerified: true });
    expect(r2.isValid).toBe(true);
    expect(r2.domain).toBe("student.hcmus.edu.vn");

    // Chữ hoa
    const r3 = isStudentEmail({ email: "TEST@FPT.EDU.VN", emailVerified: true });
    expect(r3.isValid).toBe(true);
    expect(r3.domain).toBe("fpt.edu.vn");
  });

  it("từ chối nếu emailVerified không phải true", () => {
    expect(isStudentEmail({ email: "student@hust.edu.vn", emailVerified: false }).isValid).toBe(false);
    expect(isStudentEmail({ email: "student@hust.edu.vn", emailVerified: null }).isValid).toBe(false);
    expect(isStudentEmail({ email: "student@hust.edu.vn", emailVerified: undefined }).isValid).toBe(false);
  });

  it("từ chối các nỗ lực bypass domain .edu.vn", () => {
    // 1. Tên miền kết thúc bằng .evil.com
    expect(isStudentEmail({ email: "a@edu.vn.evil.com", emailVerified: true }).isValid).toBe(false);

    // 2. Subdomain edu.vn giả mạo
    expect(isStudentEmail({ email: "a@sub.edu.vn.attacker.org", emailVerified: true }).isValid).toBe(false);

    // 3. Tên miền có gạch nối evil-edu.vn
    expect(isStudentEmail({ email: "a@evil-edu.vn", emailVerified: true }).isValid).toBe(false);

    // 4. Tên miền thương mại thông thường
    expect(isStudentEmail({ email: "a@evil.com", emailVerified: true }).isValid).toBe(false);
    expect(isStudentEmail({ email: "a@gmail.com", emailVerified: true }).isValid).toBe(false);

    // 5. Domain có dấu chấm ở cuối
    expect(isStudentEmail({ email: "a@hust.edu.vn.", emailVerified: true }).isValid).toBe(false);
  });

  it("từ chối email chứa khoảng trắng hoặc định dạng lạ", () => {
    expect(isStudentEmail({ email: " a@hust.edu.vn ", emailVerified: true }).isValid).toBe(true); // trim thì hợp lệ
    expect(isStudentEmail({ email: "a @hust.edu.vn", emailVerified: true }).isValid).toBe(false);
    expect(isStudentEmail({ email: "a@ hust.edu.vn", emailVerified: true }).isValid).toBe(false);
    expect(isStudentEmail({ email: "a@b@hust.edu.vn", emailVerified: true }).isValid).toBe(false);
    expect(isStudentEmail({ email: "", emailVerified: true }).isValid).toBe(false);
  });

  it("từ chối homoglyph và ký tự phi ASCII giả mạo", () => {
    // Cyrillic 'е' thay cho Latin 'e'
    const homoglyphEmail = "student@hust.\u0435du.vn";
    expect(isStudentEmail({ email: homoglyphEmail, emailVerified: true }).isValid).toBe(false);

    // Punycode
    expect(isStudentEmail({ email: "student@xn--hust-poa.edu.vn", emailVerified: true }).isValid).toBe(false);
  });

  it("hỗ trợ allowlist danh sách tên miền cụ thể của trường", () => {
    const allowed = ["fpt.edu.vn", "hcmut.edu.vn"];
    expect(
      isStudentEmail({
        email: "test@fe.edu.vn",
        emailVerified: true,
        allowedSuffixes: allowed,
      }).isValid
    ).toBe(true); // vẫn pass nếu là .edu.vn nói chung

    expect(
      isStudentEmail({
        email: "student@fpt.edu.vn",
        emailVerified: true,
        allowedSuffixes: allowed,
      }).isValid
    ).toBe(true);
  });
});
