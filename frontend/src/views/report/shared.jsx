import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Download, Info, Loader2, Search, X } from "lucide-react";

import { CAN_DOWNLOAD, http } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { CopyButton } from "@/components/primitives";
import { Input } from "@/components/ui/input";

/*
  قطعه‌های مشترک زبانه‌های گزارش‌ساز.
*/

/** پروفایل سازمانی آموخته از RDL (زبانهٔ تحلیل) که ساخت گزارش از آن پیروی می‌کند. */
export const PROFILE_STORE = "kavosh.rb.profile.v1";

// ── ذخیرهٔ محلی امن ──

export function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* حالت خصوصی یا فضای پر — کار ادامه می‌یابد، فقط ماندگار نمی‌شود */
  }
}

/** state ای که در localStorage می‌ماند (با تأخیر کوتاه تا تایپ کند نشود). */
export function useStoredState(key, initial) {
  const [value, setValue] = useState(() => readStore(key, typeof initial === "function" ? initial() : initial));
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => writeStore(key, value), 300);
    return () => clearTimeout(timer.current);
  }, [key, value]);
  return [value, setValue];
}

// ── فایل ──

export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** نام فایل امن از عنوان فارسی/لاتین. */
export function fileName(title, ext, fallback = "report") {
  const base = String(title || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").replace(/\s+/g, "-").slice(0, 80);
  return `${base || fallback}.${ext}`;
}

/** دکمهٔ دانلود (روی دسکتاپ) + کپی (همه‌جا). */
export function FileActions({ text, name, mime, label, copyLabel = "کپی", className }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {CAN_DOWNLOAD && (
        <button
          type="button"
          onClick={() => downloadText(name, text, mime)}
          disabled={!text}
          title={`ذخیره به‌صورت ${name}`}
          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2.5 text-[11px] font-medium text-brand-text transition-colors hover:bg-brand/20 disabled:opacity-50 sm:min-h-8"
        >
          <Download className="h-3 w-3" />
          {label || <span dir="ltr">{name}</span>}
        </button>
      )}
      <CopyButton text={text} label={copyLabel} />
    </div>
  );
}

/** بارگذاری فایل متنی (RDL، SQL) با تشخیص UTF-16 که Report Builder گاهی می‌نویسد. */
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  return new TextDecoder("utf-8").decode(buf).replace(/^﻿/, "");
}

// ── یافته‌ها ──

const SEVERITY = {
  error: { icon: AlertOctagon, tone: "border-err/40 bg-err/8", text: "text-err", label: "خطا" },
  warning: { icon: AlertTriangle, tone: "border-warn/40 bg-warn/8", text: "text-warn", label: "هشدار" },
  info: { icon: Info, tone: "border-info/35 bg-info/8", text: "text-info", label: "نکته" },
};

export function FindingsList({ findings = [], empty = "ایرادی پیدا نشد.", compact = false }) {
  const [showInfo, setShowInfo] = useState(false);
  const counts = useMemo(() => ({
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
  }), [findings]);
  const shown = findings.filter((f) => showInfo || f.severity !== "info");
  if (!findings.length) {
    return (
      <p className="flex items-center gap-1.5 rounded-md border border-ok/35 bg-ok/8 px-3 py-2 text-[11.5px] text-ok">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        {empty}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn(counts.error ? "font-semibold text-err" : "")}>{fa(counts.error)} خطا</span>
        <span>·</span>
        <span className={cn(counts.warning ? "font-semibold text-warn" : "")}>{fa(counts.warning)} هشدار</span>
        <span>·</span>
        <span>{fa(counts.info)} نکته</span>
        {counts.info > 0 && (
          <button type="button" onClick={() => setShowInfo((v) => !v)} className="text-brand-text underline-offset-2 hover:underline">
            {showInfo ? "پنهان کردن نکته‌ها" : "نمایش نکته‌ها"}
          </button>
        )}
      </div>
      {!counts.error && !counts.warning && !showInfo && (
        <p className="flex items-center gap-1.5 rounded-md border border-ok/35 bg-ok/8 px-3 py-2 text-[11.5px] text-ok">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {empty}
        </p>
      )}
      <ul className="space-y-1.5">
        {shown.map((f, i) => {
          const s = SEVERITY[f.severity] || SEVERITY.info;
          const Icon = s.icon;
          return (
            <li key={`${f.code}-${i}`} className={cn("rounded-md border px-3 py-2", s.tone)}>
              <p className={cn("flex items-start gap-1.5 text-[11.5px] font-semibold leading-relaxed", s.text)}>
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="text-foreground/90">{f.message}</span>
              </p>
              {!compact && f.hint && <p className="mt-1 ps-5 text-[11px] leading-relaxed text-muted-foreground">{f.hint}</p>}
              {!compact && f.where && <p className="ltr mt-0.5 ps-5 text-start font-mono text-[10px] text-muted-foreground/80">{f.where}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── داده ──

/** توضیح جدول از /table با حافظهٔ نهان مشترک (null برای جدول ناشناخته). */
const describeCache = new Map();
export function describeTable(full) {
  const key = String(full || "").toLowerCase();
  if (!key) return Promise.resolve(null);
  if (!describeCache.has(key)) {
    describeCache.set(key, http.get(`/table/${encodeURIComponent(full)}`).then((r) => r.data).catch(() => {
      describeCache.delete(key);
      return null;
    }));
  }
  return describeCache.get(key);
}

/** بازبینی ساختاری (همان بازبین دستیار). */
export async function structuralCheck(sql) {
  try {
    const { data } = await http.post("/assistant/check", { sql });
    return data;
  } catch {
    return null;
  }
}

/** یافته‌های بازبین ساختاری (هم‌شکل یافته‌های گزارش‌اند). */
export function checkFindings(check) {
  return (check?.findings || []).map((f) => ({ ...f, code: `schema:${f.code}` }));
}

// ── جست‌وجوی جدول ──

export function TableSearch({ onPick, placeholder = "جست‌وجوی جدول (نام فارسی یا لاتین)…", className, autoFocus }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    if (!q.trim()) {
      setHits([]);
      return undefined;
    }
    const id = ++request.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await http.get("/search", { params: { q: q.trim(), limit: 8 } });
        if (id === request.current) setHits(data.results || []);
      } catch {
        if (id === request.current) setHits([]);
      } finally {
        if (id === request.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const pick = useCallback((full) => {
    onPick(full);
    setQ("");
    setHits([]);
  }, [onPick]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) pick(hits[0].full_name);
          if (e.key === "Escape") setQ("");
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="ps-8 pe-8 text-[12.5px]"
      />
      {busy && <Loader2 className="absolute end-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {!busy && q && (
        <button type="button" onClick={() => setQ("")} className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" title="پاک کردن">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {hits.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-md border border-border bg-surface shadow-lg">
          {hits.map((h) => (
            <li key={h.full_name}>
              <button
                type="button"
                onClick={() => pick(h.full_name)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-[12px] transition-colors hover:bg-surfaceHover"
              >
                <span className="truncate text-foreground">{h.title_fa || "—"}</span>
                <span className="ltr shrink-0 font-mono text-[10.5px] text-brand-text">{h.full_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── قالب‌بندی فرم ──

export function Field({ label, hint, children, className }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[10.5px] leading-relaxed text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

export function Check({ checked, onChange, children, disabled, title }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-foreground/90", disabled && "cursor-not-allowed opacity-60")} title={title}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-[rgb(var(--brand))]"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

export const smallInput = "h-8 text-[12px]";
