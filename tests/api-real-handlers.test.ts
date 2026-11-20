import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock requireApprovedStudent
vi.mock("@/lib/auth/server", () => ({
  requireApprovedStudent: vi.fn().mockResolvedValue({
    token: { uid: "user-123", email: "student@fpt.edu.vn", role: "student" },
    verification: { schoolCode: "FPT-DN", status: "approved" },
    userDoc: { displayName: "Sinh Viên Test" },
  }),
  requireAuth: vi.fn().mockResolvedValue({
    uid: "user-123",
    email: "student@fpt.edu.vn",
  }),
  requireUser: vi.fn().mockResolvedValue({
    uid: "user-123",
    auth_time: Math.floor(Date.now() / 1000),
  }),
}));

// Mock Firebase Admin
const mockGet = vi.fn().mockResolvedValue({
  exists: false,
  data: () => ({}),
});
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockResolvedValue(undefined);

const mockCollection = vi.fn().mockReturnValue({
  doc: vi.fn().mockReturnValue({
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
    delete: mockDelete,
    id: "mock-doc-id",
  }),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  get: vi.fn().mockResolvedValue({
    empty: true,
    size: 0,
    docs: [],
    forEach: vi.fn(),
  }),
  add: vi.fn().mockResolvedValue({ id: "new-doc-id" }),
});

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: (...args: any[]) => mockCollection(...args),
    runTransaction: vi.fn(async (cb: any) => {
      const transaction = {
        get: vi.fn().mockImplementation(async (refOrQuery: any) => {
          if (refOrQuery.get) return await refOrQuery.get();
          return { exists: false, data: () => ({}) };
        }),
        set: mockSet,
        update: mockUpdate,
        delete: mockDelete,
      };
      return await cb(transaction);
    }),
    batch: vi.fn(() => ({
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  },
  adminStorage: {
    bucket: vi.fn().mockReturnValue({
      file: vi.fn().mockReturnValue({
        exists: vi.fn().mockResolvedValue([true]),
        delete: vi.fn().mockResolvedValue(undefined),
      }),
      deleteFiles: vi.fn().mockResolvedValue(undefined),
    }),
  },
  adminAuth: {
    deleteUser: vi.fn().mockResolvedValue(undefined),
  },
  FieldValue: {
    serverTimestamp: vi.fn(() => "SERVER_TIMESTAMP"),
    increment: vi.fn((n) => `INCREMENT_${n}`),
    delete: vi.fn(() => "DELETE_FIELD"),
  },
}));

describe("Kiểm thử Route Handlers thực tế (WP-9.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/listings/create: từ chối ảnh không hợp lệ (không phải ảnh)", async () => {
    const { POST } = await import("../src/app/api/listings/create/route");
    const req = new NextRequest("http://localhost/api/listings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Giáo trình Giải tích 1 năm 2024",
        categoryId: "giao-trinh",
        condition: "good",
        price: 50000,
        passDeadline: "2026-12-01",
        shippingMethods: { pickup: true },
        images: [
          "malicious-file.exe",
        ],
        publicMeetingPoint: "Cổng trường FPT Đà Nẵng",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain("ảnh");
  });

  it("POST /api/listings/create: từ chối tiêu đề chứa số điện thoại (chống lộ thông tin liên hệ)", async () => {
    const { POST } = await import("../src/app/api/listings/create/route");
    const req = new NextRequest("http://localhost/api/listings/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Pass quạt Senko gọi 0905 123 456",
        categoryId: "do-gia-dung",
        condition: "good",
        price: 100000,
        passDeadline: "2026-12-01",
        shippingMethods: { pickup: true },
        images: [
          "https://firebasestorage.googleapis.com/v0/b/bucket/o/public%2Flistings%2Fuser-123%2F1.webp",
          "https://firebasestorage.googleapis.com/v0/b/bucket/o/public%2Flistings%2Fuser-123%2F2.webp",
          "https://firebasestorage.googleapis.com/v0/b/bucket/o/public%2Flistings%2Fuser-123%2F3.webp",
        ],
        publicMeetingPoint: "KTX Bách Khoa",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("số điện thoại");
  });

  it("POST /api/reservations/create: từ chối ghi chú hẹn có chứa Zalo/SĐT", async () => {
    const { POST } = await import("../src/app/api/reservations/create/route");
    const req = new NextRequest("http://localhost/api/reservations/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: "listing-123",
        deliveryMethod: "pickup",
        preferredSchedule: "Zalo mình là 0905123456 nhé",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Zalo");
  });

  it("POST /api/listings/contact: trả về 404 nếu tin đăng không tồn tại hoặc đã bán/hết hạn", async () => {
    const { POST } = await import("../src/app/api/listings/contact/route");
    mockGet.mockImplementation(() =>
      Promise.resolve({
        exists: true,
        data: () => ({
          sellerId: "other-user",
          status: "sold", // Đã bán -> 404 cho mọi người
          passDeadline: "2026-12-01",
        }),
      })
    );

    const req = new NextRequest("http://localhost/api/listings/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: "listing-sold-id",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("không còn khả dụng");
  });
});
