# HƯỚNG DẪN CẤU HÌNH ĐĂNG NHẬP GOOGLE OAUTH & FIREBASE
**Dành cho Ban Quản Trị & Kỹ thuật viên dự án "Chợ Pass Sinh Viên"**

Tài liệu này hướng dẫn chi tiết các bước thủ công bắt buộc cần thực hiện trên Firebase Console, Google Cloud Console và Vercel để hệ thống đăng nhập Google hoạt động 100% trong môi trường thực tế.

---

## 1. Bật Xác minh 2 bước (2-Step Verification) cho Tài khoản Google Admin
> **Quan trọng**: Google Firebase hiện bắt buộc tài khoản người dùng phải bật 2-Step Verification (MFA) trước khi được cấp quyền truy cập Firebase Console.

1. Truy cập: [myaccount.google.com/signinoptions/two-step-verification](https://myaccount.google.com/signinoptions/two-step-verification)
2. Nếu trang hiển thị nút xanh dương **"Turn on 2-Step Verification"** ở góc dưới bên trái, hãy bấm vào nút này để kích hoạt.
3. Sau khi bật thành công, quay trở lại [console.firebase.google.com](https://console.firebase.google.com) và tải lại trang, bạn sẽ vào được bảng điều khiển Firebase bình thường.

---

## 2. Kích hoạt Google Sign-In trong Firebase Console

1. Mở dự án trên [Firebase Console](https://console.firebase.google.com/).
2. Điều hướng vào menu: **Build** &rarr; **Authentication** &rarr; tab **Sign-in method**.
3. Bấm vào nhà cung cấp **Google** (Google Sign-In Provider).
4. Bật công tắc **Enable**.
5. Điền thông tin:
   - **Project public-facing name**: `Chợ Pass Sinh Viên` (hoặc tên dự án của bạn).
   - **Project support email**: Chọn địa chỉ email quản trị viên của bạn từ menu thả xuống.
6. Bấm **Save** để lưu cấu hình.

---

## 3. Thêm Tên Miền Được Ủy Quyền (Authorized Domains)

1. Trong **Authentication**, chuyển sang tab **Settings** &rarr; chọn mục **Authorized domains**.
2. Đảm bảo danh sách có đầy đủ các tên miền sau:
   - `localhost` (Dành cho kiểm thử máy cá nhân)
   - `127.0.0.1`
   - `pass-sinh-vi-n.vercel.app` (Tên miền triển khai chính thức trên Vercel)
   - Tên miền tuỳ chỉnh riêng của bạn nếu có (ví dụ: `chopass.vn`, `www.chopass.vn`)
3. Bấm **Add domain** để thêm nếu tên miền của bạn chưa xuất hiện trong danh sách.

---

## 4. Kiểm tra Cấu hình OAuth 2.0 trong Google Cloud Console

1. Truy cập [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials) (chọn đúng Project ID của dự án Firebase).
2. Tại mục **OAuth 2.0 Client IDs**, bấm vào mục có tên **Web client (auto created by Google Service)**.
3. Trong phần **Authorized redirect URIs**, đảm bảo có chứa các URI sau:
   - `https://<YOUR_FIREBASE_PROJECT_ID>.firebaseapp.com/__/auth/handler`
   - `https://pass-sinh-vi-n.vercel.app/__/auth/handler` (khi sử dụng proxy rewrite qua Next.js)
4. Bấm **Save**.

---

## 5. Cấu hình Màn hình Chấp thuận OAuth (OAuth Consent Screen)

1. Điều hướng tới [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent).
2. Điền đầy đủ thông tin:
   - **App name**: `Chợ Pass Sinh Viên`
   - **User support email**: Email quản trị viên
   - **App domain**:
     - Application home page: `https://pass-sinh-vi-n.vercel.app`
     - Application privacy policy link: `https://pass-sinh-vi-n.vercel.app/privacy`
     - Application terms of service link: `https://pass-sinh-vi-n.vercel.app/terms`
3. Chuyển trạng thái Publishing status:
   - Nếu đang ở chế độ **Testing**: Chỉ các email được thêm vào danh mục "Test users" mới đăng nhập được.
   - Bấm nút **PUBLISH APP** để chuyển sang trạng thái **In production** để toàn bộ sinh viên có thể đăng nhập tự do.

---

## 6. Thiết lập Biến Môi Trường trên Vercel (Production & Preview)

Truy cập **Vercel Dashboard** &rarr; Chọn dự án `PASS-Sinh-Vi-n` &rarr; **Settings** &rarr; **Environment Variables**, cấu hình đầy đủ các biến sau:

| Tên biến | Giá trị mẫu / Hướng dẫn | Môi trường |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Lấy từ Firebase Console &rarr; Project Settings &rarr; Web App | Production, Preview |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `pass-sinh-vi-n.vercel.app` (hoặc `<project-id>.firebaseapp.com`) | Production, Preview |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `<project-id>` của dự án Firebase thật | Production, Preview |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `<project-id>.appspot.com` (hoặc `.firebasestorage.app`) | Production, Preview |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Mã sender id dạng số (ví dụ: `74839201948`) | Production, Preview |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `1:xxx:web:yyy` | Production, Preview |
| `NEXT_PUBLIC_USE_FIREBASE_EMULATOR` | `false` (Bắt buộc phải là false trên Vercel) | Production, Preview |
| `FIREBASE_PROJECT_ID` | `<project-id>` | Production, Preview |
| `FIREBASE_CLIENT_EMAIL` | Email từ file Service Account JSON tải từ Firebase | Production, Preview |
| `FIREBASE_PRIVATE_KEY` | Khóa riêng tư từ Service Account JSON (giữ nguyên `\n`) | Production, Preview |
| `STUDENT_ID_HMAC_SECRET` | Chuỗi ký tự ngẫu nhiên tối thiểu 32 ký tự (chống đảo ngược MSSV) | Production, Preview |
| `ADMIN_EMAILS` | `nnhanfptdn@gmail.com,admin@chopass.vn` (email nhận quyền Admin) | Production, Preview |
| `CRON_SECRET` | Khóa bí mật bảo vệ endpoint dọn dẹp hệ thống `/api/cron/cleanup` | Production, Preview |

---

## 7. Triển khai Quy tắc Bảo mật Firestore & Storage (Deploy Security Rules)

Chạy lệnh triển khai từ máy tính cá nhân lên project Production:
```bash
npx firebase deploy --only firestore:rules,storage --project <YOUR_PROD_PROJECT_ID>
```
Sau khi hoàn tất, toàn bộ hệ thống sẽ được bảo vệ tuyệt đối theo tiêu chuẩn ngân hàng & bảo vệ dữ liệu cá nhân PDP 2025.
