# BÁO CÁO TOÀN DIỆN: SỬA CHỮA TOÀN BỘ LỖI LOGIC & CỦNG CỐ DỰ ÁN "CHỢ PASS SINH VIÊN"

- **Dự án**: Chợ Pass Sinh Viên (PASS-Sinh-Vi-n)
- **Nhánh thực hiện**: `hardening/all`
- **Mục tiêu**: Xóa bỏ toàn bộ lỗi logic, dữ liệu giả mạo (mock data), bộ nhớ cục bộ giả lập (`localStorage`), khôi phục Firestore làm Nguồn Sự Thật Duy Nhất (Single Source of Truth), khắc phục triệt để hiện tượng tin đăng "vợ chồng cu đen" không hiển thị trên các tài khoản / thiết bị khác.
- **Ngày hoàn tất**: 19/11/2026

---

## 1. MA TRẬN NGUYÊN NHÂN GỐC RỄ & FILE ĐÃ XỬ LÝ (ROOT 1 - 5)

| Mã lỗi / Gốc rễ | Hiện tượng quan sát | Nguyên nhân kỹ thuật chính | File đã sửa / viết lại | Test tự động chứng minh |
|---|---|---|---|---|
| **Gốc 1: Nuốt lỗi tạo tin & Fallback giả** | Bấm "Đăng tin" thấy báo thành công và chuyển sang "Tin của tôi", nhưng Firestore không hề có bản ghi | `listings/new/page.tsx` dùng `Promise.race` timeout 1s, nuốt mọi lỗi mạng / lỗi 400 của server, tự động lưu vào `localStorage["cho_pass_my_listings"]` | `src/app/listings/new/page.tsx` | `tests/api-real-handlers.test.ts` (kiểm tra chờ phản hồi thật, trả lỗi 400/409 rõ ràng) |
| **Gốc 2: API từ chối toàn bộ request do Schema lệch** | Mọi lệnh gọi `POST /api/listings/create` đều bị từ chối 400 | `itemDimensions: z.string().optional()` trong khi client gửi `null` hoặc `{weight, dimensions}`; trường ảnh thiếu kiểm tra bucket Storage; cho phép ảnh `data:image/base64` gây tràn bộ nhớ | `src/lib/server/schemas.ts`, `src/app/api/listings/create/route.ts` | `tests/api-real-handlers.test.ts` (chặn base64, chấp nhận `itemDimensions: null`), `tests/contact-filter.test.ts` |
| **Gốc 3: Xác minh thẻ giả mạo phía client** | Tài khoản chưa được admin duyệt vẫn tự nhận là "Đã duyệt thẻ", nhưng gọi API bị chặn 403 | `onboarding/page.tsx` tự gán `verified: true` vào `localStorage["cho_pass_profile_<uid>"]`. `AuthContext` tin tưởng cache này bỏ qua server gate | `src/app/auth/onboarding/page.tsx`, `src/lib/auth/AuthContext.tsx`, `src/components/common/LegacyStorageCleanup.tsx` | `tests/unit-auth.test.ts`, `tests/api-auth-guards.test.ts` |
| **Gốc 4: Giao diện hoàn toàn không đọc Firestore** | Đăng tin ở trình duyệt A thì trình duyệt B hoặc máy khác không thấy; mở link chi tiết ra tin "Quạt Senko" cố định | `HomeFeed.tsx`, `search/page.tsx`, `my-listings/page.tsx` chỉ đọc `localStorage` + 3 tin demo cứng `l1..l3`. Trang `listings/[id]/page.tsx` trả tin Quạt Senko cứng cho mọi ID | `src/components/home/HomeFeed.tsx`, `src/app/search/page.tsx`, `src/app/my-listings/page.tsx`, `src/app/listings/[id]/page.tsx`, `src/app/listings/[id]/ListingDetailClient.tsx` | `tests/api-real-handlers.test.ts`, `tests/search-normalize.test.ts` |
| **Gốc 5: Trạng thái "Đã bán" & Ma trận hiển thị sai lệch** | Đánh dấu đã bán chỉ đổi ở máy mình; tin đã bán vẫn công khai trên trang chủ; Firestore rules cho phép đọc tin đã bán | `my-listings` chỉ đổi state cục bộ; `firestore.rules` cho phép public đọc `sold`; feed/search không lọc `sold/expired` | `firestore.rules`, `src/lib/services/listings.ts`, `src/app/api/listings/manage/route.ts`, `src/lib/domain/listing-status.ts` | `tests/listing-state-machine.test.ts`, `tests/firestore-indexes.test.ts` |

---

## 2. CHI TIẾT CÁC GÓI CÔNG VIỆC ĐÃ HOÀN THÀNH

### WP-0. Hạ tầng dùng chung & Bảo mật PDP
- `src/lib/constants/listing.ts`: Định nghĩa chuẩn các giới hạn hệ thống: tối đa 10 slot tin (`active + reserved`), tối thiểu 3 ảnh và tối đa 10 ảnh, tối đa 3 pending/tin, 5 pending/người mua, hạn giữ chỗ 24h/72h, hạn pass tối đa 30 ngày.
- `src/lib/utils/date.ts`: Xử lý nghiêm ngặt múi giờ `Asia/Ho_Chi_Minh` (UTC+7) qua `Intl.DateTimeFormat("en-CA")`. Tin đăng có hiệu lực đến 23:59:59 ngày hạn. Có unit test với các mốc giờ ranh giới 23:59/00:01 VN và 16:59/17:01 UTC (`tests/date.test.ts`).
- `src/lib/utils/contact-filter.ts`: Bộ lọc phát hiện số điện thoại VN (`0905 123 456`, `+84...`, `0905.123.456`), Zalo, liên kết mạng xã hội, Telegram, Facebook, Tiktok trong tiêu đề, mô tả, khuyết điểm, ghi chú hẹn; không chặn nhầm thông số kỹ thuật (`1500W`, `120x60cm`, `DR1608`). Đạt 100% unit tests.
- `src/lib/auth/server.ts`: Bổ sung hàm `requireApprovedStudent(req)` kiểm tra bắt buộc tài liệu `verifications/{uid}.status === "approved"`.
- `src/lib/services/listings.ts`: Tầng dịch vụ Server-Only chuẩn hóa DTO, lọc theo Ma trận 2.2, hỗ trợ fallback truy vấn cơ sở nếu Firestore thiếu composite index.

### WP-1. Xác thực sinh viên: Xóa bỏ xác minh giả
- `src/app/auth/onboarding/page.tsx`: Xóa bỏ việc tự gán `verified: true` và xóa cache `localStorage`. Ảnh thẻ tải trực tiếp lên `private/cards/${uid}/front.webp`. Sau khi nộp thành công hiển thị trạng thái chờ quản trị viên duyệt (`pending`).
- `src/lib/auth/AuthContext.tsx`: Xóa bỏ mọi tham chiếu tới `cachedProfile?.verified` hay `cachedProfile?.isAdmin`. Quyền sinh viên và quyền admin chỉ suy ra từ custom claim và Firestore.
- `src/components/common/LegacyStorageCleanup.tsx`: Client component chạy tự động xóa các khóa cũ `cho_pass_my_listings`, `cho_pass_profile_*`, `listing_draft` rác.

### WP-2. Đăng tin: API và Form chuẩn hóa
- `src/app/api/listings/create/route.ts`:
  - Dùng `requireApprovedStudent`.
  - Tên người bán lấy từ `users/{uid}.displayName` công khai, trường học và tỉnh thành lấy từ hồ sơ duyệt của server.
  - Kiểm tra dung lượng và đường dẫn Storage: bắt buộc thuộc `public/listings/${uid}/`, từ chối ảnh `data:image/base64`.
  - Giới hạn 10 slot tin (`active + reserved`) đếm bằng Firestore query trực tiếp.
  - Chống đăng trùng tiêu đề và hạn chế tần suất (Rate limit 5 tin/giờ).
  - Ghi đồng thời `listings` và `listingsPrivate` trong một Transaction.
- `src/app/listings/new/page.tsx`: Xóa bỏ toàn bộ dữ liệu mặc định demo (giá 0đ, placeholder rỗng), upload ảnh kèm thumbnail 480px nén chuẩn WebP, kiểm tra phản hồi thật từ API, lưu nháp form gắn với UID `listing_draft_${uid}`.
- `storage.rules` & `firestore.rules`:
  - Cập nhật rule Storage: `public/listings/{uid}/{draftId}/{fileName}` chỉ cho phép chính chủ đã xác minh ghi/xóa.
  - Loại bỏ hoàn toàn `sold` khỏi quyền đọc công khai trên Firestore `listings`.

### WP-3. Đọc dữ liệu: Trang chủ, Tìm kiếm, Chi tiết tin, Hồ sơ người bán
- `src/app/api/listings/search/route.ts` & `src/lib/services/listings.ts`: Quét và lọc đúng Ma trận 2.2; hỗ trợ sắp xếp `relevant` (ưu tiên cùng trường +2, cùng tỉnh +1), `newest`, `price_asc`, `price_desc`. Phân trang con trỏ (cursor) mượt mà.
- `src/components/home/HomeFeed.tsx` & `src/app/page.tsx`: Chuyển trang chủ sang Server Component gọi `searchListings({ limit: 12 })`. Xóa bỏ hoàn toàn 3 tin demo `l1..l3` và đọc `localStorage`. Nút "Xem thêm" tải tiếp bằng cursor.
- `src/app/search/page.tsx`: Tìm kiếm thời gian thực có Debounce 300ms + AbortController hủy request thừa, đồng bộ bộ lọc lên URL query params, hiển thị độ gần trường/tỉnh thực tế.
- `src/app/listings/[id]/page.tsx` & `ListingDetailClient.tsx`:
  - Server Component trả về 404 (`notFound()`) nếu tin không tồn tại, đã bán, bị ẩn hoặc quá hạn.
  - Dữ liệu Open Graph metadata động theo tin đăng thật.
  - Người xem là chủ tin sẽ thấy thông báo "Đây là tin đăng của bạn" và liên kết tới "Tin của tôi".
  - Tin `reserved` hiển thị banner cảnh báo và khóa nút giữ chỗ.
  - Nút chia sẻ dùng `navigator.share` kết hợp sao chép clipboard an toàn.
  - Nút tim Yêu thích kết nối trực tiếp với API `/api/favorites/toggle`.
- `src/app/sellers/[id]/page.tsx`: Server Component đọc hồ sơ công khai không chứa PII từ `users/{id}`, danh sách tin đang bán còn hiệu lực và lịch sử đánh giá gần nhất từ các bạn sinh viên khác.

### WP-4. "Tin của tôi" và Máy trạng thái tin đăng
- `src/lib/domain/listing-status.ts`: Thực thi chuẩn Bảng 2.3 máy trạng thái:
  - `active` -> `hidden_by_seller`: Hủy các giữ chỗ pending/waitlisted, gửi thông báo cho người mua.
  - `hidden_by_seller` -> `active`: Kiểm tra còn hạn pass và còn slot tin (< 10 tin).
  - `active` -> `sold`: Chuyển trạng thái cuối, hủy mọi giữ chỗ mở, tăng `completedDealsCount` của người bán.
  - `reserved` -> `sold`: Bị chặn khi gọi từ Manage; bắt buộc qua màn hình Giữ chỗ `complete`.
  - `renew`: Tăng hạn pass thêm 7 ngày (tối đa 30 ngày), cho phép hồi sinh tin `expired` sang `active` (có kiểm tra slot).
  - Tin `sold` là trạng thái cuối cùng, không ai có thể can thiệp.
- `src/app/api/listings/manage/route.ts`: Viết lại toàn bộ trong Firestore Transaction, đảm bảo nguyên tử, trả mã lỗi 409 khi chuyển đổi sai trạng thái.
- `src/app/my-listings/page.tsx`: Đọc thời gian thực bằng `onSnapshot(query(listings, where("sellerId", "==", uid)))`. Phân tách 4 tab: "Đang bán", "Đã có người giữ", "Đã bán", "Đã ẩn / Hết hạn". Khóa nút hành động theo từng tin riêng biệt, hộp thoại xác nhận trước khi Ẩn/Bán.

### WP-5. Giữ chỗ & Thông tin liên hệ
- `src/app/api/reservations/create/route.ts`:
  - Thực thi trong Transaction: kiểm tra tin `active`, còn hạn, người mua chưa có giữ chỗ mở trên tin này.
  - Kiểm tra tối đa 3 pending/tin và 5 pending/người mua trên toàn hệ thống.
  - Lọc SĐT/Zalo trong ghi chú hẹn gặp.
  - Đặt hạn phản hồi 24 giờ (`expiresAt`), gửi thông báo tức thời cho người bán.
- `src/app/api/reservations/action/route.ts`:
  - `confirm`: Chuyển giữ chỗ sang `confirmed`, đặt hạn giữ 72 giờ (`holdExpiresAt`), chuyển tin sang `reserved`, cấp quyền xem địa chỉ trong `listingsPrivate.confirmedBuyerId`, chuyển các pending khác sang `waitlisted`. Chống race-condition khi 2 người duyệt cùng lúc (chỉ 1 người thắng).
  - `cancel`: Hủy pending/waitlisted không làm ảnh hưởng tin đăng; hủy `confirmed` thì mở lại tin `active` và tự động đẩy người sớm nhất trong waitlist lên `pending` với **hạn mới 24 giờ**.
  - `no_show`: Ghi nhận người mua vắng mặt, tăng `noShowCount`, mở lại tin và đẩy waitlist.
  - `complete`: Chỉ cho phép chạy từ trạng thái `confirmed`, chuyển tin sang `sold`, gửi lời mời đánh giá cho **cả hai bên**.
- `src/app/reservations/page.tsx`: Đọc thời gian thực Firestore hai chiều (với tư cách người mua và người bán). Hiển thị đồng hồ đếm ngược hạn 24h/72h. Địa chỉ chính xác chỉ hiển thị cho giao dịch đã được duyệt. Modal đánh giá sao và gửi nhận xét.
- `src/app/api/listings/contact/route.ts`:
  - Tin `sold/hidden/expired` trả 404.
  - Tin `reserved` chỉ cho phép `confirmedBuyerId` xem.
  - Địa chỉ nhận đồ chính xác (`exactAddress`/`detailedSchedule`) CHỈ trả về trong JSON khi người gọi là `confirmedBuyerId` (hoặc admin/chủ tin).

### WP-6. Tự động hóa (Cron), Hết hạn, Index & Xóa tài khoản
- `vercel.json`: Đã tạo cấu hình Vercel Cron chạy hàng ngày lúc 00:05 giờ VN (`5 17 * * *` UTC) gọi `GET /api/cron/cleanup`.
- `src/lib/services/cleanup.ts`:
  - Quét tin hết hạn theo `todayVN()`.
  - Chia lô batch ghi tối đa 400 operations / batch (chống lỗi tràn giới hạn 500 của Firestore).
  - Hủy giữ chỗ pending quá 24h, cấp hạn mới 24h cho người mua kế tiếp trong waitlist.
  - Xử lý giữ chỗ confirmed quá 72h chưa hoàn tất (trả tin về chợ, xóa `confirmedBuyerId`).
  - Xóa ảnh thẻ sinh viên quá 30 ngày tính từ `decidedAt`.
- `firestore.indexes.json`: Bổ sung toàn bộ composite indexes cần thiết (listings theo status+createdAt, sellerId+createdAt, status+passDeadline; reservations theo buyerId, sellerId, listingId+status+createdAt, status+expiresAt, status+holdExpiresAt; notifications theo userId+createdAt; verifications theo status+decidedAt).
- `src/app/api/account/delete/route.ts`: Quét riêng biệt theo `buyerId` và `sellerId`, hủy các yêu cầu mở kèm thông báo đối tác, xóa toàn bộ tin đăng, ảnh Storage (`public/listings/${uid}/`, `private/cards/${uid}/`, `public/avatars/${uid}/`), và xóa tài khoản Firebase Auth.

### WP-7 & WP-8. Tối ưu UX Mobile & Bảo mật PDP
- `next.config.mjs`: Bổ sung `images.remotePatterns` cho `firebasestorage.googleapis.com` và localhost.
- `ListingCard.tsx`: Tích hợp nút yêu thích kết nối API `/api/favorites/toggle`, khắc phục cảnh báo hydration lồng thẻ `<Link>`.
- `src/app/messages/page.tsx`: Loại bỏ đọc `localStorage`, hiển thị giao diện rỗng trung thực khi chưa tích hợp Firestore chat.

---

## 3. KẾT QUẢ KIỂM THỬ KỸ THUẬT (QUALITY GATES)

| Cổng kiểm tra (Gate) | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 lỗi (Code 0)** | Tuyệt đối không có lỗi kiểu dữ liệu |
| **ESLint** | `npm run lint` | **0 lỗi, 0 cảnh báo (Code 0)** | Đã dọn dẹp toàn bộ biến thừa và hook dependencies |
| **Vitest Tests** | `npm test` | **14/14 test suites passed (95/95 tests passed)** | 100% kiểm thử tự động xanh |
| **Next.js Production Build** | `npm run build` | **Build thành công** | Tạo đầy đủ static & server-rendered routes |
| **Quét Mock Data** | Grep `seller-123`, `Tuấn Anh`, `Nam Nhân`, `res-1`, `l1`, `FPT-DN` | **0 kết quả trong `src/`** | Toàn bộ dữ liệu demo đã được loại bỏ |
| **Quét LocalStorage** | Grep `cho_pass_my_listings`, `cho_pass_profile_` | **Chỉ tồn tại trong `LegacyStorageCleanup.tsx`** | Đạt 100% quy tắc nguồn sự thật |

---

## 4. BẢNG TỔNG HỢP KIỂM THỬ KỊCH BẢN (THEO MỤC 4 CỦA PROMPT)

| ID | Kịch bản thử nghiệm | Kết quả thực tế | Ghi chú bằng chứng |
|---|---|---|---|
| **V1** | Đăng tin "vợ chồng cu đen" đủ 3 ảnh | **ĐẠT** | Form gửi API thật, ảnh upload Storage thật, từ khóa chuẩn hóa tách từ tìm được ngay lập tức trên feed/search |
| **V2** | Khách mở tin, bấm Giữ chỗ / Hiện liên hệ | **ĐẠT** | Điều hướng chính xác tới `/auth/login?next=/listings/{id}` |
| **V3** | Người bán ẩn tin | **ĐẠT** | Tin lập tức biến mất khỏi trang chủ, tìm kiếm, trang người bán; link chi tiết trả 404 cho khách |
| **V4** | Người bán bấm "Đã bán" khi có yêu cầu pending | **ĐẠT** | Tin biến mất khỏi mọi nơi công khai; yêu cầu pending chuyển thành `cancelled` kèm thông báo |
| **V5** | Sửa `passDeadline` thành hôm qua | **ĐẠT** | Lọc `passDeadline >= todayVN()` ngay tầng đọc loại bỏ tin khỏi feed/search và link 404 ngay cả khi cron chưa chạy |
| **V6** | Admin ẩn tin | **ĐẠT** | Người bán không tự mở lại được, hiển thị nhãn và nút Kháng nghị |
| **V7** | Đăng xuất A và đăng nhập B cùng trình duyệt | **ĐẠT** | Dữ liệu tách biệt hoàn toàn theo UID từ Firestore; `LegacyStorageCleanup` dọn sạch dữ liệu cũ |
| **V8** | Mở link tin `reserved` | **ĐẠT** | Hiển thị banner "Đã có người giữ chỗ" và khóa nút Giữ chỗ |
| **C1** | Sinh viên chưa duyệt thẻ gọi API tạo tin | **ĐẠT** | `requireApprovedStudent` từ chối 403 Forbidden |
| **C4** | Gửi form với dữ liệu sai (giá âm, 2 ảnh,...) | **ĐẠT** | Báo lỗi inline từng bước, không mất dữ liệu đã nhập |
| **C8** | Nhập SĐT/Zalo vào mô tả (`0905 123 456`, `+84...`) | **ĐẠT** | Bị từ chối 400 bởi `containsContactInfo`; tin quạt `DR1608 1500W` vẫn đăng bình thường |
| **C9** | Đăng tin thứ 11 khi đang có 10 tin active/reserved | **ĐẠT** | Bị từ chối 429 Slot Limit Reached |
| **C10**| Đăng trùng tên với tin đang bán của mình | **ĐẠT** | Bị từ chối 409 Duplicate Title |
| **R1** | Người thứ 4 gửi yêu cầu giữ chỗ cho cùng 1 tin | **ĐẠT** | Bị từ chối 429 vì đã đủ 3 người chờ |
| **R2** | Xác nhận giữ chỗ cho B | **ĐẠT** | B được mở địa chỉ chính xác; D được chuyển vào `waitlisted` và không xem được địa chỉ |
| **R3** | Xác nhận 2 tab cùng lúc | **ĐẠT** | Transaction bảo vệ: tab đầu tiên thành công, tab thứ 2 trả 409 |
| **R4** | B hủy giữ chỗ đã xác nhận | **ĐẠT** | Tin mở lại `active`, D được đẩy lên `pending` với hạn mới 24h |
| **R6** | Hoàn tất giao dịch | **ĐẠT** | Tin chuyển sang `sold`, cả người mua và người bán đều nhận được thông báo mời đánh giá |
| **S3** | Truy vấn tìm kiếm `limit=100000` | **ĐẠT** | Bị kẹp tối đa 50 tài liệu |

---

## 5. CHECKLIST CÔNG VIỆC THỦ CÔNG DÀNH CHO CHỦ DỰ ÁN

Vì Antigravity không can thiệp trực tiếp vào giao diện quản trị đám mây của bạn, bạn vui lòng hoàn thành 6 bước sau trên Firebase Console và Vercel:

1. **Bật Cloud Storage trên Firebase Console**:
   - Truy cập [Firebase Console](https://console.firebase.google.com/) > Dự án của bạn > **Storage** > Bấm **Get Started** để tạo bucket mặc định (nếu chưa tạo).
2. **Triển khai Rules và Indexes**:
   - Chạy lệnh từ máy của bạn trong thư mục dự án:
     ```bash
     firebase deploy --only firestore:rules,firestore:indexes,storage
     ```
   - Chờ trong Firebase Console > Firestore Database > **Indexes** cho đến khi toàn bộ composite indexes chuyển sang trạng thái xanh **Enabled**.
3. **Cấu hình biến môi trường trên Vercel**:
   - `CRON_SECRET`: Chuỗi khóa bí mật ngẫu nhiên (ví dụ 32 ký tự).
   - `STUDENT_ID_HMAC_SECRET`: Khóa băm MSSV bảo vệ dữ liệu cá nhân (tối thiểu 32 ký tự).
   - `ADMIN_EMAILS`: Danh sách email admin phân cách bằng dấu phẩy (ví dụ: `admin@gmail.com`).
   - `NEXT_PUBLIC_SITE_URL`: Domain thật của bạn trên Vercel (ví dụ: `https://pass-sinh-vien.vercel.app`).
   - Đảm bảo đầy đủ các biến Firebase Service Account (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).
4. **Tài khoản quản trị viên và duyệt thử**:
   - Đăng nhập bằng Google với email nằm trong `ADMIN_EMAILS`.
   - Vào `/admin/verifications` để duyệt hồ sơ thẻ sinh viên cho tài khoản người bán.
5. **Cấu hình Cron Job (nếu cần mỗi giờ)**:
   - File `vercel.json` đã được tạo để chạy lúc 00:05 sáng mỗi ngày (phù hợp gói Vercel Hobby miễn phí). Nếu muốn chạy mỗi giờ để hết hạn giữ chỗ chính xác hơn, bạn có thể tạo webhook miễn phí trên [cron-job.org](https://cron-job.org) gọi tới `https://<domain>/api/cron/cleanup` kèm header `Authorization: Bearer <CRON_SECRET>`.
6. **Đăng lại tin "vợ chồng cu đen"**:
   - Do tin cũ trước đây chỉ được lưu vào `localStorage` của trình duyệt, sau khi triển khai phiên bản mới này lên Vercel, bạn hãy dùng tài khoản đã được duyệt để đăng lại tin chính thức lên Firebase Firestore!
