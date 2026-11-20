import { NextRequest, NextResponse } from "next/server";
import { searchListings } from "@/lib/services/listings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const num = (v: string | null) => {
      if (v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };

    const SORTS = ["relevant", "newest", "price_asc", "price_desc"] as const;
    const sortRaw = searchParams.get("sort") || "relevant";
    const sort = (SORTS as readonly string[]).includes(sortRaw)
      ? (sortRaw as typeof SORTS[number])
      : "relevant";

    const limit = Math.min(50, Math.max(1, Math.trunc(Number(searchParams.get("limit")) || 20)));
    const q = (searchParams.get("q") || "").slice(0, 100) || undefined;
    const cursorRaw = searchParams.get("cursor");
    const cursor = cursorRaw && /^[A-Za-z0-9_-]{1,160}$/.test(cursorRaw) ? cursorRaw : undefined;

    const minPrice = num(searchParams.get("minPrice"));
    const maxPrice = num(searchParams.get("maxPrice"));

    const categoryRaw = searchParams.get("category")?.slice(0, 64) || undefined;
    const schoolRaw = searchParams.get("school")?.slice(0, 64) || undefined;
    const provinceRaw = searchParams.get("province")?.slice(0, 64) || undefined;
    const viewerSchool = searchParams.get("viewerSchool")?.slice(0, 64) || undefined;
    const viewerProvince = searchParams.get("viewerProvince")?.slice(0, 64) || undefined;

    const urgent = searchParams.get("urgent") === "true";
    const shipping = searchParams.get("shipping") === "true";

    const result = await searchListings({
      q,
      category: categoryRaw === "all" ? undefined : categoryRaw,
      school: schoolRaw === "all" ? undefined : schoolRaw,
      province: provinceRaw === "all" ? undefined : provinceRaw,
      urgent,
      shipping,
      minPrice,
      maxPrice,
      sort,
      cursor,
      limit,
      viewerSchool,
      viewerProvince,
    });

    return NextResponse.json(
      {
        items: result.items,
        nextCursor: result.nextCursor,
        count: result.items.length,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("Lỗi tìm kiếm tin đăng:", err);
    return NextResponse.json(
      {
        error: "Không thể thực hiện tìm kiếm tin đăng vào lúc này.",
        items: [],
      },
      { status: 500 }
    );
  }
}
