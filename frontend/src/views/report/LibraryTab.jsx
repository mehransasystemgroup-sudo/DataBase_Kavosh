import { useCallback, useEffect, useState } from "react";
import { BookMarked, FileDown, FolderOpen, Hammer, Lightbulb, Loader2, Plus, Search, Trash2, Upload } from "lucide-react";

import { CAN_DOWNLOAD, errorMessage } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { sendToBuilder } from "@/lib/report/handoff";
import { deleteReport, getReport, listReports, saveReport } from "@/lib/report/library";
import { testHarness } from "@/lib/report/patterns";
import { EmptyState, Section } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { downloadText, fileName, readTextFile, smallInput } from "./shared";

/*
  کتابخانهٔ گزارش‌ها — همان «کاتالوگ گزارش» اپ قبلی: پوشه، جست‌وجو، درس‌های
  آموخته، شمار استفاده، خروجی .sql/.rdl/.json و بازگشت به گزارش‌ساز برای
  ساخت دوباره یا ویرایش.
*/

const fmtDate = (s) => {
  try {
    return new Date(s).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return s || "";
  }
};

function ReportCard({ r, folders, onChanged }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(null);
  const [lesson, setLesson] = useState("");
  const [busy, setBusy] = useState("");
  // بی‌window.confirm/prompt: نمایشگر وب اندروید بدون کد بومی آن‌ها را بی‌صدا رد می‌کند
  const [armed, setArmed] = useState(false);
  const [newFolder, setNewFolder] = useState(null);

  const load = async () => {
    if (full) return full;
    const doc = await getReport(r.id);
    setFull(doc);
    return doc;
  };

  const run = async (label, fn) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy("");
    }
  };

  const reuse = () => run("reuse", async () => {
    const doc = await load();
    await saveReport({ id: r.id, touch: true });
    sendToBuilder({ sql: doc.sql || "", title: doc.title, libraryId: doc.id, source: "کتابخانه", spec: doc.spec ? { ...doc.spec, layout: doc.spec.layout, analyzed: false } : null });
    onChanged("open-build");
  });

  const download = (kind) => run(kind, async () => {
    const doc = await load();
    if (kind === "rdl") downloadText(fileName(doc.title, "rdl"), doc.rdl, "application/xml");
    if (kind === "sql") downloadText(fileName(doc.title, "sql"), testHarness(doc.sql || "", { title: doc.title }), "application/sql");
    if (kind === "json") downloadText(fileName(doc.title, "json"), JSON.stringify({ kavosh_report: 1, ...doc }, null, 2), "application/json");
  });

  const addLesson = () => run("lesson", async () => {
    const doc = await load();
    const lessons = [...(doc.lessons || []), lesson.trim()];
    const saved = await saveReport({ id: r.id, lessons });
    setFull({ ...doc, ...saved, rdl: doc.rdl, spec: doc.spec });
    setLesson("");
    onChanged();
  });

  return (
    <li className="rounded-lg border border-border bg-surface">
      <button type="button" onClick={() => { setOpen((v) => !v); if (!open) load().catch(() => {}); }} className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-start">
        <BookMarked className="h-4 w-4 shrink-0 text-brand-text" />
        <span className="text-[12.5px] font-semibold text-foreground">{r.title}</span>
        {r.folder && <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{r.folder}</span>}
        {r.has_rdl && <span className="rounded-full border border-ok/35 bg-ok/10 px-2 py-0.5 text-[10px] text-ok">RDL</span>}
        <span className="ms-auto text-[10.5px] text-muted-foreground">{fmtDate(r.updated_at)} · {fa(r.used_count || 0)} بار استفاده</span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-border px-3 py-2.5">
          {r.tables?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {r.tables.map((t) => <span key={t} className="ltr rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t}</span>)}
            </div>
          )}
          {r.parameters?.length > 0 && <p className="text-[11px] text-muted-foreground">پارامترها: <span className="ltr font-mono">{r.parameters.map((p) => `@${p}`).join("، ")}</span></p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="xs" onClick={reuse} disabled={busy === "reuse"}>{busy === "reuse" ? <Loader2 className="animate-spin" /> : <Hammer />}باز کردن در گزارش‌ساز</Button>
            {CAN_DOWNLOAD && r.has_rdl && <Button size="xs" variant="outline" onClick={() => download("rdl")}><FileDown />.rdl</Button>}
            {CAN_DOWNLOAD && <Button size="xs" variant="outline" onClick={() => download("sql")}><FileDown />.sql آزمون</Button>}
            {CAN_DOWNLOAD && <Button size="xs" variant="outline" onClick={() => download("json")} title="برای انتقال به دستگاه دیگر"><FileDown />.json</Button>}
            {newFolder === null ? (
              <Select
                className={cn(smallInput, "w-40")}
                value={r.folder || ""}
                onChange={(e) => {
                  if (e.target.value === "__new") {
                    setNewFolder("");
                    return;
                  }
                  const folder = e.target.value;
                  run("folder", async () => {
                    await saveReport({ id: r.id, folder });
                    onChanged();
                  });
                }}
              >
                <option value="">بدون پوشه</option>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                <option value="__new">+ پوشهٔ تازه…</option>
              </Select>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Input autoFocus className={cn(smallInput, "w-36")} value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="نام پوشه" />
                <Button size="xs" variant="outline" disabled={!newFolder.trim()} onClick={() => run("folder", async () => {
                  await saveReport({ id: r.id, folder: newFolder.trim() });
                  setNewFolder(null);
                  onChanged();
                })}>ثبت</Button>
                <Button size="xs" variant="ghost" onClick={() => setNewFolder(null)}>انصراف</Button>
              </span>
            )}
            <Button
              size="xs"
              variant={armed ? "destructive" : "ghost"}
              className={cn("ms-auto", !armed && "text-err hover:text-err")}
              onBlur={() => setArmed(false)}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                run("delete", async () => {
                  await deleteReport(r.id);
                  toast.success("حذف شد.");
                  onChanged();
                });
              }}
            >
              <Trash2 />{armed ? "تأیید حذف" : "حذف"}
            </Button>
          </div>
          <div className="space-y-1.5 rounded-md border border-border bg-ink/30 p-2">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-foreground"><Lightbulb className="h-3.5 w-3.5 text-warn" />درس‌های آموخته</p>
            {(full?.lessons || []).length ? (
              <ul className="list-disc space-y-0.5 ps-5 text-[11.5px] text-foreground/90">{full.lessons.map((l, i) => <li key={i}>{l}</li>)}</ul>
            ) : <p className="text-[11px] text-muted-foreground">هنوز درسی ثبت نشده — مثلاً «State=32 یعنی قطعی؛ با داده اثبات شد».</p>}
            <div className="flex gap-1.5">
              <Input className={smallInput} value={lesson} onChange={(e) => setLesson(e.target.value)} placeholder="نکتهٔ تازه دربارهٔ این گزارش…" onKeyDown={(e) => e.key === "Enter" && lesson.trim() && addLesson()} />
              <Button size="xs" variant="outline" disabled={!lesson.trim() || busy === "lesson"} onClick={addLesson}><Plus />ثبت</Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default function LibraryTab({ onOpenTab }) {
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listReports({ q, folder }));
      setError("");
    } catch (e) {
      setError(errorMessage(e, "کتابخانه خوانده نشد."));
    } finally {
      setLoading(false);
    }
  }, [q, folder]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  const importJson = async (file) => {
    try {
      const doc = JSON.parse(await readTextFile(file));
      if (!doc || typeof doc !== "object" || !doc.title) throw new Error("این فایل گزارش کتابخانه نیست.");
      const { id, created_at, updated_at, used_count, kavosh_report, has_rdl, has_spec, ...rest } = doc;
      await saveReport(rest);
      toast.success(`«${doc.title}» به کتابخانه افزوده شد.`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e, "فایل خوانده نشد."));
    }
  };

  const changed = (what) => {
    if (what === "open-build") onOpenTab("build");
    else refresh();
  };

  return (
    <div className="space-y-3">
      <Section icon={FolderOpen} title="کتابخانهٔ گزارش‌ها" hint={data ? `${fa(data.total)} گزارش` : ""} actions={
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text">
          <Upload className="h-3 w-3" />
          ورود .json
          <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importJson(f); }} />
        </label>
      }>
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو در عنوان، جدول، برچسب…" className="ps-8" />
          </div>
          <Select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">همهٔ پوشه‌ها</option>
            {(data?.folders || []).map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </div>
      </Section>

      {error && <p className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[11.5px] text-err">{error}</p>}
      {loading && !data && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
      {data && !data.reports.length && (
        <EmptyState
          icon={BookMarked}
          title={data.total ? "گزارشی با این جست‌وجو پیدا نشد" : "کتابخانه خالی است"}
          description="در زبانهٔ «ساخت گزارش»، پس از ساخت، «ذخیره در کتابخانه» را بزنید تا کوئری، چیدمان و فایل RDL برای بعد بماند."
          action={<Button size="sm" variant="outline" onClick={() => onOpenTab("build")}><Hammer />ساخت گزارش</Button>}
        />
      )}
      {data?.reports?.length > 0 && (
        <ul className="space-y-2">
          {data.reports.map((r) => <ReportCard key={`${r.id}-${r.updated_at}`} r={r} folders={data.folders} onChanged={changed} />)}
        </ul>
      )}
    </div>
  );
}
