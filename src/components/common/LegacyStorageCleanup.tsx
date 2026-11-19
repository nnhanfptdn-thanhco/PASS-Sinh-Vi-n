"use client";

import * as React from "react";

/**
 * XÓA DỮ LIỆU CỤC BỘ CŨ (WP-1.4)
 * Dọn sạch các khóa localStorage chứa tin đăng hoặc profile giả lập cũ
 */
export function LegacyStorageCleanup() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;

    try {
      // 1. Xóa khóa tin cá nhân cục bộ cũ
      localStorage.removeItem("cho_pass_my_listings");
      localStorage.removeItem("listing_draft"); // khóa cũ chưa gắn uid

      // 2. Xóa các khóa profile giả lập cũ
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("cho_pass_profile_") || key === "cho_pass_user_role")) {
          keysToRemove.push(key);
        }
      }

      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
    } catch {
      // Bỏ qua lỗi truy cập storage
    }
  }, []);

  return null;
}
