# Prompt xây dựng Chợ Pass Sinh Viên (cho Antigravity)
Nov 17, 2026 · @Nhân · v4

## Bối cảnh, mục tiêu và công nghệ
Bạn là lập trình viên full-stack kiêm thiết kế sản phẩm. Hãy xây dựng website Chợ Pass Sinh Viên: chợ trực tuyến để sinh viên trên toàn Việt Nam đăng bán và tìm mua đồ cũ của nhau, nhất là đồ của sinh viên năm cuối ra trường (quạt, nồi cơm, bàn học, giáo trình, xe đạp, xe máy). Sau khi đăng nhập, mỗi người chọn tỉnh hoặc thành phố và phường hoặc xã nơi mình ở, rồi chủ yếu thấy tin quanh khu vực đó. Không gắn cứng bất kỳ thành phố, trường hay khu vực nào vào mã nguồn. Làm việc theo kế hoạch, chia nhỏ thành các task, tự kiểm tra từng bước. Không dừng ở bản demo giao diện: mọi tính năng dưới đây phải chạy thật với dữ liệu thật. Tuyệt đối không tạo tin đăng giả hay tài khoản người dùng giả trong cơ sở dữ liệu thật (production). Dữ liệu mẫu chỉ được tồn tại trong Firebase Emulator và trong dữ liệu của test tự động, không bao giờ nạp vào project thật. Khi mới triển khai chưa có ai đăng tin thì giao diện hiển thị trạng thái trống (Empty State) chuẩn chỉnh để người dùng thật tự vào đăng bài.

Người dùng chính: sinh viên các trường đại học, cao đẳng và học viện trên cả nước, ở mọi thành phố có sinh viên. Phần lớn truy cập bằng điện thoại, nên thiết kế mobile-first.

### Ba điểm khác biệt, giữ xuyên suốt:
1. Chỉ sinh viên đã xác minh thẻ mới đăng tin và xem được thông tin liên hệ, nên tin đáng tin hơn các chợ mở.
2. Mỗi tin có hạn cần pass và nhãn “Pass trong ngày”, vì mùa ra trường là mùa gấp.
3. Cách giao nhận hiện rõ ngay trên tin: tự đến lấy hay người bán ship.

### Công nghệ (đã chọn sẵn, chỉ đổi khi có lý do nêu rõ):
- Frontend: Next.js (App Router), TypeScript, Tailwind CSS, icon Lucide, form dùng React Hook Form và Zod.
- Backend: Firebase gồm Authentication (Google), Firestore, Cloud Storage, Cloud Functions, App Check, kèm Firebase Admin SDK cho các tác vụ phía Server (SSR metadata / kiểm tra quyền) và Secret Manager cho các khóa bí mật.
- Dịch vụ gửi Email: Tách lớp EmailService riêng, chạy phía server (Cloud Functions), dùng Resend hoặc Nodemailer qua SMTP khi cấu hình biến môi trường; nếu chưa cấu hình khóa email thì ghi log ra console (không ghi nội dung chứa dữ liệu cá nhân) để không làm lỗi luồng chạy. Gửi email cho người dùng thật cần tên miền đã xác thực SPF/DKIM, xem mục “Chủ dự án chuẩn bị trước”.
- Triển khai: Vercel hoặc Firebase App Hosting, vì dự án cần chạy SSR (generateMetadata, Admin SDK); Firebase Hosting tĩnh thuần không đủ. Kèm hướng dẫn từng bước trong README.
- Môi trường dev: Dùng Firebase Emulator Suite để chạy và kiểm thử cục bộ trước khi nối project thật. Dữ liệu mẫu cho test chỉ nằm ở Emulator.
- Chi phí: Cloud Functions và Cloud Storage for Firebase đều yêu cầu gói Blaze (trả theo mức dùng), nên project thật phải bật Blaze. Hãy kiểm tra trang giá hiện tại, thiết kế để dùng ít tài nguyên nhất, và ghi trong README cách đặt cảnh báo ngân sách (Cloud Billing budget). Lưu ý cảnh báo ngân sách chỉ gửi thông báo, không tự chặn chi tiêu, nên phải dựa vào App Check, giới hạn tần suất và giới hạn dung lượng để chống lạm dụng.
- Ngôn ngữ giao diện: Tiếng Việt. Đặt toàn bộ chữ vào file i18n (dùng next-intl hoặc thư viện tương đương) để thêm tiếng Anh sau.
- Kiểm thử: Vitest hoặc Jest cho logic, @firebase/rules-unit-testing cho Security Rules, Playwright chạy luồng đầu-cuối trên Emulator. Dữ liệu mẫu chỉ tạo trong test.
- Sao lưu và theo dõi lỗi: Bật point-in-time recovery hoặc đặt lịch export Firestore ra bucket riêng tư, ghi trong README cách khôi phục. Theo dõi lỗi bằng Sentry hoặc Cloud Logging, không ghi dữ liệu cá nhân.

## Vai trò người dùng và xác minh thẻ sinh viên
Mọi tài khoản phải được xác minh bằng thẻ sinh viên trước khi dùng các chức năng chính. Triển khai bốn vai trò và quy trình sau.

| Vai trò | Được làm | Không được làm |
| :--- | :--- | :--- |
| Khách (chưa đăng nhập) | Xem danh sách tin, xem chi tiết tin, tìm kiếm, lọc | Xem liên hệ, nhắn tin, đăng tin, giữ chỗ |
| Thành viên chờ xác minh | Như khách, cộng thêm sửa hồ sơ và nộp lại thẻ | Đăng tin, nhắn tin, xem liên hệ, giữ chỗ |
| Sinh viên đã xác minh | Toàn bộ chức năng mua và bán | Duyệt thẻ, ẩn tin của người khác |
| Quản trị viên | Duyệt thẻ, xử lý báo cáo, ẩn hoặc xóa tin, khóa tài khoản | Xem lại ảnh thẻ đã bị xóa |

### Quy trình xác minh:
1. Người dùng đăng nhập Google, tài khoản được tạo với trạng thái chờ xác minh.
2. Hệ thống bắt buộc hoàn tất bước xác minh trước khi dùng tiếp: nhập họ tên thật, trường, khoa, khóa, mã số sinh viên, rồi tải ảnh mặt trước thẻ sinh viên. Ảnh cầm thẻ tự chụp là tùy chọn, nhưng giúp duyệt nhanh hơn.
3. Hệ thống gửi hồ sơ vào hàng đợi duyệt. Người dùng thấy trạng thái đang chờ duyệt và thời gian dự kiến.
4. Quản trị viên mở trang duyệt, đối chiếu ảnh thẻ với thông tin đã nhập, rồi bấm Duyệt hoặc Từ chối. Từ chối bắt buộc chọn lý do (ảnh mờ, thẻ hết hạn, tên không khớp, thẻ không hợp lệ) và có ô ghi chú.
5. Khi được duyệt, tài khoản có nhãn “Đã xác minh sinh viên”. Khi bị từ chối, người dùng được nộp lại, tối đa 3 lần mỗi ngày.
6. Gửi thông báo trong app và email cho mỗi kết quả.

### Quy tắc xác minh:
- Một thẻ sinh viên chỉ gắn với một tài khoản. Mã số sinh viên (kết hợp mã trường) được kiểm tra trùng qua mã băm studentIdHash, tính bằng HMAC-SHA256 với khóa bí mật lưu ở Secret Manager và chỉ tính trong Cloud Function (không tính hay gửi mã gốc từ client). Không dùng SHA-256 thuần vì mã số sinh viên ngắn nên rất dễ dò ngược.
- Cho cấu hình một danh sách tên miền email trường (ví dụ đuôi .edu.vn) trong trang quản trị. Email thuộc danh sách này chỉ giúp xếp hồ sơ lên đầu hàng đợi, vẫn phải nộp thẻ.
- Sinh viên năm cuối đã ra trường vẫn bán được đồ: cho phép trạng thái “sắp tốt nghiệp” và gia hạn xác minh theo từng năm học.
- Trạng thái xác minh gồm pending, approved, rejected và expired (quá hạn năm học, cần gia hạn). “Sắp tốt nghiệp” là cờ riêng trên hồ sơ, không phải trạng thái xác minh. Khi expired, người dùng vẫn đăng nhập và quản lý tin hiện có nhưng không đăng tin mới và không xem được liên hệ cho tới khi gia hạn.
- Thẻ sinh viên là dữ liệu cá nhân (ảnh thẻ và ảnh cầm thẻ có cả khuôn mặt). Hiển thị hộp đồng ý rõ ràng trước khi tải ảnh, nêu rõ mục đích và thời hạn lưu, cho phép người dùng che các thông tin không cần thiết, và tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 (có hiệu lực từ 01/01/2026) cùng Nghị định 356/2025/NĐ-CP hoặc văn bản thay thế hiện hành. Ghi trong README rằng chủ dự án cần tự rà soát pháp lý, kể cả cách phân loại dữ liệu nhạy cảm đối với ảnh có khuôn mặt.
- Ảnh thẻ lưu ở thư mục riêng tư, chỉ quản trị viên đọc được, và tự xóa trong vòng 30 ngày sau khi hồ sơ được duyệt hoặc bị từ chối. Sau đó chỉ giữ trạng thái xác minh, tên trường, 4 số cuối mã sinh viên và mã băm (studentIdHash) để chống đăng ký trùng. Khi người dùng xóa tài khoản, studentIdHash cũng bị xóa (đổi lại, cùng một thẻ có thể đăng ký lại). Nếu chủ dự án muốn giữ hash để chống đăng ký lại sau khi xóa, phải ghi rõ mục đích và thời hạn lưu trong Chính sách dữ liệu cá nhân và nhờ luật sư rà soát.

## Khu vực và danh mục trường (Toàn quốc 100%)
Hệ thống chạy toàn quốc. Mọi dữ liệu về nơi chốn và trường học đến từ danh mục có thể cập nhật, không gắn cứng trong mã. Mỗi người dùng và mỗi tin được gắn với đủ các cấp sau, chọn từ trên xuống, và hai chiều với nhau (chọn trường thì tự gợi ý tỉnh, phường của cơ sở đó).

| Cấp chọn | Dùng để | Quy tắc |
| :--- | :--- | :--- |
| Tỉnh hoặc thành phố | Khu vực lớn nhất, lọc và xếp tin | Bắt buộc (đầy đủ các tỉnh, thành phố theo danh mục hành chính hiện hành; hiện cả nước có 34 tỉnh, thành phố) |
| Quận, huyện hoặc thị xã (đã bỏ từ 01/07/2025) | Không còn là cấp chọn. Chỉ giữ tên quận, huyện cũ làm từ khóa tìm kiếm phụ cho xã, phường (người dùng vẫn quen gọi tên cũ) | Không tạo cấp này trong dữ liệu. Chỉ lưu tên cũ làm từ khóa phụ nếu nguồn dữ liệu có; nếu danh mục hành chính hiện hành thay đổi thì cập nhật qua danh mục, không sửa mã |
| Phường, xã hoặc đặc khu | Mức gần nhất để ưu tiên tin | Bắt buộc với người bán (đầy đủ toàn bộ đơn vị cấp xã theo danh mục hiện hành, hiện là 3.321 đơn vị; phải đối chiếu số lượng với danh mục chính thức khi nạp) |
| Trường đại học, cao đẳng, học viện | Gắn người dùng vào cộng đồng trường, lọc “cùng trường” | Bắt buộc, chọn từ danh mục đầy đủ các trường ĐH, CĐ, Học viện trên toàn quốc theo danh sách của Bộ Giáo dục và Đào tạo |
| Cơ sở của trường | Trường có nhiều cơ sở ở các khu khác nhau | Bắt buộc nếu trường có nhiều cơ sở. Dữ liệu nạp ban đầu chỉ có trụ sở chính; các cơ sở và phân hiệu khác do quản trị viên hoặc người dùng đề xuất rồi quản trị viên duyệt |
| Ký túc xá hoặc khu trọ gần trường | Nơi ở cụ thể, điểm hẹn quen thuộc | Tùy chọn, người dùng và quản trị viên cùng bổ sung được |

### Danh mục dữ liệu (Nạp đầy đủ toàn quốc, không làm thiếu hay chỉ làm mẫu vài tỉnh):
- Địa giới (collection `regions`): Nạp đầy đủ toàn bộ Tỉnh/Thành phố và Phường/Xã/Đặc khu trên toàn lãnh thổ Việt Nam theo cấu trúc hành chính hai cấp hiện hành: từ 01/07/2025 không còn cấp quận/huyện, cả nước có 34 tỉnh, thành phố và 3.321 đơn vị cấp xã (theo Quyết định 19/2025/QĐ-TTg về Bảng danh mục và mã số các đơn vị hành chính, hoặc văn bản thay thế còn hiệu lực). Tuyệt đối không dùng bộ dữ liệu 63 tỉnh cũ. Dùng mã hành chính chính thức làm ID, kèm ngày hiệu lực (effectiveDate) và trường thay thế (replacedBy) để những lần sáp nhập sau không làm hỏng dữ liệu của người dùng cũ. Quản trị viên cập nhật qua giao diện hoặc chạy lại script nhập có ghi phiên bản, không phải sửa mã.
- Trường (collection `schools`): Nạp đầy đủ 100% danh sách các trường Đại học, Cao đẳng, Học viện trên toàn quốc (Bắc - Trung - Nam) từ danh sách chính thức của Bộ Giáo dục và Đào tạo, kể cả đại học vùng, đại học quốc gia và trường thành viên. Dữ liệu ban đầu mỗi trường chỉ có trụ sở chính, gắn với Tỉnh/Thành, Phường/Xã tương ứng; các cơ sở và phân hiệu khác thêm sau qua trang quản trị hoặc người dùng đề xuất rồi quản trị viên duyệt. Người dùng không thấy trường hoặc cơ sở của mình thì chọn “Trường khác” và nhập tên, hồ sơ chờ quản trị viên xác nhận rồi thêm vào danh mục.
- Ký túc xá và khu trọ (collection `dorms`): Gắn với cơ sở của trường, thêm được qua trang quản trị hoặc người dùng đề xuất rồi quản trị viên duyệt.
- Script khởi tạo danh mục (`scripts/init-catalogs.ts`): Viết script nạp toàn bộ danh mục hành chính (34 tỉnh/thành và toàn bộ xã/phường/đặc khu) và toàn bộ danh sách trường Đại học/Cao đẳng/Học viện cả nước cùng danh mục mặt hàng vào Firestore. Script đọc từ file nguồn đặt trong thư mục `data/` (ghi rõ nguồn và ngày lấy), chạy lại nhiều lần không nhân đôi dữ liệu, và sau khi nạp phải in số lượng từng cấp để đối chiếu với danh mục chính thức. Nếu không tải được nguồn chính thức thì dừng lại và ghi vào danh sách “cần chủ dự án cung cấp”, tuyệt đối không tự bịa hay điền thiếu dữ liệu. Tuyệt đối không tạo tin đăng giả hay người dùng giả.

### Cách dùng trên giao diện:
- Ngay sau khi đăng nhập, người dùng chọn đủ các cấp ở trên. Có thể thêm tối đa 3 khu vực quan tâm. Khách chưa đăng nhập chọn tỉnh hoặc thành phố ở thanh đầu trang, và trình duyệt ghi nhớ. Đổi lại được bất cứ lúc nào.
- Thứ tự ưu tiên khi xếp tin theo kiểu sắp xếp mặc định “Phù hợp nhất”: cùng trường và cơ sở, rồi cùng phường hoặc xã, cùng tỉnh hoặc thành phố, cuối cùng là cả nước. Các kiểu sắp xếp khác (mới nhất, giá, gấp nhất) sắp đúng theo tiêu chí đó trong phạm vi đang lọc. Có công tắc “Chỉ trường của tôi” và “Xem cả nước”.
- Mỗi thẻ tin ghi trường của người bán và mức gần với người xem (cùng trường, cùng phường hoặc xã, cùng tỉnh hoặc thành phố, khác tỉnh hoặc thành phố).
- Tin có thể gắn nhãn “Giao trong trường” khi người bán hẹn gặp ngay trong khuôn viên hoặc ký túc xá.
- Mọi chỗ chọn khu vực và trường dùng chung một thành phần có ô tìm kiếm, gõ không dấu vẫn ra kết quả.

## Đăng ký, đăng nhập Google và hồ sơ
Chỉ dùng một cách đăng nhập: Google, qua Firebase Authentication. Không làm đăng ký bằng mật khẩu.

### Đăng nhập:
- Nút “Tiếp tục với Google” ở đầu trang và trong mọi chỗ cần đăng nhập. Trên điện thoại dùng chuyển hướng (redirect), trên máy tính dùng cửa sổ popup, có xử lý khi trình duyệt chặn popup.
- Trình duyệt nhúng: Google chặn đăng nhập trong WebView của Zalo, Facebook, Messenger và các app tương tự, trong khi link tin đăng sẽ được chia sẻ nhiều qua chính các app này. Phát hiện trình duyệt nhúng (qua user agent) và hiện hướng dẫn rõ “Mở bằng Chrome hoặc Safari để đăng nhập”, kèm nút sao chép liên kết.
- Đăng nhập chuyển hướng ổn định: đặt authDomain cùng miền với website (với Vercel, chuyển tiếp đường dẫn `/__/auth/` sang miền Firebase Auth) để trình duyệt không chặn lưu trữ bên thứ ba. Không đặt header Cross-Origin-Opener-Policy là same-origin vì làm hỏng cửa sổ popup; dùng `same-origin-allow-popups`.
- Lần đầu đăng nhập, tự lấy tên, ảnh đại diện và email từ Google, rồi chuyển sang trình hướng dẫn 3 bước. Người dùng có thể thoát giữa chừng và quay lại đúng bước đang dở.
- Giữ phiên đăng nhập lâu dài, có nút Đăng xuất và nút “Đăng xuất mọi thiết bị”.
- Giải thích lỗi bằng tiếng Việt rõ ràng (mất mạng, đóng cửa sổ, tài khoản bị khóa), không hiện mã lỗi thô.

### Trình hướng dẫn 3 bước:
1. Xác nhận tài khoản Google và đồng ý điều khoản, chính sách dữ liệu cá nhân.
2. Hồ sơ: họ tên thật, tên hiển thị, trường đại học (chọn từ danh mục, kèm cơ sở), khoa, khóa, mã số sinh viên, số Zalo (bắt buộc), số điện thoại (tùy chọn), nơi ở (chọn tỉnh hoặc thành phố, phường hoặc xã hoặc đặc khu, và ký túc xá hoặc khu trọ nếu có).
3. Tải ảnh thẻ sinh viên, đúng quy trình ở phần trước.

### Quyền riêng tư hồ sơ:
- Trang hồ sơ công khai chỉ hiện: tên hiển thị, ảnh đại diện, trường, tỉnh hoặc thành phố đang ở, ngày tham gia, số tin đang bán, số món đã bán, điểm đánh giá trung bình và nhãn “Đã xác minh sinh viên”. Không bao giờ hiện họ tên thật, mã sinh viên, email, Zalo hay số điện thoại.
- Thông tin liên hệ (Zalo, số điện thoại) ẩn mặc định, chỉ hiện cho người dùng đã xác minh sau khi bấm “Hiện liên hệ” (gọi qua Cloud Function, ghi lại mỗi lần xem để phát hiện hành vi thu thập số hàng loạt, và giới hạn số lần xem mỗi giờ).
- Trang cài đặt tài khoản: sửa hồ sơ, chọn loại thông báo (trong app, email), danh sách người đã chặn, tải về dữ liệu cá nhân, và xóa tài khoản. Xóa tài khoản phải xóa luôn tin đăng, ảnh, hội thoại, giữ chỗ, ảnh thẻ còn lưu và studentIdHash. Đánh giá đã gửi cho người khác được ẩn danh hóa (hiển thị “Người dùng đã xóa”) thay vì xóa. Nếu còn giao dịch đang ở trạng thái confirmed thì yêu cầu hoàn tất hoặc hủy trước khi xóa.

## Đăng tin bán đồ
Chỉ sinh viên đã xác minh được đăng tin. Làm form nhiều bước (Ảnh, Thông tin món đồ, Giá và hạn pass, Giao nhận, Xem lại), có thanh tiến độ, tự lưu nháp mỗi vài giây, và báo lỗi ngay cạnh từng ô bằng tiếng Việt. Bước cuối là bản xem trước đúng như người mua sẽ thấy.

| Trường | Bắt buộc | Quy tắc |
| :--- | :--- | :--- |
| Ảnh | Có | Từ 3 đến 10 ảnh, mỗi ảnh tối đa 5 MB, định dạng JPG, PNG hoặc WebP. Nén phía trình duyệt bằng HTML5 Canvas về cạnh dài 1600 px, đổi sang WebP, xóa dữ liệu vị trí (EXIF). Chọn được ảnh bìa, kéo thả để đổi thứ tự, cảnh báo khi ảnh quá mờ hoặc quá tối (tính độ sáng luminance và độ sắc nét Laplacian variance trên Canvas). Nén và xóa EXIF phía trình duyệt chỉ để tiết kiệm băng thông; Cloud Function chạy khi ảnh được tải lên Storage phải kiểm tra lại loại tệp, dung lượng và xóa EXIF phía server, vì phía client có thể bị qua mặt. |
| Tên món | Có | 10 đến 80 ký tự, không cho chỉ viết hoa toàn bộ, không chèn số điện thoại hay link. |
| Danh mục | Có | Chọn 2 cấp: Điện máy (quạt, tủ lạnh, nồi cơm, đèn), Nội thất, Sách và giáo trình, Xe cộ, Đồ bếp, Quần áo và chăn ga, Thể thao, Học cụ, Khác. |
| Tình trạng | Có | Mới 100%, Như mới (còn trên 90%), Tốt (70 đến 90%), Dùng được (50 đến 70%), Cũ hoặc cần sửa. Mỗi mức có một dòng giải thích để người bán chọn đúng. |
| Hãng, model, năm mua | Không | Gợi ý tự điền theo danh mục. |
| Thời gian đã dùng | Có | Chọn theo tháng hoặc năm. |
| Phụ kiện đi kèm, hóa đơn, bảo hành | Không | Chọn nhiều mục. |
| Khuyết điểm đã biết | Có | Ô nhập tự do, hoặc tick “Không có lỗi”. Hiển thị nổi bật trên trang chi tiết. |
| Mô tả | Có | 30 đến 1000 ký tự. |
| Giá pass | Có | Số nguyên đồng, làm tròn theo 1.000, tối thiểu 0 (tặng miễn phí). Tối đa 500.000.000 đồng (đặt thành hằng số cấu hình). |
| Giá mua mới | Không | Nếu nhập, phải lớn hơn hoặc bằng giá pass và hiển thị phần trăm đã giảm. |
| Thương lượng | Có | Giá cố định, Bớt nhẹ, hoặc Thoải mái thương lượng. |
| Số lượng, bán theo combo | Không | Cho phép gộp nhiều món một tin. |
| Hạn cần pass | Có | Chọn ngày (tính theo múi giờ Asia/Ho_Chi_Minh, hết hạn vào cuối ngày đó). Có công tắc “Pass trong ngày” hiện nhãn vàng nổi bật. Tin tự hết hạn sau ngày này và nhắc người bán gia hạn trước 2 ngày. Mọi mốc thời gian khác trong hệ thống (giữ chỗ 24 giờ, xóa ảnh thẻ sau 30 ngày) cũng tính theo múi giờ này. |
| Nơi lấy hàng | Có | Chọn tỉnh hoặc thành phố, phường hoặc xã (mặc định theo hồ sơ), trường và cơ sở nếu bán trong khuôn viên, cộng điểm hẹn công khai như cổng ký túc xá, cổng trường. Địa chỉ chính xác nhập riêng vào listingsPrivate và ẩn đến khi người bán đồng ý giữ chỗ. |
| Giao nhận | Có | Theo phần sau. |
| Liên hệ | Có | Mặc định dùng Zalo trong hồ sơ, có thể chọn nhận tin nhắn ngay trong app. |

### Quy tắc đăng tin:
- Có danh sách hàng cấm hiện sẵn khi đăng: hàng gian, vũ khí, thuốc, đồ có giới hạn độ tuổi, động vật sống, giấy tờ tùy thân, tài khoản và thiết bị bị khóa. Người bán tick cam kết mô tả đúng sự thật mới được đăng.
- Xe máy cần thêm: loại xe, năm sản xuất, tình trạng giấy tờ (chính chủ hay không). Không cho đăng ảnh hiển thị đầy đủ biển số hoặc số khung. Vì không thể tự động chặn hoàn toàn, làm bằng ba lớp: người bán tick cam kết đã che biển số, form có công cụ làm mờ vùng ảnh ngay trên trình duyệt, và mục báo cáo riêng cho vi phạm này.
- Tài khoản mới tối đa 10 tin đang bán cùng lúc. Chống đăng trùng: cảnh báo khi tên và ảnh quá giống một tin còn hiệu lực của cùng người. Hai quy tắc này không viết gọn được trong Security Rules, nên việc tạo tin đi qua Cloud Function callable (kiểm tra xác minh, giới hạn 10 tin, chống trùng); rules chỉ cho phép tạo tin từ đường đó.
- Vòng đời của tin: Nháp, Đang bán, Đã có người giữ, Đã bán, Hết hạn, Người bán đã ẩn, Quản trị viên đã ẩn. Tin bị quản trị viên ẩn thì người bán không tự mở lại được, chỉ gửi kháng nghị. Khi giữ chỗ đã xác nhận bị hủy hoặc quá hạn, tin quay về Đang bán và yêu cầu sớm nhất trong hàng chờ dự phòng (waitlisted) được chuyển lên pending để người bán xác nhận. Người bán đổi trạng thái được bằng một chạm từ trang “Tin của tôi”.
- Trang “Tin của tôi” có sửa, ẩn, gia hạn, đánh dấu đã bán và xem số lượt xem, lượt lưu, lượt nhắn.

## Phương thức giao nhận
Mỗi tin phải nói rõ cách người mua nhận hàng. Người bán chọn một hoặc nhiều phương thức dưới đây, và trang chi tiết hiển thị mỗi phương thức thành một khối riêng, gồm chi phí, thời gian và điều kiện, để người mua hiểu ngay mà không phải hỏi lại.

| Phương thức | Người bán phải khai báo | Người mua thấy gì |
| :--- | :--- | :--- |
| Tự đến lấy | Địa điểm hẹn công khai (cổng ký túc xá, cổng trường, quán cà phê), các khung giờ có thể gặp trong tuần, địa chỉ chính xác (ẩn), ghi chú như “tầng 3 không có thang máy” | Địa điểm công khai, khung giờ, nhắc kiểm tra hàng trước khi trả tiền, gợi ý gặp nơi đông người vào ban ngày |
| Người bán tự giao (ship nội thành hoặc trong tỉnh) | Khu vực giao (chọn các phường hoặc xã trong cùng tỉnh hoặc thành phố, hoặc cả tỉnh), phí giao (miễn phí, cố định, hoặc theo khoảng cách), thời gian giao dự kiến, có hỗ trợ khiêng hoặc lắp đồ không, kích thước và cân nặng ước tính, có cần xe ba gác hoặc xe tải không | Khu vực được giao, phí giao, thời gian, hỗ trợ đi kèm, ai trả phí |
| Gửi qua đơn vị vận chuyển (nội tỉnh hoặc liên tỉnh) | Người bán gửi qua dịch vụ nào, người mua trả phí ship, thời gian đóng gói, có nhận COD không, cách đóng gói món dễ vỡ | Phí ước tính, thời gian gửi, điều kiện đổi trả nếu có |

Nếu món đồ lớn (tủ, bàn, tủ lạnh, xe), bắt buộc người bán nhập kích thước và cân nặng ước tính để người mua biết có chở được không. Khi người mua ở khác tỉnh với người bán, chỉ hiện phương thức gửi qua đơn vị vận chuyển và cảnh báo rõ rủi ro khi mua xa.

### Thanh toán:
Bản đầu không tích hợp thanh toán trực tuyến. Hiển thị rõ rằng hai bên tự thỏa thuận (tiền mặt hoặc chuyển khoản khi nhận hàng). Với món giá trị cao, nhắc người mua không chuyển khoản trước khi chưa gặp hoặc chưa nhận hàng. Chuẩn bị sẵn cấu trúc dữ liệu để sau này thêm thanh toán hoặc giữ tiền trung gian.

### Luồng chốt giao dịch:
1. Người mua bấm nút “Giữ chỗ” (dùng một tên duy nhất trên toàn giao diện) và chọn phương thức giao nhận mong muốn, cùng khung giờ gợi ý (tạo bản ghi trong collection `reservations` với trạng thái `pending`; mỗi người mua chỉ có 1 yêu cầu pending trên một tin, và cho phép tối đa 3 yêu cầu pending cùng lúc trên một tin để tránh khóa tin bởi người hỏi ảo).
2. Người bán nhận thông báo, xác nhận (`confirmed`) hoặc từ chối (`rejected`) trong 24 giờ. Quá hạn thì lời giữ chỗ tự hủy (`expired`) và tin quay về trạng thái Đang bán.
3. Khi người bán xác nhận 1 người mua (`confirmed`), tin chuyển sang Đã có người giữ, các yêu cầu khác chuyển sang chờ dự phòng (`waitlisted`). Hai bên chốt giờ và địa điểm trong khung chat, và địa chỉ chính xác trong `listingsPrivate` chỉ mở quyền đọc từ lúc này cho đúng người mua được xác nhận.
4. Sau khi giao hoặc nhận xong, người bán bấm “Đã bán” (`completed`), và cả hai bên được mời đánh giá nhau.
5. Nếu người mua không đến (`no_show`) hoặc người bán hủy (`cancelled`), ghi nhận lại. Điểm uy tín tính bằng Cloud Function theo tỉ lệ giao dịch hoàn tất trên tổng số giao dịch đã xác nhận trong 90 ngày gần nhất, có trừ điểm cho no_show và hủy, hiển thị trên hồ sơ cạnh điểm đánh giá.

## Tính năng cho người mua và cộng đồng
### Tìm và duyệt tin:
- Trang chủ có ô tìm kiếm lớn, bộ chọn khu vực ở đầu trang, lối vào nhanh theo trường và danh mục, mục “Pass gấp trong tuần” và mục “Mới đăng”. Khi chưa có tin đăng nào trong khu vực hoặc trên hệ thống, hiển thị trạng thái trống (Empty State) đẹp mắt kèm nút kêu gọi “Đăng món đồ đầu tiên của trường bạn”.
- Tìm kiếm tiếng Việt chịu được gõ không dấu (“quat dung” ra “quạt đứng”). Với bản đầu, lưu thêm mảng từ khóa đơn đã bỏ dấu (`searchTokens`) và chuỗi không dấu trong Firestore; vì `array-contains` chỉ khớp một từ, truy vấn nhiều từ lấy từ khóa dài nhất ở phía server rồi lọc các từ còn lại ở phía client. Ghi trong README cách chuyển sang Typesense hoặc Algolia khi dữ liệu lớn.
- Bộ lọc: khu vực (cùng phường hoặc xã, cùng tỉnh, cả nước), trường và cơ sở (kèm công tắc “Chỉ trường của tôi”), danh mục, khoảng giá, tình trạng, phương thức giao nhận, chỉ hiện tin pass trong ngày, chỉ hiện tin có ship. Sắp xếp theo phù hợp nhất (mặc định), mới nhất, giá, gấp nhất. Firestore không gộp được mọi bộ lọc trong một truy vấn, nên phía server chỉ lọc theo tối đa khu vực hoặc trường, danh mục và một kiểu sắp xếp; các bộ lọc còn lại (khoảng giá, tình trạng, phương thức giao nhận, pass trong ngày, có ship) lọc ở phía client trên từng trang kết quả. Thứ tự ưu tiên theo khu vực làm bằng cách chạy các truy vấn theo từng tầng rồi gộp, loại trùng, phân trang bằng con trỏ cho từng tầng. Chỉ khai báo trong `firestore.indexes.json` những chỉ mục tổ hợp mà truy vấn thực sự dùng đến, không khai báo mọi tổ hợp.
- Phân trang vô hạn (infinite scroll) hoặc nút “Xem thêm”, có bộ khung chờ (skeleton) khi đang tải, và trạng thái trống có gợi ý hành động.
- Trang chi tiết tin: thư viện ảnh vuốt được và phóng to được, giá và nhãn thương lượng, tình trạng cùng khuyết điểm nổi bật, khối giao nhận, thông tin người bán (nhãn xác minh, điểm đánh giá, số món đã bán), tin tương tự, nút chia sẻ có ảnh bìa và tiêu đề đúng khi dán vào Zalo hoặc Facebook (Open Graph qua hàm `generateMetadata` phía server).

### Tương tác:
- Lưu yêu thích, theo dõi người bán, nhận thông báo khi tin đã lưu giảm giá hoặc sắp hết hạn.
- Nhắn tin trong app theo từng tin đăng (hội thoại một-một), có đánh dấu đã đọc, gửi được ảnh, và chống spam bằng giới hạn số hội thoại mới mỗi giờ (tạo hội thoại mới đi qua Cloud Function có kiểm tra tần suất; tin nhắn trong hội thoại đã có được ghi trực tiếp, rules chỉ cho hai bên tham gia ghi).
- Thông báo trong app và email cho: có người giữ chỗ, có tin nhắn mới, tin sắp hết hạn, kết quả xác minh. Web push là tùy chọn.
- Đánh giá 1 đến 5 sao kèm nhận xét ngắn, chỉ dành cho hai bên đã hoàn tất một giao dịch. Mỗi giao dịch đánh giá một lần.
- Chặn người dùng khác, và báo cáo tin, người dùng hoặc một hội thoại với lý do: lừa đảo, sai mô tả, hàng cấm, trùng lặp, spam, khác. Khi báo cáo hội thoại, người báo cáo gửi kèm các tin nhắn liên quan; quản trị viên chỉ đọc phần được gửi kèm, không tự mở hội thoại riêng tư.
- Cảnh báo an toàn ngay trong luồng mua bán: nhắc không chuyển tiền cọc cho người chưa gặp, nhắc kiểm tra hàng trước khi thanh toán, và nhắc rằng quản trị viên không bao giờ yêu cầu mã OTP hay mật khẩu.
- Trang quản trị (chỉ vai trò quản trị viên): hàng đợi duyệt thẻ, hàng đợi báo cáo, hàng đợi kháng nghị (khi bị khóa tài khoản hoặc bị ẩn tin, người dùng gửi kháng nghị kèm ghi chú), danh sách tài khoản có tìm kiếm và khóa tài khoản, ẩn hoặc khôi phục tin, cấu hình danh sách trường, khu vực, danh mục, tên miền email trường, và nhật ký mọi thao tác quản trị. Chủ dự án cấp hoặc thu hồi quyền quản trị viên cho người khác ngay trong trang này (ghi vào nhật ký); khuyến nghị bật xác thực hai bước cho mọi tài khoản Google của quản trị viên.

## Giao diện và trải nghiệm
- Làm theo thứ tự này: trước hết viết file design tokens (màu, chữ, khoảng cách, bo góc, bóng) và một trang thử các thành phần (button, input, card tin, chip, badge, modal, toast). Chỉ khi bộ thành phần đã đẹp mới ráp thành các trang.
- Nhận diện: Màu chủ đạo trẻ trung, dịu và hiện đại, không gắn với riêng một thành phố nào (đề xuất 2 phương án trong trang thử thành phần rồi chọn một), kết hợp một màu nhấn ấm dành riêng cho nhãn “Pass trong ngày”. Màu xanh lá dành cho “Đã xác minh”, đỏ cho cảnh báo. Mọi tổ hợp chữ và nền phải đạt tương phản WCAG AA (4.5:1 cho chữ thường).
- Chữ: Be Vietnam Pro cho nội dung (hỗ trợ dấu tiếng Việt đầy đủ), một font tiêu đề có cá tính để làm điểm nhấn. Kiểm tra mọi dấu (ệ, ữ, ợ, ặ) không bị lệch hay mất.
- Có chế độ sáng và tối, theo cài đặt hệ thống và có nút chuyển.
- Mobile-first, thiết kế ở 390 px trước rồi mở rộng lên máy tính bảng và 1280 px. Thanh điều hướng dưới cùng trên điện thoại (Trang chủ, Tìm kiếm, Đăng tin, Tin nhắn, Tôi), nút Đăng tin nổi bật.
- Thẻ tin: ảnh thật là trọng tâm (tỉ lệ 4:3), giá to và rõ, nhãn “Pass trong ngày” và “Có ship”, tên trường và hạn pass nhỏ bên dưới. Mọi thẻ cùng chiều cao phần chữ, chữ dài thì cắt dòng chứ không làm vỡ lưới.
- Mỗi màn hình có đủ ba trạng thái: đang tải (skeleton), trống (có hướng dẫn rõ ràng vì khi mới lên sản phẩm sẽ chưa có tin đăng), và lỗi (có nút thử lại).
- Chuyển động ít nhưng có chủ đích: ảnh hiện dần, bottom sheet trượt lên, nút bấm phản hồi. Tôn trọng cài đặt giảm chuyển động của hệ thống.
- Vùng bấm tối thiểu 44 px, có viền focus rõ khi dùng bàn phím, điều khiển được hoàn toàn bằng bàn phím, ảnh có văn bản thay thế.
- Hiệu năng: dùng next/image, tải lười ảnh, có ảnh mờ giữ chỗ, mục tiêu LCP dưới 2,5 giây trên 4G. Chạy Lighthouse và sửa cho Performance, Accessibility, SEO từ 90 trở lên.
- Tự kiểm tra: dùng trình duyệt tích hợp để chụp và xem từng trang chính ở 390 px và 1280 px, chế độ sáng và tối. Sửa mọi lỗi tràn ngang, chữ bị cắt, tương phản thấp trước khi báo xong.

## Cơ sở dữ liệu, bảo mật và quyền riêng tư
| Collection | Nội dung chính | Ai đọc, ai ghi |
| :--- | :--- | :--- |
| `users` | Tên hiển thị, ảnh, trường, ngày tham gia, điểm đánh giá, cờ đã xác minh | Đọc công khai các trường an toàn, chỉ chủ tài khoản ghi các trường hồ sơ |
| `usersPrivate` | Họ tên thật, Zalo, số điện thoại, email, nơi ở | Chỉ chủ tài khoản và quản trị viên đọc; người mua đã xác minh lấy Zalo/SĐT qua Cloud Function có giới hạn tần suất |
| `verifications` | Trạng thái (pending, approved, rejected, expired), trường, khoa, khóa, 4 số cuối mã sinh viên, mã băm studentIdHash (HMAC-SHA256), đường dẫn ảnh thẻ, lý do từ chối, hạn xác minh theo năm học | Chủ tài khoản đọc, quản trị viên đọc và duyệt |
| `listings` | Toàn bộ trường công khai của tin, trạng thái, hạn pass, từ khóa không dấu (searchTokens) | Đọc công khai tin ở trạng thái Đang bán, Đã có người giữ, Đã bán (để liên kết đã chia sẻ vẫn mở được); nháp, hết hạn và tin bị ẩn chỉ người bán và quản trị viên đọc. Tạo tin qua Cloud Function (kiểm tra xác minh, giới hạn 10 tin, chống trùng); người bán chỉ sửa các trường nội dung, không sửa trường hệ thống như trạng thái hay bộ đếm |
| `listingsPrivate` | Địa chỉ chính xác, khung giờ hẹn chi tiết, confirmedBuyerId | Chỉ người bán và người mua đã được xác nhận giữ chỗ (confirmedBuyerId) đọc |
| `reservations` | listingId, buyerId, sellerId, trạng thái (pending, confirmed, waitlisted, completed, cancelled, expired, rejected, no_show), phương thức giao nhận, khung giờ hẹn, hạn 24h | Chỉ người mua và người bán của giao dịch đó đọc và cập nhật theo đúng luồng |
| `conversations`, `messages` | Hội thoại theo tin, tin nhắn, trạng thái đọc | Chỉ hai bên tham gia đọc và ghi |
| `favorites`, `follows` | Tin đã lưu, người bán đã theo dõi | Chỉ chủ tài khoản |
| `reviews` | Sao, nhận xét, mã giao dịch (reservationId) | Đọc công khai, chỉ hai bên giao dịch đã hoàn tất (completed) được tạo, mỗi bên một lần |
| `reports` | Đối tượng bị báo cáo (tin, người dùng hoặc hội thoại), lý do, trạng thái xử lý, các tin nhắn người báo cáo gửi kèm | Người báo cáo tạo, quản trị viên xử lý |
| `appeals` | Đối tượng (tài khoản hoặc tin), lý do kháng nghị, trạng thái xử lý | Người gửi tạo và đọc kháng nghị của mình, quản trị viên xử lý |
| `notifications` | Loại thông báo, nội dung, đã đọc | Chỉ chủ tài khoản |
| `adminLogs` | Ai làm gì, lúc nào, với đối tượng nào | Chỉ quản trị viên đọc, chỉ Cloud Functions ghi |

### Bảo mật:
- Viết Firestore Security Rules và Storage Rules theo nguyên tắc từ chối mặc định. Kiểm tra kiểu dữ liệu, độ dài và giá trị hợp lệ của từng trường ngay trong rules, và viết test cho rules bằng Emulator.
- Cờ “đã xác minh” và vai trò quản trị chỉ đặt bằng custom claims qua Cloud Functions hoặc Admin SDK, không bao giờ để client tự ghi. Rules đọc cờ xác minh từ custom claims (`request.auth.token`), không đọc từ tài liệu Firestore, và client phải làm mới ID token sau khi claims đổi. Khóa tài khoản nghĩa là vô hiệu hóa người dùng trong Firebase Auth, thu hồi refresh token, và rules từ chối mọi thao tác.
- Ảnh thẻ ở đường dẫn riêng tư, chỉ chủ tài khoản được tải lên và chỉ quản trị viên được đọc. Ảnh tin đăng cho đọc công khai, chỉ người bán đã xác minh được tải lên, giới hạn dung lượng và loại tệp trong rules.
- Bật App Check, thêm reCAPTCHA cho các thao tác dễ bị lạm dụng (nộp thẻ, xem liên hệ, gửi tin nhắn). Giới hạn tần suất ở phía Cloud Functions.
- Làm sạch mọi nội dung người dùng nhập (chống XSS), không dùng dangerouslySetInnerHTML với dữ liệu người dùng. Thêm tiêu đề bảo mật (CSP, X-Frame-Options, Referrer-Policy).
- Không ghi dữ liệu cá nhân vào log. Không để khóa bí mật trong mã nguồn: dùng biến môi trường và cung cấp file `.env.example`.
- Cloud Function dọn dẹp theo lịch: xóa ảnh thẻ quá 30 ngày sau khi xử lý, ẩn tin hết hạn, hủy giữ chỗ quá 24 giờ. Mọi mốc thời gian tính theo múi giờ Asia/Ho_Chi_Minh. Đặt thêm Object Lifecycle rule trên thư mục ảnh thẻ (xóa sau 45 ngày) làm lớp dự phòng nếu Cloud Function lỗi.
- Cho phép người dùng tải về và xóa toàn bộ dữ liệu của mình, và xóa lan tỏa đúng như phần cài đặt tài khoản đã mô tả.

## Danh sách trang, lộ trình làm và tiêu chí hoàn thành
### Các trang cần có:
Trang chủ, Kết quả tìm kiếm, Chi tiết tin, Hồ sơ người bán, Đăng nhập, chọn khu vực và trình hướng dẫn xác minh, Đăng tin và sửa tin, Tin của tôi, Quản lý giữ chỗ, Tin đã lưu, Tin nhắn, Thông báo, Cài đặt tài khoản, Điều khoản và Chính sách dữ liệu cá nhân, Hướng dẫn mua bán an toàn, Hỗ trợ và liên hệ (kèm cách gửi kháng nghị), các trang quản trị (duyệt thẻ, báo cáo, tài khoản, cấu hình), và trang 404.

### Lộ trình làm:
- **Giai đoạn 1**: Khởi tạo dự án, cấu hình Firebase Emulator, viết design tokens và bộ thành phần giao diện.
- **Giai đoạn 2**: Script khởi tạo toàn bộ danh mục hành chính (34 tỉnh/thành và toàn bộ xã/phường/đặc khu theo danh mục hiện hành) và toàn bộ danh mục trường Đại học/Cao đẳng/Học viện cả nước (trụ sở chính) + cấp quyền cho email Admin đầu tiên; chức năng đăng nhập Google, trình hướng dẫn hồ sơ, tải thẻ và trang quản trị duyệt thẻ, kèm Security Rules và test.
- **Giai đoạn 3**: Đăng tin: form nhiều bước, tải và nén ảnh, khối giao nhận, trang Tin của tôi.
- **Giai đoạn 4**: Trang chủ, tìm kiếm, bộ lọc (kèm firestore.indexes.json), trang chi tiết tin, hồ sơ người bán.
- **Giai đoạn 5**: Giữ chỗ, luồng chốt giao dịch, nhắn tin, thông báo, đánh giá, báo cáo, chặn.
- **Giai đoạn 6**: Cloud Functions dọn dẹp theo lịch, SEO và Open Graph, tối ưu hiệu năng, kiểm tra truy cập.
- **Giai đoạn 7**: Kiểm thử toàn bộ bằng Emulator (gồm test đầu-cuối bằng Playwright), viết README, hướng dẫn triển khai lên Vercel hoặc Firebase App Hosting.

### Tiêu chí hoàn thành (kiểm từng mục trước khi báo xong):
1. Danh mục khu vực khớp với danh mục hành chính hiện hành (34 tỉnh/thành, toàn bộ xã/phường/đặc khu, không còn cấp quận/huyện; số lượng từng cấp đã đối chiếu và ghi trong README) và danh mục trường có đầy đủ các trường đại học, cao đẳng, học viện trên cả nước (trụ sở chính). Cơ sở dữ liệu thật hoàn toàn sạch (không có tin đăng ảo hay người dùng ảo); dữ liệu mẫu chỉ có trong Emulator và test.
2. Một người dùng mới đi trọn luồng được: đăng nhập Google, nộp thẻ, được quản trị viên duyệt, đăng tin có ảnh, người khác tìm thấy, giữ chỗ, nhắn tin, chốt, đánh giá.
3. Người chưa xác minh không đăng được tin và không xem được liên hệ, kể cả khi gọi thẳng API (đã có test cho rules).
4. Đăng nhập Google chạy được trên Chrome và Safari điện thoại; khi mở liên kết trong trình duyệt của Zalo hoặc Facebook thì hiện hướng dẫn mở bằng trình duyệt ngoài thay vì báo lỗi hay màn hình trắng.
5. Ảnh thẻ không đọc được bởi người dùng thường.
6. Mọi trang đẹp và không vỡ ở 390 px và 1280 px, ở chế độ sáng và tối (kể cả khi chưa có tin đăng nào).
7. Lighthouse đạt từ 90 trở lên cho Performance, Accessibility và SEO trên trang chủ và trang chi tiết tin.
8. Không có lỗi trong console, không có khóa bí mật trong mã nguồn, và không còn tên thành phố hay trường cụ thể nào bị gắn cứng trong mã.

### Cách làm việc:
- Bắt đầu bằng một kế hoạch chi tiết và danh sách task, rồi mới viết mã. Sau mỗi giai đoạn, chạy thử, báo lại những gì đã làm được và chờ xác nhận trước khi làm giai đoạn tiếp theo.
- Lưu toàn bộ tài liệu này thành `docs/SPEC.md` trong repo. Mỗi lần chỉ làm một giai đoạn, và đọc lại các phần liên quan của SPEC.md trước khi bắt đầu giai đoạn đó.
- Tuyệt đối không bịa dữ liệu tin đăng, không tạo người dùng giả hay thông tin pháp lý giả. Trang Điều khoản và Chính sách dữ liệu chỉ là bản nháp mẫu, đánh dấu rõ “CẦN LUẬT SƯ RÀ SOÁT”, thông tin chủ dự án để dạng placeholder (không tự bịa tên pháp nhân, địa chỉ, mã số thuế). Việc nào thiếu thông tin (khóa Firebase, tên miền) thì ghi rõ vào danh sách “cần chủ dự án cung cấp” thay vì tự đoán.
- Với mọi quyết định có nhiều cách làm, chọn cách đơn giản và rẻ hơn, ghi lý do ngắn trong README.

### Chủ dự án chuẩn bị trước:
- Một project Firebase mới, bật đăng nhập Google, Firestore, Storage và gói Blaze (kèm cảnh báo ngân sách).
- Email quản trị viên đầu tiên (cấu hình trong biến môi trường `ADMIN_EMAIL` để script tự động cấp quyền Admin).
- Nguồn danh mục: bảng danh mục và mã số các đơn vị hành chính hiện hành (do Cục Thống kê quản lý, theo Quyết định 19/2025/QĐ-TTg hoặc văn bản thay thế) và danh sách các trường đại học, cao đẳng, học viện của Bộ GD&ĐT. Nếu chưa cung cấp file riêng, hãy lấy từ các nguồn chính thức đó (hoặc bộ dữ liệu mở đã cập nhật theo cấu trúc 34 tỉnh/thành) vào thư mục `data/`, ghi rõ nguồn và ngày lấy rồi nạp vào Firestore. Nếu không tải được thì ghi vào danh sách “cần chủ dự án cung cấp” thay vì tự bịa dữ liệu.
- Tên miền (tùy chọn khi chạy thử, có thể dùng tên miền miễn phí của Firebase hoặc Vercel lúc đầu; nhưng bắt buộc nếu muốn gửi email thật cho người dùng, vì cần xác thực SPF/DKIM) và tài khoản Resend hoặc SMTP.
- Luật sư rà soát Điều khoản và Chính sách dữ liệu cá nhân trước khi mở cho người dùng thật.
