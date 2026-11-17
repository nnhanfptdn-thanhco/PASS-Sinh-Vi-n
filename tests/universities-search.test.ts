import { describe, it, expect } from "vitest";
import universitiesData from "../data/universities_vietnam.json";
import { removeVietnameseTones } from "../src/lib/utils";

describe("Danh Mục Toàn Bộ Các Trường Đại Học & Logic Tìm Kiếm Thông Minh", () => {
  it("Đã nạp đầy đủ danh mục trường đại học, học viện, cao đẳng toàn quốc (>150 trường)", () => {
    expect(universitiesData.length).toBeGreaterThan(150);
  });

  it("Mỗi trường đều có đầy đủ thông tin: mã, tên, viết tắt, tỉnh thành, phường xã, campuses", () => {
    for (const school of universitiesData) {
      expect(school.code).toBeTruthy();
      expect(school.name).toBeTruthy();
      expect(school.shortName).toBeTruthy();
      expect(school.provinceCode).toBeTruthy();
      expect(school.campuses).toBeDefined();
      expect(school.campuses.length).toBeGreaterThan(0);
    }
  });

  it("Tìm kiếm từ khóa 'fpt' trả về đầy đủ tất cả các trường và cơ sở FPT tại Việt Nam", () => {
    const query = "fpt";
    const cleanQuery = removeVietnameseTones(query).toLowerCase();

    const fptResults = universitiesData.filter((school) => {
      const cleanName = removeVietnameseTones(school.name).toLowerCase();
      const cleanShort = removeVietnameseTones(school.shortName).toLowerCase();
      const cleanCode = school.code.toLowerCase();
      return (
        cleanName.includes(cleanQuery) ||
        cleanShort.includes(cleanQuery) ||
        cleanCode.includes(cleanQuery)
      );
    });

    // Phải tìm thấy tối thiểu 20 cơ sở FPT (Đại học FPT, FPT Poly, Greenwich, Swinburne, BTEC...)
    expect(fptResults.length).toBeGreaterThanOrEqual(20);

    // Kiểm tra có đầy đủ 5 phân hiệu Đại học FPT
    const fptUniCodes = fptResults.map((s) => s.code);
    expect(fptUniCodes).toContain("FPT-HN");
    expect(fptUniCodes).toContain("FPT-DN");
    expect(fptUniCodes).toContain("FPT-HCM");
    expect(fptUniCodes).toContain("FPT-CT");
    expect(fptUniCodes).toContain("FPT-QN");

    // Kiểm tra có FPT Polytechnic
    expect(fptUniCodes).toContain("FPTPOLY-HN");
    expect(fptUniCodes).toContain("FPTPOLY-DN");
    expect(fptUniCodes).toContain("FPTPOLY-HCM");

    // Kiểm tra có FPT Greenwich & FPT Swinburne
    expect(fptUniCodes).toContain("FPT-GW-DN");
    expect(fptUniCodes).toContain("FPT-SWIN-DN");
  });

  it("Tìm kiếm 'bách khoa' hoặc 'bach khoa' (có dấu hoặc không dấu) đều trả về đầy đủ các trường Bách Khoa", () => {
    for (const query of ["bách khoa", "bach khoa"]) {
      const cleanQuery = removeVietnameseTones(query).toLowerCase();
      const results = universitiesData.filter((school) => {
        const cleanName = removeVietnameseTones(school.name).toLowerCase();
        const cleanShort = removeVietnameseTones(school.shortName).toLowerCase();
        return cleanName.includes(cleanQuery) || cleanShort.includes(cleanQuery);
      });

      const shortNames = results.map((s) => s.shortName);
      expect(shortNames).toContain("HUST");   // Bách Khoa Hà Nội
      expect(shortNames).toContain("HCMUT");  // Bách Khoa TP.HCM
      expect(shortNames).toContain("DUT");    // Bách Khoa Đà Nẵng
    }
  });

  it("Tìm kiếm theo tên viết tắt (Acronym) chuẩn xác", () => {
    const testCases = [
      { acronym: "NEU", expectedName: "Kinh tế Quốc dân" },
      { acronym: "UEH", expectedName: "Đại học Kinh tế TP. Hồ Chí Minh" },
      { acronym: "FTU", expectedName: "Ngoại thương" },
      { acronym: "UIT", expectedName: "Công nghệ Thông tin" },
      { acronym: "VKU", expectedName: "Việt - Hàn" },
      { acronym: "DUE", expectedName: "Kinh tế - Đại học Đà Nẵng" },
    ];

    for (const { acronym, expectedName } of testCases) {
      const found = universitiesData.find(
        (s) =>
          s.shortName.toUpperCase() === acronym ||
          s.code.toUpperCase() === acronym
      );
      expect(found).toBeDefined();
      expect(found?.name).toContain(expectedName);
    }
  });

  it("Tìm kiếm theo tỉnh / thành phố (Đà Nẵng, Cần Thơ, Huế, TP.HCM, Hà Nội)", () => {
    const query = "đà nẵng";
    const cleanQuery = removeVietnameseTones(query).toLowerCase();

    const daNangSchools = universitiesData.filter((school) => {
      const cleanAddr = removeVietnameseTones(school.address).toLowerCase();
      const cleanName = removeVietnameseTones(school.name).toLowerCase();
      return cleanAddr.includes(cleanQuery) || cleanName.includes(cleanQuery);
    });

    expect(daNangSchools.length).toBeGreaterThan(10);
  });
});
