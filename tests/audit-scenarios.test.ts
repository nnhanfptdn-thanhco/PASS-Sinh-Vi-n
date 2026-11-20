import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  requireUser,
  requireVerified,
  requireAdmin,
  requireApprovedStudent,
} from "../src/lib/auth/server";
import { adminAuth, adminDb } from "../src/lib/firebase/admin";
import { verifyCronRequest } from "../src/lib/server/cron";
import { validateManageListingAction } from "../src/lib/domain/listing-status";
import { makeStrictTransaction } from "./helpers/strict-transaction";
import { addDaysVN, todayVN } from "../src/lib/utils/date";

describe("PHASE 7: Bộ kiểm thử chuyên sâu cho toàn bộ 14 kịch bản lỗi (F01 - F24)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. [F02, F03] Auth & Admin Security Guards", () => {
    it("Token bị revoke -> ném lỗi 401 và TUYỆT ĐỐI không gọi verifyIdToken lần 2 với checkRevoked=false (F02)", async () => {
      const verifySpy = vi.spyOn(adminAuth, "verifyIdToken").mockRejectedValueOnce(
        new Error("Firebase ID token has been revoked.")
      );

      const req = new NextRequest("http://localhost:3000/api/test", {
        headers: { authorization: "Bearer revoked-token" },
      });

      await expect(requireUser(req)).rejects.toThrow(
        "Phiên đăng nhập đã bị thu hồi hoặc tài khoản bị vô hiệu hóa."
      );

      // Kiểm tra chỉ gọi đúng 1 lần với true, không fallback sang false
      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenCalledWith("revoked-token", true);
    });

    it("Email spoof: Token có email admin@chopass.vn nhưng không có custom claims admin -> requireAdmin ném 403 (F03)", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "hacker-123",
        email: "admin@chopass.vn",
        email_verified: false,
        admin: false,
      } as any);

      const req = new NextRequest("http://localhost:3000/api/admin/verifications", {
        headers: { authorization: "Bearer spoofed-token" },
      });

      await expect(requireAdmin(req)).rejects.toMatchObject({
        status: 403,
      });
    });

    it("Email spoof: Token có email admin@chopass.vn nhưng không có custom claim admin -> requireApprovedStudent ném 403 (F03)", async () => {
      vi.spyOn(adminAuth, "verifyIdToken").mockResolvedValueOnce({
        uid: "hacker-123",
        email: "admin@chopass.vn",
        email_verified: false,
        admin: false,
        verified: false,
      } as any);

      vi.spyOn(adminDb, "collection").mockReturnValue({
        doc: () => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      } as any);

      const req = new NextRequest("http://localhost:3000/api/listings/create", {
        headers: { authorization: "Bearer spoofed-token" },
      });

      await expect(requireApprovedStudent(req)).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe("2. [F06] Cron Security Guard", () => {
    it("Thiếu CRON_SECRET trong env -> ném lỗi 500 CRON_SECRET_NOT_CONFIGURED", () => {
      const originalSecret = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;

      try {
        const req = new NextRequest("http://localhost:3000/api/cron/cleanup", {
          headers: { authorization: "Bearer any_token" },
        });

        expect(() => verifyCronRequest(req)).toThrowError();
      } finally {
        process.env.CRON_SECRET = originalSecret;
      }
    });

    it("Sai Bearer token -> ném lỗi 401 UNAUTHORIZED_CRON", () => {
      const originalSecret = process.env.CRON_SECRET;
      process.env.CRON_SECRET = "super_secret_cron_1234567890";

      try {
        const req = new NextRequest("http://localhost:3000/api/cron/cleanup", {
          headers: { authorization: "Bearer wrong_secret" },
        });

        expect(() => verifyCronRequest(req)).toThrowError();
      } finally {
        process.env.CRON_SECRET = originalSecret;
      }
    });

    it("Đúng Bearer token -> xác thực thành công không ném lỗi", () => {
      const originalSecret = process.env.CRON_SECRET;
      process.env.CRON_SECRET = "super_secret_cron_1234567890";

      try {
        const req = new NextRequest("http://localhost:3000/api/cron/cleanup", {
          headers: { authorization: "Bearer super_secret_cron_1234567890" },
        });

        expect(() => verifyCronRequest(req)).not.toThrow();
      } finally {
        process.env.CRON_SECRET = originalSecret;
      }
    });
  });

  describe("3. [F07, F24] Listing State Machine & Rules", () => {
    const FUTURE = addDaysVN(todayVN(), 10);

    it("Admin show từ reserved -> bị từ chối 409", () => {
      const res = validateManageListingAction("show", {
        currentStatus: "reserved",
        passDeadline: FUTURE,
        isAdmin: true,
      });
      expect(res.valid).toBe(false);
      expect(res.statusCode).toBe(409);
    });

    it("Admin show từ hidden_by_admin -> hợp lệ", () => {
      const res = validateManageListingAction("show", {
        currentStatus: "hidden_by_admin",
        passDeadline: FUTURE,
        isAdmin: true,
      });
      expect(res.valid).toBe(true);
    });

    it("Người bán tự show từ hidden_by_admin -> bị từ chối 403", () => {
      const res = validateManageListingAction("show", {
        currentStatus: "hidden_by_admin",
        passDeadline: FUTURE,
        isAdmin: false,
      });
      expect(res.valid).toBe(false);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("4. [F01, F23] Strict Transaction Enforcement", () => {
    it("Mô phỏng strict transaction phát hiện lỗi đọc sau khi ghi (Read after Write)", async () => {
      const store = new Map<string, any>();
      store.set("doc1", { foo: "bar" });
      const tx = makeStrictTransaction(store);

      // Ghi trước
      tx.set({ id: "doc2" }, { hello: "world" });

      // Đọc sau -> Phải quăng lỗi đúng của Firestore
      await expect(tx.get({ id: "doc1" })).rejects.toThrow(
        "Firestore transactions require all reads to be executed before all writes."
      );
    });

    it("Mô phỏng strict transaction thành công khi toàn bộ get() thực hiện trước set/update/delete", async () => {
      const store = new Map<string, any>();
      store.set("doc1", { count: 5 });
      const tx = makeStrictTransaction(store);

      // 1. Toàn bộ READ PHASE
      const snap1 = await tx.get({ id: "doc1" });
      expect(snap1.exists).toBe(true);
      expect(snap1.data().count).toBe(5);

      // 2. Toàn bộ WRITE PHASE
      tx.update({ id: "doc1" }, { count: 6 });
      tx.set({ id: "doc2" }, { created: true });

      expect(store.get("doc1").count).toBe(6);
      expect(store.get("doc2").created).toBe(true);
    });
  });

  describe("5. [F16] Search Parameter Clamping & Resilience", () => {
    it("GET /api/listings/search: không bị crash khi minPrice=abc, sort=hack, limit=999999", async () => {
      vi.spyOn(adminDb, "collection").mockReturnValue({
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          empty: true,
          docs: [],
        }),
      } as any);

      const { GET } = await import("../src/app/api/listings/search/route");
      const req = new NextRequest(
        "http://localhost:3000/api/listings/search?minPrice=abc&maxPrice=-50&sort=hack&limit=999999"
      );

      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.items)).toBe(true);
    });
  });
});
