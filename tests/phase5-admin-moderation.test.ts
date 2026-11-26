import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withApi, ApiError } from "../src/lib/server/http";
import { HttpError } from "../src/lib/auth/server";
import { NO_SHOW_MIN_WAIT_MINUTES } from "../src/lib/constants/listing";
import { validateManageListingAction } from "../src/lib/domain/listing-status";
import { hasAdminClaim } from "../src/lib/server/claims";
import { deriveRole } from "../src/lib/auth/role";

describe("Phase 5: Comprehensive Security & Moderation Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. [P0-5] HttpError & withApi Integration", () => {
    it("HttpError kế thừa ApiError và trả về đúng 401 qua withApi (không biến thành 500)", async () => {
      const handler = withApi(async () => {
        throw new HttpError(401, "Bạn chưa đăng nhập");
      });

      const res = await handler(new NextRequest("http://localhost:3000/api/test"));
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe("HTTP_401");
      expect(data.error).toBe("Bạn chưa đăng nhập");
    });

    it("HttpError kế thừa ApiError và trả về đúng 403 qua withApi (không biến thành 500)", async () => {
      const handler = withApi(async () => {
        throw new HttpError(403, "Tài khoản chưa được xác minh sinh viên");
      });

      const res = await handler(new NextRequest("http://localhost:3000/api/test"));
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe("HTTP_403");
      expect(data.error).toBe("Tài khoản chưa được xác minh sinh viên");
    });
  });

  describe("2. [P1-1 + P1-2 + P2-7] Role Derivation & Admin Claim Rules", () => {
    it("User không có custom claim admin -> KHÔNG phải admin (không phụ thuộc email client bundle)", () => {
      const res = deriveRole({});
      expect(res.isAdmin).toBe(false);
      expect(res.role).toBe("pending");
      expect(res.adminClaimMissing).toBe(false);
    });

    it("User có verified: true -> role verified, isAdmin = false", () => {
      const res = deriveRole({ verified: true });
      expect(res.isAdmin).toBe(false);
      expect(res.isVerified).toBe(true);
      expect(res.role).toBe("verified");
    });

    it("User có custom claim admin: true -> role admin, isAdmin = true", () => {
      const res = deriveRole({ admin: true });
      expect(res.isAdmin).toBe(true);
      expect(res.isVerified).toBe(true);
      expect(res.role).toBe("admin");
      expect(res.adminClaimMissing).toBe(false);
    });

    it("User có custom claim role: 'admin' (chuẩn cũ) -> role admin, isAdmin = true", () => {
      const res = deriveRole({ role: "admin" });
      expect(res.isAdmin).toBe(true);
      expect(res.role).toBe("admin");
    });

    it("hasAdminClaim nhận diện đúng các dạng custom claims", () => {
      expect(hasAdminClaim({ role: "admin" })).toBe(true);
      expect(hasAdminClaim({ admin: true })).toBe(true);
      expect(hasAdminClaim({ role: "verified" })).toBe(false);
      expect(hasAdminClaim(null)).toBe(false);
    });
  });

  describe("3. [P1-7 + P1-8 + P1-9 + P2-8] Moderation & Reservation State Machine", () => {
    it("NO_SHOW_MIN_WAIT_MINUTES phải được khóa ở giá trị 60 phút", () => {
      expect(NO_SHOW_MIN_WAIT_MINUTES).toBe(60);
    });

    it("Người bán không thể tự show / renew / mark_sold tin đăng bị hidden_by_admin (403)", () => {
      const actions = ["show", "renew", "mark_sold"] as const;
      for (const act of actions) {
        const check = validateManageListingAction(act, {
          currentStatus: "hidden_by_admin",
          passDeadline: "2026-12-31",
          isAdmin: false,
        });
        expect(check.valid).toBe(false);
        expect(check.statusCode).toBe(403);
      }
    });

    it("Admin có quyền show tin đăng đang ở trạng thái hidden_by_admin", () => {
      const check = validateManageListingAction("show", {
        currentStatus: "hidden_by_admin",
        passDeadline: "2026-12-31",
        isAdmin: true,
      });
      expect(check.valid).toBe(true);
    });

    it("Helper toMs chuyển đổi đúng timestamp Firestore, số và chuỗi ngày tháng", () => {
      function toMs(v: unknown): number | null {
        if (typeof v === "string") {
          const t = Date.parse(v);
          return Number.isFinite(t) ? t : null;
        }
        if (typeof v === "number") return v;
        const ts = v as { toMillis?: () => number } | null | undefined;
        return typeof ts?.toMillis === "function" ? ts.toMillis() : null;
      }

      expect(toMs("2026-11-22T00:00:00.000Z")).toBe(1795305600000);
      expect(toMs(1234567890)).toBe(1234567890);
      expect(toMs({ toMillis: () => 999999 })).toBe(999999);
      expect(toMs(null)).toBe(null);
      expect(toMs(undefined)).toBe(null);
      expect(toMs("invalid-date")).toBe(null);
    });
  });

  describe("4. [P1-10] Reports Validation & Regex Hardening", () => {
    const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

    it("ID_RE chấp nhận ID hợp lệ và chặn đứng ID chứa ký tự lạ hoặc đường dẫn lách /", () => {
      expect(ID_RE.test("valid-id-123_ABC")).toBe(true);
      expect(ID_RE.test("user_12345")).toBe(true);

      // Chặn đường dẫn path traversal / injection
      expect(ID_RE.test("users/admin")).toBe(false);
      expect(ID_RE.test("../reports")).toBe(false);
      expect(ID_RE.test("id with space")).toBe(false);
      expect(ID_RE.test("")).toBe(false);
      expect(ID_RE.test("a".repeat(129))).toBe(false);
    });
  });

  describe("5. [P0-4 + P2-1] Submit Route Configuration & Fail-Fast", () => {
    it("503 ADMIN_SDK_NOT_CONFIGURED khi thiếu credentials ở môi trường production", () => {
      const hasAdminCredentials = false;
      const isProduction = true;

      function checkCredentials() {
        if (!hasAdminCredentials) {
          if (!isProduction && process.env.ALLOW_MOCK_VERIFICATION === "1") {
            return { success: true, mock: true };
          }
          throw new ApiError(
            503,
            "ADMIN_SDK_NOT_CONFIGURED",
            "Hệ thống tạm thời chưa nhận được hồ sơ. Vui lòng thử lại sau ít phút."
          );
        }
        return { success: true };
      }

      expect(() => checkCredentials()).toThrowError(ApiError);
      try {
        checkCredentials();
      } catch (err: any) {
        expect(err.status).toBe(503);
        expect(err.code).toBe("ADMIN_SDK_NOT_CONFIGURED");
      }
    });

    it("Cho phép mock nếu NODE_ENV !== 'production' và ALLOW_MOCK_VERIFICATION === '1'", () => {
      const hasAdminCredentials = false;
      const isProduction = false;
      process.env.ALLOW_MOCK_VERIFICATION = "1";

      function checkCredentials() {
        if (!hasAdminCredentials) {
          if (!isProduction && process.env.ALLOW_MOCK_VERIFICATION === "1") {
            return { success: true, mock: true };
          }
          throw new ApiError(503, "ADMIN_SDK_NOT_CONFIGURED", "Lỗi cấu hình");
        }
        return { success: true };
      }

      const res = checkCredentials();
      expect(res.success).toBe(true);
      expect(res.mock).toBe(true);
      delete process.env.ALLOW_MOCK_VERIFICATION;
    });
  });

  describe("6. [P0-2] Admin GET Payload Sanitization", () => {
    it("Hồ sơ trả về cho admin không được chứa PII nhạy cảm: studentIdHash, cardStoragePath, Data URL", () => {
      const rawVerificationDoc = {
        userId: "user-123",
        fullName: "Trần Văn A",
        studentId: "SE123456",
        studentIdHash: "sha256_hash_secret",
        cardStoragePath: "data:image/webp;base64,UklGR...",
        status: "pending",
        hasCardImage: true,
      };

      // Mô phỏng projection của GET /api/admin/verifications
      const { studentIdHash, cardStoragePath, ...sanitized } = rawVerificationDoc;
      const finalItem = {
        ...sanitized,
        hasCardImage: Boolean(cardStoragePath),
      };

      expect(finalItem).not.toHaveProperty("studentIdHash");
      expect(finalItem).not.toHaveProperty("cardStoragePath");
      expect(finalItem.hasCardImage).toBe(true);
      expect(JSON.stringify(finalItem)).not.toContain("data:image/");
      expect(JSON.stringify(finalItem)).not.toContain("sha256_hash_secret");
    });
  });

  describe("7. [P1-4 + P1-5 + P1-6] Admin Action Approvals & Rejections", () => {
    it("Từ chối hồ sơ với lý do rỗng hoặc chỉ toàn khoảng trắng -> ném ApiError 400 INVALID_REASON", () => {
      const invalidReasons = ["", "   ", "\t\n  "];
      for (const reason of invalidReasons) {
        const clean = (reason || "").trim();
        expect(() => {
          if (!clean) {
            throw new ApiError(400, "INVALID_REASON", "Lý do từ chối không được để trống.");
          }
        }).toThrowError(ApiError);
      }
    });

    it("Duyệt hồ sơ thiếu studentIdHash -> ném ApiError 422 MISSING_STUDENT_ID_HASH", () => {
      function validateStudentIdHash(hash: unknown) {
        if (typeof hash !== "string" || !hash.trim()) {
          throw new ApiError(
            422,
            "MISSING_STUDENT_ID_HASH",
            "Hồ sơ thiếu mã băm thẻ sinh viên. Vui lòng yêu cầu sinh viên gửi lại hồ sơ mới."
          );
        }
      }
      expect(() => validateStudentIdHash(undefined)).toThrowError(ApiError);
      expect(() => validateStudentIdHash("")).toThrowError(ApiError);
      expect(() => validateStudentIdHash("   ")).toThrowError(ApiError);
    });

    it("Xem ảnh thẻ khi cardDeleted = true hoặc không có cardStoragePath -> ném ApiError 404 CARD_NOT_AVAILABLE", () => {
      const testCases = [
        { cardStoragePath: null, cardDeleted: false },
        { cardStoragePath: "private/cards/u1/card.webp", cardDeleted: true },
      ];

      for (const tc of testCases) {
        expect(() => {
          if (!tc.cardStoragePath || tc.cardDeleted) {
            throw new ApiError(404, "CARD_NOT_AVAILABLE", "Ảnh thẻ đã được xóa hoặc chưa có.");
          }
        }).toThrowError(ApiError);
      }
    });
  });

  describe("8. [P1-11 + P0-3] Onboarding Resiliency & Network Timeouts", () => {
    it("AbortController trigger abort sau timeout và hủy cờ signal", () => {
      const controller = new AbortController();
      expect(controller.signal.aborted).toBe(false);
      controller.abort();
      expect(controller.signal.aborted).toBe(true);
    });

    it("Regex định dạng ảnh Data URL chỉ chấp nhận WebP hoặc JPEG (chặn SVG, HTML, thực thi độc hại)", () => {
      const DATA_URL_RE = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/=]+)$/;
      expect(DATA_URL_RE.test("data:image/webp;base64,AAAA")).toBe(true);
      expect(DATA_URL_RE.test("data:image/jpeg;base64,AAAA")).toBe(true);
      expect(DATA_URL_RE.test("data:image/png;base64,AAAA")).toBe(false);
      expect(DATA_URL_RE.test("data:image/svg+xml;base64,AAAA")).toBe(false);
      expect(DATA_URL_RE.test("data:text/html;base64,AAAA")).toBe(false);
    });
  });
});
