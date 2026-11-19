/**
 * CHÍNH SÁCH XÁC THỰC VÀ XÁC MINH SINH VIÊN (PROMPT 5)
 * Cấu hình tập trung chính sách định danh tài khoản
 */

/**
 * Có tự động cấp quyền 'verified' cho tài khoản đăng nhập bằng email .edu.vn hay không.
 * Mặc định: FALSE (yêu cầu nộp ảnh thẻ sinh viên hoặc hồ sơ minh chứng để quản trị viên đối chiếu).
 * Lý do: Giảng viên, cựu sinh viên, hoặc người giữ email trường cũ vẫn có thể sở hữu email .edu.vn.
 */
export const AUTO_VERIFY_BY_EDU_EMAIL = false;

/**
 * Xem thông tin liên hệ người bán có bắt buộc phải là người đã duyệt thẻ sinh viên (thay vì chỉ email).
 * Mặc định: TRUE (bảo vệ quyền riêng tư số điện thoại / Zalo của sinh viên).
 */
export const CONTACT_REQUIRES_CARD = true;

/**
 * Thời gian lưu trữ ảnh thẻ sinh viên tối đa trước khi hệ thống tự động xóa vĩnh viễn (30 ngày).
 */
export const CARD_RETENTION_DAYS = 30;
