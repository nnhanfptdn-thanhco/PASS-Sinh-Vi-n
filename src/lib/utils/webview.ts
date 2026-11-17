/**
 * Nhận diện trình duyệt nhúng (In-App WebView) của Zalo, Facebook, Messenger, Instagram, TikTok...
 * Google chặn OAuth đăng nhập bên trong WebView để bảo vệ người dùng chống phishing.
 */

export function isEmbeddedWebView(): boolean {
  if (typeof window === "undefined" || !window.navigator) return false;

  const ua = window.navigator.userAgent || window.navigator.vendor || "";

  // Các định danh đặc trưng của WebView Zalo, Facebook, Messenger, v.v.
  const isZalo = /Zalo/i.test(ua);
  const isFacebook = /FBAN|FBAV|FB_IAB/i.test(ua);
  const isMessenger = /Messenger/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isTikTok = /musical_ly|BytedanceWebview/i.test(ua);
  const isLine = /Line/i.test(ua);

  // WebView Android chuẩn (wv) hoặc iOS WebView
  const isAndroidWebView = /Android.*wv/i.test(ua);
  const isIOSWebView = /(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i.test(ua);

  return (
    isZalo ||
    isFacebook ||
    isMessenger ||
    isInstagram ||
    isTikTok ||
    isLine ||
    isAndroidWebView ||
    isIOSWebView
  );
}

export function copyCurrentUrlToClipboard(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const url = window.location.href;
  return navigator.clipboard
    .writeText(url)
    .then(() => true)
    .catch(() => false);
}
