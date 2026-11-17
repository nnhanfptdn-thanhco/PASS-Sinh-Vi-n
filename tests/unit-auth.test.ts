import { describe, it, expect } from "vitest";
import { safeNext } from "../src/lib/utils/url";
import { getFirebaseAuthErrorMessage } from "../src/lib/auth/errors";
import { checkIsEmbeddedWebView } from "../src/lib/utils/webview";

describe("1. Kiểm tra An Toàn Return URL (safeNext - Chống Open Redirect)", () => {
  it("Chấp nhận các đường dẫn nội bộ hợp lệ", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/my-listings")).toBe("/my-listings");
    expect(safeNext("/listings/new?category=dien-tu")).toBe("/listings/new?category=dien-tu");
    expect(safeNext("   /settings   ")).toBe("/settings");
  });

  it("Chặn tuyệt đối các URL chuyển hướng ra ngoài (Open Redirect Attack)", () => {
    // Protocol-relative URLs
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("//google.com/phishing")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");

    // Absolute URLs với Schemes khác nhau
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://malicious-site.com/login")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("data:text/html,<h1>Hack</h1>")).toBe("/");

    // Ký tự rỗng hoặc tham số không hợp lệ
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
    expect(safeNext("   ")).toBe("/");
    expect(safeNext("my-listings")).toBe("/"); // Không bắt đầu bằng /
  });
});

describe("2. Chuyển Đổi Mã Lỗi Firebase Auth (errors.ts)", () => {
  it("Bỏ qua lỗi người dùng chủ động đóng popup hoặc huỷ yêu cầu (không hiện lỗi đỏ)", () => {
    expect(getFirebaseAuthErrorMessage("auth/popup-closed-by-user")).toBeNull();
    expect(getFirebaseAuthErrorMessage("auth/cancelled-popup-request")).toBeNull();
    expect(getFirebaseAuthErrorMessage(undefined)).toBeNull();
  });

  it("Chuyển đổi các mã lỗi quan trọng thành tiếng Việt thân thiện", () => {
    expect(getFirebaseAuthErrorMessage("auth/popup-blocked")).toContain("chặn");
    expect(getFirebaseAuthErrorMessage("auth/network-request-failed")).toContain("kết nối mạng");
    expect(getFirebaseAuthErrorMessage("auth/unauthorized-domain")).toContain("Authorized Domains");
    expect(getFirebaseAuthErrorMessage("auth/user-disabled")).toContain("vô hiệu hóa");
    expect(getFirebaseAuthErrorMessage("auth/too-many-requests")).toContain("quá nhiều yêu cầu");
    expect(getFirebaseAuthErrorMessage("auth/unknown-error")).toContain("Không thể đăng nhập");
  });
});

describe("3. Nhận Diện In-App WebView (Zalo, Facebook, TikTok...)", () => {
  it("Phát hiện chính xác WebView nhúng của các ứng dụng mạng xã hội", () => {
    // Zalo
    const zaloUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo/23.05.01";
    expect(checkIsEmbeddedWebView(zaloUA)).toBe(true);

    // Facebook / Messenger
    const fbUA =
      "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/422.0.0.26.76;]";
    expect(checkIsEmbeddedWebView(fbUA)).toBe(true);

    const messengerUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/390.0.0.17.112;]";
    expect(checkIsEmbeddedWebView(messengerUA)).toBe(true);

    // TikTok
    const tikTokUA =
      "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.71 Mobile Safari/537.36 BytedanceWebview/1.0.0 musical_ly_25.1.3";
    expect(checkIsEmbeddedWebView(tikTokUA)).toBe(true);

    // Line
    const lineUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/12.4.1";
    expect(checkIsEmbeddedWebView(lineUA)).toBe(true);
  });

  it("Không nhận nhầm các trình duyệt độc lập chuẩn trên Desktop và Mobile", () => {
    // Desktop Chrome
    const desktopChrome =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(checkIsEmbeddedWebView(desktopChrome)).toBe(false);

    // Desktop Safari
    const desktopSafari =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(checkIsEmbeddedWebView(desktopSafari)).toBe(false);

    // Mobile Safari trên iOS
    const mobileSafari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(checkIsEmbeddedWebView(mobileSafari)).toBe(false);

    // Chrome trên iOS (CriOS) - KHÔNG ĐƯỢC nhận nhầm là WebView
    const crioUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1";
    expect(checkIsEmbeddedWebView(crioUA)).toBe(false);

    // Firefox trên iOS (FxiOS)
    const fxiOSUA =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15";
    expect(checkIsEmbeddedWebView(fxiOSUA)).toBe(false);
  });
});
