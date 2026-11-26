import { NextRequest, NextResponse } from "next/server";
import {
  fetchPrivateCloudinaryImage,
  verifyPrivateMediaToken,
} from "@/lib/server/storage-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("t") || "";
  const verified = verifyPrivateMediaToken(token);

  if (!verified.valid) {
    return NextResponse.json(
      { error: "Liên kết ảnh riêng tư không hợp lệ hoặc đã hết hạn.", code: verified.reason },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  }

  try {
    const media = await fetchPrivateCloudinaryImage(verified.path);
    if (!media) {
      return NextResponse.json(
        { error: "Không tìm thấy tệp ảnh riêng tư." },
        {
          status: 404,
          headers: { "Cache-Control": "no-store, private" },
        }
      );
    }

    return new NextResponse(media.bytes, {
      status: 200,
      headers: {
        "Content-Type": media.contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    console.error("[PRIVATE_MEDIA_PROXY] fetch failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "Không thể tải tệp ảnh riêng tư lúc này." },
      {
        status: 502,
        headers: { "Cache-Control": "no-store, private" },
      }
    );
  }
}
