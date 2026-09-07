import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn, copyText } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

/** نشان کوچک وضعیت — تنها رنگ‌های معنایی تم را می‌گیرد. */
const TONES = {
  brand: "border-brand/35 bg-brand/12 text-brand-text",
  ok: "border-ok/35 bg-ok/12 text-ok",
  warn: "border-warn/40 bg-warn/12 text-warn",
  err: "border-err/40 bg-err/12 text-err",
  info: "border-info/35 bg-info/12 text-info",
  muted: "border-border bg-surfaceHover text-muted-foreground",
};

export function Badge({ tone = "muted", className, children, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium leading-4",
        TONES[tone] || TONES.muted,
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** کارت آمار — در شبکه‌ای که روی موبایل دوستونه و روی دسکتاپ چهارستونه است. */
export function Stat({ icon: Icon, label, value, hint, tone = "muted" }) {
  return (
    <div className="rounded-lg border border-border bg-ink p-2.5 transition-colors hover:border-borderStrong">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {Icon && (
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              tone === "brand" && "text-brand-text",
              tone === "ok" && "text-ok",
              tone === "warn" && "text-warn",
              tone === "err" && "text-err",
              tone === "muted" && "text-muted-foreground",
            )}
          />
        )}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate font-mono text-sm font-bold text-foreground" title={String(value)}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** دکمه‌ی کپی با بازخورد کوتاه — همه‌جای اپ از همین یکی استفاده می‌کند. */
export function CopyButton({ text, label = "کپی", copiedLabel = "کپی شد", message, className, icon = true }) {
  const [done, setDone] = useState(false);

  const run = useCallback(async () => {
    const ok = await copyText(text || "");
    if (!ok) {
      toast.error("کپی ناموفق بود — دسترسی کلیپ‌بورد مرورگر بسته است.");
      return;
    }
    setDone(true);
    toast.success(message || "در کلیپ‌بورد کپی شد.");
    setTimeout(() => setDone(false), 1600);
  }, [text, message]);

  return (
    <button
      type="button"
      onClick={run}
      title={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text",
        className,
      )}
    >
      {icon &&
        (done ? <Check className="h-3 w-3 text-ok" /> : <Copy className="h-3 w-3" />)}
      <span>{done ? copiedLabel : label}</span>
    </button>
  );
}

/** بلوک کد SQL — چپ‌چین، اسکرول افقی مستقل، همیشه قابل کپی. */
export function SqlBlock({ sql, title = "SQL", className, actions }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-ink", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-1.5">
        <span className="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          <CopyButton text={sql} message="کوئری در کلیپ‌بورد کپی شد." />
        </div>
      </div>
      <pre className="sql-block max-h-[26rem] overflow-auto p-3 text-[12px] leading-6 text-foreground/90">
        <code>{sql}</code>
      </pre>
    </div>
  );
}

/** حالت خالی — همیشه یک قدم بعدی پیشنهاد می‌دهد، نه فقط «چیزی نیست». */
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/50 px-5 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-brand-text">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}

/** بخش‌بندی محتوا با عنوان و اکشن سمت مقابل. */
export function Section({ icon: Icon, title, hint, actions, className, children, bodyClassName }) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-ink/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-brand-text" />}
          <h3 className="truncate text-xs font-bold text-foreground">{title}</h3>
          {hint && (
            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">
              {hint}
            </span>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </header>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** نوار بارگذاری نامعین — به‌جای اسپینر وسط صفحه، بالای ناحیه‌ی در حال تغییر. */
export function LoadingBar({ show }) {
  if (!show) return null;
  return (
    <div className="h-0.5 w-full overflow-hidden bg-transparent">
      <div className="h-full w-1/3 animate-indeterminate rounded-full bg-brand" />
    </div>
  );
}
