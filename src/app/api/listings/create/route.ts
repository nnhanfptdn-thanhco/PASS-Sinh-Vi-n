import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { removeVietnameseTones } from "@/lib/utils";

// Hằng số cấu hình theo SPEC
const MAX_ACTIVE_LISTINGS_PER_SELLER = 10;
const MAX_PRICE_VND = 500_000_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      sellerId,
      sellerName,
      title,
      categoryId,
      subcategory,
      condition,
      brandModel,
      usageTime,
      defects,
      noDefects,
      description,
      price,
      originalPrice,
      negotiationType,
      isCombo,
      urgentPass,
      passDeadline,
      schoolCode,
      campusId,
      provinceCode,
      wardCode,
      publicMeetingPoint,
      exactAddress,
      detailedSchedule,
      shippingMethods,
      itemDimensions,
      images,
      motorbikeDetails,
    } = body;

    // 1. Kiểm tra tham số cơ bản
    if (!sellerId || !title || !categoryId || price === undefined) {
      return NextResponse.json(
        { error: "Vui lòng nhập đầy đủ các trường thông tin bắt buộc" },
        { status: 400 }
      );
    }

    if (title.length < 10 || title.length > 80) {
      return NextResponse.json(
        { error: "Tên món đồ phải từ 10 đến 80 ký tự" },
        { status: 400 }
      );
    }

    // Không cho phép viết hoa toàn bộ
    if (title === title.toUpperCase() && title.length > 15) {
      return NextResponse.json(
        { error: "Tên món đồ không được viết hoa toàn bộ" },
        { status: 400 }
      );
    }

    // Chặn số điện thoại hoặc link web trong tên món
    if (/(0[3|5|7|8|9]\d{8})|(https?:\/\/)|(www\.)/i.test(title)) {
      return NextResponse.json(
        { error: "Tên món đồ không được chứa số điện thoại hoặc liên kết web" },
        { status: 400 }
      );
    }

    if (price < 0 || price > MAX_PRICE_VND) {
      return NextResponse.json(
        { error: `Giá pass phải từ 0 đến ${MAX_PRICE_VND.toLocaleString()} đ` },
        { status: 400 }
      );
    }

    if (!images || images.length < 3) {
      return NextResponse.json(
        { error: "Tin đăng phải có tối thiểu 3 ảnh thực tế của món đồ" },
        { status: 400 }
      );
    }

    // 2. Kiểm tra giới hạn 10 tin đang bán của tài khoản
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

    // 3. Chống đăng trùng: kiểm tra độ tương đồng tên tin của cùng người bán
    const normalizedNewTitle = removeVietnameseTones(title);
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

    // 4. Tạo mảng từ khóa tìm kiếm tiếng Việt không dấu (searchTokens)
    const tokensSet = new Set<string>();
    const words = normalizedNewTitle.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (w.length >= 2) tokensSet.add(w);
    }
    const searchTokens = Array.from(tokensSet);

    // 5. Tạo mã tin đăng
    const listingRef = adminDb.collection("listings").doc();
    const listingId = listingRef.id;

    // 6. Lưu dữ liệu công khai vào collection listings
    await listingRef.set({
      id: listingId,
      sellerId,
      sellerName: sellerName || "Sinh viên",
      title: title.trim(),
      titleNormalized: normalizedNewTitle,
      searchTokens,
      categoryId,
      subcategory: subcategory || null,
      condition,
      brandModel: brandModel || null,
      usageTime: usageTime || null,
      defects: noDefects ? "Không có lỗi" : defects || "Không có lỗi",
      description: description || "",
      price: Math.round(price / 1000) * 1000, // Làm tròn theo 1.000 đ
      originalPrice: originalPrice ? Math.round(originalPrice / 1000) * 1000 : null,
      negotiationType: negotiationType || "flexible", // "fixed" | "slight" | "flexible"
      isCombo: Boolean(isCombo),
      urgentPass: Boolean(urgentPass),
      passDeadline: passDeadline || null,
      schoolCode: schoolCode || "QSX",
      campusId: campusId || "c1",
      provinceCode: provinceCode || "79",
      wardCode: wardCode || "27139",
      publicMeetingPoint: publicMeetingPoint || "Cổng chính khuôn viên trường",
      shippingMethods: shippingMethods || { pickup: true },
      hasShipping: Boolean(shippingMethods?.sellerDelivery || shippingMethods?.carrierShipping),
      campusDelivery: Boolean(shippingMethods?.campusDelivery),
      itemDimensions: itemDimensions || null,
      images,
      coverImage: images[0] || "",
      motorbikeDetails: motorbikeDetails || null,
      status: "active", // "draft" | "active" | "reserved" | "sold" | "expired" | "hidden_by_seller" | "hidden_by_admin"
      viewsCount: 0,
      favoritesCount: 0,
      chatsCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 7. Lưu dữ liệu bảo mật (Địa chỉ chính xác, SĐT) vào collection listingsPrivate
    // Chỉ người bán và người mua đã chốt confirmed mới được đọc
    await adminDb.collection("listingsPrivate").doc(listingId).set({
      listingId,
      sellerId,
      exactAddress: exactAddress || null,
      detailedSchedule: detailedSchedule || null,
      confirmedBuyerId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 8. Tăng bộ đếm activeListingsCount của user
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
    console.error("Lỗi đăng tin:", err);
    return NextResponse.json(
      { error: "Đã xảy ra lỗi nội bộ máy chủ khi tạo tin" },
      { status: 500 }
    );
  }
}
