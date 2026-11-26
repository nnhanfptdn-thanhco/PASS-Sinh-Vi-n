import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { adminAuth, adminDb, adminStorage } from "../src/lib/firebase/admin";
import { consumeRateLimit } from "../src/lib/server/rate-limit";
import { validateDisplayName, isImpersonatingName, containsContactInfo } from "../src/lib/utils/contact-filter";
import { ApiError } from "../src/lib/server/http";

describe("Security Fixes Audit Test Suite (Full Test Coverage)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Rate-Limit Fail-Closed (Không Mở Cửa Khi Lỗi)", () => {
    it("Khi adminDb.runTransaction gặp lỗi hạ tầng -> ném ApiError 503 (Fail-Closed, không trả thành công)", async () => {
      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: vi.fn().mockReturnValue({ id: "mock-rate-doc" }),
      } as any);

      vi.spyOn(adminDb, "runTransaction").mockRejectedValueOnce(
        new Error("Firestore connection timeout / database unavailable")
      );

      await expect(
        consumeRateLimit({
          scope: "test_scope" as any,
          key: "user-123",
          limit: 5,
          windowSec: 60,
        })
      ).rejects.toThrow("Dịch vụ giới hạn tần suất tạm thời không khả dụng.");

      await expect(
        consumeRateLimit({
          scope: "test_scope" as any,
          key: "user-123",
          limit: 5,
          windowSec: 60,
        })
      ).rejects.toMatchObject({
        status: 503,
        code: "RATE_LIMIT_UNAVAILABLE",
      });
    });

    it("Khi vượt quá hạn mức -> ném ApiError 429 RATE_LIMIT_EXCEEDED", async () => {
      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: vi.fn().mockReturnValue({ id: "mock-rate-doc" }),
      } as any);

      vi.spyOn(adminDb, "runTransaction").mockImplementation(async (cb: any) => {
        return cb({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ count: 5 }),
          }),
          set: vi.fn(),
        });
      });

      await expect(
        consumeRateLimit({
          scope: "test_scope" as any,
          key: "user-123",
          limit: 5,
          windowSec: 60,
        })
      ).rejects.toMatchObject({
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
      });
    });
  });

  describe("2. Tên Hiển Thị: Lọc Thông Tin Liên Hệ & Chống Giả Mạo Admin (WP-0.3 / WP-0.4)", () => {
    it("Phát hiện các tên giả mạo Ban Quản Trị / Admin / Hệ Thống", () => {
      expect(isImpersonatingName("Admin")).toBe(true);
      expect(isImpersonatingName("administrator")).toBe(true);
      expect(isImpersonatingName("Quản Trị Viên")).toBe(true);
      expect(isImpersonatingName("quan tri vien")).toBe(true);
      expect(isImpersonatingName("BQT Chợ Pass")).toBe(true);
      expect(isImpersonatingName("Ban Quản Trị")).toBe(true);
      expect(isImpersonatingName("Chợ Pass Official")).toBe(true);
      expect(isImpersonatingName("Chopass Support")).toBe(true);
      expect(isImpersonatingName("Hỗ Trợ Kỹ Thuật")).toBe(true);
      expect(isImpersonatingName("System Admin")).toBe(true);
      expect(isImpersonatingName("Moderator")).toBe(true);

      // Tên sinh viên bình thường hợp lệ
      expect(isImpersonatingName("Nguyễn Văn An")).toBe(false);
      expect(isImpersonatingName("Trần Thị Bình Bách Khoa")).toBe(false);
      expect(isImpersonatingName("Lê Hoàng Nam K65")).toBe(false);
    });

    it("validateDisplayName chặn số điện thoại, Zalo và tên giả mạo", () => {
      // Chặn số điện thoại
      const phoneRes = validateDisplayName("Nguyễn Văn A 0905123456");
      expect(phoneRes.valid).toBe(false);
      expect(phoneRes.error).toContain("liên kết mạng xã hội");

      // Chặn Zalo
      const zaloRes = validateDisplayName("Zalo 0912345678");
      expect(zaloRes.valid).toBe(false);

      // Chặn tên giả mạo
      const fakeAdminRes = validateDisplayName("Ban Quản Trị Hệ Thống");
      expect(fakeAdminRes.valid).toBe(false);
      expect(fakeAdminRes.error).toContain("giả mạo");

      // Cho phép tên hợp lệ
      const validRes = validateDisplayName("Nguyễn Văn An");
      expect(validRes.valid).toBe(true);
    });
  });

  describe("3. Route /api/account/profile: Validation displayName & photoURL", () => {
    it("POST /api/account/profile: chặn displayName chứa số điện thoại hoặc giả mạo admin", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValue({
        uid: "user-test-profile",
        email: "test@gmail.com",
      } as any);

      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: vi.fn().mockReturnValue({
          id: "mock-doc",
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      } as any);

      vi.spyOn(adminDb, "runTransaction").mockImplementation(async (cb: any) => {
        return cb({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
          set: vi.fn(),
        });
      });

      const { POST } = await import("../src/app/api/account/profile/route");

      // Test tên chứa SĐT
      const reqWithPhone = new NextRequest("http://localhost:3000/api/account/profile", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Sinh viên 0905123456" }),
      });
      const resPhone = await POST(reqWithPhone);
      expect(resPhone.status).toBe(400);
      const dataPhone = await resPhone.json();
      expect(dataPhone.code).toBe("INVALID_DISPLAY_NAME");

      // Test tên giả mạo Admin
      const reqWithAdmin = new NextRequest("http://localhost:3000/api/account/profile", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Admin Chợ Pass" }),
      });
      const resAdmin = await POST(reqWithAdmin);
      expect(resAdmin.status).toBe(400);
      const dataAdmin = await resAdmin.json();
      expect(dataAdmin.code).toBe("INVALID_DISPLAY_NAME");
    });

    it("POST /api/account/profile: chặn photoURL từ bucket lạ hoặc đường dẫn không phải avatars của user", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValue({
        uid: "user-123",
        email: "test@gmail.com",
      } as any);

      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: vi.fn().mockReturnValue({
          id: "mock-doc",
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      } as any);

      vi.spyOn(adminDb, "runTransaction").mockImplementation(async (cb: any) => {
        return cb({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
          set: vi.fn(),
        });
      });

      const { POST } = await import("../src/app/api/account/profile/route");

      // Bucket lạ
      const reqBadBucket = new NextRequest("http://localhost:3000/api/account/profile", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          photoURL: "https://firebasestorage.googleapis.com/v0/b/other-hacked-bucket.appspot.com/o/avatar.jpg",
        }),
      });
      const resBad = await POST(reqBadBucket);
      expect(resBad.status).toBe(400);
      const dataBad = await resBad.json();
      expect(dataBad.code).toBe("INVALID_PHOTO_URL");

      // Đường dẫn của user khác
      const reqOtherUser = new NextRequest("http://localhost:3000/api/account/profile", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          photoURL:
            "https://firebasestorage.googleapis.com/v0/b/cho-pass-sv.firebasestorage.app/o/public%2Favatars%2Fuser-VICTIM%2Favatar.jpg",
        }),
      });
      const resOther = await POST(reqOtherUser);
      expect(resOther.status).toBe(400);
      expect((await resOther.json()).code).toBe("INVALID_PHOTO_URL");
    });
  });

  describe("4. Phương Án A: Cổng Bảo Mật /api/listings/contact Không Đốt Rate Limit Khi Chưa Được Xác Nhận", () => {
    it("Người xem không phải người mua được confirmed -> trả 403 và KHÔNG gọi rate-limit", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValue({
        uid: "viewer-unconfirmed",
        email: "viewer@gmail.com",
      } as any);

      // Mock Firestore
      vi.spyOn(adminDb, "collection").mockImplementation((colName: string) => {
        if (colName === "verifications") {
          return {
            doc: () => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  status: "approved",
                }),
              }),
            }),
          } as any;
        }
        if (colName === "listings") {
          return {
            doc: () => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  status: "reserved",
                  sellerId: "seller-456",
                  passDeadline: "2030-01-01",
                }),
              }),
            }),
          } as any;
        }
        if (colName === "listingsPrivate") {
          return {
            doc: () => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  confirmedBuyerId: "confirmed-buyer-789", // Khác viewer-unconfirmed!
                  sellerPhone: "0905123456",
                }),
              }),
            }),
          } as any;
        }
        if (colName === "contactViewLogs") {
          return {
            doc: () => ({
              get: vi.fn().mockResolvedValue({
                exists: false,
              }),
              set: vi.fn().mockResolvedValue(true),
            }),
          } as any;
        }
        return {
          doc: vi.fn().mockReturnValue({ id: "mock-doc", get: vi.fn().mockResolvedValue({ exists: false }) }),
        } as any;
      });

      const rateLimitSpy = vi.spyOn(adminDb, "runTransaction");

      const { POST } = await import("../src/app/api/listings/contact/route");
      const req = new NextRequest("http://localhost:3000/api/listings/contact", {
        method: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ listingId: "listing-123" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe("RESERVATION_CONFIRMATION_REQUIRED");

      // Đảm bảo runTransaction của rateLimit TUYỆT ĐỐI không bị gọi
      expect(rateLimitSpy).not.toHaveBeenCalled();
    });
  });

  describe("5. Sweeper Cron & Dead-Letter Logic (/api/cron/purge-accounts)", () => {
    it("Tài khoản lỗi quá 3 lần -> đánh dấu deadLetter = true", async () => {
      const mockDocUpdate = vi.fn().mockResolvedValue(true);
      const mockAlertSet = vi.fn().mockResolvedValue(true);
      const mockPendingData = {
        studentIdHash: "hash-999",
        attempts: 2, // Lần thử tiếp theo sẽ là 3 -> Dead Letter
        deadLetter: false,
      };
      const mockPendingDoc = {
        id: "stuck-user-999",
        data: () => mockPendingData,
        ref: { update: mockDocUpdate },
      };

      vi.spyOn(adminDb, "collection").mockImplementation((name: string) => {
        if (name === "deadLetterAlerts" || name === "adminLogs") {
          return {
            doc: vi.fn().mockReturnValue({
              set: mockAlertSet,
            }),
          } as any;
        }
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: [mockPendingDoc],
          }),
        } as any;
      });

      vi.spyOn(adminDb, "runTransaction").mockImplementation(async (cb: any) => {
        return cb({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => mockPendingData,
          }),
          update: vi.fn(),
        });
      });

      // Mock purgeUserData ném lỗi (ví dụ Firebase Auth gặp lỗi)
      const purgeModule = await import("../src/lib/services/account-purge");
      vi.spyOn(purgeModule, "purgeUserData").mockRejectedValueOnce(
        new Error("Permanent database failure")
      );

      const originalCronSecret = process.env.CRON_SECRET;
      process.env.CRON_SECRET = "test-cron-secret";

      try {
        const { GET } = await import("../src/app/api/cron/purge-accounts/route");
        const req = new NextRequest("http://localhost:3000/api/cron/purge-accounts", {
          headers: {
            authorization: "Bearer test-cron-secret",
          },
        });

        const res = await GET(req);
        expect(res.status).toBe(200);

        expect(mockDocUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            attempts: 3,
            deadLetter: true,
            lastError: "Permanent database failure",
          })
        );
        expect(mockAlertSet).toHaveBeenCalled();
      } finally {
        process.env.CRON_SECRET = originalCronSecret;
      }
    });
  });
});
