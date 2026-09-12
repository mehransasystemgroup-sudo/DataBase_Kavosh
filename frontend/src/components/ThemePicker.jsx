import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";

import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

/*
  انتخاب تم.

  چرا کنار کلید خورشید/ماه و نه به‌جای آن: عوض‌کردن روشن/تیره کاری است که
  کاربر روزی چند بار می‌کند و باید یک کلیک بماند؛ عوض‌کردن خودِ پالت کاری
  است که شاید یک بار بکند. پس آن یکی دکمهٔ مستقیم ماند و این یکی زیر یک
  منوی جمع‌شونده رفت — و هر کدام دقیقاً به اندازهٔ بسامدش جا گرفت.

  هر گزینه سه نوار رنگ دارد: زمینه، رنگ هویت، و رنگ متنِ تأکیدی. یعنی
  کاربر پیش از انتخاب می‌بیند چه چیزی می‌گیرد، به‌جای آنکه از روی نام حدس
  بزند.
*/

function Swatch({ colors }) {
  return (
    <span className="flex h-7 w-7 shrink-0 overflow-hidden rounded-md border border-borderStrong/70">
      {colors.map((c) => (
        <span key={c} className="h-full flex-1" style={{ background: c }} />
      ))}
    </span>
  );
}

export default function ThemePicker({ className }) {
  const { theme, themes, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  // بستن با کلیک بیرون و با Escape — بدون این، منو روی لمس گوشی باز می‌ماند
  // و جلوی محتوا را می‌گیرد.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="انتخاب تم"
        title="انتخاب تم"
        className={cn(
          "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-2.5 text-muted-foreground transition-colors",
          "hover:border-brand/45 hover:bg-surfaceHover hover:text-brand-text",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          open && "border-brand/45 bg-surfaceHover text-brand-text",
        )}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="تم‌ها"
          className="anim-rise absolute end-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-panel"
        >
          <p className="px-2 pb-1 pt-1.5 text-[10.5px] text-muted-foreground">
            تم برنامه
          </p>
          {themes.map((t) => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start transition-colors",
                  active ? "bg-brand/12 text-brand-text" : "hover:bg-surfaceHover",
                )}
              >
                <Swatch colors={t.swatch} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                    {t.name}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {t.hint}
                  </span>
                </span>
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-brand-text",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
