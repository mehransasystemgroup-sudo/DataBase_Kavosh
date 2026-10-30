import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Filter, Hammer, Link2, Loader2, Plus, RotateCcw, ShieldCheck, SortAsc, Table2, Trash2, Wand2 } from "lucide-react";

import { http, errorMessage } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { sendToBuilder } from "@/lib/report/handoff";
import { lintReportSql } from "@/lib/report/lint";
import { AGGREGATES, emptyPlan, joinsFromSteps, OPS, planToSql, withMandatoryFilters } from "@/lib/report/plan";
import { Section, SqlBlock } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Check, checkFindings, describeTable, Field, FindingsList, smallInput, structuralCheck, TableSearch, useStoredState } from "./shared";

/*
  طراح بصری کوئری — همان «طرح کوئری» اپ گزارش‌ساز راهکاران، بی‌نیاز به مدل:
  جدول مبنا ← جدول‌های مرتبط (مسیر JOIN از گراف دانش) ← ستون‌ها و تجمیع ←
  فیلترها و پارامترها ← SQL که مستقیم به «ساخت گزارش» می‌رود.
*/

const STORE = "kavosh.rb.design.v1";
const AGG_LABEL = { "": "—", SUM: "جمع", COUNT: "تعداد", COUNT_DISTINCT: "تعداد یکتا", AVG: "میانگین", MIN: "کمینه", MAX: "بیشینه" };

function useDetails(tables) {
  const [details, setDetails] = useState({});
  const key = tables.join("|");
  useEffect(() => {
    let alive = true;
    Promise.all(tables.map(async (t) => [t, await describeTable(t)])).then((pairs) => {
      if (alive) setDetails(Object.fromEntries(pairs.filter(([, d]) => d)));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return details;
}

function ColumnSelect({ details, tables, value, onChange, className }) {
  return (
    <Select className={cn(smallInput, className)} value={value ? `${value.table}|${value.column}` : ""} onChange={(e) => {
      const [table, column] = e.target.value.split("|");
      onChange(e.target.value ? { table, column } : null);
    }}>
      <option value="">— ستون —</option>
      {tables.map((t) => (
        <optgroup key={t} label={`${details[t]?.title_fa || ""} ${t}`.trim()}>
          {(details[t]?.columns || []).filter((c) => !/^(timestamp|rowversion)$/i.test(c.type)).map((c) => (
            <option key={c.name} value={`${t}|${c.name}`}>{c.label_fa ? `${c.label_fa} — ` : ""}{c.name} ({c.type})</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export default function DesignTab({ onOpenTab }) {
  const [plan, setPlan] = useStoredState(STORE, emptyPlan());
  const [joining, setJoining] = useState(false);
  const [lint, setLint] = useState(null);
  const [checking, setChecking] = useState(false);
  const tables = useMemo(() => [plan.base, ...plan.joins.map((j) => j.table)].filter(Boolean), [plan.base, plan.joins]);
  const details = useDetails(tables);
  const result = useMemo(() => planToSql(plan), [plan]);
  const patch = (p) => setPlan((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));

  useEffect(() => setLint(null), [result.sql]);

  const setBase = (full) => {
    setPlan({ ...emptyPlan(full) });
  };

  const addTable = async (full) => {
    if (!plan.base) return setBase(full);
    if (tables.some((t) => t.toLowerCase() === full.toLowerCase())) {
      toast.message("این جدول از قبل در طرح هست.");
      return;
    }
    setJoining(true);
    try {
      // کوتاه‌ترین مسیر از هر جدول موجود؛ بهترین را برمی‌داریم
      const tries = await Promise.all(tables.map(async (src) => {
        try {
          const { data } = await http.get("/joinpath", { params: { source: src, target: full, maxHops: 3 } });
          return data.found ? data : null;
        } catch {
          return null;
        }
      }));
      const best = tries.filter(Boolean).sort((a, b) => a.steps.length - b.steps.length)[0];
      if (!best) {
        toast.error(`مسیری از جدول‌های طرح به ${full} در گراف دانش پیدا نشد.`);
        return;
      }
      setPlan((s) => joinsFromSteps(s, best.steps, "LEFT"));
      if (best.warning) toast.message(best.warning);
      else toast.success(`${full} با ${fa(best.steps.length)} پیوند اضافه شد.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setJoining(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      const [rules, structural] = await Promise.all([lintReportSql(result.sql, describeTable), structuralCheck(result.sql)]);
      setLint([...checkFindings(structural), ...rules.findings]);
    } finally {
      setChecking(false);
    }
  };

  const toBuilder = () => {
    if (!result.sql || !plan.columns.some((c) => c.column)) {
      toast.error("دست‌کم یک ستون انتخاب کنید.");
      return;
    }
    const title = details[plan.base]?.title_fa ? `گزارش ${details[plan.base].title_fa}` : "";
    sendToBuilder({ sql: result.sql, title, tables, source: "طراح کوئری" });
    onOpenTab("build");
  };

  const baseInfo = details[plan.base];

  return (
    <div className="space-y-3">
      <Section icon={Table2} title="جدول‌ها" hint="جدول مبنا را انتخاب کنید؛ هر جدول بعدی با مسیر JOIN گراف دانش وصل می‌شود." actions={plan.base && (
        <Button variant="ghost" size="xs" onClick={() => setPlan(emptyPlan())}><RotateCcw />طرح تازه</Button>
      )}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <TableSearch className="min-w-[16rem] flex-1" onPick={plan.base ? addTable : setBase} placeholder={plan.base ? "افزودن جدول مرتبط…" : "جدول مبنای گزارش (مثلاً سند حسابداری)…"} />
            {joining && <Loader2 className="h-4 w-4 animate-spin text-brand-text" />}
          </div>
          {plan.base && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand/35 bg-brand/8 px-3 py-2 text-[12px]">
                <span className="font-semibold text-foreground">مبنا:</span>
                <span className="text-foreground/90">{baseInfo?.title_fa || ""}</span>
                <span className="ltr font-mono text-[11px] text-brand-text">{plan.base}</span>
                {baseInfo && (
                  <Button variant="soft" size="xs" className="ms-auto" onClick={() => setPlan((s) => withMandatoryFilters(s, baseInfo.columns))} title="FiscalYearRef اجباری، BranchRef اختیاری، بازهٔ تاریخ نیم‌باز">
                    <ShieldCheck />فیلترهای اجباری گزارش مالی
                  </Button>
                )}
              </div>
              {plan.joins.map((j, i) => (
                <div key={`${j.table}-${i}`} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-ink/40 px-3 py-1.5 text-[11.5px]">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Select className={cn(smallInput, "w-28")} value={j.kind} onChange={(e) => patch((s) => ({ joins: s.joins.map((x, k) => (k === i ? { ...x, kind: e.target.value } : x)) }))}>
                    <option value="LEFT">LEFT JOIN</option>
                    <option value="INNER">INNER JOIN</option>
                  </Select>
                  <span className="text-foreground/90">{details[j.table]?.title_fa || ""}</span>
                  <span className="ltr font-mono text-[11px] text-brand-text">{j.table}</span>
                  <span className="ltr font-mono text-[10px] text-muted-foreground">ON {j.right.column} = {j.left.table.split(".").pop()}.{j.left.column}</span>
                  {!j.verified && <span className="text-[10px] text-warn">استنتاجی</span>}
                  <Button variant="ghost" size="icon-sm" className="ms-auto" title="حذف این جدول و ستون‌های وابسته" onClick={() => patch((s) => {
                    const drop = s.joins[i].table;
                    // جدول‌هایی که فقط از راه همین جدول وصل بودند هم می‌روند
                    const gone = new Set([drop.toLowerCase()]);
                    let changed = true;
                    while (changed) {
                      changed = false;
                      for (const x of s.joins) {
                        if (!gone.has(x.table.toLowerCase()) && gone.has(x.left.table.toLowerCase())) { gone.add(x.table.toLowerCase()); changed = true; }
                      }
                    }
                    const keep = (t) => !gone.has(String(t || s.base).toLowerCase());
                    return {
                      joins: s.joins.filter((x) => keep(x.table)),
                      columns: s.columns.filter((c) => keep(c.table)),
                      filters: s.filters.filter((f) => keep(f.table)),
                      orderBy: s.orderBy.filter((o) => keep(o.table)),
                    };
                  })}><Trash2 /></Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {plan.base && (
        <>
          <Section icon={ArrowLeftRight} title="ستون‌های خروجی" hint="عنوان فارسی، عنوان ستون گزارش می‌شود." actions={
            <Button variant="outline" size="xs" onClick={() => patch((s) => ({ columns: [...s.columns, { table: s.base, column: "", aggregate: "", alias: "", label: "" }] }))}><Plus />ستون</Button>
          }>
            {!plan.columns.length && <p className="text-[11.5px] text-muted-foreground">هنوز ستونی نیست. «ستون» را بزنید.</p>}
            <div className="space-y-1.5">
              {plan.columns.map((c, i) => (
                <div key={i} className="grid grid-cols-1 gap-1.5 rounded-md border border-border bg-ink/30 p-2 sm:grid-cols-[2fr_1fr_1fr_1.4fr_auto]">
                  <ColumnSelect details={details} tables={tables} value={c.column ? c : null} onChange={(v) => patch((s) => ({
                    columns: s.columns.map((x, k) => (k === i ? { ...x, ...(v || { column: "" }), label: x.label || details[v?.table]?.columns?.find((cc) => cc.name === v?.column)?.label_fa || "" } : x)),
                  }))} />
                  <Select className={smallInput} value={c.aggregate || ""} onChange={(e) => patch((s) => ({ columns: s.columns.map((x, k) => (k === i ? { ...x, aggregate: e.target.value } : x)) }))}>
                    {AGGREGATES.map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
                  </Select>
                  <Input className={smallInput} dir="ltr" placeholder="نام مستعار (لاتین)" value={c.alias || ""} onChange={(e) => patch((s) => ({ columns: s.columns.map((x, k) => (k === i ? { ...x, alias: e.target.value } : x)) }))} />
                  <Input className={smallInput} placeholder="عنوان فارسی" value={c.label || ""} onChange={(e) => patch((s) => ({ columns: s.columns.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) }))} />
                  <Button variant="ghost" size="icon-sm" title="حذف" onClick={() => patch((s) => ({ columns: s.columns.filter((_, k) => k !== i) }))}><Trash2 /></Button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              <Check checked={plan.distinct} onChange={(v) => patch({ distinct: v })}>DISTINCT</Check>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] text-foreground/90">
                TOP
                <Input className={cn(smallInput, "w-20")} dir="ltr" value={plan.top} onChange={(e) => patch({ top: e.target.value.replace(/\D/g, "") })} placeholder="همه" />
              </label>
            </div>
          </Section>

          <Section icon={Filter} title="فیلترها و پارامترها" hint="پارامتر یعنی کاربر هنگام اجرای گزارش مقدار می‌دهد." actions={
            <Button variant="outline" size="xs" onClick={() => patch((s) => ({ filters: [...s.filters, { table: s.base, column: "", op: "=", param: "", value: "", useValue: false }] }))}><Plus />فیلتر</Button>
          }>
            {!plan.filters.length && <p className="text-[11.5px] text-muted-foreground">بی‌فیلتر. اگر جدول FiscalYearRef دارد، «فیلترهای اجباری گزارش مالی» را بزنید.</p>}
            <div className="space-y-1.5">
              {plan.filters.map((f, i) => {
                const set = (p) => patch((s) => ({ filters: s.filters.map((x, k) => (k === i ? { ...x, ...p } : x)) }));
                const noValue = ["IS NULL", "IS NOT NULL"].includes(f.op);
                const paramOnly = ["RANGE", "OPTIONAL", "IN"].includes(f.op);
                return (
                  <div key={i} className="grid grid-cols-1 gap-1.5 rounded-md border border-border bg-ink/30 p-2 sm:grid-cols-[2fr_1.3fr_1.6fr_auto]">
                    <ColumnSelect details={details} tables={tables} value={f.column ? f : null} onChange={(v) => set({ ...(v || { column: "" }), param: f.param || v?.column || "" })} />
                    <Select className={smallInput} value={f.op} onChange={(e) => set({ op: e.target.value })}>
                      {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                    {noValue ? <span /> : (
                      <div className="flex items-center gap-1.5">
                        {!paramOnly && (
                          <Select className={cn(smallInput, "w-24 shrink-0")} value={f.useValue ? "value" : "param"} onChange={(e) => set({ useValue: e.target.value === "value" })}>
                            <option value="param">پارامتر</option>
                            <option value="value">مقدار ثابت</option>
                          </Select>
                        )}
                        {f.useValue && !paramOnly
                          ? <Input className={smallInput} dir="ltr" value={f.value ?? ""} onChange={(e) => set({ value: e.target.value })} placeholder="مقدار" />
                          : <Input className={smallInput} dir="ltr" value={f.param ?? ""} onChange={(e) => set({ param: e.target.value })} placeholder="نام پارامتر" />}
                      </div>
                    )}
                    <Button variant="ghost" size="icon-sm" title="حذف" onClick={() => patch((s) => ({ filters: s.filters.filter((_, k) => k !== i) }))}><Trash2 /></Button>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section icon={SortAsc} title="مرتب‌سازی" actions={
            <Button variant="outline" size="xs" onClick={() => patch((s) => ({ orderBy: [...s.orderBy, { table: s.base, column: "", dir: "ASC" }] }))}><Plus />مرتب‌سازی</Button>
          }>
            {!plan.orderBy.length && <p className="text-[11.5px] text-muted-foreground">بی‌ترتیب؛ گزارش هم می‌تواند خودش مرتب کند.</p>}
            <div className="space-y-1.5">
              {plan.orderBy.map((o, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-1.5">
                  <ColumnSelect details={details} tables={tables} value={o.column ? o : null} onChange={(v) => patch((s) => ({ orderBy: s.orderBy.map((x, k) => (k === i ? { ...x, ...(v || { column: "" }) } : x)) }))} />
                  <Select className={cn(smallInput, "w-28")} value={o.dir} onChange={(e) => patch((s) => ({ orderBy: s.orderBy.map((x, k) => (k === i ? { ...x, dir: e.target.value } : x)) }))}>
                    <option value="ASC">صعودی</option>
                    <option value="DESC">نزولی</option>
                  </Select>
                  <Button variant="ghost" size="icon-sm" title="حذف" onClick={() => patch((s) => ({ orderBy: s.orderBy.filter((_, k) => k !== i) }))}><Trash2 /></Button>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Wand2} title="کوئری ساخته‌شده" actions={
            <>
              <Button variant="outline" size="sm" onClick={check} disabled={checking}>{checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />}بازبینی</Button>
              <Button size="sm" onClick={toBuilder}><Hammer />ساخت گزارش از این کوئری</Button>
            </>
          }>
            <div className="space-y-2">
              {result.warnings.map((w) => <p key={w} className="rounded-md border border-warn/40 bg-warn/8 px-3 py-1.5 text-[11.5px] text-foreground/90">{w}</p>)}
              <SqlBlock sql={result.sql} title={`T-SQL — ${fa(result.params.length)} پارامتر`} />
              {lint && <FindingsList findings={lint} empty="کوئری از نظر ساختار و قواعد گزارش مالی ایرادی ندارد." />}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
