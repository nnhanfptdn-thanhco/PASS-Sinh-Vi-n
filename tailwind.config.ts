import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--background) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          muted: "rgb(var(--surface-muted) / <alpha-value>)",
          border: "rgb(var(--surface-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          hover: "rgb(var(--primary-hover) / <alpha-value>)",
          light: "rgb(var(--primary-light) / <alpha-value>)",
          focus: "rgb(var(--primary-focus) / <alpha-value>)",
        },
        urgent: {
          bg: "rgb(var(--urgent-bg) / <alpha-value>)",
          text: "rgb(var(--urgent-text) / <alpha-value>)",
          border: "rgb(var(--urgent-border) / <alpha-value>)",
          solid: "rgb(var(--urgent-solid) / <alpha-value>)",
        },
        verified: {
          bg: "rgb(var(--verified-bg) / <alpha-value>)",
          text: "rgb(var(--verified-text) / <alpha-value>)",
          border: "rgb(var(--verified-border) / <alpha-value>)",
        },
        danger: {
          bg: "rgb(var(--danger-bg) / <alpha-value>)",
          text: "rgb(var(--danger-text) / <alpha-value>)",
          solid: "rgb(var(--danger-solid) / <alpha-value>)",
        },
        text: {
          main: "rgb(var(--text-main) / <alpha-value>)",
          secondary: "rgb(var(--text-secondary) / <alpha-value>)",
          muted: "rgb(var(--text-muted) / <alpha-value>)",
        },
      },
      fontFamily: {
        body: ["var(--font-vietnam)", "sans-serif"],
        heading: ["var(--font-jakarta)", "var(--font-vietnam)", "sans-serif"],
      },
      screens: {
        xs: "390px", // iPhone standard mobile-first breakpoint
      },
      boxShadow: {
        subtle: "0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
        card: "0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
        elevated: "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
      },
    },
  },
  plugins: [],
};
export default config;
