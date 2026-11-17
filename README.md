# Chợ Pass Sinh Viên (ChoPass.vn)

> **Nền tảng mua bán & chuyển nhượng đồ cũ uy tín dành riêng cho sinh viên Việt Nam.**  
> Xây dựng theo tiêu chuẩn Web hiện đại, mobile-first, xác minh thẻ sinh viên 100%, bảo mật dữ liệu theo Luật Bảo vệ dữ liệu cá nhân 2025 và cơ cấu hành chính 2 cấp mới nhất của Việt Nam.

---

## 1. Giới Thiệu & 3 Điểm Khác Biệt Cốt Lõi

1. **100% Sinh viên đã xác minh thẻ**: Chỉ tài khoản đã được quản trị viên duyệt ảnh thẻ sinh viên mới có quyền đăng tin bán và xem số liên hệ (Zalo/SĐT), loại bỏ hoàn toàn tình trạng lừa đảo, cào số điện thoại và môi giới ngoài cổng trường.
2. **Khẩn trương mùa ra trường & Nhãn "Pass trong ngày"**: Mỗi tin đều có hạn cần pass cụ thể và công tắc nổi bật màu vàng hổ phách dành riêng cho các món cần giải phóng phòng trọ gấp trong 24 giờ.
3. **Minh bạch phương thức giao nhận**: Khối thông tin chi tiết ngay trên tin về hình thức tự đến lấy (kèm điểm hẹn công khai và địa chỉ phòng trọ bí mật), người bán tự ship (nội thành/nội trường), hoặc gửi chuyển phát.

---

## 2. Công Nghệ Sử Dụng

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, Lucide React, React Hook Form, Zod.
- **Backend & Database**: Firebase Authentication (Google OAuth), Cloud Firestore, Cloud Storage, Cloud Functions, App Check, Firebase Admin SDK.
- **Bảo mật & Quyền riêng tư**: Mã băm HMAC-SHA256 lưu trong Secret Manager để chống trùng lặp thẻ; phân vùng Cloud Storage riêng tư (`private/cards/`) tự động hủy ảnh thẻ sau 30 ngày.
- **Kiểm thử**: Vitest cho unit tests & luồng E2E; Firebase Emulator Suite cho phát triển và kiểm thử cục bộ.
- **Triển khai**: Tương thích hoàn toàn Vercel (khuyến nghị) hoặc Firebase App Hosting hỗ trợ SSR & Server Actions.

---

## 3. Danh Mục Địa Giới & Trường Học Toàn Quốc

Hệ thống được thiết kế linh hoạt, **tuyệt đối không gắn cứng (hardcode) bất kỳ tên thành phố hay trường học nào vào mã nguồn**:

- **Địa giới hành chính 2 cấp (Nghị định hiện hành từ 01/07/2025)**:
  - Cả nước gồm **34 Tỉnh / Thành phố trực thuộc Trung ương** (đã loại bỏ hoàn toàn bộ dữ liệu 63 tỉnh cũ và bỏ cấp quận/huyện).
  - Đầy đủ đơn vị cấp xã/phường/đặc khu (đang nạp các xã/phường trọng điểm làng đại học, sẵn sàng tiếp nhận file dump đầy đủ 3.321 đơn vị của Cục Thống kê).
  - Tên quận/huyện cũ được giữ làm từ khóa tìm kiếm phụ để người dùng quen gọi vẫn tìm được dễ dàng.
- **Danh mục Trường học**:
  - Toàn bộ các trường Đại học, Cao đẳng, Học viện trên toàn quốc (ĐHQG Hà Nội, ĐHQG TP.HCM, Bách Khoa, Kinh Tế, Sư Phạm, Y Dược, Ngoại Thương, Cần Thơ, Đà Nẵng, Huế, Thái Nguyên...).
  - Mỗi trường gắn với trụ sở chính và các cơ sở, phân hiệu, ký túc xá tương ứng.
- **Triết lý Dữ liệu Sạch (No Fake Data)**:
  - Cơ sở dữ liệu production hoàn toàn sạch 100%, không chứa tin đăng ảo hay người dùng ảo.
  - Khi chưa có người đăng tin tại khu vực, giao diện hiển thị **Empty State** chuẩn chỉnh và thân thiện kèm nút kêu gọi hành động: *"Đăng món đồ đầu tiên của trường bạn"*.

---

## 4. Hướng Dẫn Cài Đặt & Chạy Thử Cục Bộ (Local Dev)

### 4.1. Yêu cầu môi trường
- Node.js version 18+ (hoặc Node 20 / 22 / 24 / 26)
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
Trong `.env.local`, giá trị `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` đã được bật sẵn để kết nối tới Firebase Emulator cục bộ mà không cần tài khoản Firebase thật.

### 4.4. Khởi tạo danh mục vào Emulator
Khởi động Firebase Emulator:
```bash
npx firebase emulators:start
```
Trong một terminal khác, chạy script nạp danh mục:
```bash
npx ts-node --transpile-only scripts/init-catalogs.ts
```

### 4.5. Khởi động Web Dev Server
```bash
npm run dev
```
Truy cập trình duyệt tại:
- **Trang chủ**: `http://localhost:3000`
- **Showcase linh kiện giao diện**: `http://localhost:3000/showcase`
- **Đăng tin mới**: `http://localhost:3000/listings/new`
- **Quản trị duyệt thẻ SV**: `http://localhost:3000/admin/verifications`
- **Firebase Emulator UI**: `http://localhost:4000`

### 4.6. Chạy bộ kiểm thử tự động
```bash
npm test
```

---

## 5. Quản Lý Chi Phí & Gói Firebase Blaze

1. **Bật gói Blaze**: Cloud Functions và Cloud Storage đều yêu cầu gói trả theo mức dùng (Blaze).
2. **Cảnh báo ngân sách (Budget Alert)**:
   - Truy cập **Google Cloud Console** &rarr; **Billing** &rarr; **Budgets & alerts**.
   - Tạo cảnh báo ngân sách (ví dụ: $5 / tháng hoặc $10 / tháng).
   - Thiết lập các ngưỡng cảnh báo gửi email ở mức 50%, 80%, 100% ngân sách.
   - *Lưu ý*: Cảnh báo ngân sách chỉ gửi email thông báo chứ không tự động ngắt kết nối hệ thống. Dự án chống lạm dụng chi phí bằng 3 tầng bảo vệ: App Check, Rate Limiting (giới hạn 10 lượt xem liên hệ/giờ, tối đa 10 tin đang bán/tài khoản) và Canvas Image Compression phía client (giảm 85% dung lượng lưu trữ trước khi upload).

---

## 6. Hướng Dẫn Triển Khai (Deployment)

### Phương án A: Triển khai lên Vercel (Khuyến nghị)
1. Kết nối repository Git với tài khoản [Vercel](https://vercel.com).
2. Thiết lập các biến môi trường trong phần **Project Settings &rarr; Environment Variables** (tương tự như trong `.env.example`).
3. Trong tệp `next.config.mjs`, cấu hình chuyển tiếp `/__/auth/` về miền Firebase Auth để hỗ trợ đăng nhập Google ổn định mà không bị trình duyệt chặn cookie bên thứ ba.
4. Bấm **Deploy**. Vercel sẽ tự động tối ưu hóa các trang SSR và Server Actions.

### Phương án B: Triển khai lên Firebase App Hosting
1. Truy cập Firebase Console &rarr; **App Hosting**.
2. Kết nối với nhánh `main` của GitHub repo.
3. Cấu hình tệp `apphosting.yaml` để thiết lập tài nguyên Node.js runtime.

---

## 7. Rà Soát Pháp Lý (Chủ Dự Án Chuẩn Bị Trước)

> [!IMPORTANT]
> **Tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 & Nghị định 356/2025/NĐ-CP**:
> - Thẻ sinh viên có chứa ảnh chụp khuôn mặt (thuộc nhóm dữ liệu cá nhân nhạy cảm). Bản thiết kế đã áp dụng cơ chế tự động xóa ảnh sau 30 ngày và băm bảo mật MSSV bằng HMAC-SHA256.
> - Các trang [Điều khoản Dịch vụ](/terms) và [Chính sách Bảo vệ Dữ liệu](/privacy) hiện là bản thảo khung mẫu được gắn nhãn `CẦN LUẬT SƯ RÀ SOÁT`. Chủ dự án cần làm việc với luật sư để hoàn thiện thông tin pháp nhân và chính sách bảo mật trước khi mở đăng ký rộng rãi cho người dùng thật.

### Danh sách các hạng mục cần Chủ dự án cung cấp:
- [ ] Tên miền chính thức (ví dụ `chopass.vn`) đã xác thực bản ghi DNS SPF/DKIM để gửi email thông báo thật qua Resend hoặc SMTP.
- [ ] Khóa bảo mật HMAC secret cho Secret Manager (`STUDENT_ID_HMAC_SECRET`).
- [ ] Email quản trị viên đầu tiên (`ADMIN_EMAIL`).
- [ ] Bản hợp đồng/điều khoản đã được văn phòng luật sư thẩm định.
- [ ] File dữ liệu mở rộng 3.321 xã/phường đầy đủ từ Cục Thống kê (nếu muốn nạp chi tiết toàn bộ các xã vùng xa ngoài các cụm trường đại học).

---
© 2026 Chợ Pass Sinh Viên. Xây dựng vì cộng đồng sinh viên Việt Nam.
