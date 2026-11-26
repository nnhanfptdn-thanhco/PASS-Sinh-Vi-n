import { NextRequest, NextResponse } from "next/server";
import { searchListings } from "@/lib/services/listings";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { getTrustedClientIp, rejectDuplicateQueryParams } from "@/lib/server/request-utils";
import { withApi, ApiError } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  rejectDuplicateQueryParams(searchParams, [
    "q",
    "category",
    "school",
    "province",
    "sort",
    "cursor",
    "limit",
    "minPrice",
    "maxPrice",
    "urgent",
    "shipping",
    "viewerSchool",
    "viewerProvince",
  ]);

  const ip = getTrustedClientIp(req);
  // Phân tán khóa IP vào 4 shard để giảm xung đột transaction Firestore dưới NAT Wi-Fi trường đại học
  const shard = Math.floor(Math.random() * 4);

  await consumeRateLimit({
    scope: "search_listings",
    key: `${ip}_s${shard}`,
    limit: 20,
    windowSec: 60,
    customMessage: "Bạn đang tìm kiếm quá nhanh. Vui lòng thử lại sau giây lát.",
  });

  const num = (v: string | null) => {
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const SORTS = ["relevant", "newest", "price_asc", "price_desc"] as const;
  const sortRaw = searchParams.get("sort") || "relevant";
  const sort = (SORTS as readonly string[]).includes(sortRaw)
    ? (sortRaw as (typeof SORTS)[number])
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

  try {
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
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof ApiError) throw err;
    console.error("Lỗi tìm kiếm tin đăng:", err);
    throw new ApiError(
      503,
      "SEARCH_UNAVAILABLE",
      "Hệ thống tìm kiếm tạm thời gián đoạn. Vui lòng thử lại sau giây lát."
    );
  }
});
