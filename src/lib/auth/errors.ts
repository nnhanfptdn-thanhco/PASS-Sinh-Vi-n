/**
 * Chuyển đổi mã lỗi Firebase Auth thành thông báo tiếng Việt thân thiện, rõ ràng.
 */
export function getFirebaseAuthErrorMessage(errorCode?: string): string | null {
  if (!errorCode) return null;

  switch (errorCode) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      // Người dùng chủ động đóng cửa sổ hoặc huỷ đăng nhập -> không hiển thị lỗi đỏ
      return null;

    case "auth/popup-blocked":
      return "Trình duyệt đã chặn cửa sổ đăng nhập tự động. Hệ thống đang chuyển hướng sang trang đăng nhập...";

    case "auth/network-request-failed":
      return "Mất kết nối mạng. Vui lòng kiểm tra lại kết nối Wifi/4G của bạn và thử lại.";

    case "auth/unauthorized-domain":
      return "Tên miền hiện tại chưa được cấp phép đăng nhập Google trong Firebase Console. Vui lòng kiểm tra mục Authorized Domains.";

    case "auth/account-exists-with-different-credential":
      return "Email này đã được liên kết với một tài khoản hoặc phương thức đăng nhập khác.";

    case "auth/user-disabled":
      return "Tài khoản của bạn đã bị vô hiệu hóa hoặc tạm khóa. Vui lòng liên hệ ban quản trị để được hỗ trợ.";

    case "auth/too-many-requests":
      return "Bạn đã gửi quá nhiều yêu cầu liên tiếp. Vui lòng chờ vài phút trước khi thử lại.";

    case "auth/operation-not-allowed":
      return "Tính năng đăng nhập Google chưa được kích hoạt trên hệ thống máy chủ.";

    case "auth/internal-error":
      return "Đã xảy ra lỗi nội bộ từ hệ thống xác thực Google. Vui lòng thử lại sau giây lát.";

    default:
      return "Không thể đăng nhập, vui lòng thử lại sau.";
  }
}
