/**
 * Nhận diện trình duyệt nhúng (In-App WebView) của Zalo, Facebook, Messenger, Instagram, TikTok...
 * Google chặn OAuth đăng nhập bên trong WebView để bảo vệ người dùng chống phishing.
 * Hỗ trợ đầy đủ iPhone, iPad (kể cả iPadOS 13+ gửi UA MacIntel) và chế độ PWA Home Screen trên Safari.
 */

export function checkIsKnownInAppBrowser(userAgent: string): boolean {
  if (!userAgent) return false;
  return (
    /Zalo/i.test(userAgent) ||
    /FBAN|FBAV|FB_IAB/i.test(userAgent) ||
    /Messenger/i.test(userAgent) ||
    /Instagram/i.test(userAgent) ||
    /musical_ly|BytedanceWebview/i.test(userAgent) ||
    /\bLine\//i.test(userAgent) ||
    /Snapchat/i.test(userAgent) ||
    /Twitter/i.test(userAgent) ||
    /Pinterest/i.test(userAgent) ||
    /LinkedInApp/i.test(userAgent)
  );
}

export function checkIsEmbeddedWebView(
  userAgent: string,
  options?: { isStandalonePWA?: boolean }
): boolean {
  if (!userAgent) return false;

  const ua = userAgent;
  if (checkIsKnownInAppBrowser(ua)) {
    return true;
  }

  // WebView Android chuẩn (wv)
  const isAndroidWebView = /Android.*wv/i.test(ua);
  if (isAndroidWebView) return true;

  // Khi người dùng iPhone/iPad thêm web ra Màn hình chính (PWA standalone),
  // Apple ẩn chữ "Safari" khỏi UA dù đây là Safari hợp lệ -> KHÔNG được chặn như WebView.
  if (options?.isStandalonePWA) {
    return false;
  }

  // iOS WebView (UIWebView/WKWebView không phải Safari/Chrome/Firefox/Edge iOS)
  const isIOS = /(iPhone|iPod|iPad)/i.test(ua);
  const isIOSBrowsers = /(CriOS|FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo)/i.test(ua);
  const isIOSWebView =
    isIOS &&
    !isIOSBrowsers &&
    /AppleWebKit/i.test(ua) &&
    !/Safari/i.test(ua);

  return isIOSWebView;
}

export function isIOSStandalonePWA(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia?.("(display-mode: standalone)")?.matches === true;
  } catch {
    return false;
  }
}

export function isEmbeddedWebView(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  const ua = window.navigator.userAgent || window.navigator.vendor || "";
  return checkIsEmbeddedWebView(ua, { isStandalonePWA: isIOSStandalonePWA() });
}

export function isAndroidDevice(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  return /Android/i.test(window.navigator.userAgent || "");
}

/**
 * Nhận diện iPhone, iPod và cả iPad (bao gồm iPadOS 13+ tự khai báo platform "MacIntel" với maxTouchPoints > 1).
 */
export function checkIsIOSDevice(
  userAgent: string,
  platform = "",
  maxTouchPoints = 0
): boolean {
  if (/(iPhone|iPod|iPad)/i.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function isIOSDevice(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;
  return checkIsIOSDevice(
    window.navigator.userAgent || "",
    window.navigator.platform || "",
    window.navigator.maxTouchPoints || 0
  );
}

/**
 * Tạo Android Intent URL để mở trang hiện tại bằng Google Chrome độc lập
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

export async function copyCurrentUrlToClipboard(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const url = window.location.href;

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Fallback xuống textarea execCommand cho iOS Safari / WebView / HTTP LAN
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, url.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
