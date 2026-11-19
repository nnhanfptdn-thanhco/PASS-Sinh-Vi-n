import { z } from "zod";
import { containsContactInfo } from "@/lib/utils/contact-filter";

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
      .min(8, "draftId không hợp lệ")
      .max(64, "draftId quá dài")
      .optional(),
    clientRequestId: z.string().max(100).optional(),
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
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Hạn pass phải theo định dạng YYYY-MM-DD"),
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
      .array(z.string())
      .min(1, "Vui lòng tải tối thiểu 1 ảnh thực tế")
      .max(10, "Tối đa 10 ảnh"),
    thumbs: z.array(z.string()).max(10).optional(),
  })
  .strict();

export const contactRequestSchema = z
  .object({
    listingId: z.string().min(1, "Thiếu listingId"),
  })
  .strict();

export const submitVerificationSchema = z
  .object({
    realName: z.string().min(2, "Họ và tên phải từ 2 ký tự trở lên"),
    displayName: z.string().min(2, "Tên hiển thị phải từ 2 ký tự trở lên"),
    schoolCode: z.string().min(1, "Vui lòng chọn trường học"),
    campusId: z.string().optional(),
    faculty: z.string().optional(),
    studentClass: z.string().optional(),
    studentId: z.string().min(4, "Mã số sinh viên không hợp lệ"),
    zaloPhone: z
      .string()
      .regex(/^(0|\+84)[35789][0-9]{8}$/, "Số điện thoại Zalo không hợp lệ"),
    altPhone: z.string().optional(),
    provinceCode: z.string().optional(),
    wardCode: z.string().optional(),
    dormOrAddress: z.string().optional(),
    isGraduating: z.boolean().optional(),
    cardStoragePath: z.string().min(1, "Thiếu đường dẫn tệp ảnh thẻ"),
  })
  .strict();
