import { useEffect, useState } from "react";
import { FileSpreadsheet, FlaskConical, Loader2, Microscope, ShieldCheck } from "lucide-react";

import { CAN_DOWNLOAD } from "@/lib/api";
import { cn, copyText, fa } from "@/lib/utils";
import { sendToBuilder } from "@/lib/report/handoff";
import { lintReportSql } from "@/lib/report/lint";
import { testHarness } from "@/lib/report/patterns";
import { toast } from "@/components/ui/sonner";
import { describeTable, downloadText, FindingsList, writeStore } from "./shared";

/*
  پل دستیار ← گزارش‌ساز، زیر هر کوئریِ دستیار:
    • بازبینی گزارش‌محور (قواعد مهارت گزارش‌سازی راهکاران) — جدا از بازبینی
      ساختاری، چون «ستون وجود دارد» با «عدد گزارش درست است» فرق دارد.
    • ساخت گزارش RDL از همین کوئری
    • اسکریپت تشخیصی SSMS برای جدول‌های همین کوئری
    • فایل آزمون SSMS با DECLARE پارامترها
*/

const btn = "inline-flex min-h-9 items-center justify-center gap-1 rounded-md border px-2.5 text-[11px] transition-colors sm:min-h-8";

export default function AssistantReportTools({ sql, question, tables = [], onOpenReports }) {
  const [lint, setLint] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLint(null);
    lintReportSql(sql, describeTable).then((r) => alive && setLint(r.findings)).catch(() => alive && setLint([]));
    return () => { alive = false; };
  }, [sql]);

  const serious = (lint || []).filter((f) => f.severity !== "info");
  const errors = serious.filter((f) => f.severity === "error").length;

  const harness = () => {
    const text = testHarness(sql, { title: question });
    if (CAN_DOWNLOAD) downloadText("kavosh-report-test.sql", text, "application/sql");
    else copyText(text).then((ok) => (ok ? toast.success("فایل آزمون SSMS کپی شد.") : toast.error("کپی ناموفق بود.")));
  };

  return (
    <div className="space-y-1.5 rounded-md border border-border/70 bg-ink/30 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(btn, lint === null ? "border-border text-muted-foreground" : errors ? "border-err/40 bg-err/8 text-err" : serious.length ? "border-warn/40 bg-warn/8 text-warn" : "border-ok/35 bg-ok/8 text-ok")}
          title="قواعد مهارت گزارش‌سازی: سال مالی، شعبه، State، بازهٔ تاریخ، ReferenceType، Version، FORMAT…"
        >
          {lint === null ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
          {lint === null ? "بازبینی گزارش‌محور…" : serious.length ? `قواعد گزارش: ${fa(serious.length)} مورد` : "قواعد گزارش: سالم"}
        </button>
        {onOpenReports && (
          <button
            type="button"
            onClick={() => { sendToBuilder({ sql, title: question, tables, source: "دستیار کوئری‌نویسی" }); onOpenReports("build"); }}
            className={cn(btn, "border-brand/40 bg-brand/10 text-brand-text hover:bg-brand/20")}
            title="همین کوئری در گزارش‌ساز تحلیل و به فایل RDL تبدیل شود"
          >
            <FileSpreadsheet className="h-3 w-3" />
            ساخت گزارش RDL
          </button>
        )}
        {onOpenReports && tables.length > 0 && (
          <button
            type="button"
            onClick={() => { writeStore("kavosh.rb.discovery.v1", tables.slice(0, 12)); onOpenReports("patterns"); }}
            className={cn(btn, "border-border bg-surface text-muted-foreground hover:border-brand/45 hover:text-brand-text")}
            title="ساختار، نمونهٔ ۵۰ ردیفی، توزیع State/فلگ‌ها و کلیدهای خارجی همین جدول‌ها — برای اثبات فرض‌ها"
          >
            <Microscope className="h-3 w-3" />
            اسکریپت تشخیصی SSMS
          </button>
        )}
        <button type="button" onClick={harness} className={cn(btn, "border-border bg-surface text-muted-foreground hover:border-brand/45 hover:text-brand-text")} title="کوئری با DECLARE پارامترهای آزمونی، برای اجرا در SSMS">
          <FlaskConical className="h-3 w-3" />
          {CAN_DOWNLOAD ? "فایل آزمون SSMS" : "کپی فایل آزمون SSMS"}
        </button>
      </div>
      {open && lint && <FindingsList findings={lint} empty="کوئری با قواعد گزارش مالی می‌خواند." />}
    </div>
  );
}
