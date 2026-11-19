import { describe, it, expect } from "vitest";
import {
  computeTargetSize,
  pickOutputFormat,
  runPool,
} from "../src/lib/image/compress";

describe("Prompt 4: Image Compression Pure Functions", () => {
  describe("computeTargetSize", () => {
    it("Giữ nguyên kích thước nếu cả 2 cạnh đều <= maxEdge", () => {
      expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
      expect(computeTargetSize(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
    });

    it("Thu nhỏ cạnh dài ngang về 1600 và giữ đúng tỉ lệ cạnh dọc", () => {
      // 3200 x 2400 (4:3) -> 1600 x 1200
      expect(computeTargetSize(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
      // 4000 x 2000 (2:1) -> 1600 x 800
      expect(computeTargetSize(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 });
    });

    it("Thu nhỏ cạnh dài dọc về 1600 và giữ đúng tỉ lệ cạnh ngang (ảnh chụp dọc điện thoại)", () => {
      // 2400 x 3200 (3:4) -> 1200 x 1600
      expect(computeTargetSize(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
      // 1000 x 2000 (1:2) -> 800 x 1600
      expect(computeTargetSize(1000, 2000, 1600)).toEqual({ width: 800, height: 1600 });
    });

    it("Xử lý an toàn kích thước 0 hoặc âm", () => {
      expect(computeTargetSize(0, 0)).toEqual({ width: 0, height: 0 });
    });
  });

  describe("pickOutputFormat", () => {
    it("Trả về image/webp khi canvas hỗ trợ webp", () => {
      expect(pickOutputFormat("image/webp")).toBe("image/webp");
    });

    it("Trả về image/jpeg khi canvas fallback sang PNG hoặc định dạng khác (Safari iOS)", () => {
      expect(pickOutputFormat("image/png")).toBe("image/jpeg");
      expect(pickOutputFormat("")).toBe("image/jpeg");
    });
  });

  describe("runPool Concurrency", () => {
    it("Chạy toàn bộ items và trả về kết quả đúng thứ tự ban đầu", async () => {
      const items = [10, 20, 30, 40, 50];
      const results = await runPool(
        items,
        async (val) => {
          return val * 2;
        },
        2
      );

      expect(results).toEqual([20, 40, 60, 80, 100]);
    });

    it("Không bao giờ vượt quá concurrency giới hạn", async () => {
      let activeCount = 0;
      let maxActiveObserved = 0;
      const items = [1, 2, 3, 4, 5, 6];

      await runPool(
        items,
        async () => {
          activeCount++;
          maxActiveObserved = Math.max(maxActiveObserved, activeCount);
          await new Promise((r) => setTimeout(r, 10));
          activeCount--;
          return true;
        },
        2
      );

      expect(maxActiveObserved).toBeLessThanOrEqual(2);
    });
  });
});
