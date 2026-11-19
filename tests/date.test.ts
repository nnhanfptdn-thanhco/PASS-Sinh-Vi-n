import { describe, it, expect } from "vitest";
import { todayVN, addDaysVN, isPastDeadline, formatDeadlineVN } from "../src/lib/utils/date";

describe("Date Utilities - Múi giờ Asia/Ho_Chi_Minh (WP-0.2)", () => {
  it("todayVN trả đúng ngày theo giờ Việt Nam tại mốc chuyển ngày UTC", () => {
    // 2026-11-19 16:59:00 UTC = 2026-11-19 23:59:00 VN -> Vẫn là 2026-11-19
    const d1 = new Date("2026-11-19T16:59:00Z");
    expect(todayVN(d1)).toBe("2026-11-19");

    // 2026-11-19 17:01:00 UTC = 2026-11-20 00:01:00 VN -> Đã sang ngày 2026-11-20
    const d2 = new Date("2026-11-19T17:01:00Z");
    expect(todayVN(d2)).toBe("2026-11-20");

    // 00:00 UTC = 07:00 VN
    const d3 = new Date("2026-11-20T00:00:00Z");
    expect(todayVN(d3)).toBe("2026-11-20");
  });

  it("addDaysVN cộng đúng ngày qua ranh giới tháng và năm", () => {
    expect(addDaysVN("2026-11-28", 3)).toBe("2026-12-01");
    expect(addDaysVN("2024-02-28", 1)).toBe("2024-02-29"); // Năm nhuận
    expect(addDaysVN("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("isPastDeadline xác định hạn vào cuối ngày (23:59:59)", () => {
    // Thời điểm hiện tại là trưa ngày 2026-11-19 VN
    const now = new Date("2026-11-19T05:00:00Z"); // 12:00 VN

    // Hạn là hôm nay (2026-11-19): VẪN CHƯA HẾT HẠN
    expect(isPastDeadline("2026-11-19", now)).toBe(false);

    // Hạn là ngày mai (2026-11-20): CHƯA HẾT HẠN
    expect(isPastDeadline("2026-11-20", now)).toBe(false);

    // Hạn là hôm qua (2026-11-18): ĐÃ HẾT HẠN
    expect(isPastDeadline("2026-11-18", now)).toBe(true);
  });

  it("formatDeadlineVN hiển thị thân thiện", () => {
    const now = new Date("2026-11-19T05:00:00Z"); // 2026-11-19 VN

    expect(formatDeadlineVN("2026-11-19", now)).toBe("Hôm nay");
    expect(formatDeadlineVN("2026-11-20", now)).toBe("Còn 1 ngày (Ngày mai)");
    expect(formatDeadlineVN("2026-11-21", now)).toBe("Còn 2 ngày");
    expect(formatDeadlineVN("2026-11-22", now)).toBe("Còn 3 ngày");
    expect(formatDeadlineVN("2026-11-25", now)).toBe("25/11/2026");
    expect(formatDeadlineVN("2026-11-18", now)).toBe("Đã hết hạn");
  });
});
