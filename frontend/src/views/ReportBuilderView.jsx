import { lazy, Suspense } from "react";
import { BookOpen, FileSearch, FolderOpen, Hammer, Loader2, Puzzle, Workflow } from "lucide-react";

import { cn } from "@/lib/utils";

/*
  گزارش‌ساز — همهٔ امکانات ابزار «گزارش‌ساز راهکاران» (Report-Builder-assist) و
  مهارت report-builder-sql-expert در یک زبانه:

    ساخت گزارش       کوئری ← بازبینی گزارش‌محور ← ستون/پارامتر/چیدمان ← RDL 2016
    طراح کوئری       جدول مبنا + JOIN از گراف دانش + ستون/فیلتر/پارامتر ← SQL
    تحلیل و اصلاح    بارگذاری RDL ← کشف ساختار ← اعتبارسنجی ← اصلاح جراحی
    الگوها           اسکریپت تشخیصی، الگوهای T-SQL، فایل آزمون SSMS
    کتابخانه         گزارش‌های ذخیره‌شده با پوشه، درس‌ها و خروجی
    مرجع             دانش مهارت، مترجم خطا، چک‌لیست تحویل

  همه‌چیز در مرورگر اجرا می‌شود (بی‌مدل و بی‌کلید)؛ پس روی ویندوز و گوشی یکسان
  کار می‌کند. هر زیرزبانه تنبل بار می‌شود تا باز شدن برنامه کند نشود.
*/

const BuildTab = lazy(() => import("./report/BuildTab"));
const DesignTab = lazy(() => import("./report/DesignTab"));
const AnalyzeTab = lazy(() => import("./report/AnalyzeTab"));
const PatternsTab = lazy(() => import("./report/PatternsTab"));
const LibraryTab = lazy(() => import("./report/LibraryTab"));
const DocsTab = lazy(() => import("./report/DocsTab"));

export const REPORT_TABS = [
  { id: "build", label: "ساخت گزارش", icon: Hammer, Component: BuildTab },
  { id: "design", label: "طراح کوئری", icon: Workflow, Component: DesignTab },
  { id: "analyze", label: "تحلیل و اصلاح RDL", short: "تحلیل RDL", icon: FileSearch, Component: AnalyzeTab },
  { id: "patterns", label: "الگوها و اسکریپت‌ها", short: "الگوها", icon: Puzzle, Component: PatternsTab },
  { id: "library", label: "کتابخانه", icon: FolderOpen, Component: LibraryTab },
  { id: "docs", label: "مرجع", icon: BookOpen, Component: DocsTab },
];

export default function ReportBuilderView({ sub, onNavigate }) {
  const active = REPORT_TABS.find((t) => t.id === sub) || REPORT_TABS[0];
  const Active = active.Component;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-background/70 px-3 py-2 sm:px-4 lg:px-6">
        <div role="tablist" aria-label="بخش‌های گزارش‌ساز" className="no-scrollbar grid grid-cols-3 gap-1 sm:-mx-1 sm:flex sm:overflow-x-auto sm:px-1">
          {/* روی گوشی شش زبانه در دو ردیف، تا هیچ‌کدام پشت لبهٔ اسکرول پنهان نماند */}
          {REPORT_TABS.map((t) => {
            const Icon = t.icon;
            const on = t.id === active.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => onNavigate(t.id)}
                className={cn(
                  "inline-flex min-h-10 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors sm:min-h-8 sm:justify-start sm:px-3",
                  on ? "border-brand/45 bg-brand/12 text-brand-text" : "border-transparent text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.short || t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-4 lg:px-6">
          <Suspense fallback={<Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-muted-foreground" />}>
            <Active onOpenTab={onNavigate} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
