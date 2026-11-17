# Chợ Pass Sinh Viên (ChoPass.vn)

> **Nền tảng mua bán & chuyển nhượng đồ cũ uy tín dành riêng cho sinh viên Việt Nam.**  
> Xây dựng theo tiêu chuẩn Web hiện đại, mobile-first, xác minh thẻ sinh viên 100%, bảo mật dữ liệu theo Luật Bảo vệ dữ liệu cá nhân 2025 và cơ cấu hành chính 2 cấp mới nhất của Việt Nam.

---

## 1. Giới Thiệu & 3 Điểm Khác Biệt Cốt Lõi

1. **100% Sinh viên đã xác minh thẻ**: Chỉ tài khoản đã được quản trị viên duyệt ảnh thẻ sinh viên mới có quyền đăng tin bán và xem số liên hệ (Zalo/SĐT), loại bỏ hoàn toàn tình trạng lừa đảo, cào số điện thoại và môi giới ngoài cổng trường.
2. **Khẩn trương mùa ra trường & Nhãn "Pass trong ngày"**: Mỗi tin đều có hạn cần pass cụ thể và công tắc nổi bật màu vàng hổ phách dành riêng cho các món cần giải phóng phòng trọ gấp trong 24 giờ.
3. **Minh bạch phương thức giao nhận**: Khối thông tin chi tiết ngay trên tin về hình thức tự đến lấy (kèm điểm hẹn công khai và địa chỉ phòng trọ bí mật), người bán tự ship (nội thành/nội trường), hoặc gửi chuyển phát.

---

## 2. Kiến Trúc & Công Nghệ Sử Dụng

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide React, Zod.
- **Backend & API**: Next.js App Router Route Handlers kết hợp Firebase Admin SDK (`firebase-admin`), kiểm thực danh tính qua Firebase ID Token (`Authorization: Bearer <idToken>`).
- **Database & Lưu trữ**: Cloud Firestore & Cloud Storage.
- **Bảo mật & Quyền riêng tư**:
  - Mã băm HMAC-SHA256 kết hợp mã trường và MSSV (`STUDENT_ID_HMAC_SECRET`) chạy độc quyền phía máy chủ để chống đăng ký trùng lặp thẻ mà không lưu số thẻ gốc.
  - Phân vùng Cloud Storage riêng tư (`private/cards/{uid}/front.webp`) chỉ cho phép chủ tài khoản và Admin đọc qua Signed URL ngắn hạn 5 phút. Tự động xóa vĩnh viễn ảnh thẻ sau 30 ngày.
  - Kiểm tra và ngăn chặn triệt để lỗ hổng leo thang quyền hạn bằng Firestore & Storage Security Rules nghiêm ngặt.
- **Kiểm thử**: Vitest cho unit tests & kiểm thử bảo mật; Firebase Emulator Suite cho môi trường phát triển cục bộ.
- **Triển khai**: Tương thích hoàn toàn Vercel (Production) với cơ chế Auth Proxy Rewrite.

---

## 3. Danh Mục Địa Giới & Trường Học Toàn Quốc

Hệ thống được thiết kế linh hoạt, **tuyệt đối không gắn cứng (hardcode) bất kỳ tên thành phố hay trường học nào vào mã nguồn**:

- **Địa giới hành chính 2 cấp (Nghị định hiện hành từ 01/07/2025)**:
  - Cả nước gồm **34 Tỉnh / Thành phố trực thuộc Trung ương** (đã loại bỏ hoàn toàn bộ dữ liệu 63 tỉnh cũ và bỏ cấp quận/huyện).
  - Đầy đủ đơn vị cấp xã/phường/đặc khu làng đại học.
  - Tên quận/huyện cũ được giữ làm từ khóa tìm kiếm phụ để người dùng quen gọi vẫn tìm được dễ dàng.
- **Danh mục Trường học**:
  - Toàn bộ các trường Đại học, Cao đẳng, Học viện trên toàn quốc (ĐHQG Hà Nội, ĐHQG TP.HCM, Bách Khoa, Kinh Tế, Sư Phạm, Y Dược, Ngoại Thương, Cần Thơ, Đà Nẵng, Huế, Thái Nguyên...).
  - Mỗi trường gắn với trụ sở chính và các cơ sở, phân hiệu, ký túc xá tương ứng.
- **Triết lý Dữ liệu Sạch (No Fake Data)**:
  - Cơ sở dữ liệu production hoàn toàn sạch 100%, không chứa tin đăng ảo hay người dùng giả lập.
  - Khi chưa có người đăng tin tại khu vực, giao diện hiển thị **Empty State** chuẩn chỉnh và thân thiện kèm nút kêu gọi hành động: *"Đăng món đồ đầu tiên của trường bạn"*.

---

## 4. Hướng Dẫn Cài Đặt & Chạy Thử Cục Bộ (Local Dev)

### 4.1. Yêu cầu môi trường
- Node.js version 18+ (hoặc Node 20 / 22)
- Java Runtime Environment (JRE 11+) để chạy Firebase Emulator Suite.

### 4.2. Cài đặt các gói phụ thuộc
```bash
git clone <repo-url>
cd cho-pass-sv
npm install
```

### 4.3. Thiết lập biến môi trường
Sao chép tệp cấu hình mẫu:
```bash
cp .env.example .env.local
```
Trong `.env.local`, giá trị `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` được bật sẵn để kết nối tới Firebase Emulator cục bộ.

### 4.4. Khởi động Web Dev Server & Kiểm thử
```bash
npm run dev
```
Truy cập trình duyệt tại:
- **Trang chủ**: `http://localhost:3000`
- **Đăng nhập Google**: `http://localhost:3000/auth/login`
- **Đăng tin mới**: `http://localhost:3000/listings/new`
- **Quản trị duyệt thẻ SV**: `http://localhost:3000/admin/verifications`

Chạy bộ kiểm thử tự động:
```bash
npm test
```

Chi tiết các bước thiết lập OAuth Google trên Firebase Console và Google Cloud Console xem tại [docs/google-login-setup.md](docs/google-login-setup.md).
