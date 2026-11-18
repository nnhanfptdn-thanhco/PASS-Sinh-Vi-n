# QUY TẮC LÀM VIỆC CHO MỌI PROMPT HARDENING

## Dự án
Chợ Pass Sinh Viên: Next.js 14 (App Router) + TypeScript + Tailwind; Firebase (Client SDK: Auth, Storage; Admin SDK: Firestore trong Route Handlers); Vitest; deploy Vercel. Chợ đồ cũ C2C cho sinh viên: chỉ SV đã được duyệt mới đăng tin và xem liên hệ người bán. Production chưa có dữ liệu thật.

## Nguồn của các phát hiện
Một bản review bên ngoài đã đọc README, firestore.rules, storage.rules, next.config.mjs và HTML trang live, nhưng KHÔNG đọc được src/. Vì vậy mọi phát hiện chỉ là GIẢ THUYẾT: luôn đọc code thật trước khi sửa. Nếu phát hiện sai hoặc đã được xử lý → ghi "Không áp dụng" kèm bằng chứng (file:dòng) rồi bỏ qua.

## Luật bắt buộc
1. Nhánh làm việc: `hardening/all` (Prompt 0 tạo). Mỗi prompt tạo các commit riêng, message dạng `hardening(pN): ...`. Không force-push, không rewrite lịch sử.
2. KHÔNG chạy `firebase deploy`, `gcloud`, `vercel`; KHÔNG đọc/ghi/commit secret hoặc .env thật. Việc cần quyền cloud/Vercel → ghi vào "Việc chủ dự án tự làm".
3. Không đổi stack, không nâng major version thư viện, không đổi tên route/collection nếu prompt không yêu cầu. Thêm dependency chỉ khi thật sự cần và ghi lý do.
4. Gate sau mỗi prompt phải xanh: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`; từ Prompt 1 thêm `npm run test:rules`. Test cũ không được hỏng; nếu hành vi đổi có chủ đích thì sửa test và ghi lý do. Gate đỏ thì sửa tới khi xanh; không tắt test/lint để qua; không commit trạng thái đỏ.
5. Mỗi thay đổi bảo mật phải có test chứng minh: viết test trước, thấy fail, sửa, thấy pass.
6. Quyết định chính sách chưa rõ: chọn phương án an toàn nhất mà KHÔNG phá hành vi hiện có, ghi vào "Quyết định cần chủ dự án xác nhận". Không hỏi giữa chừng.
7. Không bịa số liệu (hiệu năng, độ phủ test...). Không đo được thì nói rõ là không đo được.
8. Việc ngoài phạm vi prompt: không sửa, chỉ ghi vào "Phát hiện thêm".
9. Không log PII (MSSV, ảnh thẻ, SĐT/Zalo, email); không đưa PII thật vào thông báo lỗi hay test fixture.
10. Thông báo hướng người dùng viết bằng tiếng Việt có dấu, ngắn gọn, không đổ lỗi cho người dùng.

## Báo cáo
Cuối mỗi prompt, thêm một mục vào `docs/HARDENING_REPORT.md` (tạo nếu chưa có) gồm: Đã làm · Không áp dụng (+bằng chứng) · File đã đổi · Test đã thêm · Việc chủ dự án tự làm · Quyết định cần xác nhận · Phát hiện thêm · Kết quả các gate. Cuối phiên, trả lời người dùng tối đa 10 dòng tóm tắt.
