/**
 * MODULE NÉN VÀ XỬ LÝ ẢNH CHUẨN SẢN PHẨM (PROMPT 4)
 * - Tách bạch hàm thuần túy toán học & xử lý canvas
 * - Giữ nguyên tỉ lệ gốc (aspect ratio), cạnh dài tối đa 1600px
 * - Kiểm tra chính xác blob.type để phòng ngừa Safari/iOS xuất PNG ngầm
 * - Quản lý giải phóng bộ nhớ (bitmap.close, URL.revokeObjectURL)
 */

export interface TargetDimensions {
  width: number;
  height: number;
}

/**
 * Hàm thuần tính toán kích thước đích giữ nguyên tỉ lệ gốc
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge = 1600
): TargetDimensions {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  if (width <= maxEdge && height <= maxEdge) {
    return { width, height };
  }
  if (width >= height) {
    return {
      width: maxEdge,
      height: Math.max(1, Math.round((height * maxEdge) / width)),
    };
  }
  return {
    width: Math.max(1, Math.round((width * maxEdge) / height)),
    height: maxEdge,
  };
}

/**
 * Hàm thuần kiểm tra và chọn định dạng xuất
 * Phòng ngừa trường hợp canvas.toBlob("image/webp") trả về PNG trên Safari cũ
 */
export function pickOutputFormat(blobType: string): "image/webp" | "image/jpeg" {
  if (blobType === "image/webp") {
    return "image/webp";
  }
  return "image/jpeg";
}

/**
 * Hàm thuần thực thi tác vụ theo hàng đợi với giới hạn đồng thời (Concurrency Pool)
 */
export async function runPool<T, R>(
  items: T[],
  workerFn: (item: T, index: number) => Promise<R>,
  concurrency = 2
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await workerFn(items[currentIndex], currentIndex);
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(pool);
  return results;
}

export interface CompressedResult {
  blob: Blob;
  mimeType: "image/webp" | "image/jpeg";
  width: number;
  height: number;
  extension: "webp" | "jpg";
}

/**
 * Nén 1 tệp ảnh với đầy đủ kiểm tra lỗi, bậc thang chất lượng và dọn RAM
 */
export async function compressListingImage(file: File): Promise<CompressedResult> {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Định dạng ảnh chưa được hỗ trợ. Vui lòng chọn ảnh định dạng JPG, PNG hoặc WebP.");
  }

  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Kích thước tệp ảnh quá lớn (vượt quá 25MB). Vui lòng chọn ảnh nhẹ hơn.");
  }

  // 1. Giải mã ảnh ưu tiên createImageBitmap
  let sourceWidth = 0;
  let sourceHeight = 0;
  let drawableSource: ImageBitmap | HTMLImageElement | null = null;
  let objectUrlToRevoke: string | null = null;

  try {
    if (typeof createImageBitmap === "function") {
      try {
        drawableSource = await createImageBitmap(file, { imageOrientation: "from-image" });
        sourceWidth = drawableSource.width;
        sourceHeight = drawableSource.height;
      } catch {
        drawableSource = null;
      }
    }

    if (!drawableSource) {
      objectUrlToRevoke = URL.createObjectURL(file);
      const img = new Image();
      img.src = objectUrlToRevoke;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Không thể giải mã tệp ảnh"));
      });
      drawableSource = img;
      sourceWidth = img.naturalWidth || img.width;
      sourceHeight = img.naturalHeight || img.height;
    }

    const { width: targetWidth, height: targetHeight } = computeTargetSize(
      sourceWidth,
      sourceHeight,
      1600
    );

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Trình duyệt không hỗ trợ Canvas 2D");
    }

    ctx.drawImage(drawableSource, 0, 0, targetWidth, targetHeight);

    // 2. Thử xuất WebP trước
    let outputBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", 0.8)
    );

    let finalMimeType: "image/webp" | "image/jpeg" = "image/webp";

    if (!outputBlob || outputBlob.type !== "image/webp") {
      // Safari / iOS fallback sang JPEG
      finalMimeType = "image/jpeg";
      outputBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82)
      );
    }

    if (!outputBlob) {
      throw new Error("Không thể xuất dữ liệu ảnh từ canvas");
    }

    // 3. Nếu blob > 1.5MB thì giảm theo bậc chất lượng (0.7 -> 0.6 -> 0.5)
    let currentQuality = 0.7;
    while (outputBlob.size > 1.5 * 1024 * 1024 && currentQuality >= 0.5) {
      const nextBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), finalMimeType, currentQuality)
      );
      if (nextBlob) {
        outputBlob = nextBlob;
      }
      currentQuality -= 0.1;
    }

    if (outputBlob.size > 5 * 1024 * 1024) {
      throw new Error("Ảnh sau khi nén vẫn vượt quá 5MB. Vui lòng chọn ảnh khác.");
    }

    return {
      blob: outputBlob,
      mimeType: finalMimeType,
      width: targetWidth,
      height: targetHeight,
      extension: finalMimeType === "image/webp" ? "webp" : "jpg",
    };
  } finally {
    if (drawableSource && "close" in drawableSource && typeof drawableSource.close === "function") {
      drawableSource.close();
    }
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}
