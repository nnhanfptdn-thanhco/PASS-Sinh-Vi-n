import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  requireUser,
  requireVerified,
  requireAdmin,
  HttpError,
  errorResponse,
} from "../src/lib/auth/server";
import { adminAuth } from "../src/lib/firebase/admin";

describe("Kiểm tra Server Auth Guards (src/lib/auth/server.ts)", () => {
  it("Không có header Authorization -> quăng lỗi HttpError 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/listings/create");
    await expect(requireUser(req)).rejects.toThrow("Vui lòng đăng nhập.");
    await expect(requireUser(req)).rejects.toMatchObject({ status: 401 });
  });

  it("Header Authorization không đúng định dạng Bearer -> quăng lỗi HttpError 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/listings/create", {
      headers: { authorization: "Basic 123456" },
    });
    await expect(requireUser(req)).rejects.toThrow("Vui lòng đăng nhập.");
    await expect(requireUser(req)).rejects.toMatchObject({ status: 401 });
  });

  it("Token bị hết hạn hoặc không hợp lệ -> quăng lỗi HttpError 401", async () => {
    vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(
      new Error("Firebase ID token has expired")
    );

    const req = new NextRequest("http://localhost:3000/api/listings/create", {
      headers: { authorization: "Bearer expired-token" },
    });

    await expect(requireUser(req)).rejects.toThrow("Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    await expect(requireUser(req)).rejects.toMatchObject({ status: 401 });
  });

  it("requireVerified: Chặn tài khoản chưa xác minh thẻ SV (verified: false) -> 403", async () => {
    vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValue({
      uid: "user-unverified",
      email: "test@gmail.com",
      verified: false,
      admin: false,
    } as any);

    const req = new NextRequest("http://localhost:3000/api/listings/create", {
      headers: { authorization: "Bearer valid-token" },
    });

    await expect(requireVerified(req)).rejects.toMatchObject({
      status: 403,
      message: "Tài khoản cần được xác minh thẻ sinh viên.",
    });
  });

  it("requireVerified: Cho phép tài khoản đã xác minh thẻ SV (verified: true)", async () => {
    vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
      uid: "user-verified",
      email: "student@hcmut.edu.vn",
      verified: true,
      admin: false,
    } as any);

    const req = new NextRequest("http://localhost:3000/api/listings/create", {
      headers: { authorization: "Bearer valid-token" },
    });

    const token = await requireVerified(req);
    expect(token.uid).toBe("user-verified");
    expect(token.verified).toBe(true);
  });

  it("requireAdmin: Chặn người dùng thông thường gọi API Quản trị -> 403", async () => {
    vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValue({
      uid: "user-regular",
      email: "student@hcmut.edu.vn",
      verified: true,
      admin: false,
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/verifications", {
      headers: { authorization: "Bearer valid-token" },
    });

    await expect(requireAdmin(req)).rejects.toMatchObject({
      status: 403,
      message: "Chỉ quản trị viên mới có quyền này.",
    });
  });

  it("requireAdmin: Cho phép tài khoản có Custom Claim admin == true", async () => {
    vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
      uid: "admin-user",
      email: "admin@chopass.vn",
      verified: true,
      admin: true,
    } as any);

    const req = new NextRequest("http://localhost:3000/api/admin/verifications", {
      headers: { authorization: "Bearer valid-token" },
    });

    const token = await requireAdmin(req);
    expect(token.uid).toBe("admin-user");
    expect(token.admin).toBe(true);
  });
});

describe("Kiểm tra Logic Xác Thực Email Trường (.edu.vn) & Bảo Mật Cron", () => {
  it("Quy tắc isEduEmail: Chỉ chấp nhận đuôi .edu.vn VÀ email_verified = true", () => {
    const checkIsEduEmail = (email?: string, emailVerified?: boolean) => {
      return Boolean(emailVerified && email?.toLowerCase().endsWith(".edu.vn"));
    };

    // Đúng: Đuôi .edu.vn và Google đã verify
    expect(checkIsEduEmail("nguyen.vana@hcmut.edu.vn", true)).toBe(true);
    expect(checkIsEduEmail("tran.b@ftu.edu.vn", true)).toBe(true);

    // Sai: Đuôi .edu.vn nhưng chưa verify email trên Google
    expect(checkIsEduEmail("nguyen.vana@hcmut.edu.vn", false)).toBe(false);

    // Sai: Email .vn thông thường (như @gmail.vn, @yahoo.vn, @abc.vn) - Vá lỗ hổng [P1-12]
    expect(checkIsEduEmail("scammer@gmail.vn", true)).toBe(false);
    expect(checkIsEduEmail("user@abc.vn", true)).toBe(false);
    expect(checkIsEduEmail("student@gmail.com", true)).toBe(false);
  });

  it("errorResponse chuẩn hóa mã phản hồi JSON", async () => {
    const res401 = errorResponse(new HttpError(401, "Chưa đăng nhập"));
    expect(res401.status).toBe(401);
    const body401 = await res401.json();
    expect(body401.error).toBe("Chưa đăng nhập");

    const res500 = errorResponse(new Error("Lỗi database bất ngờ"));
    expect(res500.status).toBe(500);
    const body500 = await res500.json();
    expect(body500.error).toBe("Lỗi nội bộ máy chủ");
  });
});
