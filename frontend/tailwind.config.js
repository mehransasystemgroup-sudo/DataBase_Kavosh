import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      screens: {
        // گوشی‌های کوچک هم باید چیدمان دوستونه‌ی راحت داشته باشند
        xs: "420px",
      },
      fontFamily: {
        sans: ["Vazirmatn Variable", "Vazirmatn", "system-ui", "sans-serif"],
        // Vazirmatn پس از JetBrains: مونو گلیف فارسی ندارد و بی آن حروف فارسیِ داخل
        // برچسب‌های مونو به قلم مونوی سیستم می‌افتند و از هم جدا می‌شوند.
        mono: ["JetBrains Mono Variable", "JetBrains Mono", "Vazirmatn Variable", "Vazirmatn", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 2px)",
        md: "var(--radius)",
        lg: "calc(var(--radius) + 4px)",
        xl: "calc(var(--radius) + 8px)",
      },
      // هر رنگ از متغیر CSS می‌آید — تعویض تم فقط متغیرها را عوض می‌کند
      // و هیچ رنگ سخت‌کدشده‌ای در کامپوننت‌ها باقی نمی‌ماند.
      colors: {
        background: "rgb(var(--bg) / <alpha-value>)",
        foreground: "rgb(var(--fg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        surfaceHover: "rgb(var(--surface-hover) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        borderStrong: "rgb(var(--border-strong) / <alpha-value>)",
        input: "rgb(var(--border) / <alpha-value>)",
        ring: "rgb(var(--brand) / <alpha-value>)",
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          soft: "rgb(var(--brand-soft) / <alpha-value>)",
          text: "rgb(var(--brand-text) / <alpha-value>)",
          foreground: "rgb(var(--brand-fg) / <alpha-value>)",
        },
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        err: "rgb(var(--err) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        // نام‌های سازگار با shadcn/ui
        card: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          foreground: "rgb(var(--brand-fg) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--surface-hover) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--surface-hover) / <alpha-value>)",
          foreground: "rgb(var(--muted-fg) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--surface-hover) / <alpha-value>)",
          foreground: "rgb(var(--fg) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--err) / <alpha-value>)",
          foreground: "rgb(var(--on-err) / <alpha-value>)",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--brand) / 0.35), 0 8px 30px -12px rgb(var(--brand) / 0.45)",
        panel: "0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px -20px rgb(var(--shadow) / 0.55)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(-8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        indeterminate: {
          "0%": { transform: "translateX(110%) scaleX(0.4)" },
          "50%": { transform: "translateX(0%) scaleX(1)" },
          "100%": { transform: "translateX(-210%) scaleX(0.4)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.26s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in": "slide-in 0.22s ease-out both",
        indeterminate: "indeterminate 1.25s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
};
