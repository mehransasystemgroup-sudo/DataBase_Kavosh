import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** اعداد را با ارقام فارسی و جداکنندهٔ هزارگان نشان می‌دهد. */
export function fa(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fa-IR");
}

/** خلاصه‌سازی اعداد بزرگ برای نشان‌ها: ۱٬۲۴۰٬۰۰۰ → ۱.۲ م */
export function faCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} م`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} ه`;
  return v.toLocaleString("fa-IR");
}

/**
 * رقم‌های لاتینِ داخل یک جملهٔ فارسی را فارسی می‌کند.
 *
 * برای متن‌هایی که سرور می‌سازد («۲۸ جدول نامزد پیدا شد»): آن‌جا شمارش است
 * نه نمایش، پس عدد لاتین می‌آید و کنار بقیهٔ رابط ناجور می‌نشیند. شناسه‌های
 * لاتین دست نمی‌خورند چون فقط رقم‌ها جایگزین می‌شوند.
 */
export function faText(text) {
  return String(text ?? "").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** نام کامل جدول را به اسکیما و نام می‌شکند. */
export function splitTable(fullName = "") {
  const [schema, ...rest] = String(fullName).split(".");
  return { schema, name: rest.join(".") || schema };
}

/** `FIN3.Voucher` → `[FIN3].[Voucher]` */
export function bracket(fullName = "") {
  return String(fullName)
    .split(".")
    .map((p) => `[${p}]`)
    .join(".");
}

/** کپی در کلیپ‌بورد با پشتیبانی از مرورگرهای بدون Clipboard API. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  }
}
