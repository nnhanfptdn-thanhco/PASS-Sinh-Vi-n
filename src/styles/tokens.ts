/**
 * DESIGN TOKENS - CHỢ PASS SINH VIÊN
 * Đáp ứng WCAG AA (Tương phản >= 4.5:1 với chữ thường, >= 3:1 với chữ lớn)
 * Hỗ trợ chế độ sáng/tối và chuyển đổi 2 phương án màu chủ đạo
 */

export const designTokens = {
  // 2 Phương án màu chủ đạo theo SPEC
  themes: {
    // Phương án A: Xanh Thông / Rừng Ngọc (Sinh viên, Bền vững, Đồ cũ tái sử dụng)
    emerald: {
      id: "emerald",
      name: "Xanh Ngọc Bền Vững (Emerald Pine)",
      description: "Tươi trẻ, dịu mắt, thể hiện tinh thần tái chế xanh và bền vững của sinh viên.",
      primary: {
        50: "#ECFDF5",
        100: "#D1FAE5",
        200: "#A7F3D0",
        300: "#6EE7B7",
        400: "#34D399",
        500: "#10B981",
        600: "#059669",
        700: "#047857",
        800: "#065F46",
        900: "#064E3B",
      },
      accent: "#059669",
    },
    // Phương án B: Xanh Đại Dương / Lam Trí Tuệ (Tri thức, Hiện đại, Công nghệ trẻ)
    ocean: {
      id: "ocean",
      name: "Xanh Lam Trí Tuệ (Ocean Indigo)",
      description: "Hiện đại, thanh niên, đáng tin cậy và chuyên nghiệp.",
      primary: {
        50: "#EFF6FF",
        100: "#DBEAFE",
        200: "#BFDBFE",
        300: "#93C5FD",
        400: "#60A5FA",
        500: "#3B82F6",
        600: "#2563EB",
        700: "#1D4ED8",
        800: "#1E40AF",
        900: "#1E3A8A",
      },
      accent: "#2563EB",
    },
  },

  // Màu nhấn ấm đặc quyền cho "Pass trong ngày" (Urgent Pass)
  urgent: {
    50: "#FFFBEB",
    100: "#FEF3C7",
    200: "#FDE68A",
    300: "#FCD34D",
    400: "#FBBF24",
    500: "#F59E0B", // Màu thẻ nhãn vàng/cam ấm nổi bật
    600: "#D97706",
    700: "#B45309",
    textLight: "#78350F", // WCAG AA trên nền vàng
    textDark: "#FEF3C7",
  },

  // Màu chứng thực "Đã xác minh sinh viên" (Verified Student Badge)
  verified: {
    50: "#F0FDF4",
    100: "#DCFCE7",
    500: "#22C55E",
    600: "#16A34A",
    700: "#15803D",
    textLight: "#14532D", // WCAG AA
    textDark: "#DCFCE7",
  },

  // Màu cảnh báo & Lỗi (Danger / Alert)
  danger: {
    50: "#FEF2F2",
    100: "#FEE2E2",
    500: "#EF4444",
    600: "#DC2626",
    700: "#B91C1C",
    textLight: "#7F1D1D", // WCAG AA
  },

  // Typography
  typography: {
    fontBody: "'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, sans-serif",
    fontHeading: "'Plus Jakarta Sans', 'Be Vietnam Pro', sans-serif",
  },

  // Border radius thân thiện, hiện đại
  radii: {
    sm: "0.375rem", // 6px
    md: "0.5rem",   // 8px
    lg: "0.75rem",  // 12px
    xl: "1rem",     // 16px
    full: "9999px",
  },

  // Kích thước tương tác tối thiểu cho Mobile (chuẩn công thái học)
  touchTargetMin: "44px",
};
