import { useCallback, useEffect, useState } from "react";
import { Database, Loader2, Network, RefreshCw, Search, Table2 } from "lucide-react";

import { errorMessage, http } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { ThemeProvider } from "@/context/ThemeContext";
import ThemeToggle from "@/components/ThemeToggle";
import { Toaster, toast } from "@/components/ui/sonner";
import ExplorerView from "@/views/ExplorerView";
import SchemaGraphView from "@/views/SchemaGraphView";

const VIEWS = [
  { id: "explorer", label: "کاوش جدول‌ها", short: "جدول‌ها", icon: Search },
  { id: "graph", label: "گراف روابط اسکیما", short: "گراف", icon: Network },
];

function Brand({ health }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-text ring-1 ring-brand/30">
        <Database className="h-[18px] w-[18px]" strokeWidth={2.2} />
        <span className="absolute -bottom-0.5 -end-0.5 h-2 w-2 rounded-full bg-brand ring-2 ring-background" />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-extrabold tracking-tight text-foreground">
          کاوشگر پایگاه داده
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {health?.kb?.tables
            ? `${fa(health.kb.tables)} جدول · ${fa(health.kb.columns)} ستون`
            : "SCHEMA · RELATIONS · SQL"}
        </div>
      </div>
    </div>
  );
}

function ViewSwitch({ view, setView, className }) {
  return (
    <div
      role="tablist"
      aria-label="حالت نمایش"
      className={cn(
        "flex items-center gap-1 rounded-lg border border-border bg-ink p-1",
        className,
      )}
    >
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = view === v.id;
        return (
          <button
            key={v.id}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => setView(v.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-all sm:flex-none",
              active
                ? "bg-brand text-brand-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">{v.label}</span>
            <span className="sm:hidden">{v.short}</span>
          </button>
        );
      })}
    </div>
  );
}

function AppShell() {
  const [view, setView] = useState("explorer");
  const [health, setHealth] = useState(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [focusTable, setFocusTable] = useState(null);
  const [graphSchema, setGraphSchema] = useState("FIN3");

  const refreshHealth = useCallback(async () => {
    try {
      const { data } = await http.get("/health");
      setHealth(data);
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    const id = toast.loading("بازسازی ایندکس دانش آغاز شد…");
    try {
      const { data } = await http.post("/index/rebuild");
      if (data.ok) {
        toast.success("ایندکس بازسازی شد؛ دانش تازه در جست‌وجو فعال است.", { id });
        refreshHealth();
      } else {
        toast.error(`بازسازی ناموفق بود: ${data.error || "خطای نامشخص"}`, { id });
      }
    } catch (e) {
      toast.error(errorMessage(e, "ارتباط با سرور برقرار نشد."), { id });
    } finally {
      setRebuilding(false);
    }
  }, [refreshHealth]);

  /** از گراف به جزئیات جدول، و از جزئیات به گراف اسکیما. */
  const openTable = useCallback((fullName) => {
    setFocusTable({ name: fullName, at: Date.now() });
    setView("explorer");
  }, []);

  const openSchemaGraph = useCallback((schema) => {
    if (schema) setGraphSchema(schema);
    setView("graph");
  }, []);

  return (
    <div className="app-canvas flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <Toaster />

      <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <Brand health={health} />

          <ViewSwitch view={view} setView={setView} className="hidden sm:flex" />

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={rebuild}
              disabled={rebuilding}
              title="بازسازی ایندکس جست‌وجو پس از ثبت دانش جدید"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-brand/45 hover:bg-surfaceHover hover:text-brand-text disabled:opacity-60"
            >
              {rebuilding ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand-text" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="hidden lg:inline">بازسازی ایندکس</span>
            </button>
            <ThemeToggle />
          </div>
        </div>

        {/* روی موبایل، سوییچ نما زیر عنوان و تمام‌عرض می‌نشیند */}
        <div className="px-3 pb-2.5 sm:hidden">
          <ViewSwitch view={view} setView={setView} className="w-full" />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "explorer" ? (
          <ExplorerView
            health={health}
            focusTable={focusTable}
            onOpenSchemaGraph={openSchemaGraph}
          />
        ) : (
          <SchemaGraphView
            schema={graphSchema}
            onSchemaChange={setGraphSchema}
            onSelectTable={openTable}
          />
        )}
      </main>

      {!health && (
        <div className="shrink-0 border-t border-err/40 bg-err/10 px-4 py-1.5 text-center text-[11px] text-err">
          <Table2 className="me-1 inline h-3 w-3" />
          ارتباط با سرور دانش برقرار نشد — سرویس بک‌اند را اجرا کنید.
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
