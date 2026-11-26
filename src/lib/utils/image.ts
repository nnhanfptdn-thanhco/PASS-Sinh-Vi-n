/**
 * XỬ LÝ ẢNH PHÍA CLIENT (CANVAS HTML5)
 * - Nén ảnh về cạnh dài tối đa 1600px
 * - Chuyển đổi sang định dạng WebP (tự động loại bỏ siêu dữ liệu vị trí EXIF)
 * - Tính toán độ sáng (Luminance) & độ sắc nét (Laplacian Variance) để cảnh báo ảnh mờ/tối
 */

export interface ImageQualityCheck {
  isTooDark: boolean;
  isTooBright: boolean;
  isBlurry: boolean;
  luminance: number;
  sharpness: number;
}

export interface CompressedImageResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  quality: ImageQualityCheck;
}

/**
 * Nén ảnh về cạnh tối đa 1600px, xuất ra WebP và phân tích chất lượng ảnh
 */
export async function compressAndAnalyzeImage(
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<CompressedImageResult> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    const cleanupUrl = () => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    };
    img.onload = () => {
      cleanupUrl();
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;

      // Tính tỉ lệ co về maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Không thể khởi tạo Canvas 2D"));
        return;
      }

      // Vẽ ảnh lên canvas (quá trình này tự động làm sạch EXIF vị trí)
      ctx.drawImage(img, 0, 0, width, height);

      // Lấy dữ liệu pixel để phân tích độ sáng & độ sắc nét
      const imgData = ctx.getImageData(0, 0, width, height);
      const qualityCheck = analyzeImagePixels(imgData);

      // Xuất ra WebP, fallback JPEG nếu Safari trả PNG
      const exportWithFallback = (targetMime: "image/webp" | "image/jpeg", q: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Lỗi khi xuất Blob từ canvas"));
              return;
            }
            // Safari trả image/png khi không hỗ trợ encode WebP -> chuyển sang JPEG
            if (targetMime === "image/webp" && blob.type !== "image/webp") {
              exportWithFallback("image/jpeg", q);
              return;
            }
            const mime = blob.type === "image/jpeg" ? "image/jpeg" : "image/webp";
            let currentQ = q;
            let dataUrl = canvas.toDataURL(mime, currentQ);

            // Giảm chất lượng nếu kích thước Data URL vượt ngưỡng 480KB (P1-11)
            const MAX_DATA_URL_CHARS = 480 * 1024;
            if (dataUrl.length > MAX_DATA_URL_CHARS && currentQ > 0.5) {
              currentQ = 0.6;
              dataUrl = canvas.toDataURL(mime, currentQ);
              if (dataUrl.length > MAX_DATA_URL_CHARS) {
                currentQ = 0.5;
                dataUrl = canvas.toDataURL(mime, currentQ);
              }
            }

            resolve({
              blob,
              dataUrl,
              width,
              height,
              quality: qualityCheck,
            });
          },
          targetMime,
          q
        );
      };

      exportWithFallback("image/webp", quality);
    };
    img.onerror = () => {
      cleanupUrl();
      reject(new Error("Không thể đọc định dạng ảnh"));
    };
    img.src = objectUrl;
  });
}

/**
 * Phân tích độ sáng trung bình (Luminance) và độ sắc nét (Laplacian Variance)
 */
function analyzeImagePixels(imgData: ImageData): ImageQualityCheck {
  const data = imgData.data;
  const len = data.length;
  let totalLuminance = 0;
  const count = len / 4;

  // Tạo mảng grayscale nhỏ để tính toán biến sai Laplacian
  const gray: number[] = new Array(count);
  for (let i = 0, j = 0; i < len; i += 4, j++) {
    // Công thức tính cảm nhận độ sáng chuẩn: 0.299 R + 0.587 G + 0.114 B
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    totalLuminance += lum;
    gray[j] = lum;
  }

  const avgLuminance = totalLuminance / count;

  // Tính phương sai Laplacian (Laplacian Variance) trên ma trận ảnh để đo độ nét
  const w = imgData.width;
  const h = imgData.height;
  let laplacianSum = 0;
  let laplacianSqSum = 0;
  let laplacianCount = 0;

  // Lấy mẫu bước nhảy 4 để tính nhanh không làm giật giao diện
  const step = 4;
  for (let y = 1; y < h - 1; y += step) {
    for (let x = 1; x < w - 1; x += step) {
      const idx = y * w + x;
      // Kernel Laplacian:
      //  0  1  0
      //  1 -4  1
      //  0  1  0
      const val =
        gray[idx - w] +
        gray[idx + w] +
        gray[idx - 1] +
        gray[idx + 1] -
        4 * gray[idx];
      laplacianSum += val;
      laplacianSqSum += val * val;
      laplacianCount++;
    }
  }

  const mean = laplacianSum / (laplacianCount || 1);
  const variance = laplacianSqSum / (laplacianCount || 1) - mean * mean;

  return {
    isTooDark: avgLuminance < 45, // Quá tối
    isTooBright: avgLuminance > 230, // Quá lóa
    isBlurry: variance < 15, // Quá mờ
    luminance: Math.round(avgLuminance),
    sharpness: Math.round(variance),
  };
}
