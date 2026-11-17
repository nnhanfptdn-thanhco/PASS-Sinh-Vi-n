"use client";

import * as React from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [isDark, setIsDark] = React.useState(false);
  const [palette, setPalette] = React.useState<"emerald" | "ocean">("emerald");

  React.useEffect(() => {
    // Check saved mode or system preference
    const savedTheme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialDark = savedTheme === "dark" || (!savedTheme && prefersDark);
    setIsDark(initialDark);
    if (initialDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    // Check saved palette
    const savedPalette = (localStorage.getItem("palette") as "emerald" | "ocean") || "emerald";
    setPalette(savedPalette);
    document.documentElement.setAttribute("data-theme", savedPalette);
  }, []);

  const toggleDarkMode = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const switchPalette = (newPalette: "emerald" | "ocean") => {
    setPalette(newPalette);
    document.documentElement.setAttribute("data-theme", newPalette);
    localStorage.setItem("palette", newPalette);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Nút đổi màu chủ đạo (Phương án A / B) */}
      <div className="flex items-center bg-surface border border-surface-border rounded-lg p-0.5 shadow-subtle">
        <button
          type="button"
          onClick={() => switchPalette("emerald")}
          title="Phương án A: Xanh Ngọc Sinh Viên (Emerald)"
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold transition-all ${
            palette === "emerald"
              ? "bg-emerald-600 text-white shadow-sm"
              : "text-text-secondary hover:text-text-main"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-300" />
          <span className="hidden sm:inline">Xanh Ngọc</span>
        </button>

        <button
          type="button"
          onClick={() => switchPalette("ocean")}
          title="Phương án B: Xanh Lam Trí Tuệ (Ocean)"
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold transition-all ${
            palette === "ocean"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-text-secondary hover:text-text-main"
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-blue-300" />
          <span className="hidden sm:inline">Xanh Lam</span>
        </button>
      </div>

      {/* Nút chuyển chế độ Sáng / Tối */}
      <button
        type="button"
        onClick={toggleDarkMode}
        aria-label={isDark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
        className="w-9 h-9 rounded-lg border border-surface-border bg-surface flex items-center justify-center text-text-secondary hover:text-text-main transition-colors shadow-subtle"
      >
        {isDark ? (
          <Sun className="w-4 h-4 text-amber-400" />
        ) : (
          <Moon className="w-4 h-4 text-slate-700" />
        )}
      </button>
    </div>
  );
}
