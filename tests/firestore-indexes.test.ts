import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Kiểm tra đầy đủ Firestore Composite Indexes (WP-6.3)", () => {
  const indexesPath = path.resolve(__dirname, "../firestore.indexes.json");
  const content = JSON.parse(fs.readFileSync(indexesPath, "utf-8"));
  const indexes: Array<{
    collectionGroup: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }> = content.indexes || [];

  const hasIndex = (
    collection: string,
    expectedFields: Array<{ fieldPath: string; order?: string }>
  ) => {
    return indexes.some((idx) => {
      if (idx.collectionGroup !== collection) return false;
      if (idx.fields.length !== expectedFields.length) return false;
      return expectedFields.every((ef, i) => {
        const actual = idx.fields[i];
        if (actual.fieldPath !== ef.fieldPath) return false;
        if (ef.order && actual.order !== ef.order) return false;
        return true;
      });
    });
  };

  it("listings: có index (status ASC, createdAt DESC)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("listings: có index (status, categoryId, createdAt)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "categoryId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("listings: có index (status, schoolCode, createdAt)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "schoolCode", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("listings: có index (status, provinceCode, createdAt)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "provinceCode", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("listings: có index (status, price ASC) và (status, price DESC)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "price", order: "ASCENDING" },
      ])
    ).toBe(true);
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "price", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("listings: có index (sellerId ASC, createdAt DESC)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "sellerId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("listings: có index (status ASC, passDeadline ASC)", () => {
    expect(
      hasIndex("listings", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "passDeadline", order: "ASCENDING" },
      ])
    ).toBe(true);
  });

  it("reservations: có các index (buyerId, createdAt), (sellerId, createdAt), (listingId, status, createdAt)", () => {
    expect(
      hasIndex("reservations", [
        { fieldPath: "buyerId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
    expect(
      hasIndex("reservations", [
        { fieldPath: "sellerId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
    expect(
      hasIndex("reservations", [
        { fieldPath: "listingId", order: "ASCENDING" },
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "ASCENDING" },
      ])
    ).toBe(true);
  });

  it("reservations: có index (status, expiresAt) và (status, holdExpiresAt)", () => {
    expect(
      hasIndex("reservations", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "expiresAt", order: "ASCENDING" },
      ])
    ).toBe(true);
    expect(
      hasIndex("reservations", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "holdExpiresAt", order: "ASCENDING" },
      ])
    ).toBe(true);
  });

  it("notifications: có index (userId ASC, createdAt DESC)", () => {
    expect(
      hasIndex("notifications", [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ])
    ).toBe(true);
  });

  it("verifications: có index (status ASC, decidedAt ASC)", () => {
    expect(
      hasIndex("verifications", [
        { fieldPath: "status", order: "ASCENDING" },
        { fieldPath: "decidedAt", order: "ASCENDING" },
      ])
    ).toBe(true);
  });

  it("contactViewLogs: có index (buyerId, timestamp)", () => {
    expect(
      hasIndex("contactViewLogs", [
        { fieldPath: "buyerId", order: "ASCENDING" },
        { fieldPath: "timestamp", order: "ASCENDING" },
      ])
    ).toBe(true);
  });
});
