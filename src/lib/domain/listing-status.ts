import { isPastDeadline } from "../utils/date";

export type ListingStatus =
  | "active"
  | "reserved"
  | "sold"
  | "hidden_by_seller"
  | "hidden_by_admin"
  | "expired";

export type ManageAction = "hide" | "show" | "mark_sold" | "renew";

export interface ListingStatusCheckContext {
  currentStatus: ListingStatus;
  passDeadline: string;
  now?: Date;
  isAdmin?: boolean;
}

/**
 * Kiểm tra xem hành động quản lý tin (hide/show/mark_sold/renew) có hợp lệ theo Bảng 2.3 hay không
 */
export function validateManageListingAction(
  action: ManageAction,
  ctx: ListingStatusCheckContext
): { valid: boolean; error?: string; statusCode?: number } {
  const { currentStatus, passDeadline, now = new Date(), isAdmin = false } = ctx;
  const isExpired = isPastDeadline(passDeadline, now) || currentStatus === "expired";

  // Trạng thái đã bán là trạng thái cuối, không ai được can thiệp
  if (currentStatus === "sold") {
    return {
      valid: false,
      statusCode: 409,
      error: "Tin đăng đã bán thành công và không thể thay đổi trạng thái hoặc gia hạn thêm.",
    };
  }

  // Tin bị admin ẩn thì chỉ admin mới can thiệp được
  if (currentStatus === "hidden_by_admin" && !isAdmin) {
    return {
      valid: false,
      statusCode: 403,
      error: "Tin đăng đã bị Quản trị viên ẩn do vi phạm quy định. Vui lòng gửi kháng nghị để được xem xét.",
    };
  }

  switch (action) {
    case "hide": {
      if (currentStatus === "hidden_by_admin") {
        return {
          valid: false,
          statusCode: 409,
          error: "Tin đăng đã bị Quản trị viên ẩn trước đó.",
        };
      }
      if (currentStatus === "hidden_by_seller" && !isAdmin) {
        return {
          valid: false,
          statusCode: 409,
          error: "Tin đăng đã ở trạng thái tạm ẩn.",
        };
      }
      if (currentStatus === "reserved" && !isAdmin) {
        return {
          valid: false,
          statusCode: 409,
          error: "Tin đang có người giữ chỗ. Bạn cần hủy hoặc hoàn tất giữ chỗ trước khi ẩn tin.",
        };
      }
      if (currentStatus !== "active" && !isAdmin) {
        return {
          valid: false,
          statusCode: 409,
          error: `Không thể ẩn tin từ trạng thái "${currentStatus}".`,
        };
      }
      return { valid: true };
    }

    case "show": {
      if (currentStatus === "active") {
        return {
          valid: false,
          statusCode: 409,
          error: "Tin đăng hiện đã đang được hiển thị công khai.",
        };
      }
      const showable =
        currentStatus === "hidden_by_seller" ||
        (currentStatus === "hidden_by_admin" && isAdmin);
      if (!showable) {
        return {
          valid: false,
          statusCode: 409,
          error: `Không thể hiện lại tin từ trạng thái "${currentStatus}".`,
        };
      }
      if (isExpired) {
        return {
          valid: false,
          statusCode: 400,
          error: "Tin đã quá hạn đăng. Vui lòng bấm 'Gia hạn' để hiển thị lại tin.",
        };
      }
      return { valid: true };
    }

    case "mark_sold": {
      if (currentStatus === "reserved") {
        return {
          valid: false,
          statusCode: 409,
          error: "Tin đang có người giữ chỗ. Vui lòng vào trang 'Giữ chỗ' và chọn 'Đã giao xong' để hoàn tất giao dịch.",
        };
      }
      if (currentStatus !== "active") {
        return {
          valid: false,
          statusCode: 409,
          error: `Không thể đánh dấu đã bán từ trạng thái "${currentStatus}".`,
        };
      }
      return { valid: true };
    }

    case "renew": {
      if (currentStatus === "reserved") {
        return {
          valid: false,
          statusCode: 409,
          error: "Tin đang có người giữ chỗ. Bạn cần hoàn tất hoặc hủy giao dịch giữ chỗ trước khi gia hạn tin.",
        };
      }
      if (currentStatus === "hidden_by_seller" && !isExpired) {
        return {
          valid: false,
          statusCode: 409,
          error: "Vui lòng hiện tin trước khi thực hiện gia hạn.",
        };
      }
      if (
        currentStatus !== "active" &&
        currentStatus !== "expired" &&
        currentStatus !== "hidden_by_seller"
      ) {
        return {
          valid: false,
          statusCode: 409,
          error: `Không thể gia hạn tin ở trạng thái "${currentStatus}".`,
        };
      }
      return { valid: true };
    }

    default:
      return {
        valid: false,
        statusCode: 400,
        error: "Hành động quản lý không hợp lệ.",
      };
  }
}
