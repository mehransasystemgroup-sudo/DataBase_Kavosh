import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft, Hash, ListChecks, Search, Table2, X } from "lucide-react";

import { http } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { schemaAccent, schemaLabel } from "@/lib/schemaTheme";
import { useTheme } from "@/context/ThemeContext";
import { Badge, EmptyState, LoadingBar, Shimmer } from "@/components/primitives";
import { ScrollArea } from "@/components/ui/scroll-area";

/*
  جدول‌های کد و شرحی — SYS3.Lookup و SYS3.LookupInfo.

  این‌ها فهرست‌های از پیش تعریف‌شده‌ای هستند که کاربر در فرم‌های نرم‌افزار از
  میانشان انتخاب می‌کند و امکان ورود دستی ندارند (مثلاً «مقطع تحصیلی» در فرم
  کارمند). چیزی که در پایگاه داده ذخیره می‌شود عددِ code است، پس بدون این
  فهرست، ستونی مثل EducationDegree در جدول کارمند فقط عددی بی‌معناست.

  چرا بخش جداست و زیر جدول‌ها نرفت: این‌ها جدولِ داده نیستند، فهرست مرجع‌اند.
  یک نوع ممکن است هیچ ستونی به آن ارجاع ندهد و باز هم معتبر باشد، و برعکس یک
  نوع در ده جدول مختلف استفاده شود. کاوش آن‌ها هم از سمت دیگری شروع می‌شود:
  کاربر معمولاً مقدارِ دیده‌شده در فرم («دیپلم») را به یاد دارد، نه نام نوع را.
*/

function TypeRow({ item, active, onOpen, index, isDark }) {
  const accent = schemaAccent(item.module || "", isDark);
  return (
    <button
      type="button"
      onClick={() => onOpen(item.type)}
      style={{ "--i": index }}
      aria-current={active ? "true" : undefined}
      className={cn(
        "anim-stagger block w-full rounded-lg border p-2.5 text-start transition-colors duration-150",
        active
          ? "border-brand/55 bg-brand/10"
          : "border-border/60 bg-surface/60 hover:border-brand/35 hover:bg-surfaceHover",
      )}
    >
      <div className="flex items-center gap-1.5">
        {item.module && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
            style={{ color: accent.text, background: accent.soft }}
            title={schemaLabel(item.module) || item.module}
          >
            {item.module}
          </span>
        )}
        <span className="ltr truncate font-mono text-[12.5px] font-semibold text-foreground">
          {item.type}
        </span>
        <span className="ms-auto shrink-0 text-[10.5px] text-muted-foreground">
          {item.n_values > 0 ? `${fa(item.n_values)} مقدار` : "بدون مقدار"}
        </span>
      </div>
      {item.title_fa && (
        <div className="mt-1 truncate text-[11.5px] text-muted-foreground">{item.title_fa}</div>
      )}
      {/*
        مقداری که باعث تطبیق شده. بدون این، جست‌وجو با «دیپلم» فهرستی از
        نام‌های لاتین برمی‌گرداند که هیچ‌کدام واژهٔ جست‌وجو را نشان نمی‌دهند
        و کاربر باید تک‌تک را باز کند تا بفهمد چرا آمده‌اند.
      */}
      {item.matched_value && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-brand-text">
          <CornerDownLeft className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.matched_value}</span>
        </div>
      )}
    </button>
  );
}

function ValueTable({ values }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[22rem] border-collapse text-start">
        <thead>
          <tr className="border-b border-border bg-ink/60 text-[11px] text-muted-foreground">
            <th className="w-20 px-3 py-2 text-start font-medium">کد</th>
            <th className="px-3 py-2 text-start font-medium">شرح</th>
          </tr>
        </thead>
        <tbody>
          {values.map((v, i) => (
            <tr
              key={`${v.code}-${v.value}`}
              className={cn(
                "border-b border-border/60 last:border-0 transition-colors hover:bg-surfaceHover",
                i % 2 === 1 && "bg-surface/40",
              )}
            >
              {/*
                کد همان چیزی است که واقعاً در ستون پایگاه داده نشسته، پس
                مونواسپیس و برجسته است — کاربر با همین عدد کوئری می‌نویسد.
              */}
              <td className="px-3 py-2 align-top font-mono text-[12.5px] font-semibold text-brand-text">
                {v.code ?? "—"}
              </td>
              <td className="px-3 py-2 align-top text-[12.5px] leading-relaxed text-foreground">
                {v.value}
                {v.extra && (
                  <span className="ms-2 text-[10.5px] text-muted-foreground">({v.extra})</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LookupView({ onSelectTable }) {
  const { isDark } = useTheme();
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [types, setTypes] = useState([]);
  const [modules, setModules] = useState([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    // تأخیر کوتاه تا هر حرفِ تایپ یک درخواست نسازد
    const t = setTimeout(() => {
      http
        .get("/lookups", { params: { q, module, limit: 400 } })
        .then(({ data }) => {
          if (cancelled) return;
          setTypes(data.types || []);
          if (data.modules?.length) setModules(data.modules);
        })
        .catch(() => !cancelled && setTypes([]))
        .finally(() => !cancelled && setBusy(false));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, module]);

  const open = useCallback((type) => {
    setSelected(type);
    setDetailBusy(true);
    http
      .get(`/lookup/${encodeURIComponent(type)}`)
      .then(({ data }) => setDetail(data))
      .catch(() => setDetail(null))
      .finally(() => setDetailBusy(false));
  }, []);

  // انتخاب خودکار اولین نتیجه — فقط روی نمایشگری که ستون جزئیات را نشان
  // می‌دهد. روی موبایل آن ستون تمام‌صفحه است، پس انتخاب خودکار یعنی پرتاب
  // کاربر به صفحه‌ای که نخواسته بود.
  //
  // شرط دوم برای وقتی است که کاربر جست‌وجو را عوض می‌کند: نوعِ انتخاب‌شده
  // ممکن است دیگر در نتایج نباشد و ستون جزئیات چیزی را نشان دهد که در فهرست
  // کنارش وجود ندارد.
  useEffect(() => {
    if (!types.length) return;
    if (selected && types.some((t) => t.type === selected)) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    open(types[0].type);
  }, [types, selected, open]);

  const accent = useMemo(
    () => schemaAccent(detail?.module || "", isDark),
    [detail?.module, isDark],
  );

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "w-full min-w-0 shrink-0 flex-col border-e border-border bg-surface/40 md:w-[340px] lg:w-[380px] xl:w-[420px]",
          selected ? "hidden md:flex" : "flex",
        )}
      >
        <div className="shrink-0 border-b border-border p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="نام نوع یا خودِ مقدار، مثلاً «دیپلم»…"
              aria-label="جست‌وجوی جدول‌های کد و شرحی"
              className="h-10 w-full rounded-md border border-border bg-ink pe-9 ps-8 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/60"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="پاک کردن جست‌وجو"
                className="absolute start-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {modules.length > 0 && (
            <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto pb-0.5">
              <button
                type="button"
                onClick={() => setModule("")}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  module === ""
                    ? "border-brand/55 bg-brand/12 text-brand-text"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                همه
              </button>
              {modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModule(module === m.id ? "" : m.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    module === m.id
                      ? "border-brand/55 bg-brand/12 text-brand-text"
                      : "border-border bg-surface text-muted-foreground hover:text-foreground",
                  )}
                  title={schemaLabel(m.id) || m.id}
                >
                  {m.id}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between px-0.5 text-[10.5px] text-muted-foreground">
            <span>{busy ? "در حال جست‌وجو…" : `${fa(types.length)} نوع`}</span>
            {q && !busy && types.length === 0 && <span>چیزی پیدا نشد</span>}
          </div>
        </div>

        <LoadingBar show={busy} />

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {busy && types.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <Shimmer key={i} className="h-14 w-full rounded-lg" />
                ))
              : types.map((t, i) => (
                  <TypeRow
                    key={t.type}
                    item={t}
                    index={i}
                    active={selected === t.type}
                    onOpen={open}
                    isDark={isDark}
                  />
                ))}

            {!busy && types.length === 0 && (
              <EmptyState
                icon={Search}
                title="نوعی با این عبارت پیدا نشد"
                description="نام لاتین نوع، عنوان فارسی‌اش یا یکی از مقادیرش را امتحان کنید."
                className="border-0 bg-transparent"
              />
            )}
          </div>
        </ScrollArea>
      </aside>

      <section
        className={cn(
          "min-w-0 flex-1 overflow-y-auto overscroll-contain",
          selected ? "block" : "hidden md:block",
        )}
      >
        <div className="mx-auto w-full max-w-[64rem] p-3 sm:p-4 lg:p-5">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setDetail(null);
            }}
            className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text md:hidden"
          >
            <ArrowRight className="h-4 w-4" />
            بازگشت به فهرست
          </button>
          {detailBusy && !detail ? (
            <div className="space-y-3">
              <Shimmer className="h-8 w-64 rounded" />
              <Shimmer className="h-56 w-full rounded-lg" />
            </div>
          ) : detail ? (
            <div className="anim-fade space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {detail.module && (
                    <span
                      className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                      style={{ color: accent.text, background: accent.soft }}
                    >
                      {detail.module}
                      {schemaLabel(detail.module) ? ` · ${schemaLabel(detail.module)}` : ""}
                    </span>
                  )}
                  <span className="ltr font-mono text-base font-bold text-foreground">
                    {detail.type}
                  </span>
                  {detail.is_dynamic ? <Badge tone="info">پویا</Badge> : null}
                </div>
                {detail.title_fa && (
                  <h2 className="mt-1.5 text-sm font-bold text-foreground">{detail.title_fa}</h2>
                )}
                <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-muted-foreground">
                  در فرم‌های نرم‌افزار، کاربر یکی از این مقادیر را انتخاب می‌کند و امکان ورود
                  دستی ندارد. آنچه در پایگاه داده ذخیره می‌شود، ستون «کد» است.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <div className="rounded-lg border border-border bg-ink px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ListChecks className="h-3.5 w-3.5 text-brand-text" /> مقدار
                  </div>
                  <div className="mt-0.5 font-mono text-lg font-bold leading-none text-foreground">
                    {fa(detail.n_values)}
                  </div>
                </div>
                {detail.used_by?.length > 0 && (
                  <div className="rounded-lg border border-border bg-ink px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Table2 className="h-3.5 w-3.5 text-brand-text" /> ستون هم‌نام
                    </div>
                    <div className="mt-0.5 font-mono text-lg font-bold leading-none text-foreground">
                      {fa(detail.used_by.length)}
                    </div>
                  </div>
                )}
              </div>

              {/*
                نوعِ بی‌مقدار جدول خالی نمی‌گیرد. خالی بودنش خبر است نه نقص، و
                اگر پویا باشد دلیلش را هم می‌دانیم: مقادیرش را خودِ مشتری در
                نرم‌افزار تعریف می‌کند و در این نصب چیزی تعریف نشده.
              */}
              {detail.values?.length ? (
                <ValueTable values={detail.values} />
              ) : (
                <div className="rounded-lg border border-warn/35 bg-warn/10 p-3 text-[11.5px] leading-relaxed text-warn">
                  {detail.is_dynamic
                    ? "این نوع پویاست: مقادیرش در خود نرم‌افزار تعریف می‌شوند و در این نصب هنوز چیزی تعریف نشده. نوع و عنوانش تعریف‌شده است، ولی فهرست مقادیری برایش وجود ندارد."
                    : "برای این نوع مقداری در پایگاه داده ثبت نشده است."}
                </div>
              )}

              {detail.used_by?.length > 0 && (
                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
                    <Hash className="h-3.5 w-3.5 text-brand-text" />
                    ستون‌هایی که نامشان به این نوع می‌خورد
                  </h3>
                  {/*
                    این‌ها بر پایهٔ هم‌نامی‌اند (Type، TypeRef، TypeID) نه رابطهٔ
                    اعلام‌شده در پایگاه داده — پس سرنخ‌اند، نه سند. صریح گفته
                    می‌شود تا کسی آن را قطعی نگیرد.
                  */}
                  <p className="mb-2 text-[10.5px] text-muted-foreground">
                    بر پایهٔ هم‌نامی است، نه رابطهٔ اعلام‌شده در پایگاه داده — به‌عنوان سرنخ
                    ببینیدش.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.used_by.map((u) => (
                      <button
                        key={`${u.table_ref}.${u.name}`}
                        type="button"
                        onClick={() => onSelectTable?.(u.table_ref)}
                        className="ltr rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text"
                      >
                        {u.table_ref}
                        <span className="text-brand-text">.{u.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[50dvh] items-center justify-center">
              <EmptyState
                icon={ListChecks}
                title="یک نوع را انتخاب کنید"
                description="مقادیر از پیش تعریف‌شده و کدِ ذخیره‌شدهٔ هر کدام این‌جا نمایش داده می‌شود."
                className="max-w-md"
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
