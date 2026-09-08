import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "dbk_theme";
const ThemeContext = createContext(null);

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage در iframeهای محدودشده در دسترس نیست
  }
  return "dark";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStored);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
    root.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ذخیره نشد؛ تم فقط تا پایان همین نشست می‌ماند
    }
    // اگر برنامه داخل پوستهٔ اندروید باز شده باشد، نوار وضعیت هم باید با تم
    // بخواند؛ وگرنه بالای صفحه یک نوار ناهماهنگ می‌ماند.
    try {
      window.KavoshShell?.postMessage(theme);
    } catch {
      // پوسته‌ای در کار نیست — نسخهٔ وب
    }
  }, [theme]);

  const setTheme = useCallback((next) => {
    if (next === "light" || next === "dark") setThemeState(next);
  }, []);

  const toggleTheme = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo(
    () => ({ theme, isDark: theme === "dark", setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme باید داخل ThemeProvider استفاده شود.");
  return ctx;
}
