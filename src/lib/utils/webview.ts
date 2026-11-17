/**
 * Nhận diện trình duyệt nhúng (In-App WebView) của Zalo, Facebook, Messenger, Instagram, TikTok...
 * Google chặn OAuth đăng nhập bên trong WebView để bảo vệ người dùng chống phishing.
 */

export function checkIsEmbeddedWebView(userAgent: string): boolean {
  if (!userAgent) return false;

  const ua = userAgent;

  // Các định danh đặc trưng của WebView Zalo, Facebook, Messenger, Instagram, TikTok, Line, v.v.
  const isZalo = /Zalo/i.test(ua);
  const isFacebook = /FBAN|FBAV|FB_IAB/i.test(ua);
  const isMessenger = /Messenger/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isTikTok = /musical_ly|BytedanceWebview/i.test(ua);
  const isLine = /\bLine\//i.test(ua);
  const isSnapchat = /Snapchat/i.test(ua);
  const isTwitter = /Twitter/i.test(ua);
  const isPinterest = /Pinterest/i.test(ua);
  const isLinkedIn = /LinkedInApp/i.test(ua);

  // WebView Android chuẩn (wv)
  const isAndroidWebView = /Android.*wv/i.test(ua);

  // iOS WebView (UIWebView hoặc WKWebView tùy biến không phải Safari chuẩn, loại trừ CriOS/FxiOS/EdgiOS)
  const isIOS = /(iPhone|iPod|iPad)/i.test(ua);
  const isIOSBrowsers = /(CriOS|FxiOS|EdgiOS|OPiOS|OPT)/i.test(ua);
  const isIOSWebView =
    isIOS &&
    !isIOSBrowsers &&
    /AppleWebKit/i.test(ua) &&
    !/Safari/i.test(ua);

  return (
    isZalo ||
    isFacebook ||
    isMessenger ||
    isInstagram ||
    isTikTok ||
    isLine ||
    isSnapchat ||
    isTwitter ||
    isPinterest ||
    isLinkedIn ||
    isAndroidWebView ||
    isIOSWebView
  );
}

export function isEmbeddedWebView(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  const ua = window.navigator.userAgent || window.navigator.vendor || "";
  return checkIsEmbeddedWebView(ua);
}

export function isAndroidDevice(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  return /Android/i.test(window.navigator.userAgent || "");
}

export function isIOSDevice(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  return /(iPhone|iPod|iPad)/i.test(window.navigator.userAgent || "");
}

/**
 * Tạo Android Intent URL để mở trang hiện tại bằng Google Chrome độc lập
 * Cú pháp: intent://<host><path>#Intent;scheme=https;package=com.android.chrome;end
 */
export function getAndroidChromeIntentUrl(fullUrl?: string): string {
  if (typeof window === "undefined" && !fullUrl) return "";
  const target = fullUrl || window.location.href;
  try {
    const parsed = new URL(target);
    const hostAndPath = parsed.host + parsed.pathname + parsed.search + parsed.hash;
    return `intent://${hostAndPath}#Intent;scheme=${parsed.protocol.replace(":", "")};package=com.android.chrome;end`;
  } catch {
    return target;
  }
}

export function copyCurrentUrlToClipboard(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const url = window.location.href;
  return navigator.clipboard
    .writeText(url)
    .then(() => true)
    .catch(() => false);
}
