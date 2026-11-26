import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { createListingSchema } from "../src/lib/server/schemas";
import { addDaysVN, todayVN } from "../src/lib/utils/date";

vi.mock("server-only", () => ({}));

describe("Phase 1 Remediation Test Suite (C3 - C10)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("C10: Nested Zod .strict() từ chối key lạ trong shippingMethods và itemDimensions", () => {
    const basePayload = {
      title: "Giáo trình Giải tích 1 Đại học Bách Khoa",
      categoryId: "giao-trinh",
      condition: "good",
      price: 45000,
      passDeadline: addDaysVN(todayVN(), 7),
      images: ["https://firebasestorage.googleapis.com/v0/b/b/o/public%2Flistings%2Fu%2Fd%2Fimg_1.webp"],
      shippingMethods: { pickup: true, extraEvilField: "injected" },
    };

    expect(() => createListingSchema.parse(basePayload)).toThrow(z.ZodError);

    const payload2 = {
      ...basePayload,
      shippingMethods: { pickup: true },
      itemDimensions: { weight: "2kg", unexpectedAdminFlag: true },
    };
    expect(() => createListingSchema.parse(payload2)).toThrow(z.ZodError);
  });

  it("C10: GET /api/listings/search từ chối duplicate query parameters (HTTP Parameter Pollution)", async () => {
    vi.doMock("../src/lib/server/rate-limit", () => ({
      consumeRateLimit: vi.fn().mockResolvedValue({ count: 1, remaining: 59, resetAt: Date.now() + 60_000 }),
    }));
    vi.doMock("../src/lib/services/listings", () => ({
      searchListings: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    }));

    const { GET } = await import("../src/app/api/listings/search/route");
    const req = new NextRequest("http://localhost:3000/api/listings/search?q=laptop&q=iphone");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("DUPLICATE_QUERY_PARAM");
  });

  it("C3: Option A fail-closed khi holdExpiresAt thiếu hoặc đã quá 72 giờ (không tiêu rate-limit)", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    const authGuardModule = await import("../src/lib/server/auth-guard");
    const rateLimitSpy = vi.spyOn(adminModule.adminDb, "runTransaction");

    vi.spyOn(authGuardModule, "requireApprovedStudent").mockResolvedValue({
      uid: "buyer-1",
      email: "buyer@fpt.edu.vn",
      name: "Buyer",
      claims: {},
      isAdmin: false,
      isVerifiedStudent: true,
      accountStatus: "active",
      verificationStatus: "approved",
      verification: { status: "approved" },
      userDoc: { accountStatus: "active" },
      token: { uid: "buyer-1" } as any,
    });

    const pastIso = new Date(Date.now() - 60_000).toISOString();
    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((col: string) => {
      if (col === "listings") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: "reserved", sellerId: "seller-1", passDeadline: "2099-01-01" }),
            }),
          }),
        } as any;
      }
      if (col === "listingsPrivate") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                confirmedBuyerId: "buyer-1",
                confirmedReservationId: "res-1",
                confirmedUntil: pastIso,
              }),
            }),
          }),
        } as any;
      }
      if (col === "reservations") {
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            empty: false,
            docs: [
              {
                id: "res-1",
                data: () => ({
                  status: "confirmed",
                  buyerId: "buyer-1",
                  holdExpiresAt: pastIso,
                }),
              },
            ],
          }),
          doc: () => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                status: "confirmed",
                buyerId: "buyer-1",
                holdExpiresAt: pastIso,
              }),
            }),
          }),
        } as any;
      }
      return {
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        })),
      } as any;
    });

    const { POST } = await import("../src/app/api/listings/contact/route");
    const req = new NextRequest("http://localhost:3000/api/listings/contact", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify({ listingId: "listing_1" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe("LISTING_NOT_AVAILABLE");
    expect(rateLimitSpy).not.toHaveBeenCalled();
  });

  it("C4: processListingOperationJob xử lý 600 pending reservations theo các chunk <= 400 writes/batch", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    const commitBatchSizes: number[] = [];

    const fakeReservations = Array.from({ length: 600 }, (_, i) => ({
      id: `res_${i}`,
      ref: { path: `reservations/res_${i}` },
      data: () => ({
        buyerId: `buyer_${i}`,
        listingId: "listing_big",
        status: "pending",
      }),
    }));

    let remaining = [...fakeReservations];
    let jobData: Record<string, any> = {
      id: "job_600",
      type: "hide",
      listingId: "listing_big",
      listingTitle: "Xe đạp sinh viên",
      titleNormalized: "xe dap sinh vien",
      sellerId: "seller_1",
      previousStatus: "active",
      finalStatus: "hidden_by_seller",
      initiatorUid: "seller_1",
      initiatorEmail: "s@fpt.edu.vn",
      isModeration: false,
      excludeReservationId: null,
      targetStatuses: ["pending", "waitlisted"],
      cancelledBy: "seller",
      cancelReason: "Ẩn tin đăng",
      buyerNotifTitle: "Tin đã ẩn",
      buyerNotifBody: "Người bán đã ẩn tin",
      status: "pending",
      attempts: 0,
      deadLetter: false,
      leaseUntil: null,
      nextAttemptAt: null,
      lastError: null,
      processedReservations: 0,
      processedReports: 0,
    };

    vi.spyOn(adminModule.adminDb, "runTransaction").mockImplementation(async (cb: any) => {
      return cb({
        get: vi.fn(async (ref: any) => {
          if (ref?.path === "listingOperationJobs/job_600") {
            return { exists: true, data: () => jobData };
          }
          return { exists: true, data: () => ({ activeCount: 1, status: "active" }) };
        }),
        update: vi.fn((ref: any, upd: any) => {
          if (ref?.path === "listingOperationJobs/job_600") {
            jobData = { ...jobData, ...upd };
          }
        }),
        set: vi.fn(),
        delete: vi.fn(),
      });
    });

    vi.spyOn(adminModule.adminDb, "batch").mockImplementation(() => {
      let ops = 0;
      const b: any = {
        update: vi.fn(() => { ops++; }),
        set: vi.fn(() => { ops++; }),
        delete: vi.fn(() => { ops++; }),
        commit: vi.fn(async () => {
          commitBatchSizes.push(ops);
          expect(ops).toBeLessThanOrEqual(400);
        }),
      };
      return b;
    });

    const jobDocUpdate = vi.fn().mockResolvedValue(true);
    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((name: string) => {
      if (name === "listingOperationJobs") {
        return {
          doc: (id: string) => ({
            path: `listingOperationJobs/${id}`,
            get: vi.fn().mockResolvedValue({ exists: true, data: () => jobData }),
            update: jobDocUpdate,
          }),
        } as any;
      }
      if (name === "reservations") {
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn((lim: number) => ({
            get: vi.fn(async () => {
              const slice = remaining.slice(0, lim);
              remaining = remaining.slice(lim);
              return { empty: slice.length === 0, docs: slice };
            }),
          })),
        } as any;
      }
      return {
        doc: vi.fn(() => ({ path: `${name}/id` })),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      } as any;
    });

    const { processListingOperationJob } = await import("../src/lib/server/listing-jobs");
    const result = await processListingOperationJob("job_600");

    expect(result.completed).toBe(true);
    expect(result.processedReservations).toBe(600);
    expect(commitBatchSizes.length).toBeGreaterThanOrEqual(6);
    expect(commitBatchSizes.every((n) => n <= 400)).toBe(true);
  });

  it("C6: account/delete khóa tài khoản trước và compensating unlock nếu phát hiện confirmed reservation", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    const authGuardModule = await import("../src/lib/server/auth-guard");
    const rateLimitModule = await import("../src/lib/server/rate-limit");

    vi.spyOn(authGuardModule, "requireActiveUser").mockResolvedValue({
      uid: "u_del_1",
      email: "u1@fpt.edu.vn",
      name: "U1",
      claims: {},
      isAdmin: false,
      isVerifiedStudent: true,
      accountStatus: "active",
      userDoc: { accountStatus: "active" },
      token: { uid: "u_del_1", auth_time: Math.floor(Date.now() / 1000) } as any,
    });
    vi.spyOn(rateLimitModule, "consumeRateLimit").mockResolvedValue({ count: 1, remaining: 4, resetAt: Date.now() + 1000 });

    const txEvents: string[] = [];
    vi.spyOn(adminModule.adminDb, "runTransaction").mockImplementation(async (cb: any) => {
      return cb({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: vi.fn((_ref: any, data: any) => {
          txEvents.push(String(data.accountStatus || data.deletionState || "set"));
        }),
        delete: vi.fn(() => {
          txEvents.push("unlock_delete_pending");
        }),
      });
    });

    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((col: string) => {
      if (col === "reservations") {
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ empty: false, docs: [{ id: "conf_1" }] }),
        } as any;
      }
      return {
        doc: vi.fn(() => ({ id: "doc" })),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      } as any;
    });

    const { POST } = await import("../src/app/api/account/delete/route");
    const req = new NextRequest("http://localhost:3000/api/account/delete", {
      method: "POST",
      headers: { authorization: "Bearer fresh-token" },
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ACTIVE_CONFIRMED_TRANSACTIONS");
    // Xác minh Freeze Gate ("deleting") chạy trước Compensating Unlock ("active" + "unlock_delete_pending")
    expect(txEvents).toContain("deleting");
    expect(txEvents).toContain("active");
    expect(txEvents).toContain("unlock_delete_pending");
  });

  it("C6: purgeUserData không gọi recursiveDelete nếu chat Storage vẫn còn file sau deleteFiles", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    vi.spyOn(adminModule.adminAuth, "getUser").mockResolvedValue({ uid: "u_p", disabled: true } as any);
    const recursiveSpy = vi.spyOn(adminModule.adminDb, "recursiveDelete").mockResolvedValue(undefined);

    vi.spyOn(adminModule.adminStorage, "bucket").mockReturnValue({
      deleteFiles: vi.fn().mockResolvedValue(undefined),
      getFiles: vi.fn().mockResolvedValue([[{ name: "private/chats/c1/leftover.webp" }]]),
    } as any);

    const jobSetSpy = vi.fn().mockResolvedValue(true);
    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((col: string) => {
      if (col === "conversations") {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: [{ id: "c1", ref: { path: "conversations/c1" } }],
          }),
        } as any;
      }
      if (col === "storageCleanupJobs") {
        return {
          doc: vi.fn(() => ({
            set: jobSetSpy,
            delete: vi.fn().mockResolvedValue(true),
          })),
        } as any;
      }
      return {
        doc: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
          delete: vi.fn().mockResolvedValue(true),
        })),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
      } as any;
    });

    const { purgeUserData } = await import("../src/lib/services/account-purge");
    await expect(purgeUserData("u_p", null)).rejects.toThrow(/STORAGE_PREFIX_NOT_EMPTY/);
    expect(recursiveSpy).not.toHaveBeenCalled();
    expect(jobSetSpy).toHaveBeenCalled();
  });

  it("C7a: Upload intent quota chặn spam nhiều random filenames vượt hạn mức ngày", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    const authGuardModule = await import("../src/lib/server/auth-guard");
    const rateLimitModule = await import("../src/lib/server/rate-limit");

    vi.spyOn(authGuardModule, "requireActiveUser").mockResolvedValue({
      uid: "spammer_1",
      email: "s@fpt.edu.vn",
      name: "Spam",
      claims: {},
      isAdmin: false,
      isVerifiedStudent: false,
      accountStatus: "active",
      userDoc: { accountStatus: "active" },
      token: { uid: "spammer_1" } as any,
    });
    vi.spyOn(rateLimitModule, "consumeRateLimit").mockResolvedValue({ count: 1, remaining: 24, resetAt: Date.now() + 1000 });

    let dailyCardFiles = 6; // Hạn mức card là 6/ngày
    const alertSpy = vi.fn().mockResolvedValue(true);

    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((name: string) => {
      if (name === "adminLogs") {
        return { doc: () => ({ set: alertSpy }) } as any;
      }
      return {
        doc: (id: string) => ({ id, path: `${name}/${id}` }),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      } as any;
    });

    vi.spyOn(adminModule.adminDb, "runTransaction").mockImplementation(async (cb: any) => {
      return cb({
        get: vi.fn(async (target: any) => {
          if (target?.path?.startsWith("userUploadQuotas/")) {
            return {
              exists: true,
              data: () => ({
                totalFiles: dailyCardFiles,
                totalBytes: 1_000_000,
                byKind: { card: { files: dailyCardFiles, bytes: 1_000_000 } },
              }),
            };
          }
          if (target?.path) {
            return { exists: false, data: () => ({}) };
          }
          return { docs: [] };
        }),
        set: vi.fn(),
        update: vi.fn(),
      });
    });

    const { POST } = await import("../src/app/api/uploads/intent/route");
    const req = new NextRequest("http://localhost:3000/api/uploads/intent", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      body: JSON.stringify({
        kind: "card",
        files: [{ name: "random_card_999.webp", contentType: "image/webp", sizeBytes: 50_000 }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("UPLOAD_QUOTA_EXCEEDED");
    expect(alertSpy).toHaveBeenCalled();
  });

  it("C7b: Data Export phân trang 500+ messages trả đủ 100% số lượng + tách riêng aiAssistantHistory", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    const authGuardModule = await import("../src/lib/server/auth-guard");
    const rateLimitModule = await import("../src/lib/server/rate-limit");

    vi.spyOn(authGuardModule, "requireActiveUser").mockResolvedValue({
      uid: "u_exp",
      email: "exp@fpt.edu.vn",
      name: "Exp",
      claims: {},
      isAdmin: false,
      isVerifiedStudent: true,
      accountStatus: "active",
      userDoc: { accountStatus: "active" },
      token: { uid: "u_exp", auth_time: Math.floor(Date.now() / 1000) } as any,
    });
    vi.spyOn(rateLimitModule, "consumeRateLimit").mockResolvedValue({ count: 1, remaining: 29, resetAt: Date.now() + 1000 });

    const all520Msgs = Array.from({ length: 520 }, (_, i) => ({
      id: `m_${i}`,
      data: () => ({ senderId: "u_exp", text: `Msg ${i}`, createdAt: i }),
    }));

    const buildMsgsSubCol = () => {
      let startIdx = 0;
      let maxCount = 200;
      const chain: any = {
        doc: vi.fn((id: string) => ({
          get: vi.fn(async () => {
            const idx = all520Msgs.findIndex((m) => m.id === id);
            return idx >= 0 ? { exists: true, id, _idx: idx } : { exists: false };
          }),
        })),
        orderBy: vi.fn().mockReturnThis(),
        startAfter: vi.fn((cursorSnap: any) => {
          startIdx = (cursorSnap._idx ?? 0) + 1;
          return chain;
        }),
        limit: vi.fn((n: number) => {
          maxCount = n;
          return chain;
        }),
        get: vi.fn(async () => ({
          docs: all520Msgs.slice(startIdx, startIdx + maxCount),
        })),
      };
      return chain;
    };

    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((name: string) => {
      if (name === "adminLogs") {
        return { add: vi.fn().mockResolvedValue({ id: "log_1" }) } as any;
      }
      if (name === "conversations") {
        const cRef = { id: "conv_520", collection: () => buildMsgsSubCol() };
        return {
          doc: vi.fn(() => ({
            ...cRef,
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ participantIds: ["u_exp", "u_other"] }),
            }),
          })),
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: [{ id: "conv_520", ref: cRef, data: () => ({ participantIds: ["u_exp", "u_other"] }) }],
          }),
        } as any;
      }
      if (name === "aiConversations") {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: [
              {
                id: "ai_1",
                ref: {
                  collection: () => ({
                    orderBy: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    get: vi.fn().mockResolvedValue({ docs: [{ id: "ai_m1", data: () => ({ role: "user", text: "Hi" }) }] }),
                  }),
                },
                data: () => ({ ownerUid: "u_exp", title: "AI Help" }),
              },
            ],
          }),
        } as any;
      }
      return {
        doc: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }) })),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any;
    });

    const { GET } = await import("../src/app/api/account/export/route");

    // 1. Root bundle tách biệt aiAssistantHistory và báo có nextPageEndpoint
    const rootRes = await GET(
      new NextRequest("http://localhost:3000/api/account/export", { headers: { authorization: "Bearer valid" } })
    );
    expect(rootRes.status).toBe(200);
    const rootJson = await rootRes.json();
    expect(rootJson.conversations[0].messages).toHaveLength(50);
    expect(rootJson.conversations[0].pagination.hasMore).toBe(true);
    expect(rootJson.aiAssistantHistory).toHaveLength(1);

    // 2. Paginate tiếp để gom đủ 520 tin nhắn
    const collectedIds = new Set(rootJson.conversations[0].messages.map((m: any) => m.id));
    let cursor = rootJson.conversations[0].pagination.nextCursor;
    while (cursor) {
      const pageRes = await GET(
        new NextRequest(
          `http://localhost:3000/api/account/export?conversationId=conv_520&cursor=${cursor}&limit=200`,
          { headers: { authorization: "Bearer valid" } }
        )
      );
      expect(pageRes.status).toBe(200);
      const pageJson = await pageRes.json();
      for (const m of pageJson.messages) collectedIds.add(m.id);
      cursor = pageJson.pagination.nextCursor;
    }

    expect(collectedIds.size).toBe(520);
  });

  it("C8: POST /api/admin/dlq replay đưa job trở lại hàng đợi và ghi audit log", async () => {
    const adminModule = await import("../src/lib/firebase/admin");
    const authGuardModule = await import("../src/lib/server/auth-guard");
    const rateLimitModule = await import("../src/lib/server/rate-limit");

    vi.spyOn(authGuardModule, "requireAdmin").mockResolvedValue({
      uid: "admin_1",
      email: "admin@fpt.edu.vn",
      name: "Admin",
      claims: { admin: true },
      isAdmin: true,
      isVerifiedStudent: true,
      accountStatus: "active",
      userDoc: { accountStatus: "active" },
      token: { uid: "admin_1", admin: true } as any,
    });
    vi.spyOn(rateLimitModule, "consumeRateLimit").mockResolvedValue({ count: 1, remaining: 29, resetAt: Date.now() + 1000 });

    const jobUpdateSpy = vi.fn().mockResolvedValue(true);
    const alertSetSpy = vi.fn().mockResolvedValue(true);
    const logAddSpy = vi.fn().mockResolvedValue({ id: "l1" });

    vi.spyOn(adminModule.adminDb, "collection").mockImplementation((col: string) => {
      if (col === "pendingDeletions") {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ deadLetter: true }) }),
            update: jobUpdateSpy,
          }),
        } as any;
      }
      if (col === "deadLetterAlerts") {
        return { doc: () => ({ set: alertSetSpy }) } as any;
      }
      if (col === "adminLogs") {
        return { add: logAddSpy } as any;
      }
      return {} as any;
    });

    const { POST } = await import("../src/app/api/admin/dlq/route");
    const req = new NextRequest("http://localhost:3000/api/admin/dlq", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer valid" },
      body: JSON.stringify({
        collection: "pendingDeletions",
        docId: "u_stuck_1",
        action: "replay",
        note: "Đã khôi phục quyền Storage",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(jobUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deadLetter: false,
        status: "pending",
        attempts: 0,
      })
    );
    expect(logAddSpy).toHaveBeenCalled();
  });
});
