/**
 * XỬ LÝ MÚI GIỜ VÀ HẠN PASS CHUẨN VIỆT NAM (WP-0.2 & 2.1)
 * Múi giờ gốc: Asia/Ho_Chi_Minh (UTC+7)
 */

export const TIMEZONE_VN = "Asia/Ho_Chi_Minh";

/**
 * Lấy chuỗi ngày YYYY-MM-DD hiện tại theo múi giờ Việt Nam
 */
export function todayVN(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE_VN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Cộng thêm n ngày từ một chuỗi ngày YYYY-MM-DD
 */
export function addDaysVN(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  utcDate.setUTCDate(utcDate.getUTCDate() + n);
  return utcDate.toISOString().slice(0, 10);
}

/**
 * Kiểm tra xem ngày hạn pass đã qua chưa.
 * Quy tắc: Tin hết hạn VÀO CUỐI NGÀY HẠN (23:59:59 giờ VN),
 * nghĩa là nếu passDeadline === todayVN(now) thì tin VẪN CÒN HIỆU LỰC.
 * Chỉ khi passDeadline < todayVN(now) mới là đã hết hạn.
 */
export function isPastDeadline(passDeadline: string, now: Date = new Date()): boolean {
  if (!passDeadline) return true;
  return passDeadline < todayVN(now);
}

/**
 * Hiển thị hạn pass thân thiện tiếng Việt
 */
export function formatDeadlineVN(passDeadline: string, now: Date = new Date()): string {
  if (!passDeadline) return "";
  const currentToday = todayVN(now);

  if (passDeadline < currentToday) {
    return "Đã hết hạn";
  }
  if (passDeadline === currentToday) {
    return "Hôm nay";
  }

  const [cy, cm, cd] = currentToday.split("-").map(Number);
  const [dy, dm, dd] = passDeadline.split("-").map(Number);

  const curUtc = Date.UTC(cy, cm - 1, cd);
  const deadUtc = Date.UTC(dy, dm - 1, dd);
  const diffDays = Math.round((deadUtc - curUtc) / (24 * 60 * 60 * 1000));

  if (diffDays === 1) {
    return "Còn 1 ngày (Ngày mai)";
  }
  if (diffDays <= 3) {
    return `Còn ${diffDays} ngày`;
  }

  // Format DD/MM/YYYY
  return `${String(dd).padStart(2, "0")}/${String(dm).padStart(2, "0")}/${dy}`;
}
