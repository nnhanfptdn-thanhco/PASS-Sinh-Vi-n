import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { searchListings } from "@/lib/services/listings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q") || undefined;
    const category = searchParams.get("category") || undefined;
    const school = searchParams.get("school") || undefined;
    const province = searchParams.get("province") || undefined;
    const urgent = searchParams.get("urgent") === "true";
    const shipping = searchParams.get("shipping") === "true";

    const rawMinPrice = searchParams.get("minPrice");
    const minPrice = rawMinPrice ? Number(rawMinPrice) : undefined;

    const rawMaxPrice = searchParams.get("maxPrice");
    const maxPrice = rawMaxPrice ? Number(rawMaxPrice) : undefined;

    const sort = (searchParams.get("sort") as "relevant" | "newest" | "price_asc" | "price_desc") || "relevant";
    const cursor = searchParams.get("cursor") || undefined;

    const rawLimit = searchParams.get("limit");
    const limit = rawLimit ? Number(rawLimit) : 20;

    const viewerSchool = searchParams.get("viewerSchool") || undefined;
    const viewerProvince = searchParams.get("viewerProvince") || undefined;

    const result = await searchListings({
      q,
      category: category === "all" ? undefined : category,
      school: school === "all" ? undefined : school,
      province: province === "all" ? undefined : province,
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
        total: result.items.length,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error: unknown) {
    console.error("[SEARCH_API_ERROR] Lỗi tìm kiếm tin đăng:", error);
    return NextResponse.json(
      {
        items: [],
        error: "Lỗi nội bộ khi tìm kiếm tin đăng",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
