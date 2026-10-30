import { useEffect, useMemo, useState } from "react";
import { FileCode2, FlaskConical, Hammer, Loader2, Microscope, Puzzle, ScrollText, X } from "lucide-react";

import { fa } from "@/lib/utils";
import { ASSETS, loadAsset } from "@/lib/report/docs";
import { discoveryScript, flagColumns } from "@/lib/report/discovery";
import { sendToBuilder } from "@/lib/report/handoff";
import { buildPattern, PATTERNS, stateCase, testHarness } from "@/lib/report/patterns";
import { Section, SqlBlock } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { describeTable, Field, FileActions, smallInput, TableSearch, useStoredState } from "./shared";

/*
  الگوها و اسکریپت‌ها:
    • اسکریپت تشخیصی مرحلهٔ ۰ برای جدول‌های انتخابی — «حدس نزن، بپرس»
    • الگوهای پارامتری T-SQL (پیوت پویا، ROW_NUMBER، پارامتر اختیاری …)
    • CASE وضعیت از دانش برنامه، با ELSE اجباری
    • فایل آزمون SSMS از هر کوئری
    • اسکریپت کاوش تکمیلی و قالب پایهٔ RDL مهارت
*/

function Discovery() {
  const [tables, setTables] = useStoredState("kavosh.rb.discovery.v1", []);
  const [purpose, setPurpose] = useState("");
  const [details, setDetails] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    Promise.all(tables.map(describeTable)).then((list) => {
      if (alive) setDetails(list.filter(Boolean));
    }).finally(() => alive && setBusy(false));
    return () => { alive = false; };
  }, [tables]);
  const script = useMemo(() => (details.length ? discoveryScript(details, { purpose }) : ""), [details, purpose]);
  return (
    <Section icon={Microscope} title="اسکریپت تشخیصی (مرحلهٔ ۰)" hint="ساختار ستون‌ها، ۵۰ ردیف نمونه، توزیع واقعی فلگ‌ها و کلیدهای خارجی — در SSMS اجرا و نتیجه را بررسی کنید.">
      <div className="space-y-2">
        <TableSearch onPick={(t) => setTables((x) => (x.includes(t) ? x : [...x, t].slice(0, 12)))} placeholder="افزودن جدول به اسکریپت…" />
        <div className="flex flex-wrap gap-1">
          {tables.map((t) => {
            const d = details.find((x) => x.full_name === t);
            return (
              <span key={t} className="inline-flex items-center gap-1 rounded border border-brand/35 bg-brand/10 py-0.5 pe-0.5 ps-1.5 text-[11px] text-brand-text">
                <span className="ltr font-mono">{t}</span>
                {d && <span className="text-muted-foreground">· {fa(flagColumns(d).length)} فلگ</span>}
                <button type="button" onClick={() => setTables((x) => x.filter((y) => y !== t))} className="rounded p-0.5 hover:bg-brand/20" title="برداشتن"><X className="h-3 w-3" /></button>
              </span>
            );
          })}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <Field label="هدف گزارش (در سرآیند اسکریپت می‌آید)">
          <Input className={smallInput} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="مثلاً: گزارش ماندهٔ حساب به تفکیک شعبه" />
        </Field>
        {script ? (
          <>
            <FileActions text={script} name="discovery-stage0.sql" mime="application/sql" copyLabel="کپی اسکریپت" />
            <SqlBlock sql={script} title={`اسکریپت تشخیصی — ${fa(details.length)} جدول`} />
          </>
        ) : (
          <p className="text-[11.5px] text-muted-foreground">جدولی انتخاب نشده. تا خروجی این اسکریپت نرسیده، کوئری نهایی «فرضی / نیازمند تأیید» است.</p>
        )}
      </div>
    </Section>
  );
}

function StateCase() {
  const [table, setTable] = useState("");
  const [d, setD] = useState(null);
  const [column, setColumn] = useState("State");
  const [alias, setAlias] = useState("t");
  useEffect(() => {
    if (!table) return;
    describeTable(table).then((x) => {
      setD(x);
      const enums = Object.keys(x?.enums || {});
      if (enums.length && !enums.includes(column)) setColumn(enums[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);
  const enumCols = Object.keys(d?.enums || {});
  const code = d && column ? stateCase(alias, column, d.enums?.[column] || [], `${column}Title`) : "";
  return (
    <Section icon={Puzzle} title="CASE وضعیت از دانش برنامه" hint="مقادیر شناخته‌شدهٔ enum با ELSE اجباری — اگر مقدار تازه‌ای بیاید، گزارش نشانش می‌دهد نه اینکه بی‌صدا خالی بماند.">
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <TableSearch onPick={setTable} placeholder={table || "جدول…"} />
          <Select className={smallInput} value={column} onChange={(e) => setColumn(e.target.value)} disabled={!enumCols.length}>
            {!enumCols.length && <option value="">{d ? "enum ثبت‌شده ندارد" : "ستون"}</option>}
            {enumCols.map((c) => <option key={c} value={c}>{c} ({fa(d.enums[c].length)} مقدار)</option>)}
          </Select>
          <Input className={smallInput} dir="ltr" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="نام مستعار" />
        </div>
        {table && <p className="ltr text-start font-mono text-[11px] text-brand-text">{table}</p>}
        {code && <SqlBlock sql={code} title="CASE … ELSE" />}
      </div>
    </Section>
  );
}

function Harness() {
  const [sql, setSql] = useState("");
  const out = useMemo(() => (sql.trim() ? testHarness(sql) : ""), [sql]);
  return (
    <Section icon={FlaskConical} title="فایل آزمون SSMS" hint="هر کوئری گزارش را با DECLARE پارامترهای آزمونی، مستقل از Report Builder اجرا کنید.">
      <div className="space-y-2">
        <Textarea dir="ltr" value={sql} onChange={(e) => setSql(e.target.value)} className="min-h-[120px] font-mono text-[11.5px]" placeholder="کوئری دارای @پارامتر…" spellCheck={false} />
        {out && (
          <>
            <FileActions text={out} name="report-test.sql" mime="application/sql" copyLabel="کپی" />
            <SqlBlock sql={out} title="فایل آزمون" />
          </>
        )}
      </div>
    </Section>
  );
}

function Patterns({ onOpenTab }) {
  const [id, setId] = useState(PATTERNS[0].id);
  const [values, setValues] = useState({});
  const p = PATTERNS.find((x) => x.id === id);
  const code = useMemo(() => buildPattern(id, values), [id, values]);
  return (
    <Section icon={ScrollText} title="الگوهای T-SQL گزارش" hint="نسخهٔ پارامتری مرجع «الگوهای T-SQL» — توضیحِ «چرا» داخل کامنت‌های کد می‌ماند.">
      <div className="grid gap-3 lg:grid-cols-[16rem_1fr]">
        <ul className="space-y-1">
          {PATTERNS.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => { setId(x.id); setValues({}); }}
                className={`w-full rounded-md border px-3 py-2 text-start transition-colors ${x.id === id ? "border-brand/45 bg-brand/10" : "border-border bg-ink/30 hover:border-brand/30"}`}
              >
                <div className="text-[12px] font-semibold text-foreground">{x.title}</div>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 space-y-2">
          <p className="rounded-md border border-info/35 bg-info/8 px-3 py-2 text-[11.5px] leading-relaxed text-foreground/90">{p.when}</p>
          {p.inputs.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {p.inputs.map((inp) => (
                <Field key={inp.key} label={inp.label}>
                  <Input className={smallInput} dir="ltr" value={values[inp.key] ?? ""} placeholder={inp.placeholder} onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))} />
                </Field>
              ))}
            </div>
          )}
          <SqlBlock sql={code} title={p.title} />
          {/^\s*SELECT/i.test(code) && (
            <Button size="sm" variant="outline" onClick={() => { sendToBuilder({ sql: code, title: p.title, source: "الگوها" }); onOpenTab("build"); }}>
              <Hammer />ساخت گزارش از این الگو
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

function Assets() {
  const [busy, setBusy] = useState("");
  const [texts, setTexts] = useState({});
  const load = async (key) => {
    setBusy(key);
    try {
      const t = await loadAsset(key);
      setTexts((x) => ({ ...x, [key]: t }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  };
  return (
    <Section icon={FileCode2} title="فایل‌های آمادهٔ مهارت">
      <div className="grid gap-2 lg:grid-cols-2">
        {Object.entries(ASSETS).map(([key, a]) => (
          <div key={key} className="space-y-1.5 rounded-md border border-border bg-ink/30 p-2.5">
            <p className="text-[12px] font-semibold text-foreground">{a.title}</p>
            <p className="ltr text-start font-mono text-[10.5px] text-muted-foreground">{a.name}</p>
            {texts[key] ? (
              <FileActions text={texts[key]} name={a.name} mime={a.name.endsWith(".rdl") ? "application/xml" : "application/sql"} />
            ) : (
              <Button size="xs" variant="outline" onClick={() => load(key)} disabled={busy === key}>{busy === key ? <Loader2 className="animate-spin" /> : null}آماده‌سازی</Button>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function PatternsTab({ onOpenTab }) {
  return (
    <div className="space-y-3">
      <Discovery />
      <Patterns onOpenTab={onOpenTab} />
      <StateCase />
      <Harness />
      <Assets />
    </div>
  );
}
