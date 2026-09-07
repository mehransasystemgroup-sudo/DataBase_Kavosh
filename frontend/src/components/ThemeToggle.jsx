import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

/**
 * تعویض تم روشن/تیره.
 *
 * دو آیکون روی هم سوار شده‌اند و با چرخش جا عوض می‌کنند؛ چیدمان دکمه ثابت
 * می‌ماند تا نوار بالایی هنگام تعویض تم نپرد.
 */
export default function ThemeToggle({ className, showLabel = false }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "تغییر به تم روشن" : "تغییر به تم تیره"}
      title={isDark ? "تم روشن" : "تم تیره"}
      className={cn(
        "group inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/45 hover:bg-surfaceHover hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        className,
      )}
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <Sun
          className={cn(
            "absolute h-4 w-4 transition-all duration-300",
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0",
          )}
        />
        <Moon
          className={cn(
            "absolute h-4 w-4 transition-all duration-300",
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
          )}
        />
      </span>
      {showLabel && <span>{isDark ? "روشن" : "تیره"}</span>}
    </button>
  );
}
