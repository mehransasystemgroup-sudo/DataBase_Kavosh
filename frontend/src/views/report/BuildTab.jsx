import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Columns3,
  FileCode2,
  FileUp,
  Hammer,
  LayoutTemplate,
  ListChecks,
  Loader2,
  RotateCcw,
  ScanSearch,
  SlidersHorizontal,
  Table2,
} from "lucide-react";

import { errorMessage } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { analyzeSql, FIELD_KEEP, mergeByName, PARAM_KEEP, toBuildSpec } from "@/lib/report/analyze";
import { buildRdl, DEFAULT_PROFILE, HELPERS, NUMBER_FORMATS } from "@/lib/report/build";
import { CHECKLIST } from "@/lib/report/docs";
import { takeHandoff } from "@/lib/report/handoff";
import { saveReport } from "@/lib/report/library";
import { lintReportSql } from "@/lib/report/lint";
import { testHarness } from "@/lib/report/patterns";
import { validateRdl } from "@/lib/report/rdl";
import { PAGE_SIZES } from "@/lib/report/units";
import { Section, SqlBlock } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  Check,
  checkFindings,
  describeTable,
  Field,
  FileActions,
  fileName,
  FindingsList,
  PROFILE_STORE,
  readStore,
  readTextFile,
  smallInput,
  structuralCheck,
  useStoredState,
} from "./shared";

/*
  ساخت گزارش — از کوئری تا فایل RDL که Report Builder باز می‌کند.

  پنج گام، همه روی یک صفحه تا کاربر همیشه ببیند هر انتخاب به کجا می‌رسد:
    ۱) کوئری و بازبینی گزارش‌محور (سال مالی، شعبه، State، تاریخ …)
    ۲) ستون‌ها: عنوان فارسی، نمایش، جمع، قالب، عرض، ترتیب
    ۳) پارامترها: عنوان، نوع، اختیاری/چندمقداری، لیست کشویی استاندارد
    ۴) چیدمان (ساده / گروه‌بندی / ماتریس) و پروفایل سازمانی
    ۵) ساخت، اعتبارسنجی، دانلود RDL و فایل آزمون SSMS، ذخیره در کتابخانه
*/

const STORE = "kavosh.rb.build.v1";

const EMPTY = {
  title: "",
  sql: "",
  libraryId: "",
  analyzed: false,
  body: "",
  tables: [],
  notes: [],
  fields: [],
  params: [],
  layout: { kind: "table", groups: [], grandTotal: true, rowNumber: true, stripes: true, repeatTitle: false, showFilters: true, sortField: "", matrix: { row: "", column: "", value: "", aggregate: "Sum" } },
  profile: {},
};

const LAYOUTS = [
  { id: "table", label: "جدول ساده" },
  { id: "group", label: "گروه‌بندی‌شده" },
  { id: "matrix", label: "ماتریس (پیوت)" },
];

const TYPE_TONE = (t) => (/int|decimal|numeric|money|float|real/i.test(t) ? "text-info" : /date|time/i.test(t) ? "text-warn" : "text-muted-foreground");

function StepTitle({ n, children }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[10.5px] font-bold text-brand-text">{fa(n)}</span>
      {children}
    </span>
  );
}

/** چک‌لیست تحویل با ارزیابی خودکار هرجا ممکن است. */
function Checklist({ verdict, lint, state }) {
  const auto = useMemo(() => {
    if (!verdict) return {};
    const codes = new Set(verdict.findings.map((f) => f.severity !== "info" && f.code));
    const lintCodes = new Set((lint || []).filter((f) => f.severity !== "info").map((f) => f.code));
    return {
      rdl: verdict.stats.errors === 0,
      fields: !codes.has("field_not_in_select") && !codes.has("duplicate_field"),
      params: !codes.has("missing_query_param") && !codes.has("unknown_param"),
      width: !codes.has("body_overflow") && !codes.has("page_overflow") && !codes.has("tablix_width"),
      fiscal: !lintCodes.has("fiscal_year") && !lintCodes.has("branch"),
      state: !lintCodes.has("state"),
      dates: !lintCodes.has("between_date"),
      header: !codes.has("page_header") && !codes.has("page_footer"),
      sys: Boolean(state.profile?.sysParams ?? DEFAULT_PROFILE.sysParams),
    };
  }, [verdict, lint, state.profile]);
  const [manual, setManual] = useStoredState("kavosh.rb.checklist.v1", {});
  return (
    <ul className="space-y-1">
      {CHECKLIST.map((c) => {
        const a = c.auto ? auto[c.auto] : undefined;
        const done = a ?? Boolean(manual[c.id]);
        return (
          <li key={c.id} className="flex items-start gap-2 text-[11.5px] leading-relaxed">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]"
              checked={done}
              disabled={a !== undefined}
              onChange={(e) => setManual({ ...manual, [c.id]: e.target.checked })}
            />
            <span className={cn(done ? "text-foreground/90" : "text-muted-foreground")}>
              {c.text}
              {a !== undefined && <span className={cn("ms-1.5 text-[10px]", a ? "text-ok" : "text-err")}>({a ? "بررسی خودکار: درست" : "بررسی خودکار: ایراد دارد"})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function BuildTab({ onOpenTab }) {
  const [state, setState] = useStoredState(STORE, EMPTY);
  const [busy, setBusy] = useState(false);
  const [lint, setLint] = useState(null);
  const [output, setOutput] = useState(null); // { rdl, warnings, verdict, harness }
  const [saving, setSaving] = useState(false);
  const orgProfile = readStore(PROFILE_STORE, null);
  const profile = useMemo(() => ({ ...DEFAULT_PROFILE, ...(orgProfile?.profile || {}), ...(state.profile || {}) }), [orgProfile, state.profile]);

  // کوئریِ ویرایش‌شده پس از تحلیل: ستون‌ها و پارامترها دیگر با آن نمی‌خوانند
  const stale = Boolean(state.analyzed && state.sql !== (state.analyzedSql ?? state.sql));
  const patch = useCallback((p) => setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })), [setState]);
  const patchLayout = (p) => patch((s) => ({ layout: { ...s.layout, ...p } }));
  const patchProfile = (p) => patch((s) => ({ profile: { ...(s.profile || {}), ...p } }));

  const analyze = useCallback(async (sqlText = state.sql, base = state) => {
    if (!String(sqlText || "").trim()) {
      toast.error("ابتدا کوئری را وارد کنید.");
      return;
    }
    setBusy(true);
    setOutput(null);
    try {
      const pre = analyzeSql(sqlText);
      const details = new Map();
      await Promise.all(pre.tables.map(async (t) => {
        const d = await describeTable(t);
        if (d) details.set(t.toLowerCase(), d);
      }));
      const a = analyzeSql(sqlText, details);
      const [rules, check] = await Promise.all([lintReportSql(a.body, describeTable), structuralCheck(a.body)]);
      setLint([...checkFindings(check), ...rules.findings]);
      const fields = mergeByName(a.fields, base.analyzed ? base.fields : [], FIELD_KEEP);
      const params = mergeByName(a.params, base.analyzed ? base.params : [], PARAM_KEEP);
      const names = new Set(fields.map((f) => f.name));
      const layout = { ...EMPTY.layout, ...base.layout };
      layout.groups = (layout.groups || []).filter((g) => names.has(g.field));
      if (layout.sortField && !names.has(layout.sortField)) layout.sortField = "";
      setState((s) => ({ ...s, sql: sqlText, analyzedSql: sqlText, analyzed: true, body: a.body, tables: a.tables, notes: a.notes, fields, params, layout }));
      if (!fields.length) toast.error("هیچ ستون خروجی پیدا نشد؛ کوئری باید با SELECT نهایی تمام شود.");
    } catch (e) {
      toast.error(errorMessage(e, "تحلیل کوئری ناموفق بود."));
    } finally {
      setBusy(false);
    }
  }, [state, setState]);

  // کوئری تحویل‌شده از دستیار، طراح کوئری یا کتابخانه
  useEffect(() => {
    const h = takeHandoff();
    if (!h?.sql) return;
    const base = h.spec ? { ...EMPTY, ...h.spec } : { ...EMPTY };
    const next = { ...base, title: h.title || base.title || "", sql: h.sql, libraryId: h.libraryId || "", analyzed: Boolean(h.spec?.analyzed) };
    setState(next);
    setLint(null);
    setOutput(null);
    toast.success(h.source ? `کوئری از «${h.source}» آمد؛ در حال تحلیل…` : "کوئری دریافت شد؛ در حال تحلیل…");
    analyze(h.sql, next);
    // فقط یک‌بار هنگام باز شدن
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (i, p) => patch((s) => ({ fields: s.fields.map((f, k) => (k === i ? { ...f, ...p } : f)) }));
  const moveField = (i, d) => patch((s) => {
    const f = [...s.fields];
    const j = i + d;
    if (j < 0 || j >= f.length) return {};
    [f[i], f[j]] = [f[j], f[i]];
    return { fields: f };
  });
  const setParam = (i, p) => patch((s) => ({ params: s.params.map((x, k) => (k === i ? { ...x, ...p } : x)) }));

  const build = () => {
    if (stale) {
      toast.error("کوئری پس از تحلیل تغییر کرده؛ ابتدا دوباره تحلیل کنید.");
      return;
    }
    try {
      const spec = toBuildSpec({ title: state.title || "گزارش", body: state.body, fields: state.fields, params: state.params, layout: state.layout, profile });
      const res = buildRdl(spec);
      const verdict = validateRdl(res.rdl);
      const types = Object.fromEntries(state.params.map((p) => [p.name, p.sqlType]));
      const harness = testHarness(state.sql, { title: state.title, types });
      setOutput({ ...res, verdict, harness });
      if (verdict.stats.errors) toast.error("گزارش ساخته شد ولی اعتبارسنج خطا یافت؛ یافته‌ها را ببینید.");
      else toast.success("گزارش ساخته و اعتبارسنجی شد.");
    } catch (e) {
      setOutput(null);
      toast.error(e.message || "ساخت گزارش ناموفق بود.");
    }
  };

  const save = async () => {
    if (stale) {
      toast.error("کوئری پس از تحلیل تغییر کرده؛ ابتدا دوباره تحلیل کنید تا کوئری و گزارش ذخیره‌شده با هم بخوانند.");
      return;
    }
    if (!state.title.trim()) {
      toast.error("برای ذخیره، عنوان گزارش را بنویسید.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveReport({
        id: state.libraryId || undefined,
        title: state.title.trim(),
        sql: state.sql,
        rdl: output?.rdl || undefined,
        tables: state.tables,
        parameters: state.params.map((p) => p.name),
        spec: { fields: state.fields, params: state.params, layout: state.layout, profile: state.profile, analyzed: true, body: state.body, tables: state.tables },
      });
      patch({ libraryId: saved.id });
      toast.success(state.libraryId ? "نسخهٔ کتابخانه به‌روز شد." : "در کتابخانه ذخیره شد.");
    } catch (e) {
      toast.error(errorMessage(e, "ذخیره ناموفق بود."));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setState(EMPTY);
    setLint(null);
    setOutput(null);
  };

  const fieldsByName = state.fields;
  const visibleWidth = state.fields.filter((f) => f.visible !== false && !(state.layout.kind === "group" && state.layout.groups.some((g) => g.field === f.name))).reduce((a, f) => a + (Number(f.width) || 0), 0) + (state.layout.rowNumber ? 1 : 0);
  const page = PAGE_SIZES[profile.page] || PAGE_SIZES.landscape_a4;
  const printable = page.width - 2 * profile.margin;

  return (
    <div className="space-y-3">
      {/* ۱) کوئری */}
      <Section
        icon={FileCode2}
        title={<StepTitle n={1}>کوئری گزارش</StepTitle>}
        hint="SELECT نهایی، فیلدهای گزارش را می‌سازد؛ DECLAREهای آغازین فقط برای آزمون‌اند و از CommandText حذف می‌شوند."
        actions={
          <>
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text">
              <FileUp className="h-3 w-3" />
              بارگذاری <bdi dir="ltr">.sql</bdi>
              <input
                type="file"
                accept=".sql,.txt,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  const text = await readTextFile(f);
                  setOutput(null);
                  patch({ sql: text, title: state.title || f.name.replace(/\.[^.]+$/, "") });
                }}
              />
            </label>
            <Button variant="ghost" size="xs" onClick={reset} title="شروع گزارش تازه">
              <RotateCcw />
              گزارش تازه
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="عنوان گزارش">
            <Input value={state.title} onChange={(e) => patch({ title: e.target.value })} placeholder="مثلاً: گزارش ماندهٔ حساب‌ها به تفکیک شعبه" />
          </Field>
          <Field label="کوئری (T-SQL)">
            <Textarea
              dir="ltr"
              value={state.sql}
              onChange={(e) => {
                // خروجیِ ساخته‌شده از کوئری قبلی دیگر معتبر نیست
                if (output) setOutput(null);
                patch({ sql: e.target.value });
              }}
              placeholder={"SELECT v.[Number] AS VoucherNumber, -- شماره سند\n       v.[Date] AS VoucherDate -- تاریخ\nFROM FIN3.Voucher AS v\nWHERE v.[FiscalYearRef] = @FiscalYearRef"}
              className="min-h-[180px] font-mono text-[12px] leading-6"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => analyze()} disabled={busy || !state.sql.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              تحلیل و بازبینی کوئری
            </Button>
            <span className="text-[11px] text-muted-foreground">
              کوئری ندارید؟ از{" "}
              <button type="button" className="text-brand-text underline-offset-2 hover:underline" onClick={() => onOpenTab("design")}>طراح کوئری</button>
              {" "}یا{" "}
              <button type="button" className="text-brand-text underline-offset-2 hover:underline" onClick={() => onOpenTab("patterns")}>الگوها</button>
              {" "}شروع کنید.
            </span>
          </div>
          {stale && (
            <p className="rounded-md border border-warn/40 bg-warn/8 px-3 py-1.5 text-[11.5px] text-warn">
              کوئری پس از آخرین تحلیل تغییر کرده؛ پیش از ساخت گزارش دوباره «تحلیل و بازبینی» را بزنید (تنظیم ستون‌ها و پارامترها حفظ می‌شود).
            </p>
          )}
          {state.notes?.length > 0 && (
            <ul className="space-y-1">
              {state.notes.map((n) => (
                <li key={n} className="rounded-md border border-warn/40 bg-warn/8 px-3 py-1.5 text-[11.5px] text-foreground/90">{n}</li>
              ))}
            </ul>
          )}
          {lint && (
            <div className="space-y-1.5">
              <p className="text-[11.5px] font-semibold text-foreground">بازبینی ساختاری و گزارش‌محور</p>
              <FindingsList findings={lint} empty="کوئری از نظر ساختار و قواعد گزارش مالی ایرادی ندارد." />
            </div>
          )}
        </div>
      </Section>

      {state.analyzed && state.fields.length > 0 && (
        <>
          {/* ۲) ستون‌ها */}
          <Section icon={Columns3} title={<StepTitle n={2}>ستون‌ها</StepTitle>} hint={`${fa(state.fields.length)} فیلد · عرض ستون‌های نمایشی ${fa(visibleWidth.toFixed(1))} از ${fa(printable.toFixed(1))} سانتی‌متر`} bodyClassName="p-0">
            {visibleWidth > printable + 0.01 && state.layout.kind !== "matrix" && (
              <p className="border-b border-border bg-warn/8 px-3 py-1.5 text-[11px] text-warn">
                جمع عرض ستون‌ها از عرض قابل چاپ {page.label} بیشتر است؛ در PDF صفحهٔ اضافه می‌سازد. ستونی را پنهان یا باریک کنید یا صفحهٔ بزرگ‌تر بگیرید.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[11.5px]">
                <thead className="bg-ink/60 text-[10.5px] text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-start font-medium">نمایش</th>
                    <th className="px-2 py-1.5 text-start font-medium">فیلد</th>
                    <th className="px-2 py-1.5 text-start font-medium">عنوان ستون</th>
                    <th className="px-2 py-1.5 text-start font-medium">جمع</th>
                    <th className="px-2 py-1.5 text-start font-medium">قالب عدد</th>
                    <th className="px-2 py-1.5 text-start font-medium">عرض (cm)</th>
                    <th className="px-2 py-1.5 text-start font-medium">ترتیب</th>
                  </tr>
                </thead>
                <tbody>
                  {state.fields.map((f, i) => (
                    <tr key={f.name} className={cn("border-t border-border/70", f.visible === false && "opacity-55")}>
                      <td className="px-2 py-1"><Check checked={f.visible !== false} onChange={(v) => setField(i, { visible: v })} /></td>
                      <td className="px-2 py-1">
                        <div className="ltr text-start font-mono text-[11px] text-foreground">{f.name}</div>
                        <div className={cn("ltr text-start font-mono text-[10px]", TYPE_TONE(f.sqlType))}>{f.sqlType}{f.aggregate ? ` · ${f.aggregate}` : ""}</div>
                      </td>
                      <td className="px-2 py-1"><Input className={smallInput} value={f.label} onChange={(e) => setField(i, { label: e.target.value })} /></td>
                      <td className="px-2 py-1"><Check checked={f.total} onChange={(v) => setField(i, { total: v })} /></td>
                      <td className="px-2 py-1">
                        <Select className={cn(smallInput, "min-w-36")} value={f.format || ""} onChange={(e) => setField(i, { format: e.target.value })}>
                          {!NUMBER_FORMATS.some((n) => n.value === (f.format || "")) && <option value={f.format}>{f.format}</option>}
                          {NUMBER_FORMATS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Input className={cn(smallInput, "w-20")} type="number" min="0.5" max="20" step="0.1" value={f.width} onChange={(e) => setField(i, { width: Math.max(0.5, Math.min(20, Number(e.target.value) || 0.5)) })} />
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex gap-0.5">
                          <Button variant="ghost" size="icon-sm" onClick={() => moveField(i, -1)} disabled={i === 0} title="بالا (راست‌تر در گزارش)"><ArrowUp /></Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => moveField(i, 1)} disabled={i === state.fields.length - 1} title="پایین (چپ‌تر در گزارش)"><ArrowDown /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ۳) پارامترها */}
          <Section icon={SlidersHorizontal} title={<StepTitle n={3}>پارامترها</StepTitle>} hint={state.params.length ? `${fa(state.params.length)} پارامتر از کوئری${profile.sysParams ? " + پارامترهای سیستمی Sys_* (پنهان)" : ""}` : "کوئری پارامتری ندارد"}>
            {!state.params.length ? (
              <p className="text-[11.5px] text-muted-foreground">کوئری پارامتر @ ندارد. اگر جدول مبنا FiscalYearRef دارد، بی‌پارامتر سال مالی عدد گزارش غلط است.</p>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                {state.params.map((p, i) => (
                  <div key={p.name} className="space-y-2 rounded-md border border-border bg-ink/40 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="ltr font-mono text-[12px] font-semibold text-brand-text">@{p.name}</span>
                      <span className="ltr font-mono text-[10px] text-muted-foreground">{p.sqlType || "نوع نامعلوم"}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="عنوان برای کاربر"><Input className={smallInput} value={p.prompt} onChange={(e) => setParam(i, { prompt: e.target.value })} /></Field>
                      <Field label="نوع">
                        <Select className={smallInput} value={p.dataType} onChange={(e) => setParam(i, { dataType: e.target.value })}>
                          {["String", "Integer", "Float", "DateTime", "Boolean"].map((t) => <option key={t} value={t}>{t}</option>)}
                        </Select>
                      </Field>
                    </div>
                    <Field label="مقدار پیش‌فرض (اختیاری)">
                      <Input className={smallInput} dir="ltr" value={(p.defaults || [])[0] || ""} onChange={(e) => setParam(i, { defaults: e.target.value ? [e.target.value] : [] })} placeholder="خالی = کاربر وارد کند" />
                    </Field>
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                      <Check checked={p.nullable} onChange={(v) => setParam(i, { nullable: v })} title="کاربر می‌تواند خالی بگذارد (= همه)">اختیاری (خالی = همه)</Check>
                      <Check checked={p.multiValue} onChange={(v) => setParam(i, { multiValue: v })}>چندمقداری</Check>
                      <Check checked={p.hidden} onChange={(v) => setParam(i, { hidden: v })}>پنهان</Check>
                      {HELPERS[p.name] && (
                        <Check checked={p.useHelper} onChange={(v) => setParam(i, { useHelper: v })} title={HELPERS[p.name].dataSet.sql}>
                          لیست کشویی استاندارد ({HELPERS[p.name].prompt})
                        </Check>
                      )}
                    </div>
                    {p.nullable && !/IS\s+NULL/i.test(state.body) && (
                      <p className="text-[10.5px] text-warn">کوئری برای @{p.name} شرط «IS NULL» ندارد؛ مقدار خالی همهٔ ردیف‌ها را حذف می‌کند.</p>
                    )}
                    {p.dataType === "Integer" && /bigint/i.test(p.sqlType) && (
                      <p className="text-[10.5px] text-muted-foreground">Integer در RDL فقط ۳۲بیتی است؛ اگر شناسه‌ها از ۲٬۱۴۷٬۴۸۳٬۶۴۷ بزرگ‌ترند، String بگذارید.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ۴) چیدمان و پروفایل */}
          <Section icon={LayoutTemplate} title={<StepTitle n={4}>چیدمان و پروفایل</StepTitle>} hint={orgProfile ? `پروفایل سازمانی آموخته از «${orgProfile.source}»` : "پروفایل پیش‌فرض راهکاران — از زبانهٔ «تحلیل و اصلاح RDL» می‌شود از یک گزارش واقعی آموخت"}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-ink p-1">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => patchLayout({ kind: l.id })}
                      className={cn("min-h-9 flex-1 rounded-sm px-3 text-xs font-medium transition-colors sm:min-h-8", state.layout.kind === l.id ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-surfaceHover")}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>

                {state.layout.kind === "group" && (
                  <div className="space-y-2">
                    {[0, 1, 2].map((level) => {
                      const g = state.layout.groups[level];
                      if (level > state.layout.groups.length) return null;
                      return (
                        <div key={level} className="grid grid-cols-[1fr_auto] items-end gap-2">
                          <Field label={`گروه سطح ${fa(level + 1)}`}>
                            <Select
                              className={smallInput}
                              value={g?.field || ""}
                              onChange={(e) => {
                                const groups = [...state.layout.groups];
                                if (!e.target.value) groups.splice(level);
                                else groups[level] = { ...(groups[level] || {}), field: e.target.value };
                                patchLayout({ groups });
                              }}
                            >
                              <option value="">— بدون گروه —</option>
                              {fieldsByName.filter((f) => !state.layout.groups.some((x, k) => k !== level && x.field === f.name)).map((f) => (
                                <option key={f.name} value={f.name}>{f.label} ({f.name})</option>
                              ))}
                            </Select>
                          </Field>
                          {g && (
                            <Check checked={g.pageBreak} onChange={(v) => patchLayout({ groups: state.layout.groups.map((x, k) => (k === level ? { ...x, pageBreak: v } : x)) })}>
                              صفحهٔ جدا
                            </Check>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {state.layout.kind === "matrix" && (
                  <div className="grid grid-cols-2 gap-2">
                    {[["row", "سطر"], ["column", "ستون (پویا)"], ["value", "مقدار"]].map(([k, label]) => (
                      <Field key={k} label={label}>
                        <Select className={smallInput} value={state.layout.matrix?.[k] || ""} onChange={(e) => patchLayout({ matrix: { ...state.layout.matrix, [k]: e.target.value } })}>
                          <option value="">—</option>
                          {fieldsByName.map((f) => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
                        </Select>
                      </Field>
                    ))}
                    <Field label="تجمیع">
                      <Select className={smallInput} value={state.layout.matrix?.aggregate || "Sum"} onChange={(e) => patchLayout({ matrix: { ...state.layout.matrix, aggregate: e.target.value } })}>
                        {["Sum", "Count", "Avg", "Min", "Max"].map((a) => <option key={a} value={a}>{a}</option>)}
                      </Select>
                    </Field>
                  </div>
                )}

                {state.layout.kind !== "matrix" && (
                  <Field label="مرتب‌سازی ردیف‌های جزئیات">
                    <Select className={smallInput} value={state.layout.sortField || ""} onChange={(e) => patchLayout({ sortField: e.target.value })}>
                      <option value="">ترتیب خود کوئری (ORDER BY)</option>
                      {fieldsByName.map((f) => <option key={f.name} value={f.name}>{f.label} ({f.name})</option>)}
                    </Select>
                  </Field>
                )}

                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <Check checked={state.layout.grandTotal} onChange={(v) => patchLayout({ grandTotal: v })}>جمع کل</Check>
                  {state.layout.kind !== "matrix" && <Check checked={state.layout.rowNumber} onChange={(v) => patchLayout({ rowNumber: v })}>ستون ردیف</Check>}
                  {state.layout.kind !== "matrix" && <Check checked={state.layout.stripes} onChange={(v) => patchLayout({ stripes: v })}>ردیف‌های راه‌راه</Check>}
                  <Check checked={state.layout.showFilters} onChange={(v) => patchLayout({ showFilters: v })}>خلاصهٔ فیلترها زیر عنوان</Check>
                  {state.layout.kind !== "matrix" && (
                    <Check checked={state.layout.repeatTitle} onChange={(v) => patchLayout({ repeatTitle: v })} title="عنوان به‌صورت ردیف ثابت تکرارشوندهٔ Tablix — جایگزین PageHeader که میزبان نمی‌پذیرد">
                      تکرار عنوان در همهٔ صفحه‌ها
                    </Check>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 self-start">
                <Field label="اندازهٔ صفحه">
                  <Select className={smallInput} value={profile.page} onChange={(e) => patchProfile({ page: e.target.value })}>
                    {Object.entries(PAGE_SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </Select>
                </Field>
                <Field label="قلم">
                  <Input className={smallInput} value={profile.fontFamily} onChange={(e) => patchProfile({ fontFamily: e.target.value })} />
                </Field>
                <Field label="اندازهٔ قلم (pt)">
                  <Input className={smallInput} type="number" min="6" max="16" step="0.5" value={profile.fontSize} onChange={(e) => patchProfile({ fontSize: Math.max(6, Math.min(16, Number(e.target.value) || 9)) })} />
                </Field>
                <Field label="منبع داده">
                  <Select className={smallInput} value={profile.dataSource} onChange={(e) => patchProfile({ dataSource: e.target.value })}>
                    <option value="shared">مشترک (روی سرور گزارش)</option>
                    <option value="embedded">جاسازی‌شده (رشتهٔ اتصال)</option>
                  </Select>
                </Field>
                {profile.dataSource === "shared" ? (
                  <Field label="مسیر منبع دادهٔ مشترک" className="col-span-2">
                    <Input className={smallInput} dir="ltr" value={profile.dataSourceRef} onChange={(e) => patchProfile({ dataSourceRef: e.target.value })} />
                  </Field>
                ) : (
                  <Field label="رشتهٔ اتصال" className="col-span-2" hint="رمز عبور در فایل ننویسید؛ Integrated Security پیش‌فرض است.">
                    <Input className={smallInput} dir="ltr" value={profile.connectString} onChange={(e) => patchProfile({ connectString: e.target.value })} />
                  </Field>
                )}
                <div className="col-span-2 flex flex-wrap gap-x-4 gap-y-2 pt-1">
                  <Check checked={profile.sysParams} onChange={(v) => patchProfile({ sysParams: v })} title="Sys_CompanyID، Sys_UserID، Sys_CurrentCulture … — میزبان راهکاران این‌ها را می‌فرستد">پارامترهای سیستمی Sys_*</Check>
                  <Check checked={profile.utilFormat} onChange={(v) => patchProfile({ utilFormat: v })} title="Code.Util.Format از SG.ReportingUtilities — فقط روی سرور راهکاران اجرا می‌شود">قالب‌بندی سازمانی Code.Util</Check>
                </div>
                {Object.keys(state.profile || {}).length > 0 && (
                  <button type="button" className="col-span-2 text-start text-[11px] text-brand-text underline-offset-2 hover:underline" onClick={() => patch({ profile: {} })}>
                    برگشت به پروفایل {orgProfile ? "سازمانی" : "پیش‌فرض"}
                  </button>
                )}
              </div>
            </div>
          </Section>

          {/* ۵) ساخت */}
          <Section
            icon={Hammer}
            title={<StepTitle n={5}>ساخت، اعتبارسنجی و خروجی</StepTitle>}
            actions={
              <Button variant="outline" size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="animate-spin" /> : <BookmarkPlus />}
                {state.libraryId ? "به‌روزرسانی در کتابخانه" : "ذخیره در کتابخانه"}
              </Button>
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={build}>
                  <Hammer />
                  ساخت فایل RDL
                </Button>
                {lint?.some((f) => f.severity === "error") && (
                  <span className="text-[11px] text-err">بازبینی کوئری خطا دارد؛ گزارش ساخته می‌شود ولی عددش قابل اتکا نیست.</span>
                )}
              </div>

              {output && (
                <>
                  <div className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["خطا", output.verdict.stats.errors, output.verdict.stats.errors ? "text-err" : "text-ok"],
                      ["هشدار", output.verdict.stats.warnings, output.verdict.stats.warnings ? "text-warn" : "text-ok"],
                      ["Textbox", output.verdict.stats.textboxes, "text-foreground"],
                      ["عرض بدنه (cm)", Number(output.width.toFixed(2)), "text-foreground"],
                    ].map(([label, v, tone]) => (
                      <div key={label} className="rounded-md border border-border bg-ink/50 px-3 py-2">
                        <div className="text-[10.5px] text-muted-foreground">{label}</div>
                        <div className={cn("font-mono text-sm font-bold", tone)}>{fa(v)}</div>
                      </div>
                    ))}
                  </div>
                  {output.warnings.length > 0 && (
                    <ul className="space-y-1">
                      {output.warnings.map((w) => <li key={w} className="rounded-md border border-warn/40 bg-warn/8 px-3 py-1.5 text-[11.5px] text-foreground/90">{w}</li>)}
                    </ul>
                  )}
                  <FindingsList findings={output.verdict.findings} empty="اعتبارسنج RDL ایرادی نیافت: قانون سه‌گانهٔ Tablix، نام‌های یکتا، پارامترها و قراردادهای میزبان درست‌اند." />
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-brand/30 bg-brand/5 p-2.5">
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-foreground">فایل گزارش</p>
                      <FileActions text={output.rdl} name={fileName(state.title, "rdl")} mime="application/xml" copyLabel="کپی XML" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-foreground">فایل آزمون SSMS (با DECLARE)</p>
                      <FileActions text={output.harness} name={fileName(state.title, "sql")} mime="application/sql" copyLabel="کپی SQL" />
                    </div>
                  </div>
                  <details className="rounded-md border border-border bg-ink/30">
                    <summary className="cursor-pointer px-3 py-2 text-[11.5px] text-muted-foreground">پیش‌نمایش XML و فایل آزمون</summary>
                    <div className="space-y-2 p-2">
                      <SqlBlock sql={output.harness} title="فایل آزمون SSMS" />
                      <SqlBlock sql={output.rdl} title="RDL" />
                    </div>
                  </details>
                  <div className="space-y-1.5 rounded-md border border-border bg-ink/30 p-2.5">
                    <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground">
                      <ListChecks className="h-3.5 w-3.5 text-brand-text" />
                      چک‌لیست تحویل گزارش
                    </p>
                    <Checklist verdict={output.verdict} lint={lint} state={state} />
                  </div>
                  <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <Table2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    پیش از بارگذاری در راهکاران: فایل آزمون را در SSMS اجرا کنید، سپس RDL را در Report Builder باز و یک‌بار Run کنید. اگر Report Builder خطایی داد، متنش را در زبانهٔ «مرجع ← مترجم خطا» بچسبانید.
                  </p>
                </>
              )}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
