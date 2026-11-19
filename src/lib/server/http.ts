import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Đọc body JSON an toàn và giới hạn kích thước (mặc định tối đa 64KB để chống DoS)
 */
export async function readJson<T = unknown>(
  req: NextRequest,
  maxBytes: number = 64 * 1024
): Promise<T> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Yêu cầu Content-Type application/json");
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Dung lượng dữ liệu vượt quá giới hạn cho phép (${Math.round(maxBytes / 1024)}KB)`
    );
  }

  const text = await req.text();
  if (text.length > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Dữ liệu gửi lên vượt quá giới hạn");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Định dạng JSON không hợp lệ");
  }
}

/**
 * Higher-Order Function chuẩn hóa xử lý lỗi cho Next.js Route Handlers
 */
export function withApi(
  handler: (req: NextRequest, context?: unknown) => Promise<NextResponse>
) {
  return async (req: NextRequest, context?: unknown): Promise<NextResponse> => {
    try {
      return await handler(req, context);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const headers: Record<string, string> = {};
        if (err.status === 429 && typeof err.details === "object" && err.details && "retryAfter" in err.details) {
          headers["Retry-After"] = String((err.details as { retryAfter: number }).retryAfter);
        }
        return NextResponse.json(
          {
            error: err.message,
            code: err.code,
            details: err.details,
          },
          { status: err.status, headers }
        );
      }

      if (err instanceof ZodError) {
        const formattedErrors = err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        }));
        return NextResponse.json(
          {
            error: "Dữ liệu không hợp lệ",
            code: "VALIDATION_ERROR",
            issues: formattedErrors,
          },
          { status: 400 }
        );
      }

      // Log server error an toàn không kèm PII
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[API_ERROR]", errorMsg);

      return NextResponse.json(
        {
          error: "Đã xảy ra lỗi nội bộ máy chủ. Vui lòng thử lại sau.",
          code: "INTERNAL_SERVER_ERROR",
        },
        { status: 500 }
      );
    }
  };
}
