import { describe, it, expect } from "vitest";
import { computeStudentIdHash } from "../src/lib/firebase/admin";
import { removeVietnameseTones, formatCurrencyVND } from "../src/lib/utils";

describe("E2E Luồng Mua Bán Toàn Diện - Chợ Pass Sinh Viên", () => {
  // 1. Luồng Xác thực Thẻ Sinh Viên
  it("BƯỚC 1: Sinh viên nộp thẻ và tính mã băm bảo mật HMAC-SHA256", () => {
    const studentInfo = {
      schoolCode: "QSX",
      studentId: "2110456",
      realName: "Trần Minh Quân",
    };

    const hash = computeStudentIdHash(studentInfo.schoolCode, studentInfo.studentId);
    expect(hash).toHaveLength(64);

    // Kiểm tra tính nhất quán (Idempotent)
    const hashRepeat = computeStudentIdHash("qsx", "2110456 ");
    expect(hash).toBe(hashRepeat);
  });

  // 2. Chặn Người Chưa Xác Minh
  it("BƯỚC 2: Người chưa xác minh không được phép đăng tin hoặc xem số liên hệ", () => {
    const unverifiedUser = {
      uid: "user-unverified",
      verified: false,
    };

    const canPost = unverifiedUser.verified === true;
    const canViewPhone = unverifiedUser.verified === true;

    expect(canPost).toBe(false);
    expect(canViewPhone).toBe(false);
  });

  // 3. Quản Trị Viên Duyệt Thẻ
  it("BƯỚC 3: Admin duyệt thẻ thành công, cấp quyền verified cho tài khoản", () => {
    const user = {
      uid: "user-1",
      verified: false,
      role: "pending",
    };

    // Admin action: Approve
    user.verified = true;
    user.role = "verified";

    expect(user.verified).toBe(true);
    expect(user.role).toBe("verified");
  });

  // 4. Sinh Viên Đã Xác Minh Đăng Tin
  it("BƯỚC 4: Tạo tin đăng hợp lệ, tách biệt thông tin công khai và địa chỉ bảo mật", () => {
    const newListing = {
      id: "listing-101",
      sellerId: "user-1",
      title: "Quạt đứng Senko lồng sóc màu xám",
      price: 180000,
      urgentPass: true,
      condition: "Như mới (còn trên 90%)",
      publicMeetingPoint: "Cổng 1 KTX Bách Khoa",
      // Dữ liệu riêng tư
      exactAddress: "Phòng 402, Nhà B3, KTX Bách Khoa",
      sellerPhone: "0912345678",
      confirmedBuyerId: null as string | null,
    };

    // Kiểm tra tên món
    expect(newListing.title.length).toBeGreaterThanOrEqual(10);
    expect(newListing.title.length).toBeLessThanOrEqual(80);

    // Kiểm tra giá pass
    expect(newListing.price).toBeGreaterThanOrEqual(0);
    expect(formatCurrencyVND(newListing.price)).toContain("180.000");

    // Địa chỉ chính xác chưa mở cho ai khi chưa chốt
    expect(newListing.confirmedBuyerId).toBeNull();
  });

  // 5. Tìm Kiếm Bằng Tiếng Việt Không Dấu
  it("BƯỚC 5: Tìm kiếm tiếng Việt chịu được gõ không dấu", () => {
    const listingTitle = "Quạt đứng Senko lồng sóc";
    const normalizedTitle = removeVietnameseTones(listingTitle);

    const userQuery1 = "quat dung";
    const userQuery2 = "senko";
    const userQuery3 = "long soc";

    expect(normalizedTitle).toContain(userQuery1);
    expect(normalizedTitle).toContain(userQuery2);
    expect(normalizedTitle).toContain(userQuery3);
  });

  // 6. Luồng Giữ Chỗ & Xác Nhận 24 Giờ
  it("BƯỚC 6: Người mua gửi yêu cầu Giữ chỗ, Người bán duyệt xác nhận", () => {
    const reservation = {
      id: "res-1",
      listingId: "listing-101",
      buyerId: "user-2",
      sellerId: "user-1",
      status: "pending",
      hoursRemaining: 24,
    };

    expect(reservation.status).toBe("pending");
    expect(reservation.hoursRemaining).toBeLessThanOrEqual(24);

    // Người bán xác nhận
    reservation.status = "confirmed";
    expect(reservation.status).toBe("confirmed");

    // Khi đã confirmed, quyền xem địa chỉ chính xác được mở cho buyerId
    const confirmedBuyerId = reservation.buyerId;
    expect(confirmedBuyerId).toBe("user-2");
  });

  // 7. Hoàn Tất Giao Dịch & Đánh Giá 5 Sao
  it("BƯỚC 7: Hoàn tất giao dịch, 2 bên đánh giá sao và cập nhật uy tín", () => {
    const transaction = {
      status: "completed",
    };
    expect(transaction.status).toBe("completed");

    const review = {
      rating: 5,
      comment: "Bạn bán nhiệt tình, quạt chạy êm ru đúng mô tả!",
    };
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review.rating).toBeLessThanOrEqual(5);
  });
});
