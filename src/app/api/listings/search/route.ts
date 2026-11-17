import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { removeVietnameseTones } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface ListingSearchItem {
  id: string;
  title?: string;
  titleNormalized?: string;
  price?: number;
  urgentPass?: boolean;
  hasShipping?: boolean;
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const category = searchParams.get("category");
    const school = searchParams.get("school");
    const province = searchParams.get("province");
    const urgent = searchParams.get("urgent") === "true";
    const shipping = searchParams.get("shipping") === "true";
    const minPrice = Number(searchParams.get("minPrice") || 0);
    const maxPrice = Number(searchParams.get("maxPrice") || 500000000);
    const sort = searchParams.get("sort") || "relevant";
    const limit = Number(searchParams.get("limit") || 20);

    let query: FirebaseFirestore.Query = adminDb
      .collection("listings")
      .where("status", "==", "active");

    // Lọc theo danh mục
    if (category && category !== "all") {
      query = query.where("categoryId", "==", category);
    }

    // Lọc theo trường
    if (school && school !== "all") {
      query = query.where("schoolCode", "==", school);
    }

    // Lọc theo tỉnh thành
    if (province && province !== "all") {
      query = query.where("provinceCode", "==", province);
    }

    // Sắp xếp
    if (sort === "newest") {
      query = query.orderBy("createdAt", "desc");
    } else if (sort === "price_asc") {
      query = query.orderBy("price", "asc");
    } else if (sort === "price_desc") {
      query = query.orderBy("price", "desc");
    }

    query = query.limit(limit);

    const snapshot = await query.get();
    let items: ListingSearchItem[] = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Lọc client-side cho tìm kiếm từ khóa tiếng Việt không dấu & bộ lọc phụ
    if (q) {
      const normalizedQ = removeVietnameseTones(q).toLowerCase();
      const queryWords = normalizedQ.split(/\s+/).filter(Boolean);

      items = items.filter((item) => {
        const itemTitle = (
          item.titleNormalized || removeVietnameseTones(item.title || "")
        ).toLowerCase();
        return queryWords.every((word) => itemTitle.includes(word));
      });
    }

    if (urgent) {
      items = items.filter((item) => Boolean(item.urgentPass));
    }

    if (shipping) {
      items = items.filter((item) => Boolean(item.hasShipping));
    }

    if (minPrice > 0 || maxPrice < 500000000) {
      items = items.filter(
        (item) =>
          typeof item.price === "number" &&
          item.price >= minPrice &&
          item.price <= maxPrice
      );
    }

    return NextResponse.json({
      items,
      total: items.length,
    });
  } catch (err) {
    console.error("Lỗi tìm kiếm tin:", err);
    return NextResponse.json(
      { error: "Lỗi nội bộ máy chủ khi tìm kiếm" },
      { status: 500 }
    );
  }
}
