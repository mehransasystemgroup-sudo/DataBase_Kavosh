import { useEffect, useMemo, useState } from "react";

import { useTheme } from "@/context/ThemeContext";

/*
  D3 رنگ‌ها را مستقیم روی خصیصه‌های SVG می‌نویسد، پس کلاس‌های Tailwind به آن
  نمی‌رسد. برای این‌که گراف هم دقیقاً با تم اپ عوض شود، همان متغیرهای CSS را
  از ریشه‌ی سند می‌خوانیم — یعنی هنوز یک منبع حقیقت برای رنگ داریم.
*/

const TOKENS = {
  bg: "--bg",
  surface: "--surface",
  surfaceHover: "--surface-hover",
  ink: "--ink",
  border: "--border",
  borderStrong: "--border-strong",
  fg: "--fg",
  mutedFg: "--muted-fg",
  brand: "--brand",
  brandText: "--brand-text",
  ok: "--ok",
  warn: "--warn",
  err: "--err",
  info: "--info",
};

function readTokens() {
  if (typeof window === "undefined") return {};
  const style = getComputedStyle(document.documentElement);
  const out = {};
  for (const [name, variable] of Object.entries(TOKENS)) {
    const raw = style.getPropertyValue(variable).trim();
    out[name] = raw ? `rgb(${raw})` : "";
    out[`${name}Rgb`] = raw;
  }
  return out;
}

/** رنگ با شفافیت دلخواه از یک توکن: `alpha(t.brandRgb, 0.2)` */
export function alpha(rgbTriplet, a) {
  return rgbTriplet ? `rgb(${rgbTriplet} / ${a})` : "transparent";
}

/**
 * پالت گراف برای تم فعال.
 *
 * با هر تعویض تم دوباره خوانده می‌شود تا رنگ‌های SVG هم‌زمان با بقیه‌ی اپ
 * به‌روز شوند (فقط پس از اعمال کلاس روی <html>، به کمک یک فریم تأخیر).
 */
export function useGraphTheme() {
  const { theme, isDark } = useTheme();
  const [tokens, setTokens] = useState(readTokens);

  useEffect(() => {
    const id = requestAnimationFrame(() => setTokens(readTokens()));
    return () => cancelAnimationFrame(id);
  }, [theme]);

  return useMemo(
    () => ({
      ...tokens,
      isDark,
      theme,
      // مشتقات پرکاربرد
      link: alpha(tokens.borderStrongRgb, isDark ? 0.85 : 1),
      linkVerified: alpha(tokens.brandRgb, isDark ? 0.75 : 0.85),
      linkWeak: alpha(tokens.warnRgb, isDark ? 0.6 : 0.8),
      halo: alpha(tokens.brandRgb, isDark ? 0.22 : 0.16),
      dim: isDark ? 0.14 : 0.2,
      labelShadow: isDark ? "rgb(0 0 0 / 0.85)" : "rgb(255 255 255 / 0.9)",
    }),
    [tokens, isDark, theme],
  );
}
