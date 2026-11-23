import { z } from "zod";
import { containsContactInfo } from "@/lib/utils/contact-filter";
import { todayVN, addDaysVN } from "@/lib/utils/date";

/**
 * Kiểm tra xem văn bản công khai có chứa thông tin liên hệ không
 */
export function hasContactInfo(text: string): boolean {
  return containsContactInfo(text);
}

export const createListingSchema = z
  .object({
    draftId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,64}$/, "draftId không hợp lệ")
      .optional(),
    clientRequestId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,100}$/, "clientRequestId không hợp lệ")
      .optional(),
    title: z
      .string()
      .trim()
      .min(10, "Tên món đồ phải từ 10 ký tự trở lên")
      .max(80, "Tên món đồ không được vượt quá 80 ký tự"),
    categoryId: z.string().min(1, "Vui lòng chọn danh mục"),
    subcategory: z.string().optional(),
    condition: z.string().min(1, "Vui lòng chọn tình trạng món đồ"),
    brandModel: z.string().max(80).optional(),
    usageTime: z.string().max(50).optional(),
    defects: z.string().max(500).optional(),
    noDefects: z.boolean().optional(),
    description: z.string().max(2000, "Mô tả tối đa 2000 ký tự").optional().default(""),
    price: z
      .number()
      .int("Giá phải là số nguyên")
      .min(0, "Giá không được nhỏ hơn 0")
      .max(500000000, "Giá không được vượt quá 500.000.000 đ"),
    originalPrice: z.number().int().min(0).max(500000000).optional(),
    negotiationType: z.enum(["fixed", "slight", "flexible"]).default("slight"),
    urgentPass: z.boolean().optional().default(false),
    passDeadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Hạn pass phải theo định dạng YYYY-MM-DD")
      .refine((val) => {
        const [y, m, d] = val.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        return (
          dt.getUTCFullYear() === y &&
          dt.getUTCMonth() === m - 1 &&
          dt.getUTCDate() === d
        );
      }, "Hạn pass không phải là ngày hợp lệ trên lịch")
      .refine((val) => {
        const today = todayVN();
        const maxDeadline = addDaysVN(today, 60);
        return val >= today && val <= maxDeadline;
      }, "Hạn pass phải nằm trong khoảng từ hôm nay đến tối đa 60 ngày tới"),
    schoolCode: z.string().optional(),
    campusId: z.string().optional(),
    provinceCode: z.string().optional(),
    wardCode: z.string().optional(),
    publicMeetingPoint: z.string().max(120).optional().default("Cổng trường"),
    exactAddress: z.string().max(200).optional(),
    detailedSchedule: z.string().max(300).optional(),
    shippingMethods: z.object({
      pickup: z.boolean().default(true),
      sellerDelivery: z.boolean().default(false),
      carrierShipping: z.boolean().default(false),
      campusDelivery: z.boolean().default(false),
      shipFeeNote: z.string().max(200).optional(),
    }),
    itemDimensions: z
      .object({
        weight: z.union([z.string().max(50), z.number()]).optional(),
        dimensions: z.string().max(100).optional(),
      })
      .nullable()
      .optional(),
    images: z
      .array(z.string().max(2048, "Đường dẫn ảnh quá dài"))
      .min(1, "Vui lòng tải tối thiểu 1 ảnh thực tế")
      .max(10, "Tối đa 10 ảnh"),
    thumbs: z.array(z.string().max(2048, "Đường dẫn thumbnail quá dài")).max(10).optional(),
  })
  .strict();

export const contactRequestSchema = z
  .object({
    listingId: z.string().min(1, "Thiếu listingId"),
  })
  .strict();

export const submitVerificationSchema = z
  .object({
    realName: z.string().trim().min(2, "Họ và tên phải từ 2 ký tự trở lên").max(100, "Họ và tên tối đa 100 ký tự"),
    displayName: z.string().trim().min(2, "Tên hiển thị phải từ 2 ký tự trở lên").max(60, "Tên hiển thị tối đa 60 ký tự"),
    schoolCode: z.string().min(1, "Vui lòng chọn trường học").max(32),
    campusId: z.string().max(64).optional(),
    faculty: z.string().max(100).optional(),
    studentClass: z.string().max(50).optional(),
    studentId: z
      .string()
      .trim()
      .min(4, "Mã số sinh viên không hợp lệ")
      .max(32, "Mã số sinh viên quá dài")
      .regex(/^[A-Za-z0-9\-_./\s]{4,32}$/, "Mã số sinh viên chỉ chứa chữ cái, chữ số và ký tự hợp lệ"),
    zaloPhone: z
      .string()
      .regex(/^(0|\+84)[35789][0-9]{8}$/, "Số điện thoại Zalo không hợp lệ"),
    altPhone: z
      .string()
      .regex(/^(0|\+84)[35789][0-9]{8}$/, "Số điện thoại phụ không hợp lệ")
      .optional()
      .or(z.literal("")),
    provinceCode: z.string().max(32).optional(),
    wardCode: z.string().max(32).optional(),
    dormOrAddress: z.string().max(200).optional(),
    isGraduating: z.boolean().optional(),
    cardStoragePath: z
      .string()
      .min(1, "Thiếu đường dẫn tệp ảnh thẻ")
      .max(256, "Đường dẫn tệp ảnh thẻ quá dài")
      .regex(/^private\/cards\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]{4,64}\.(webp|jpg)$/, "Đường dẫn tệp ảnh thẻ không hợp lệ"),
  })
  .strict();
