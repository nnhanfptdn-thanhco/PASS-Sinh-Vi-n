import { NextRequest, NextResponse } from "next/server";
import { requireVerified, errorResponse } from "@/lib/auth/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { removeVietnameseTones } from "@/lib/utils";
import { z } from "zod";

const MAX_ACTIVE_LISTINGS_PER_SELLER = 10;
const MAX_PRICE_VND = 500_000_000;

const createListingSchema = z.object({
  title: z
    .string()
    .min(10, "Tên món đồ phải từ 10 đến 80 ký tự")
    .max(80, "Tên món đồ phải từ 10 đến 80 ký tự")
    .refine((val) => val !== val.toUpperCase() || val.length <= 15, {
      message: "Tên món đồ không được viết hoa toàn bộ",
    })
    .refine(
      (val) => !/(0[3|5|7|8|9]\d{8})|(https?:\/\/)|(www\.)/i.test(val),
      {
        message: "Tên món đồ không được chứa số điện thoại hoặc liên kết web",
      }
    ),
  categoryId: z.string().min(1, "Vui lòng chọn danh mục"),
  subcategory: z.string().optional(),
  condition: z.string().min(1, "Vui lòng chọn tình trạng món đồ"),
  brandModel: z.string().optional(),
  usageTime: z.string().optional(),
  defects: z.string().optional(),
  noDefects: z.boolean().optional(),
  description: z.string().optional(),
  price: z
    .number()
    .min(0, "Giá pass không được âm")
    .max(MAX_PRICE_VND, `Giá pass tối đa ${MAX_PRICE_VND.toLocaleString()} đ`),
  originalPrice: z.number().optional(),
  negotiationType: z.enum(["fixed", "slight", "flexible"]).optional(),
  isCombo: z.boolean().optional(),
  urgentPass: z.boolean().optional(),
  passDeadline: z.string().optional(),
  schoolCode: z.string().min(1, "Vui lòng chọn mã trường học"),
  campusId: z.string().optional(),
  provinceCode: z.string().min(1, "Vui lòng chọn tỉnh/thành"),
  wardCode: z.string().optional(),
  publicMeetingPoint: z.string().optional(),
  exactAddress: z.string().optional(),
  detailedSchedule: z.string().optional(),
  shippingMethods: z.record(z.string(), z.any()).optional(),
  itemDimensions: z.string().optional(),
  images: z
    .array(z.string().min(1))
    .min(1, "Tin đăng phải có tối thiểu 1 ảnh thực tế")
    .max(10, "Tin đăng có tối đa 10 ảnh"),
  motorbikeDetails: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const token = await requireVerified(req);
    const sellerId = token.uid;
    const sellerName = token.name || "Sinh viên";

    const body = await req.json();
    const parsed = createListingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // 1. Kiểm tra giới hạn 10 tin đang bán của tài khoản
    const activeListingsSnap = await adminDb
      .collection("listings")
      .where("sellerId", "==", sellerId)
      .where("status", "==", "active")
      .get();

    if (activeListingsSnap.size >= MAX_ACTIVE_LISTINGS_PER_SELLER) {
      return NextResponse.json(
        {
          error: `Bạn đang có ${activeListingsSnap.size} tin đang bán. Mỗi tài khoản chỉ được mở tối đa 10 tin cùng lúc. Vui lòng ẩn hoặc hoàn tất các tin cũ trước khi đăng thêm.`,
        },
        { status: 429 }
      );
    }

    // 2. Chống đăng trùng: kiểm tra độ tương đồng tên tin của cùng người bán
    const normalizedNewTitle = removeVietnameseTones(data.title);
    for (const doc of activeListingsSnap.docs) {
      const existingTitle = removeVietnameseTones(doc.data().title || "");
      if (
        normalizedNewTitle === existingTitle ||
        (existingTitle.includes(normalizedNewTitle) && normalizedNewTitle.length > 15)
      ) {
        return NextResponse.json(
          {
            error:
              "Bạn đã có một tin đăng có tên tương tự đang còn hiệu lực. Vui lòng kiểm tra lại để tránh đăng trùng lặp.",
          },
          { status: 409 }
        );
      }
    }

    // 3. Tạo searchTokens
    const tokensSet = new Set<string>();
    const words = normalizedNewTitle.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (w.length >= 2) tokensSet.add(w);
    }
    const searchTokens = Array.from(tokensSet);

    // 4. Tạo mã tin đăng
    const listingRef = adminDb.collection("listings").doc();
    const listingId = listingRef.id;

    // 5. Lưu dữ liệu công khai vào collection listings
    await listingRef.set({
      id: listingId,
      sellerId,
      sellerName,
      title: data.title.trim(),
      titleNormalized: normalizedNewTitle,
      searchTokens,
      categoryId: data.categoryId,
      subcategory: data.subcategory || null,
      condition: data.condition,
      brandModel: data.brandModel || null,
      usageTime: data.usageTime || null,
      defects: data.noDefects ? "Không có lỗi" : data.defects || "Không có lỗi",
      description: data.description || "",
      price: Math.round(data.price / 1000) * 1000,
      originalPrice: data.originalPrice ? Math.round(data.originalPrice / 1000) * 1000 : null,
      negotiationType: data.negotiationType || "flexible",
      isCombo: Boolean(data.isCombo),
      urgentPass: Boolean(data.urgentPass),
      passDeadline: data.passDeadline || null,
      schoolCode: data.schoolCode,
      campusId: data.campusId || null,
      provinceCode: data.provinceCode,
      wardCode: data.wardCode || null,
      publicMeetingPoint: data.publicMeetingPoint || "Cổng chính khuôn viên trường",
      shippingMethods: data.shippingMethods || { pickup: true },
      hasShipping: Boolean(
        data.shippingMethods?.sellerDelivery || data.shippingMethods?.carrierShipping
      ),
      campusDelivery: Boolean(data.shippingMethods?.campusDelivery),
      itemDimensions: data.itemDimensions || null,
      images: data.images,
      coverImage: data.images[0] || "",
      motorbikeDetails: data.motorbikeDetails || null,
      status: "active",
      viewsCount: 0,
      favoritesCount: 0,
      chatsCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 6. Lưu dữ liệu bảo mật vào collection listingsPrivate
    await adminDb.collection("listingsPrivate").doc(listingId).set({
      listingId,
      sellerId,
      exactAddress: data.exactAddress || null,
      detailedSchedule: data.detailedSchedule || null,
      confirmedBuyerId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 7. Tăng bộ đếm activeListingsCount của user
    await adminDb
      .collection("users")
      .doc(sellerId)
      .set(
        {
          activeListingsCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return NextResponse.json({
      success: true,
      listingId,
      message: "Đăng tin thành công! Tin của bạn đã xuất hiện trên chợ sinh viên.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
