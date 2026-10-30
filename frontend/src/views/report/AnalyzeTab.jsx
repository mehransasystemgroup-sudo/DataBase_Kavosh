import { useMemo, useState } from "react";
import {
  BookOpenCheck,
  Columns3,
  Database,
  FileSearch,
  FileUp,
  GraduationCap,
  Hammer,
  History,
  Minus,
  Plus,
  RefreshCcw,
  Undo2,
  Wrench,
} from "lucide-react";

import { cn, fa } from "@/lib/utils";
import {
  addColumn,
  addSysParams,
  EditError,
  fitSectionWidth,
  fixKeepWithGroup,
  fixTablixDirection,
  movePageBandsToBody,
  newReportId,
  passSysToSubreports,
  removeColumn,
  setCommandText,
  syncFields,
} from "@/lib/report/edit";
import { sendToBuilder } from "@/lib/report/handoff";
import { learnProfile } from "@/lib/report/profile";
import { summarize, validateRdl } from "@/lib/report/rdl";
import { rdlType } from "@/lib/report/sqlmeta";
import { NUMBER_FORMATS } from "@/lib/report/build";
import { Section, SqlBlock } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { Check, Field, FileActions, FindingsList, PROFILE_STORE, readStore, readTextFile, smallInput, writeStore } from "./shared";

/*
  تحلیل و اصلاح RDL — مراحل ۱ تا ۴ مهارت روی فایلی که کاربر دارد:
  کشف ساختار، اعتبارسنجی، و ویرایش «جراحی» که فقط همان تکه‌های لازم را عوض
  می‌کند و بقیهٔ فایل (sglt:، CodeModules، Style ها) را بایت‌به‌بایت دست‌نخورده
  نگه می‌دارد. هر ویرایش پیش از پذیرش دوباره تجزیه می‌شود؛ تاریخچه برای
  برگشت هست.

  فایل فقط در حافظهٔ همین صفحه است (نه localStorage): RDL های واقعی تا چند
  مگابایت می‌رسند و جای ذخیره‌گاه مرورگر را پر می‌کنند.
*/

const TYPE_OPTIONS = [
  ["nvarchar", "متن"], ["bigint", "عدد صحیح بزرگ (bigint)"], ["int", "عدد صحیح"], ["decimal", "عدد اعشاری / مبلغ"], ["datetime", "تاریخ"], ["bit", "بله/خیر"],
];

const QUICK_FIXES = [
  { id: "kwg", label: "اصلاح KeepWithGroup", hint: "سرآیند تکرارشونده بالای گروه After، پایین گروه Before", run: fixKeepWithGroup },
  { id: "bands", label: "انتقال سرصفحه به بدنه", hint: "میزبان راهکاران گزارش دارای PageHeader/PageFooter را بار نمی‌کند", run: (t) => movePageBandsToBody(t, { footer: "remove" }) },
  { id: "sys", label: "افزودن پارامترهای Sys_*", hint: "پنهان و تهی‌پذیر", run: addSysParams },
  { id: "subsys", label: "ارسال Sys_* به زیرگزارش‌ها", hint: "pass-through اجباری میزبان", run: passSysToSubreports },
  { id: "dir", label: "اصلاح جهت Tablix", hint: "<Direction> ← <LayoutDirection>", run: fixTablixDirection },
  { id: "width", label: "تطبیق عرض بدنه", hint: "عرض بخش = لبهٔ دورترین آیتم؛ ستون خالی Excel از بین می‌رود", run: fitSectionWidth },
  { id: "rid", label: "شناسهٔ تازهٔ گزارش", hint: "برای گزارشی که از روی گزارش دیگر کپی شده", run: newReportId },
];

export default function AnalyzeTab({ onOpenTab }) {
  const [doc, setDoc] = useState(null); // { name, text, history: [{text, label}] }
  const [log, setLog] = useState([]);
  const [paste, setPaste] = useState("");
  const [, refresh] = useState(0);
  const verdict = useMemo(() => (doc ? validateRdl(doc.text) : null), [doc]);
  const summary = useMemo(() => (verdict?.info?.ok ? summarize(verdict.info) : null), [verdict]);

  const open = (name, text) => {
    if (!String(text).trim()) return;
    setDoc({ name, text, original: text, history: [] });
    setLog([]);
  };

  const apply = (label, fn) => {
    try {
      const res = fn(doc.text);
      setLog((l) => [{ label, changes: res.changes, ok: true, at: Date.now() }, ...l].slice(0, 30));
      if (!res.changed) {
        toast.message(res.changes[0] || "تغییری لازم نبود.");
        return;
      }
      setDoc((d) => ({ ...d, text: res.text, history: [...d.history, { text: d.text, label }].slice(-25) }));
      toast.success(label);
    } catch (e) {
      // خطای پیش‌بینی‌نشده (نه EditError) با پیام فنی خام به کاربر نمی‌رسد
      const msg = e instanceof EditError ? e.message : `این ویرایش روی ساختار این فایل ممکن نشد و هیچ تغییری اعمال نشد. (${e.message})`;
      setLog((l) => [{ label, changes: [msg], ok: false, at: Date.now() }, ...l].slice(0, 30));
      toast.error(msg);
    }
  };

  const undo = () => setDoc((d) => {
    const prev = d.history[d.history.length - 1];
    if (!prev) return d;
    toast.message(`برگشت: ${prev.label}`);
    return { ...d, text: prev.text, history: d.history.slice(0, -1) };
  });

  const learn = () => {
    try {
      const { profile, learned } = learnProfile(doc.text);
      writeStore(PROFILE_STORE, { profile, learned, source: doc.name, at: new Date().toISOString() });
      setLog((l) => [{ label: "پروفایل سازمانی آموخته شد", changes: learned, ok: true, at: Date.now() }, ...l]);
      toast.success("پروفایل سازمانی ذخیره شد؛ گزارش‌های تازه با همین ظاهر ساخته می‌شوند.");
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!doc) {
    const org = readStore(PROFILE_STORE, null);
    return (
      <div className="space-y-3">
        <Section icon={FileUp} title="بارگذاری فایل RDL" hint="فایل فقط در مرورگر شما خوانده می‌شود و جایی فرستاده نمی‌شود.">
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-ink/40 px-4 py-8 text-center transition-colors hover:border-brand/45">
              <FileSearch className="h-7 w-7 text-brand-text" />
              <span className="text-sm font-semibold text-foreground">انتخاب فایل <bdi dir="ltr">.rdl</bdi></span>
              <span className="text-[11px] text-muted-foreground">کشف ساختار، اعتبارسنجی کامل، اصلاح جراحی و یادگیری پروفایل سازمانی</span>
              <input
                type="file"
                accept=".rdl,.rdlc,.xml"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 8 * 1024 * 1024) {
                    toast.error("فایل بزرگ‌تر از ۸ مگابایت است.");
                    return;
                  }
                  open(f.name, await readTextFile(f));
                }}
              />
            </label>
            <details className="rounded-md border border-border bg-ink/30">
              <summary className="cursor-pointer px-3 py-2 text-[11.5px] text-muted-foreground">یا متن XML را بچسبانید (روی گوشی)</summary>
              <div className="space-y-2 p-2">
                <Textarea dir="ltr" value={paste} onChange={(e) => setPaste(e.target.value)} className="min-h-[140px] font-mono text-[11px]" placeholder="<?xml version=&quot;1.0&quot;…" />
                <Button size="sm" onClick={() => open("report.rdl", paste)} disabled={!paste.trim()}>تحلیل</Button>
              </div>
            </details>
            {org && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <GraduationCap className="h-3.5 w-3.5 text-brand-text" />
                پروفایل سازمانی فعلی از «{org.source}» آموخته شده.
                <button type="button" className="text-brand-text underline-offset-2 hover:underline" onClick={() => { writeStore(PROFILE_STORE, undefined); toast.success("پروفایل سازمانی پاک شد."); refresh((n) => n + 1); }}>
                  پاک کردن
                </button>
              </p>
            )}
          </div>
        </Section>
      </div>
    );
  }

  const changed = doc.text !== doc.original;

  return (
    <div className="space-y-3">
      <Section
        icon={FileSearch}
        title={<span className="ltr font-mono">{doc.name}</span>}
        hint={summary ? `${summary.version || "RDL"} · ${fa(summary.dataSets.length)} دیتاست · ${fa(summary.tablixes.length)} Tablix · ${fa(summary.textboxCount)} Textbox` : "XML نامعتبر"}
        actions={
          <>
            <Button variant="ghost" size="xs" onClick={undo} disabled={!doc.history.length}><Undo2 />برگشت</Button>
            <Button variant="ghost" size="xs" onClick={() => setDoc(null)}>فایل دیگر</Button>
          </>
        }
      >
        <div className="space-y-3">
          <FindingsList findings={verdict.findings} empty="اعتبارسنج ایرادی نیافت." />
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-brand/30 bg-brand/5 p-2.5">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-foreground">{changed ? `فایل اصلاح‌شده (${fa(doc.history.length)} ویرایش)` : "فایل (بدون تغییر)"}</p>
              <FileActions text={doc.text} name={doc.name.replace(/\.(rdlc?|xml)$/i, "") + (changed ? "-fixed" : "") + ".rdl"} mime="application/xml" copyLabel="کپی XML" />
            </div>
            {summary && (
              <Button variant="outline" size="sm" onClick={learn} title="قلم، رنگ‌ها، قالب عدد، صفحه و منبع داده">
                <GraduationCap />یادگیری پروفایل سازمانی از این فایل
              </Button>
            )}
          </div>
        </div>
      </Section>

      {summary && (
        <>
          <Section icon={Database} title="ساختار" hint="مرحلهٔ ۱ مهارت: پیش از هر تغییر، فایل را کامل بشناس.">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                {summary.dataSets.map((d) => (
                  <details key={d.name} className="rounded-md border border-border bg-ink/30">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-[11.5px]">
                      <span className="ltr font-mono font-semibold text-brand-text">{d.name}</span>
                      <span className="text-muted-foreground">{fa(d.fields.length)} فیلد · {fa(d.queryParams.length)} پارامتر کوئری</span>
                      {onOpenTab && d.commandText && (
                        <button type="button" className="ms-auto text-[11px] text-brand-text underline-offset-2 hover:underline" onClick={(e) => { e.preventDefault(); sendToBuilder({ sql: d.commandText, title: doc.name.replace(/\.rdlc?$/i, ""), source: `${doc.name} › ${d.name}` }); onOpenTab("build"); }}>
                          ساخت گزارش تازه از این کوئری
                        </button>
                      )}
                    </summary>
                    <div className="space-y-2 border-t border-border p-2">
                      {d.commandText ? <SqlBlock sql={d.commandText} title={`CommandText — ${d.dataSource}`} /> : <p className="text-[11px] text-muted-foreground">دیتاست مشترک یا بی‌کوئری.</p>}
                      <div className="flex flex-wrap gap-1">
                        {d.fields.map((f) => <span key={f.name} className="ltr rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title={f.typeName}>{f.name}</span>)}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
              <div className="space-y-2 text-[11.5px]">
                {summary.tablixes.map((t) => (
                  <div key={t.name} className="rounded-md border border-border bg-ink/30 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ltr font-mono font-semibold text-foreground">{t.name}</span>
                      <span className="text-muted-foreground">{fa(t.columns)} ستون × {fa(t.rows)} ردیف · {t.dataSet || "—"}</span>
                    </div>
                    {t.groups.length > 0 && <div className="mt-1 text-[10.5px] text-muted-foreground">گروه‌ها: <span className="ltr font-mono">{t.groups.join("، ")}</span></div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {t.headers.map((h, i) => <span key={i} className="rounded bg-surfaceHover px-1.5 py-0.5 text-[10px] text-foreground/80">{fa(i + 1)}. {h || "—"}</span>)}
                    </div>
                  </div>
                ))}
                <div className="rounded-md border border-border bg-ink/30 px-3 py-2 leading-6 text-muted-foreground">
                  <div>پارامترها: <span className="ltr font-mono text-foreground/80">{summary.params.map((p) => p.name).join("، ") || "—"}</span></div>
                  <div>زیرگزارش‌ها: {summary.subreports.length ? summary.subreports.map((s) => s.reportName).join("، ") : "—"}</div>
                  <div>عرض بخش: {summary.sectionWidth != null ? `${fa(summary.sectionWidth.toFixed(2))} cm` : "—"} · صفحه: {summary.page.width ? `${fa(summary.page.width.toFixed(1))} × ${fa(summary.page.height.toFixed(1))} cm` : "—"}</div>
                  <div>کلیدهای sglt: {fa(summary.sgltCount)} · CodeModule: {summary.codeModules.length ? summary.codeModules.map((c) => c.split(",")[0]).join("، ") : "—"}</div>
                  <div>سرصفحه/پاصفحه: {summary.hasPageHeader || summary.hasPageFooter ? <span className="text-err">دارد (میزبان بار نمی‌کند)</span> : "ندارد"}</div>
                </div>
              </div>
            </div>
          </Section>

          <Section icon={Wrench} title="اصلاح‌های یک‌کلیکی" hint="هر اصلاح فقط همان تکهٔ لازم را تغییر می‌دهد و نتیجه پیش از پذیرش دوباره تجزیه می‌شود.">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {QUICK_FIXES.map((q) => (
                <button key={q.id} type="button" onClick={() => apply(q.label, q.run)} className="rounded-md border border-border bg-ink/40 px-3 py-2 text-start transition-colors hover:border-brand/45 hover:bg-brand/5">
                  <div className="text-[12px] font-semibold text-foreground">{q.label}</div>
                  <div className="text-[10.5px] leading-relaxed text-muted-foreground">{q.hint}</div>
                </button>
              ))}
            </div>
          </Section>

          <ColumnEditor key={`c${doc.history.length}`} summary={summary} apply={apply} />
          <QueryEditor key={`q${doc.history.length}`} summary={summary} apply={apply} />
        </>
      )}

      {log.length > 0 && (
        <Section icon={History} title="گزارش ویرایش‌ها">
          <ul className="space-y-1.5">
            {log.map((l) => (
              <li key={l.at + l.label} className={cn("rounded-md border px-3 py-2 text-[11.5px]", l.ok ? "border-border bg-ink/30" : "border-err/40 bg-err/8")}>
                <p className={cn("font-semibold", l.ok ? "text-foreground" : "text-err")}>{l.label}</p>
                <ul className="mt-0.5 list-disc space-y-0.5 ps-5 text-[11px] text-muted-foreground">
                  {l.changes.map((c) => <li key={c}>{c}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ColumnEditor({ summary, apply }) {
  const tablixes = summary.tablixes;
  const [tablix, setTablix] = useState(tablixes[0]?.name || "");
  const t = tablixes.find((x) => x.name === tablix) || tablixes[0];
  const ds = summary.dataSets.find((d) => d.name === t?.dataSet);
  const [mode, setMode] = useState("add");
  const [index, setIndex] = useState(t ? t.columns : 0);
  const [header, setHeader] = useState("");
  const [field, setField] = useState("");
  const [sqlType, setSqlType] = useState("nvarchar");
  const [format, setFormat] = useState("");
  const [width, setWidth] = useState(2.5);
  const [total, setTotal] = useState(false);
  if (!t) return null;
  const isNew = field && !ds?.fields.some((f) => f.name === field);
  return (
    <Section icon={Columns3} title="افزودن / حذف ستون" hint="قانون سه‌گانه خودکار رعایت می‌شود: TablixColumn + TablixMember + یک سلول در هر ردیف؛ سلول تازه از همسایه کپی می‌شود.">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Tablix">
            <Select className={smallInput} value={t.name} onChange={(e) => { setTablix(e.target.value); const nt = tablixes.find((x) => x.name === e.target.value); setIndex(nt?.columns || 0); }}>
              {tablixes.map((x) => <option key={x.name} value={x.name}>{x.name} ({fa(x.columns)} ستون)</option>)}
            </Select>
          </Field>
          <Field label="عملیات">
            <Select className={smallInput} value={mode} onChange={(e) => { setMode(e.target.value); setIndex(e.target.value === "add" ? t.columns : 0); }}>
              <option value="add">افزودن ستون</option>
              <option value="remove">حذف ستون</option>
            </Select>
          </Field>
          <Field label={mode === "add" ? "جایگاه (در XML؛ در گزارش راست‌به‌چپ، ۱ = راست‌ترین)" : "ستون"}>
            <Select className={smallInput} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
              {mode === "add"
                ? Array.from({ length: t.columns + 1 }, (_, i) => (
                  <option key={i} value={i}>{i === t.columns ? "انتها" : `پیش از ستون ${fa(i + 1)} (${t.headers[i] || "—"})`}</option>
                ))
                : Array.from({ length: t.columns }, (_, i) => <option key={i} value={i}>{fa(i + 1)}. {t.headers[i] || "—"}</option>)}
            </Select>
          </Field>
        </div>
        {mode === "add" ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="عنوان ستون"><Input className={smallInput} value={header} onChange={(e) => setHeader(e.target.value)} placeholder="مثلاً: مبلغ" /></Field>
              <Field label="فیلد دیتاست" hint={isNew ? "فیلد تازه است؛ به دیتاست اضافه می‌شود — کوئری هم باید همین ستون را برگرداند." : ""}>
                <Input className={smallInput} dir="ltr" list={`fields-${t.name}`} value={field} onChange={(e) => setField(e.target.value.trim())} placeholder="Amount" />
                <datalist id={`fields-${t.name}`}>{ds?.fields.map((f) => <option key={f.name} value={f.name} />)}</datalist>
              </Field>
              {isNew ? (
                <Field label="نوع فیلد تازه">
                  <Select className={smallInput} value={sqlType} onChange={(e) => setSqlType(e.target.value)}>
                    {TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
              ) : <span />}
              <Field label="قالب عدد">
                <Select className={smallInput} value={format} onChange={(e) => setFormat(e.target.value)}>
                  {NUMBER_FORMATS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </Select>
              </Field>
              <Field label="عرض (cm)"><Input className={smallInput} type="number" min="0.5" max="20" step="0.1" value={width} onChange={(e) => setWidth(Number(e.target.value) || 2.5)} /></Field>
              <div className="flex items-end pb-1.5"><Check checked={total} onChange={setTotal}>جمع در ردیف‌های جمع</Check></div>
            </div>
            <Button size="sm" disabled={!header && !field} onClick={() => apply(`افزودن ستون «${header || field}»`, (text) => addColumn(text, { tablix: t.name, index, header, field, width, format, total, typeName: rdlType(sqlType) }))}>
              <Plus />افزودن ستون
            </Button>
          </>
        ) : (
          <Button size="sm" variant="destructive" onClick={() => apply(`حذف ستون ${index + 1} (${t.headers[index] || "—"})`, (text) => removeColumn(text, { tablix: t.name, index }))}>
            <Minus />حذف این ستون
          </Button>
        )}
      </div>
    </Section>
  );
}

function QueryEditor({ summary, apply }) {
  const editable = summary.dataSets.filter((d) => d.commandText);
  const [name, setName] = useState(editable[0]?.name || "");
  const ds = editable.find((d) => d.name === name) || editable[0];
  const [sql, setSql] = useState(ds?.commandText || "");
  const [removeGhosts, setRemoveGhosts] = useState(false);
  const [alsoSync, setAlsoSync] = useState(true);
  if (!ds) return null;
  return (
    <Section icon={BookOpenCheck} title="کوئری دیتاست" hint="کوئری تازه + QueryParameter های لازم + هم‌خوانی فیلدها با SELECT.">
      <div className="space-y-2">
        <Field label="دیتاست">
          <Select className={smallInput} value={ds.name} onChange={(e) => { setName(e.target.value); setSql(editable.find((d) => d.name === e.target.value)?.commandText || ""); }}>
            {editable.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </Select>
        </Field>
        <Textarea dir="ltr" value={sql} onChange={(e) => setSql(e.target.value)} className="min-h-[160px] font-mono text-[11.5px] leading-6" spellCheck={false} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Check checked={alsoSync} onChange={setAlsoSync}>فیلدها هم با SELECT هم‌خوان شوند</Check>
          <Check checked={removeGhosts} onChange={setRemoveGhosts} disabled={!alsoSync} title="فیلدی که کوئری دیگر برنمی‌گرداند — ممکن است در Tablix استفاده شده باشد">حذف فیلدهای بی‌ستون</Check>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!sql.trim() || sql === ds.commandText} onClick={() => apply(`کوئری تازهٔ ${ds.name}`, (text) => {
            const r1 = setCommandText(text, { dataSet: ds.name, sql });
            if (!alsoSync) return r1;
            // کوئری تازه می‌ماند حتی اگر فیلدها خودکار هم‌خوان نشوند (SELECT *، جدول موقت…)
            try {
              const r2 = syncFields(r1.text, { dataSet: ds.name, removeGhosts });
              return { text: r2.text, changes: [...r1.changes, ...r2.changes], changed: r1.changed || r2.changed };
            } catch (e) {
              return { ...r1, changes: [...r1.changes, `هم‌خوانی فیلدها انجام نشد: ${e.message} — فیلدها را در Report Builder با «Refresh Fields» به‌روز کنید.`] };
            }
          })}>
            <Hammer />جایگزینی کوئری
          </Button>
          <Button size="sm" variant="outline" onClick={() => apply(`هم‌خوانی فیلدهای ${ds.name}`, (text) => syncFields(text, { dataSet: ds.name, removeGhosts }))}>
            <RefreshCcw />فقط هم‌خوانی فیلدها با کوئری فعلی
          </Button>
        </div>
      </div>
    </Section>
  );
}
