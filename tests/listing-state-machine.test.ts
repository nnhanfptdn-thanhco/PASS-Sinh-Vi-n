import { describe, it, expect } from "vitest";
import { validateManageListingAction } from "../src/lib/domain/listing-status";
import { addDaysVN, todayVN } from "../src/lib/utils/date";

const FUTURE = addDaysVN(todayVN(), 10);
const PAST = addDaysVN(todayVN(), -10);

describe("Máy trạng thái tin đăng theo Bảng 2.3", () => {
  it("active -> hide (hợp lệ)", () => {
    const res = validateManageListingAction("hide", {
      currentStatus: "active",
      passDeadline: FUTURE,
    });
    expect(res.valid).toBe(true);
  });

  it("reserved -> hide (bị từ chối, phải xử lý giữ chỗ trước -> 409)", () => {
    const res = validateManageListingAction("hide", {
      currentStatus: "reserved",
      passDeadline: FUTURE,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.error).toContain("giữ chỗ");
  });

  it("hidden_by_seller -> show (hợp lệ khi còn hạn)", () => {
    const res = validateManageListingAction("show", {
      currentStatus: "hidden_by_seller",
      passDeadline: FUTURE,
    });
    expect(res.valid).toBe(true);
  });

  it("hidden_by_seller -> show (bị từ chối khi hết hạn -> bắt gia hạn)", () => {
    const res = validateManageListingAction("show", {
      currentStatus: "hidden_by_seller",
      passDeadline: PAST,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.error).toContain("Gia hạn");
  });

  it("active -> mark_sold (hợp lệ)", () => {
    const res = validateManageListingAction("mark_sold", {
      currentStatus: "active",
      passDeadline: FUTURE,
    });
    expect(res.valid).toBe(true);
  });

  it("reserved -> mark_sold qua manage trực tiếp (bị từ chối -> 409, yêu cầu qua Giữ chỗ)", () => {
    const res = validateManageListingAction("mark_sold", {
      currentStatus: "reserved",
      passDeadline: FUTURE,
      isAdmin: false,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.error).toContain("Giữ chỗ");
  });

  it("mark_sold: reserved với admin (cũng bị từ chối -> 409, phải qua luồng reservations/action)", () => {
    const res = validateManageListingAction("mark_sold", {
      currentStatus: "reserved",
      passDeadline: FUTURE,
      isAdmin: true,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.error).toContain("Giữ chỗ");
  });

  it("renew: reserved với non-admin (bị từ chối -> 409, không cho gia hạn đè giao dịch)", () => {
    const res = validateManageListingAction("renew", {
      currentStatus: "reserved",
      passDeadline: FUTURE,
      isAdmin: false,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(409);
  });

  it("renew: reserved với admin (cũng bị từ chối -> 409, không cho gia hạn đè giao dịch)", () => {
    const res = validateManageListingAction("renew", {
      currentStatus: "reserved",
      passDeadline: FUTURE,
      isAdmin: true,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(409);
  });

  it("sold -> bất kỳ hành động nào (bị từ chối -> 409, trạng thái cuối)", () => {
    for (const action of ["hide", "show", "mark_sold", "renew"] as const) {
      const res = validateManageListingAction(action, {
        currentStatus: "sold",
        passDeadline: FUTURE,
      });
      expect(res.valid).toBe(false);
      expect(res.statusCode).toBe(409);
    }
  });

  it("hidden_by_admin -> người bán tự can thiệp (bị từ chối -> 403)", () => {
    const res = validateManageListingAction("show", {
      currentStatus: "hidden_by_admin",
      passDeadline: FUTURE,
      isAdmin: false,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("hidden_by_admin -> admin can thiệp (hợp lệ)", () => {
    const res = validateManageListingAction("show", {
      currentStatus: "hidden_by_admin",
      passDeadline: FUTURE,
      isAdmin: true,
    });
    expect(res.valid).toBe(true);
  });

  it("renew: hợp lệ cho expired và active", () => {
    expect(
      validateManageListingAction("renew", {
        currentStatus: "expired",
        passDeadline: PAST,
      }).valid
    ).toBe(true);

    expect(
      validateManageListingAction("renew", {
        currentStatus: "active",
        passDeadline: FUTURE,
      }).valid
    ).toBe(true);
  });

  it("renew: từ chối nếu tin đang ở trạng thái hidden_by_seller (phải hiện tin trước)", () => {
    const res = validateManageListingAction("renew", {
      currentStatus: "hidden_by_seller",
      passDeadline: FUTURE,
    });
    expect(res.valid).toBe(false);
    expect(res.statusCode).toBe(409);
  });

  it("renew: cho phép gia hạn nếu tin hidden_by_seller đã quá hạn (tránh dead-end với show)", () => {
    const res = validateManageListingAction("renew", {
      currentStatus: "hidden_by_seller",
      passDeadline: PAST,
    });
    expect(res.valid).toBe(true);
  });

  it("hide: admin được phép ẩn tin đang reserved (kiểm duyệt vi phạm)", () => {
    const res = validateManageListingAction("hide", {
      currentStatus: "reserved",
      passDeadline: FUTURE,
      isAdmin: true,
    });
    expect(res.valid).toBe(true);
  });
});
