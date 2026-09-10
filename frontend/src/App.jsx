import { useCallback, useEffect, useState } from "react";
import { Database, ListChecks, Network, Search, TriangleAlert } from "lucide-react";

import { http, OFFLINE_HINT } from "@/lib/api";
import { cn, fa } from "@/lib/utils";
import { useHashRoute } from "@/lib/route";
import { ThemeProvider } from "@/context/ThemeContext";
import ThemeToggle from "@/components/ThemeToggle";
import { Toaster } from "@/components/ui/sonner";
import ExplorerView from "@/views/ExplorerView";
import SchemaGraphView from "@/views/SchemaGraphView";
import LookupView from "@/views/LookupView";

const VIEWS = [
  { id: "explorer", label: "کاوش جدول‌ها", short: "جدول‌ها", icon: Search },
  { id: "graph", label: "گراف روابط اسکیما", short: "گراف", icon: Network },
  { id: "lookup", label: "کد و شرح", short: "کد و شرح", icon: ListChecks },
];

function Brand({ health }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-text ring-1 ring-brand/30">
        <Database className="h-[18px] w-[18px]" strokeWidth={2.2} />
        <span
          className={cn(
            "absolute -bottom-0.5 -end-0.5 h-2 w-2 rounded-full ring-2 ring-background transition-colors",
            health ? "bg-brand" : "bg-err",
          )}
        />
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
      className={cn("flex items-center gap-1 rounded-lg border border-border bg-ink p-1", className)}
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
            // روی لمس ارتفاع کامل ۴۴ پیکسل، روی اشاره‌گر جمع‌وجورتر
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 text-xs font-medium transition-colors sm:min-h-9 sm:flex-none",
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
  const [route, navigate] = useHashRoute();
  const [health, setHealth] = useState(null);

  const view = ["graph", "lookup"].includes(route.view) ? route.view : "explorer";
  const graphSchema = route.schema || "FIN3";

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

  const setView = useCallback(
    (next) => {
      if (next === "graph") return navigate({ view: "graph", schema: graphSchema });
      if (next === "lookup") return navigate({ view: "lookup" });
      return navigate({ view: "explorer" });
    },
    [navigate, graphSchema],
  );

  return (
    <div className="app-canvas inset-safe flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <Toaster />

      {/*
        نوار سازنده — بالای همه‌چیز، روی هر سه نما.

        عمداً بیرون از هدرِ چسبان است و با آن اسکرول نمی‌شود: یک خط اعتبار
        نباید دائماً بخشی از ارتفاع کاری صفحه را بگیرد، به‌ویژه روی گوشی که
        هدر و سوییچ نما از قبل دو ردیف‌اند.

        ltr و ‌dir صریح دارد چون نام و نشانیِ رایانامه لاتین‌اند و داخل سندِ
        راست‌به‌چپ، پرانتز و نقطه‌شان جابه‌جا رندر می‌شود.
      */}
      <div
        dir="ltr"
        className="shrink-0 border-b border-border/70 bg-ink/70 px-3 py-1 text-center text-[10.5px] leading-4 text-muted-foreground sm:px-4 lg:px-6"
      >
        Created by Mehran-Sabzali{" "}
        <a
          href="mailto:mehransa@systemgroup.net"
          className="font-mono text-brand-text underline-offset-2 transition-colors hover:underline"
        >
          (mehransa@systemgroup.net)
        </a>
      </div>

      <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4 lg:px-6">
          <Brand health={health} />

          <ViewSwitch view={view} setView={setView} className="hidden sm:flex" />

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
          </div>
        </div>

        {/* روی موبایل، سوییچ نما زیر عنوان و تمام‌عرض می‌نشیند */}
        <div className="px-3 pb-2.5 sm:hidden">
          <ViewSwitch view={view} setView={setView} className="w-full" />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {view === "explorer" && (
          <ExplorerView health={health} route={route} navigate={navigate} />
        )}
        {view === "graph" && <SchemaGraphView route={route} navigate={navigate} />}
        {view === "lookup" && (
          <LookupView onSelectTable={(full) => navigate({ view: "explorer", table: full })} />
        )}
      </main>

      {!health && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-center gap-1.5 border-t border-err/40 bg-err/10 px-4 py-2 text-center text-[11px] text-err"
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {OFFLINE_HINT}
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
