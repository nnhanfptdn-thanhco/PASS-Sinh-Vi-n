import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireAuth, requireVerified, requireAdmin } from "../src/lib/server/auth-guard";
import { readJson, ApiError, withApi } from "../src/lib/server/http";
import { hasContactInfo, createListingSchema } from "../src/lib/server/schemas";
import { adminAuth, adminDb } from "../src/lib/firebase/admin";
import { addDaysVN, todayVN } from "../src/lib/utils/date";

const FUTURE = addDaysVN(todayVN(), 10);

function mockFirestoreAccountState(opts?: {
  user?: Record<string, unknown> | null;
  pendingDeletion?: Record<string, unknown> | null;
  verification?: Record<string, unknown> | null;
}) {
  vi.spyOn(adminDb, "collection").mockImplementation((col: string) => {
    if (col === "users") {
      return {
        doc: () => ({
          get: vi.fn().mockResolvedValue(
            opts?.user ? { exists: true, data: () => opts.user } : { exists: false, data: () => null }
          ),
        }),
      } as any;
    }
    if (col === "pendingDeletions") {
      return {
        doc: () => ({
          get: vi.fn().mockResolvedValue(
            opts?.pendingDeletion
              ? { exists: true, data: () => opts.pendingDeletion }
              : { exists: false, data: () => null }
          ),
        }),
      } as any;
    }
    if (col === "verifications") {
      return {
        doc: () => ({
          get: vi.fn().mockResolvedValue(
            opts?.verification
              ? { exists: true, data: () => opts.verification }
              : { exists: false, data: () => null }
          ),
        }),
      } as any;
    }
    return {
      doc: () => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
      }),
    } as any;
  });
}

describe("Prompt 2: Hardening API Infrastructure & Guards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. requireAuth Guard (Fail-Closed Revocation & Account State)", () => {
    it("Không có token -> quăng ApiError 401 UNAUTHORIZED", async () => {
      const req = new NextRequest("http://localhost:3000/api/listings/create");
      await expect(requireAuth(req)).rejects.toMatchObject({
        status: 401,
        code: "UNAUTHORIZED",
      });
    });

    it("Token bình thường còn hạn + active -> trả AuthContextIdentity", async () => {
      const spy = vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "active-user-1",
        email: "sv@hcmut.edu.vn",
        name: "Sinh Viên",
      } as any);
      mockFirestoreAccountState();

      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { authorization: "Bearer valid-active-token" },
      });

      const auth = await requireAuth(req);
      expect(spy).toHaveBeenCalledWith("valid-active-token", true);
      expect(auth.uid).toBe("active-user-1");
      expect(auth.accountStatus).toBe("active");
    });

    it("Token bị revoke / disabled -> quăng ApiError 401 SESSION_REVOKED và KHÔNG fallback checkRevoked=false", async () => {
      const spy = vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(
        new Error("Firebase ID token has been revoked.")
      );

      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        headers: { authorization: "Bearer revoked-token" },
      });

      await expect(requireAuth(req)).rejects.toMatchObject({
        status: 401,
        code: "SESSION_REVOKED",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("revoked-token", true);
    });

    it("User bị disable (auth/user-disabled) -> quăng ApiError 401 SESSION_REVOKED", async () => {
      const err = Object.assign(new Error("The user record has been disabled by an administrator."), {
        code: "auth/user-disabled",
      });
      vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(err);

      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { authorization: "Bearer disabled-user-token" },
      });

      await expect(requireAuth(req)).rejects.toMatchObject({
        status: 401,
        code: "SESSION_REVOKED",
      });
    });

    it("Token hết hạn / không hợp lệ -> quăng ApiError 401 INVALID_TOKEN", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(
        new Error("Decoding Firebase ID token failed")
      );

      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        headers: { authorization: "Bearer invalid-token" },
      });

      await expect(requireAuth(req)).rejects.toMatchObject({
        status: 401,
        code: "INVALID_TOKEN",
      });
    });

    it("Thiếu default credentials hoặc ADC thiếu quyền check revoke -> quăng 503 AUTH_REVOCATION_CHECK_UNAVAILABLE (tuyệt đối KHÔNG fallback false)", async () => {
      const spy = vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(
        new Error("Could not load the default credentials.")
      );

      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { authorization: "Bearer adc-token" },
      });

      await expect(requireAuth(req)).rejects.toMatchObject({
        status: 503,
        code: "AUTH_REVOCATION_CHECK_UNAVAILABLE",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("adc-token", true);
    });

    it("Auth service timeout / network failure -> quăng 503 AUTH_SERVICE_UNAVAILABLE", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(
        new Error("ETIMEDOUT connecting to identitytoolkit.googleapis.com")
      );

      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { authorization: "Bearer timeout-token" },
      });

      await expect(requireAuth(req)).rejects.toMatchObject({
        status: 503,
        code: "AUTH_SERVICE_UNAVAILABLE",
      });
    });

    it("Tài khoản đang xóa (deleting) -> bị từ chối 423 ACCOUNT_DELETING kể cả với admin claim", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "deleting-admin",
        admin: true,
      } as any);
      mockFirestoreAccountState({
        pendingDeletion: { userId: "deleting-admin", deletionState: "pending", startedAt: new Date() },
      });

      const req = new NextRequest("http://localhost:3000/api/admin/verifications", {
        headers: { authorization: "Bearer valid-token" },
      });

      await expect(requireAdmin(req)).rejects.toMatchObject({
        status: 423,
        code: "ACCOUNT_DELETING",
      });
    });

    it("Tài khoản bị banned -> bị từ chối 403 ACCOUNT_INACTIVE kể cả với claim verified", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "banned-user",
        verified: true,
      } as any);
      mockFirestoreAccountState({
        user: { status: "banned" },
        verification: { status: "approved" },
      });

      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        headers: { authorization: "Bearer valid-token" },
      });

      await expect(requireVerified(req)).rejects.toMatchObject({
        status: 403,
        code: "ACCOUNT_INACTIVE",
      });
    });
  });

  describe("2. requireVerified Guard (Single Source of Truth: Firestore)", () => {
    it("Chặn người dùng khi doc verifications/{uid} không tồn tại hoặc chưa approved -> 403", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "user-unverified",
        email: "test@gmail.com",
        verified: true, // Claim cũ giả mạo hoặc chưa revoke
      } as any);

      // Mock Firestore doc verifications không tồn tại
      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: () => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      } as any);

      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        headers: { authorization: "Bearer valid-token" },
      });

      await expect(requireVerified(req)).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN_NOT_VERIFIED",
      });
    });

    it("Cho phép khi Firestore xác nhận status === 'approved'", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "user-verified",
        email: "test@fpt.edu.vn",
      } as any);

      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ status: "approved", schoolCode: "FPT-DN" }),
          }),
        }),
      } as any);

      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        headers: { authorization: "Bearer valid-token" },
      });

      const user = await requireVerified(req);
      expect(user.uid).toBe("user-verified");
      expect(user.verificationStatus).toBe("approved");
    });
  });

  describe("3. readJson & Payload Protection", () => {
    it("Từ chối khi Content-Type không phải JSON -> 415", async () => {
      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "plain text",
      });

      await expect(readJson(req)).rejects.toMatchObject({
        status: 415,
        code: "UNSUPPORTED_MEDIA_TYPE",
      });
    });

    it("Từ chối khi body vượt quá 64KB -> 413 PAYLOAD_TOO_LARGE", async () => {
      const largeString = "a".repeat(65 * 1024);
      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(largeString.length + 20),
        },
        body: JSON.stringify({ data: largeString }),
      });

      await expect(readJson(req, 64 * 1024)).rejects.toMatchObject({
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
      });
    });
  });

  describe("4. Schema .strict() & Chống chèn liên hệ công khai", () => {
    it("Chặn body có field lạ ngoài schema (chống giả mạo sellerId)", () => {
      const maliciousBody = {
        draftId: "draft-12345678",
        title: "Quạt đứng Senko còn mới",
        categoryId: "dien-may",
        condition: "Tốt",
        price: 150000,
        passDeadline: FUTURE,
        schoolCode: "FPT-DN",
        publicMeetingPoint: "Cổng KTX",
        exactAddress: "Phòng 301",
        shippingMethods: { pickup: true },
        images: ["img1", "img2", "img3"],
        sellerId: "hacker_uid", // Field lạ bị cấm bởi .strict()
      };

      const result = createListingSchema.safeParse(maliciousBody);
      expect(result.success).toBe(false);
    });

    it("hasContactInfo: Nhận diện chính xác số điện thoại VN và Zalo", () => {
      expect(hasContactInfo("Liên hệ mình qua 0912345678 nhé")).toBe(true);
      expect(hasContactInfo("Zalo: 0388999888")).toBe(true);
      expect(hasContactInfo("Xem thêm tại zalo.me/0909123456")).toBe(true);
      expect(hasContactInfo("Quạt Senko công suất 50W, lồng 40cm")).toBe(false);
    });
  });

  describe("5. withApi Error Handler", () => {
    it("Trả về mã lỗi HTTP và format chuẩn cho ApiError", async () => {
      const handler = withApi(async () => {
        throw new ApiError(404, "NOT_FOUND", "Không tìm thấy món đồ");
      });

      const res = await handler(new NextRequest("http://localhost:3000/api/test"));
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.code).toBe("NOT_FOUND");
      expect(data.error).toBe("Không tìm thấy món đồ");
    });
  });
});
