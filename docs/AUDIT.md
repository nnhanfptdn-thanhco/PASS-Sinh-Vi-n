# BÁO CÁO AUDIT & XÁC MINH GIẢ THUYẾT (PROMPT 0)
*Dự án: Chợ Pass Sinh Viên*  
*Thời gian thực hiện: 18/11/2026*  
*Nhánh kiểm toán: `hardening/all`*  
*Phương pháp: Kiểm tra mã nguồn thực tế (Code Review & Static Analysis)*

---

## 1. Kết Quả Baseline Kiểm Tra Hệ Thống

| Công cụ kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| **TypeScript Compiler** | `npx tsc --noEmit` | **PASS (0 lỗi)** | Type checking hoàn toàn hợp lệ |
| **ESLint** | `npm run lint` | **PASS (0 warning, 0 error)** | Next.js lint quy chuẩn sạch |
| **Vitest Test Suite** | `npm test` | **PASS (5/5 files, 36/36 tests)** | 36 unit/integration tests xanh |
| **Next.js Production Build** | `npm run build` | **PASS (34/34 routes)** | Build thành công toàn bộ static & SSR routes |
| **NPM Audit (Production)** | `npm audit --omit=dev` | **8 lỗ hổng (7 High, 1 Critical)** | Lỗ hổng upstream từ `@grpc/grpc-js` và `next` (yêu cầu nâng Next 16) |

---

## 2. Ma Trận API Routes (`src/app/api/**/route.ts`)

| Đường dẫn API | HTTP Method | Xác thực | Yêu cầu Verified | Validate Input | Rate Limit | Collections đọc/ghi | Dùng Transaction | Header Cache | Dynamic / Runtime |
|---|---|---|---|---|---|---|---|---|---|
| `/api/account/delete` | `POST` | Bearer (`requireUser`) | Không | Thủ công | Không | `listings`, `listingsPrivate`, `notifications`, `reservations`, `reviews`, `users`, `usersPrivate`, `verifications` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` (mặc định) |
| `/api/account/export` | `GET` | Bearer (`requireUser`) | Không | Không body | Không | `listings`, `reservations`, `users`, `usersPrivate`, `verifications` | Không | Mặc định | Dynamic: `force-dynamic`, Runtime: `nodejs` |
| `/api/admin/verifications` | `GET`, `POST` | Bearer (`requireAdmin`) | Yêu cầu Admin claim | Zod | Không | `adminLogs`, `notifications`, `users`, `verifications` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/appeals` | `POST` | Bearer (`requireUser`) | Không | Zod | Không | `appeals` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/auth/bootstrap` | `POST` | Bearer (`requireUser`) | Không (User mới) | Thủ công | Có (In-memory `Map`) | `adminLogs`, `users`, `usersPrivate` | Có | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/cron/cleanup` | `GET` | Bearer (`CRON_SECRET`) | Không (Service role) | Không body | Không | `verifications`, `listings`, `reservations` | Có (Batch) | Mặc định | Dynamic: `force-dynamic`, Runtime: `nodejs` |
| `/api/listings/contact` | `POST` | Bearer (`requireVerified`) | Có (Claim + Firestore doc) | Zod | Có (Query `contactViewLogs`) | `contactViewLogs`, `listings`, `usersPrivate`, `verifications` | Không | Mặc định (Thiếu `no-store`) | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/listings/create` | `POST` | Bearer (`requireVerified`) | Có (Claim `token.verified`) | Zod | Không | `listings`, `listingsPrivate`, `users` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/listings/manage` | `POST` | Bearer (`requireVerified`) | Có (Claim `token.verified`) | Zod | Không | `listings` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/listings/search` | `GET` | Không (Công khai) | Không | Query Params | Không | `listings` | Không | Mặc định | Dynamic: `force-dynamic`, Runtime: `nodejs` |
| `/api/reports` | `POST` | Bearer (`requireUser`) | Không | Zod | Không | `reports` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/reservations/action` | `POST` | Bearer (`requireUser`) | Không | Zod | Không | `listings`, `listingsPrivate`, `notifications`, `reservations`, `users` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/reservations/create` | `POST` | Bearer (`requireVerified`) | Có (Claim `token.verified`) | Zod | Không | `listings`, `notifications`, `reservations` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/reviews` | `POST` | Bearer (`requireUser`) | Không | Zod | Không | `reservations`, `reviews`, `users` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |
| `/api/verifications/submit` | `POST` | Bearer (`requireUser`) | Không (Nộp hồ sơ) | Zod | Không | `users`, `usersPrivate`, `verifications` | Không | Mặc định | Dynamic: `auto`, Runtime: `nodejs` |

---

## 3. Danh Sách Ghi Trực Tiếp Từ Client (Ngoài Thư Mục `api/`)

Grep toàn bộ các thao tác `addDoc|setDoc|updateDoc|deleteDoc|writeBatch|uploadBytes|uploadBytesResumable|deleteObject` trong `src/`:

1. **`src/app/auth/onboarding/page.tsx:136`** (`uploadBytes`):
   - Đường dẫn đích: `private/cards/${user.uid}/front.webp`
   - Mục đích: Tải ảnh thẻ sinh viên lên Firebase Storage trước khi gửi API `/api/verifications/submit`.
2. **`src/app/listings/new/page.tsx:160`** (`uploadBytes`):
   - Đường dẫn đích: `public/listings/${tempId}/${i}.webp`
   - Mục đích: Tải các ảnh món đồ pass lên Firebase Storage trước khi gửi API `/api/listings/create`.

*Nhận xét:* Client **hoàn toàn không** ghi trực tiếp vào Firestore (`addDoc`, `setDoc`, `updateDoc`). Toàn bộ việc ghi dữ liệu nghiệp vụ đều đi qua Next.js Route Handlers (Admin SDK).

---

## 4. Xác Minh Chi Tiết 17 Câu Hỏi (Kèm Bằng Chứng File:Dòng)

### Q1. Trạng thái "verified" được quyết định ở đâu? Ai set claim? AuthContext đọc nguồn nào? localStorage được dùng làm gì?
- **Server:** Được quyết định dựa trên **Firebase Custom Claims** (`token.verified === true`) tại `src/lib/auth/server.ts:37` trong hàm `requireVerified`.
- **Ai set claim:**
  - `src/app/api/admin/verifications/route.ts:115`: Admin duyệt hồ sơ gọi `adminAuth.setCustomUserClaims(userId, { verified: true })`.
  - `src/app/api/auth/bootstrap/route.ts:122`: Bootstrap tự động set claim nếu là email admin.
- **`AuthContext` đọc nguồn nào:**
  - Đọc từ Custom Claims qua `currentUser.getIdTokenResult()` (`src/lib/auth/AuthContext.tsx:121`).
  - Đồng thời đọc cache từ `localStorage.getItem('cho_pass_profile_' + uid)` (`src/lib/auth/AuthContext.tsx:128`).
  - Tính toán `effectiveVerified = Boolean(isVerified || cachedProfile?.verified)` (`src/lib/auth/AuthContext.tsx:136`).
- **`localStorage` dùng để làm gì:** Lưu cache thông tin sinh viên (`cho_pass_profile_${uid}`) để hiển thị tức thì trên giao diện mà không phải đợi network call.

### Q2. Cơ chế "fallback ảnh WebP nén trực tiếp" đưa ảnh đi đâu? Timeout 1.2s cài đặt thế nào?
- **Timeout 1.2s:** Cài đặt tại `src/app/listings/new/page.tsx:170-174` bằng `Promise.race([Promise.all(uploadPromises), timeoutP])` với `timeoutP = new Promise((_, reject) => setTimeout(..., 1200))`.
- **Dữ liệu fallback đi đâu:**
  - Khi timeout, mảng ảnh `images` (chuỗi base64 data URLs tạo từ canvas) được gán vào `uploadedUrls` (`src/app/listings/new/page.tsx:177, 182`).
  - Gửi thẳng trong body JSON lên `/api/listings/create` (`src/app/listings/new/page.tsx:223, 231`).
  - Lưu vào `localStorage` key `cho_pass_my_listings` (`src/app/listings/new/page.tsx:273-280`).
  - Nếu API lưu thành công, ảnh base64 sẽ bị ghi thẳng vào document Firestore `listings/{listingId}`.

### Q3. Các đường dẫn Storage trong code so với `storage.rules`? Có chỗ nào lệch không?
- `storage.rules:38`: Định nghĩa `match /public/listings/{listingId}/{fileName}`.
- `src/app/listings/new/page.tsx:159`: Upload vào `public/listings/${tempId}/${i}.webp`.
- **Độ lệch & rủi ro:** Khớp về mặt cú pháp đường dẫn (`public/listings/{id}/{file}`), nhưng **lệch về bảo mật**: Đường dẫn không có `{userId}`, và `storage.rules` cho phép bất kỳ user nào có `isVerified()` được `write` vào toàn bộ `public/listings/**`, dẫn tới việc có thể ghi đè ảnh của tin đăng khác (H1).

### Q4. Logic nhận diện email `.edu.vn`: Chép nguyên đoạn code. Gợi ý trường hay cấp `verified`? Có kiểm tra `email_verified`? Dùng `endsWith` hay `includes`?
- **Đoạn code trong API:** `src/app/api/verifications/submit/route.ts:83-87`:
  ```typescript
  // 4. Kiểm tra email trường (.edu.vn) VÀ email đã được verify bởi Google
  const isEduEmail = Boolean(
    token.email_verified &&
    userEmail.toLowerCase().endsWith(".edu.vn")
  );
  ```
- **Hành vi:**
  - **Không cấp `verified` trực tiếp:** Chỉ đánh dấu `isEduEmail: true` vào hồ sơ và đặt `status: "pending"` để admin ưu tiên duyệt (`src/app/api/verifications/submit/route.ts:100-101`).
  - Có kiểm tra `token.email_verified`.
  - Dùng `.endsWith(".edu.vn")`. (Lưu ý: Không kiểm tra ký tự trước `.edu.vn`, ví dụ `fake-edu.vn` vẫn thỏa mãn).
- **Đoạn code trên Client:** `src/app/auth/onboarding/page.tsx:84-102`:
  Chỉ dùng để gợi ý trường và tự động điền form (`setFormData({ schoolCode, campusId, ... })`), không cấp quyền.

### Q5. Cơ chế tự xóa ảnh thẻ SV sau 30 ngày thực tế là gì?
- **Thực tế:** Logic xóa đã được code tại `src/lib/services/cleanup.ts:24-51` (`runScheduledCleanup`), tìm hồ sơ có `updatedAt <= thirtyDaysAgo` và gọi `adminStorage.bucket().file(storagePath).delete({ ignoreNotFound: true })`.
- Tuy nhiên: **Không có Cloud Functions** (repo không có thư mục `functions/`) và **chưa có file `vercel.json`** để cấu hình cron tự động gọi endpoint `/api/cron/cleanup`. Do đó tính năng này hiện tại chỉ chạy khi có ai đó gọi API bằng tay.

### Q6. Doc `users/{uid}` chứa những field nào? Có PII không?
- Khởi tạo tại `src/app/api/auth/bootstrap/route.ts:47-58`:
  Gồm: `uid`, `displayName`, `photoURL`, `verified`, `rating`, `activeListingsCount`, `completedDealsCount`, `createdAt`, `updatedAt`, `lastLoginAt`.
- **Có PII không:** **KHÔNG**. Toàn bộ PII nhạy cảm (`email`, `emailVerified`, `zaloPhone`, `altPhone`, `realName`, `studentIdHash`) đều được tách lưu riêng vào collection `usersPrivate/{uid}`.

### Q7. Rate limit cài đặt ra sao; có chạy đúng trên serverless không?
- Cài đặt tại `src/app/api/auth/bootstrap/route.ts:6-21`:
  Sử dụng `const rateLimitMap = new Map<string, { count: number; resetAt: number }>()`.
- **Đánh giá:** **KHÔNG chạy đúng trên serverless (Vercel)** vì instances serverless bị hủy/tạo mới liên tục (cold start) và không chia sẻ bộ nhớ chung giữa các invocation.

### Q8. Chat: Ai tạo conversation và message? Các field của doc là gì?
- **Hiện trạng:**
  - `firestore.rules:70-98`: Cho phép client trực tiếp `create` conversation nếu `auth.uid in participantIds` và `participantIds.size() == 2`. Không giới hạn whitelist field.
  - Client `src/app/messages/page.tsx:40-59`: Hiện chỉ là giao diện mẫu dùng React local state (`useState`), chưa kết nối Firestore.

### Q9. Giữ chỗ: Có transaction không? Có hạn giữ chỗ không? Có giới hạn lượt giữ chỗ mở không?
- `src/app/api/reservations/create/route.ts:31-95`:
  - **Không dùng transaction:** Sử dụng các truy vấn tuần tự `get()` -> kiểm tra -> `set()`, dễ bị race condition khi 2 người cùng giữ chỗ 1 món đồ.
  - **Hạn giữ chỗ:** Có, gán `expiresAt = now + 24 * 60 * 60 * 1000` (24 giờ) tại dòng 91.
  - **Giới hạn:** Giới hạn tối đa 3 pending trên một tin đăng (`MAX_PENDING_RESERVATIONS_PER_LISTING = 3`), nhưng **không giới hạn** số lượng giữ chỗ mở tối đa của một người mua.

### Q10. `/api/listings/contact`: Method, kiểm tra điều kiện, header cache, có log `contactViewLogs` không?
- **Method:** Chỉ có `POST` (dòng 12).
- **Kiểm tra điều kiện:**
  - `requireVerified(req)` (dòng 14).
  - Đọc Firestore `verifications/{buyerId}` kiểm tra `status === 'approved'` (dòng 29-30).
  - Kiểm tra tin đăng tồn tại, `status === 'active'`, và `sellerId !== buyerId` (dòng 41-64).
  - Giới hạn 10 lượt/giờ bằng cách đếm bản ghi trong `contactViewLogs` (dòng 68-74).
- **Header cache:** Không có header `Cache-Control: no-store`.
- **Log:** Có, ghi vào `contactViewLogs` tại dòng 96-101. Nhược điểm: Mỗi lần bấm xem lại số cũ vẫn bị tính vào quota 10 lượt/giờ.

### Q11. `/api/verifications/submit`: Validate gì? Dedupe HMAC thế nào? Thông báo lỗi trùng có lộ thông tin không?
- **Validate:** Zod schema `submitVerificationSchema` tại `src/app/api/verifications/submit/route.ts:6-21` (không `.strict()`). Chưa kiểm tra xem `cardStoragePath` có đúng định dạng `private/cards/${userId}/...` hay không.
- **Dedupe HMAC:** Tính qua `computeStudentIdHash(data.schoolCode, data.studentId)` dùng `STUDENT_ID_HMAC_SECRET`, sau đó truy vấn Firestore `verifications.where('studentIdHash', '==', hash)`. Không dùng Firestore transaction hay khóa duy nhất dạng document ID.
- **Lộ thông tin:** Trả về thông báo: *"Mã thẻ sinh viên này đã được đăng ký trên hệ thống..."* (409). Cho phép kẻ tấn công kiểm tra xem một MSSV nào đó đã có tài khoản trên sàn hay chưa (user enumeration).

### Q12. Tìm kiếm `/search` chạy ở đâu, có chuẩn hóa không dấu không, dùng index gì?
- Chạy qua API `/api/listings/search/route.ts`.
- Firestore query chỉ lọc theo `status == 'active'` và `limit(20)`.
- **Chuẩn hóa không dấu:** Có, dùng `removeVietnameseTones(q)` tại dòng 69, nhưng lại **lọc in-memory** trên tập 20 tài liệu đã tải về. Các tin đăng từ vị trí 21 trở đi sẽ bị bỏ sót.
- **Index:** `firestore.indexes.json` có composite index cho category/school/province + createdAt, nhưng không có index cho token tìm kiếm text (`searchTokens`).

### Q13. Vị trí mặc định ở header và danh sách TP.HCM/Hà Nội/Đà Nẵng đến từ đâu?
- **Header:** Đã chuyển sang động tại `src/components/navigation/Header.tsx:126`: `{profile?.schoolName || "Sinh viên Toàn quốc"}`.
- **Trang chủ:** Danh sách nhanh 3 thành phố là thẻ HTML tĩnh tại `src/app/page.tsx:93-101`, chưa kết nối logic chuyển vùng.

### Q14. Biến môi trường: Dùng `NEXT_PUBLIC_*` nào? Có fallback project id không? `.env.example` có khớp không?
- `NEXT_PUBLIC_*`: 12 biến Firebase Client và Emulator (khớp hoàn toàn giữa code và `.env.example`).
- **Fallback Project ID:** Có, trong `next.config.mjs:5` có fallback `"cho-pass-sv-dev"`.
- Chưa có biến `NEXT_PUBLIC_SITE_URL` phục vụ SEO/OG.

### Q15. Test `security-rules` thực chất là gì?
- File `tests/security-rules.test.ts` chỉ là **unit test chạy hàm tiện ích thuần** (`computeStudentIdHash`, `removeVietnameseTones`, `formatCurrencyVND`) và kiểm tra object mock `roles`.
- Hoàn toàn **không dùng Firebase Emulator** hay `@firebase/rules-unit-testing` để test rules thật.

### Q16. API xác thực bằng header Bearer hay cookie session?
- Xác thực bằng **Header `Authorization: Bearer <token>`** qua hàm `requireUser` tại `src/lib/auth/server.ts:18-20`. Không dùng session cookie nên không có rủi ro CSRF truyền thống.

### Q17. Quét bí mật & `.gitignore`
- Git chỉ theo dõi `.env.example`. Không có file `.env.local` hay file Service Account JSON nào bị commit.
- `.gitignore` có `.env*.local`, nhưng chưa có dòng chặn tổng quát `.env` hay `serviceAccount*.json`.

---

## 5. Bảng Đánh Giá 16 Giả Thuyết (H1 – H16)

| ID | Mô tả giả thuyết | Đánh giá | Bằng chứng mã nguồn | Mức độ |
|---|---|---|---|---|
| **H1** | Ghi đè ảnh tin đăng người khác (Storage rule thiếu kiểm tra chủ tin) | **ĐÚNG** | `storage.rules:38-42`: `allow write: if isVerified() && isValidImage();` không kiểm tra `userId` trong path hoặc metadata. | **Nghiêm trọng (High)** |
| **H2** | Upload không giới hạn số file / quota | **ĐÚNG** | `storage.rules` chỉ check `size <= 10MB`, không kiểm tra số file per draft; `/api/listings/create` không dọn file thừa. | **Trung bình (Medium)** |
| **H3** | Chat mở cho mọi user đăng nhập, không whitelist field | **ĐÚNG** | `firestore.rules:70-98`: Cho phép client tự tạo conversation và message khi chỉ cần đăng nhập, không yêu cầu `isVerified()`, không whitelist field. | **Cao (High)** |
| **H4** | Favorites / Follows đổi được `userId` khi update | **ĐÚNG** | `firestore.rules:100-108`: `allow write` cho phép update mà không ràng buộc `userId` bất biến. | **Trung bình (Medium)** |
| **H5** | Doc `users` public chứa PII | **KHÔNG ÁP DỤNG** | `src/app/api/auth/bootstrap/route.ts:47-71`: Đã tách riêng `users` (public) và `usersPrivate` (private PII). | **Thấp (None)** |
| **H6** | Claim `verified` cũ + localStorage bị tin ở server | **MỘT PHẦN** | Server check token claim (`requireVerified`), không tin localStorage. Nhưng client `AuthContext:136` tin localStorage, và server chưa check trực tiếp doc Firestore khi claim chưa kịp sync. | **Trung bình (Medium)** |
| **H7** | Email `.edu.vn` cấp verified yếu | **KHÔNG ÁP DỤNG / MỘT PHẦN** | Code **không** tự cấp `verified` cho email `.edu.vn` (chỉ gắn cờ priority). Tuy nhiên regex kiểm tra domain chỉ dùng `.endsWith(".edu.vn")`. | **Thấp (Low)** |
| **H8** | Fallback lưu base64 vào Firestore | **ĐÚNG** | `src/app/listings/new/page.tsx:177, 223`: Timeout upload Storage đẩy ảnh data URL base64 vào API payload. | **Cao (High)** |
| **H9** | Timeout 1.2s quá ngắn cho upload ảnh | **ĐÚNG** | `src/app/listings/new/page.tsx:171`: Race timeout 1200ms khiến mạng 4G/3G luôn rơi vào lỗi timeout. | **Cao (High)** |
| **H10** | Xóa ảnh thẻ 30 ngày chưa thực hiện trên production | **MỘT PHẦN** | Code dọn dẹp đã viết (`cleanup.ts`), nhưng thiếu `vercel.json` cron config và không có Cloud Functions. | **Trung bình (Medium)** |
| **H11** | Thiếu CSP/Permissions-Policy và có fallback project id | **ĐÚNG** | `next.config.mjs:5` có fallback `"cho-pass-sv-dev"`; thiếu CSP, Permissions-Policy, HSTS. | **Trung bình (Medium)** |
| **H12** | `/listings/new` không được gate | **KHÔNG ÁP DỤNG** | `src/app/listings/new/page.tsx:273`: Form đã được bọc bởi `<RequireVerified>`. | **Thấp (None)** |
| **H13** | Vị trí mặc định hardcode | **MỘT PHẦN** | Header đã đổi động theo user profile, nhưng quick filter tại `page.tsx` và mock sample data vẫn hardcode TP.HCM/Bách Khoa. | **Thấp (Low)** |
| **H14** | Empty state nhấp nháy khi chưa tải xong | **ĐÚNG** | Chưa có skeleton chuẩn cho trạng thái initial loading ở một số view client. | **Thấp (UX)** |
| **H15** | Thiếu thẻ Open Graph | **MỘT PHẦN** | Listing detail có OG cơ bản, nhưng `layout.tsx` thiếu `metadataBase`, Twitter cards, và ảnh preview mặc định khi share Zalo/Facebook. | **Thấp (SEO)** |
| **H16** | Safari/iOS trả PNG khi encode WebP từ canvas | **ĐÚNG** | Hàm nén ảnh không kiểm tra lại `blob.type` trả về từ canvas, có thể gây đội dung lượng file trên iOS Safari. | **Trung bình (Medium)** |

---

## 6. Tổng Kết: 5 Vấn Đề Nghiêm Trọng Nhất & Các Giả Thuyết Sai

### 5 Vấn Đề Nghiêm Trọng Nhất Xác Nhận Qua Code:
1. **Lỗ hổng Storage Rule Ghi Đè Ảnh (H1):** Rule `public/listings/{listingId}/{fileName}` cho phép bất kỳ user nào đã verified cũng có thể ghi đè ảnh của tin đăng khác do thiếu `userId` trong path và thiếu rule ownership.
2. **Fallback Base64 & Timeout 1.2s Ngắn (H8, H9):** Timeout 1.2s quá ngắn trên mạng di động khiến hệ thống fallback nhồi ảnh base64 vào payload API và Firestore document, vi phạm giới hạn 1MB của Firestore.
3. **Chat Rules Mở Rộng Không Kiểm Soát (H3):** Firestore rules cho phép mọi user đăng nhập tạo conversation/message mà không cần verified, không whitelist field, không bắt buộc `serverTimestamp()`.
4. **Giữ Chỗ Thiếu Transaction & Thiếu Quota (Q9):** Luồng `/api/reservations/create` không dùng Firestore transaction, dễ bị race condition khi nhiều người cùng giữ chỗ; không giới hạn số lượng giữ chỗ mở của một người mua.
5. **Rate Limit In-Memory Vô Tác Dụng Trên Serverless (Q7):** Sử dụng `new Map()` trong Route Handler Next.js sẽ bị reset sau mỗi cold start trên Vercel.

### Các Giả Thuyết Hóa Ra Sai / Đã Được Xử Lý Sẵn:
- **H5 (`users` public chứa PII) - SAI:** Code thực tế đã phân tách sạch sẽ giữa `users` (công khai) và `usersPrivate` (chỉ chủ sở hữu/admin).
- **H12 (`/listings/new` không gate) - SAI:** Trang đăng tin đã được bọc bằng component `<RequireVerified>` chặn người dùng chưa duyệt thẻ.
- **H7 (Email `.edu.vn` tự cấp verified) - SAI:** Email `.edu.vn` không tự động được cấp quyền đăng tin hay xem số điện thoại mà vẫn phải qua hàng đợi duyệt hồ sơ của Admin.
