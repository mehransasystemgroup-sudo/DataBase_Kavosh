import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  THEMES,
  THEME_STORAGE_KEY,
  counterpart,
  normalizeTheme,
  themeById,
} from "@/lib/themes";

const ThemeContext = createContext(null);

function readStored() {
  try {
    return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // localStorage در iframeهای محدودشده در دسترس نیست
    return normalizeTheme(null);
  }
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(readStored);
  const theme = themeById(themeId);

  useEffect(() => {
    const root = document.documentElement;
    // کلاس روشن/تیره برای color-scheme و واریانت dark: تیلویند می‌ماند، و
    // data-theme پالت دقیق را می‌گوید. یعنی افزودن تم تازه هیچ کلاسی را
    // خراب نمی‌کند.
    root.classList.remove("light", "dark");
    root.classList.add(theme.mode);
    root.style.colorScheme = theme.mode;
    root.dataset.theme = theme.id;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    } catch {
      // ذخیره نشد؛ تم فقط تا پایان همین نشست می‌ماند
    }

    // نوار آدرس مرورگر و نوار وضعیت گوشی هم باید هم‌رنگ صفحه باشند، وگرنه
    // بالای برنامه یک نوار ناهماهنگ می‌ماند.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme.bg);

    // پوستهٔ اندروید: «حالت|رنگ». نسخه‌های قدیمیِ پوسته فقط «dark» را
    // می‌شناختند، پس حالت عمداً اول می‌آید و آن‌ها هم درست کار می‌کنند.
    try {
      window.KavoshShell?.postMessage(`${theme.mode}|${theme.bg}`);
    } catch {
      // پوسته‌ای در کار نیست — نسخهٔ وب
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (THEMES.some((t) => t.id === next)) setThemeId(next);
  }, []);

  // کلید خورشید/ماه کاربر را به جفتِ همین تم می‌برد، نه به تم دیگری: کسی که
  // روی «شبِ زمرد» است و روشنایی می‌خواهد، «روزِ زمرد» می‌گیرد نه نیلی.
  const toggleTheme = useCallback(() => setThemeId((id) => counterpart(id)), []);

  const value = useMemo(
    () => ({
      theme: theme.id,
      themes: THEMES,
      meta: theme,
      mode: theme.mode,
      isDark: theme.mode === "dark",
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme باید داخل ThemeProvider استفاده شود.");
  return ctx;
}
