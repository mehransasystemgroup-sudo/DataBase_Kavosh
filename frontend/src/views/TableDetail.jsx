import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Calendar,
  CheckSquare,
  Coins,
  Columns3,
  FileCode2,
  GitFork,
  Hash,
  KeyRound,
  Layers,
  Link2,
  ListTree,
  Loader2,
  Network,
  Route,
  Search,
  ShieldCheck,
  Square,
  Type,
  X,
} from "lucide-react";

import { errorMessage, http } from "@/lib/api";
import { bracket, cn, fa, splitTable } from "@/lib/utils";
import { schemaAccent, schemaLabel } from "@/lib/schemaTheme";
import { useTheme } from "@/context/ThemeContext";
import { Badge, CopyButton, EmptyState, Section, SqlBlock, Stat } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import TableGraph from "@/components/graph/TableGraph";
import TeachDialog from "@/views/TeachDialog";

const COLUMN_FILTERS = [
  { id: "all", label: "همه", icon: Columns3 },
  { id: "keys", label: "کلیدها", icon: KeyRound },
  { id: "indexed", label: "ایندکس‌دار", icon: ShieldCheck },
  { id: "numeric", label: "عددی", icon: Coins },
  { id: "text", label: "متنی", icon: Type },
  { id: "date", label: "تاریخ", icon: Calendar },
  { id: "enum", label: "کددار", icon: ListTree },
  { id: "notnull", label: "اجباری", icon: AlertTriangle },
];

const SQL_TEMPLATES = [
  { id: "select", label: "بازیابی ساده" },
  { id: "join", label: "پیوند با والدها" },
  { id: "aggregate", label: "تجمیع و شمارش" },
];

function matchesCategory(column, category, ctx) {
  const type = (column.type || "").toLowerCase();
  switch (category) {
    case "keys":
      return column.is_pk || ctx.fkByColumn.has(column.name);
    case "indexed":
      return ctx.indexed.has(column.name);
    case "notnull":
      return !column.nullable;
    case "enum":
      return Boolean(ctx.enums?.[column.name]);
    case "numeric":
      return /int|decimal|numeric|float|money|real/.test(type);
    case "text":
      return /char|text|string/.test(type);
    case "date":
      return /date|time/.test(type);
    default:
      return true;
  }
}

/** یک ردیف رابطه (خروجی یا ورودی) با امکان پرش و کپی شرط JOIN. */
function RelationRow({ direction, join, onSelectTable, isDark }) {
  const other = direction === "out" ? join.to_table : join.from_table;
  const { schema, name } = splitTable(other);
  const accent = schemaAccent(schema, isDark);
  const localCol = direction === "out" ? join.from_col : join.to_col;
  const remoteCol = direction === "out" ? join.to_col : join.from_col;

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border bg-ink p-2 transition-colors hover:border-brand/40 hover:bg-surfaceHover">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{ background: accent.soft, color: accent.text }}
        title={direction === "out" ? "این جدول به جدول مقابل ارجاع می‌دهد" : "جدول مقابل به این جدول ارجاع می‌دهد"}
      >
        {direction === "out" ? (
          <ArrowUpRight className="h-3.5 w-3.5" />
        ) : (
          <ArrowDownLeft className="h-3.5 w-3.5" />
        )}
      </span>

      <button
        type="button"
        onClick={() => onSelectTable?.(other)}
        className="min-w-0 flex-1 text-start"
      >
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 font-mono text-[10px]" style={{ color: accent.text }}>
            {schema}
          </span>
          <span className="ltr truncate font-mono text-[12px] font-semibold text-foreground group-hover:text-brand-text">
            {name}
          </span>
        </div>
        <div className="ltr mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {localCol} → {remoteCol}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        {join.verified ? (
          <Badge tone="ok" title="با دیتابیس یا توسط کاربر تأیید شده">
            <ShieldCheck className="h-2.5 w-2.5" />
          </Badge>
        ) : (
          <Badge tone="warn" title="از روی نام‌گذاری استنتاج شده — تأییدنشده">
            <AlertTriangle className="h-2.5 w-2.5" />
          </Badge>
        )}
        <CopyButton
          text={join.sql}
          label=""
          copiedLabel=""
          message="دستور JOIN کپی شد."
          className="px-1.5 py-1"
        />
      </div>
    </div>
  );
}

export default function TableDetail({ table, loading, onSelectTable, onOpenSchemaGraph, onRefresh }) {
  const { isDark } = useTheme();
  const [tab, setTab] = useState("relations");

  const [columnQuery, setColumnQuery] = useState("");
  const [columnCategory, setColumnCategory] = useState("all");
  const [columnSort, setColumnSort] = useState("ordinal");
  const [picked, setPicked] = useState(() => new Set());

  const [relationQuery, setRelationQuery] = useState("");
  const [neighborQuery, setNeighborQuery] = useState("");
  const [enumQuery, setEnumQuery] = useState("");
  const [sqlTemplate, setSqlTemplate] = useState("select");

  const [pathTarget, setPathTarget] = useState("");
  const [pathBusy, setPathBusy] = useState(false);
  const [pathResult, setPathResult] = useState(null);
  const [pathError, setPathError] = useState("");

  const { schema, name } = splitTable(table.full_name);
  const accent = schemaAccent(schema, isDark);
  const columns = table.columns || [];
  const outgoing = table.outgoing || [];
  const incoming = table.incoming || [];
  const enums = table.enums || {};
  const hasEnums = Object.keys(enums).length > 0;

  const indexed = useMemo(() => new Set(table.indexed_columns || []), [table.indexed_columns]);
  const fkByColumn = useMemo(
    () => new Map(outgoing.map((j) => [j.from_col, j])),
    [outgoing],
  );
  const hasFiscalYear = useMemo(
    () => columns.some((c) => c.name === "FiscalYearRef"),
    [columns],
  );

  const visibleColumns = useMemo(() => {
    const ctx = { indexed, fkByColumn, enums };
    let list = columns.filter((c) => matchesCategory(c, columnCategory, ctx));
    const q = columnQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.type || "").toLowerCase().includes(q) ||
          (c.label_fa || "").includes(q),
      );
    }
    const sorted = [...list];
    if (columnSort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (columnSort === "type")
      sorted.sort((a, b) => (a.type || "").localeCompare(b.type || ""));
    else if (columnSort === "keys")
      sorted.sort((a, b) => {
        const rank = (c) =>
          (c.is_pk ? 4 : 0) + (fkByColumn.has(c.name) ? 2 : 0) + (indexed.has(c.name) ? 1 : 0);
        return rank(b) - rank(a);
      });
    return sorted;
  }, [columns, columnCategory, columnQuery, columnSort, indexed, fkByColumn, enums]);

  const filteredOutgoing = useMemo(() => {
    const q = relationQuery.trim().toLowerCase();
    if (!q) return outgoing;
    return outgoing.filter((j) =>
      `${j.to_table} ${j.from_col} ${j.to_col}`.toLowerCase().includes(q),
    );
  }, [outgoing, relationQuery]);

  const filteredIncoming = useMemo(() => {
    const q = relationQuery.trim().toLowerCase();
    if (!q) return incoming;
    return incoming.filter((j) =>
      `${j.from_table} ${j.from_col} ${j.to_col}`.toLowerCase().includes(q),
    );
  }, [incoming, relationQuery]);

  const neighbors = useMemo(() => {
    const list = table.schema_neighbors || [];
    const q = neighborQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (n) =>
        n.full_name.toLowerCase().includes(q) || (n.title_fa || "").toLowerCase().includes(q),
    );
  }, [table.schema_neighbors, neighborQuery]);

  const filteredEnums = useMemo(() => {
    const q = enumQuery.trim().toLowerCase();
    if (!q) return enums;
    const out = {};
    for (const [col, values] of Object.entries(enums)) {
      if (col.toLowerCase().includes(q)) {
        out[col] = values;
        continue;
      }
      const hits = values.filter(
        (v) =>
          String(v.value).toLowerCase().includes(q) ||
          (v.label_fa || "").toLowerCase().includes(q),
      );
      if (hits.length) out[col] = hits;
    }
    return out;
  }, [enums, enumQuery]);

  const selectedNames = useMemo(
    () => (picked.size ? columns.filter((c) => picked.has(c.name)).map((c) => c.name) : columns.map((c) => c.name)),
    [picked, columns],
  );

  const sqlQueries = useMemo(() => {
    const fiscal = hasFiscalYear
      ? "\nWHERE t.[FiscalYearRef] = @FiscalYearRef -- الزامی: بدون این فیلتر، خروجی بی‌خطا ولی غلط است"
      : "";
    const cols = selectedNames.map((c) => `    t.[${c}]`).join(",\n");

    const select = `-- ${table.title_fa || table.full_name}
SELECT TOP (100)
${cols}
FROM ${bracket(table.full_name)} AS t${fiscal};`;

    const verified = outgoing.filter((j) => j.verified);
    const joinClauses = verified
      .map(
        (j, i) =>
          `LEFT JOIN ${bracket(j.to_table)} AS p${i + 1}\n    ON t.[${j.from_col}] = p${i + 1}.[${j.to_col}]`,
      )
      .join("\n");
    const joinCols = verified
      .map((j, i) => `    p${i + 1}.* -- ${j.to_table}`)
      .join(",\n");

    const join = `-- پیوند ${table.full_name} با جدول‌های والد تأییدشده
SELECT
    t.*${joinCols ? `,\n${joinCols}` : ""}
FROM ${bracket(table.full_name)} AS t
${joinClauses || "-- هیچ رابطهٔ تأییدشده‌ای ثبت نشده است"}${fiscal};`;

    const pk = table.primary_key?.[0];
    const aggregate = `-- تجمیع و شمارش ${table.full_name}
SELECT
    COUNT(*) AS [TotalRows]${pk ? `,\n    COUNT(DISTINCT t.[${pk}]) AS [UniqueKeys]` : ""}${
      hasFiscalYear ? ",\n    t.[FiscalYearRef]" : ""
    }
FROM ${bracket(table.full_name)} AS t
${hasFiscalYear ? "GROUP BY t.[FiscalYearRef]\nORDER BY t.[FiscalYearRef] DESC;" : ";"}`;

    return { select, join, aggregate };
  }, [table, selectedNames, outgoing, hasFiscalYear]);

  const togglePick = useCallback((columnName) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) next.delete(columnName);
      else next.add(columnName);
      return next;
    });
  }, []);

  const pickKeyColumns = useCallback(() => {
    const keys = columns
      .filter(
        (c) =>
          c.is_pk ||
          fkByColumn.has(c.name) ||
          /title|name|code|number|date/i.test(c.name),
      )
      .map((c) => c.name);
    setPicked(new Set(keys));
    toast.success(`${fa(keys.length)} ستون کلیدی و شناسه‌ای انتخاب شد.`);
  }, [columns, fkByColumn]);

  const findPath = useCallback(
    async (target) => {
      const dst = (target ?? pathTarget).trim();
      if (!dst) {
        toast.error("نام جدول مقصد را وارد کنید.");
        return;
      }
      setPathBusy(true);
      setPathError("");
      setPathResult(null);
      try {
        const { data } = await http.get("/joinpath", {
          params: { source: table.full_name, target: dst },
        });
        setPathResult(data);
        if (!data.found) setPathError(data.warning || "مسیری پیدا نشد.");
      } catch (e) {
        setPathError(errorMessage(e, "ارتباط با سرور برقرار نشد."));
      } finally {
        setPathBusy(false);
      }
    },
    [pathTarget, table.full_name],
  );

  const pathSuggestions = useMemo(
    () =>
      (table.schema_neighbors || [])
        .filter((n) => n.has_data)
        .slice(0, 4)
        .map((n) => n.full_name),
    [table.schema_neighbors],
  );

  return (
    <div className="animate-fade-up space-y-3">
      {/* ── کارت سرصفحه ── */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-panel">
        <div className="h-1 w-full" style={{ background: accent.stroke }} />
        <div className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenSchemaGraph?.(schema)}
                  title={`گراف روابط اسکیمای ${schema}`}
                  className="inline-flex min-h-8 items-center rounded-md px-2 font-mono text-[11px] font-bold transition-opacity hover:opacity-80"
                  style={{ color: accent.text, background: accent.soft }}
                >
                  {schema}
                  {schemaLabel(schema) ? ` · ${schemaLabel(schema)}` : ""}
                </button>
                <h2 className="ltr min-w-0 select-all break-all font-mono text-base font-bold tracking-tight text-foreground sm:text-lg">
                  {name}
                </h2>
                <CopyButton
                  text={table.full_name}
                  label="کپی نام"
                  message={`${table.full_name} کپی شد.`}
                />
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-text" />}
              </div>

              {table.title_fa ? (
                <h3 className="text-sm font-bold text-foreground sm:text-base">{table.title_fa}</h3>
              ) : (
                <p className="text-[11px] italic text-muted-foreground">
                  عنوان فارسی ثبت نشده — با «آموزش دانش» اضافه‌اش کنید.
                </p>
              )}

              {table.description_fa && (
                <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  {table.description_fa}
                </p>
              )}

              {/*
                موجودیتِ نرم‌افزاری که این جدول پیاده‌سازی‌اش می‌کند. ماژولش
                بخش‌بندیِ خودِ نرم‌افزار است (HCM.Staff) نه اسکیمای پایگاه داده
                (HCM3) — همان محوری که کاربر در منوی نرم‌افزار می‌بیند، پس پلی
                است از چیزی که می‌شناسد به جدولی که نمی‌شناسد.
              */}
              {table.entity?.component && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[11px] text-muted-foreground">
                  <Boxes className="h-3.5 w-3.5 shrink-0 text-brand-text" />
                  <span>موجودیت نرم‌افزار:</span>
                  <span className="ltr font-mono text-foreground">{table.entity.name}</span>
                  <span className="text-borderStrong">·</span>
                  <span>{table.entity.component}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {table.has_data ? (
                  <Badge tone="ok">{fa(table.row_count)} ردیف داده</Badge>
                ) : (
                  <Badge tone="warn">بدون داده در نصب فعلی</Badge>
                )}
                {!table.in_live_db && <Badge tone="err">در دیتابیس زنده نیست</Badge>}
                {hasFiscalYear && (
                  <Badge tone="warn">
                    <AlertTriangle className="h-2.5 w-2.5" /> سال‌مالی‌محور
                  </Badge>
                )}
                {table.kind && <Badge tone="info">{table.kind}</Badge>}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => onOpenSchemaGraph?.(schema)}>
                <Network />
                <span className="hidden sm:inline">گراف اسکیما</span>
              </Button>
              <TeachDialog table={table} onDone={onRefresh} />
            </div>
          </div>

          {/*
            چهار سنجه، نه پنج. «ردیف‌ها» حذف شد چون تعداد ردیف همین بالا در نشانِ
            سربرگ آمده و اگر داده‌ای نباشد، هشدارِ زیرش هم دلیلش را می‌گوید — سه
            بار گفتنِ یک چیز. سود دوم: پنج کارت در شبکهٔ دوستونهٔ موبایل یک کارتِ
            یتیم به جا می‌گذاشت؛ چهارتا ۲×۲ تمیز می‌بندد.
          */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat icon={Columns3} label="ستون‌ها" value={fa(columns.length)} tone="brand" />
            <Stat
              icon={KeyRound}
              label="کلید اصلی"
              value={table.primary_key?.length ? table.primary_key.join("، ") : "ندارد"}
              tone={table.primary_key?.length ? "ok" : "warn"}
            />
            <Stat
              icon={Link2}
              label="روابط"
              value={fa(outgoing.length + incoming.length)}
              hint={`${fa(outgoing.length)} خروجی · ${fa(incoming.length)} ورودی`}
              tone="brand"
            />
            <Stat
              icon={ShieldCheck}
              label="ایندکس‌ها"
              value={fa((table.indexes || []).length)}
              hint={`${fa(indexed.size)} ستون ایندکس‌دار`}
            />
          </div>

          {table.warnings?.length > 0 && (
            <ul className="space-y-1.5">
              {table.warnings.map((w) => (
                <li
                  key={w}
                  className="flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn"
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── تب‌ها ── */}
      <Tabs value={tab} onValueChange={setTab}>
        {/*
          نوار تب هنگام اسکرول جدول‌های بلند (۷۳ ستون، ۴۱ رابطه) بالا می‌ماند
          تا کاربر برای عوض‌کردن تب مجبور نباشد تا سر صفحه برگردد.
        */}
        <TabsList className="sticky top-0 z-20 flex w-full flex-nowrap overflow-x-auto rounded-lg bg-ink/95 no-scrollbar backdrop-blur">
          <TabsTrigger value="relations" className="shrink-0">
            <Link2 className="h-3.5 w-3.5" />
            روابط
            <span className="font-mono text-[10px] opacity-70">
              {fa(outgoing.length + incoming.length)}
            </span>
          </TabsTrigger>
          <TabsTrigger value="columns" className="shrink-0">
            <Columns3 className="h-3.5 w-3.5" />
            ستون‌ها
            <span className="font-mono text-[10px] opacity-70">{fa(columns.length)}</span>
          </TabsTrigger>
          <TabsTrigger value="graph" className="shrink-0">
            <GitFork className="h-3.5 w-3.5" />
            نمودار
          </TabsTrigger>
          <TabsTrigger value="sql" className="shrink-0">
            <FileCode2 className="h-3.5 w-3.5" />
            SQL
          </TabsTrigger>
          <TabsTrigger value="indexes" className="shrink-0">
            <ShieldCheck className="h-3.5 w-3.5" />
            ایندکس
            <span className="font-mono text-[10px] opacity-70">
              {fa((table.indexes || []).length)}
            </span>
          </TabsTrigger>
          {hasEnums && (
            <TabsTrigger value="enums" className="shrink-0">
              <ListTree className="h-3.5 w-3.5" />
              کدینگ
              <span className="font-mono text-[10px] opacity-70">
                {fa(Object.keys(enums).length)}
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── روابط ── */}
        <TabsContent value="relations" className="space-y-3">
          <Section
            icon={Route}
            title="مسیریاب پیوند"
            hint="کوتاه‌ترین زنجیرهٔ JOIN تا هر جدول دیگر"
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={pathTarget}
                onChange={(e) => setPathTarget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && findPath()}
                placeholder="نام کامل جدول مقصد، مثلاً GNR3.Party"
                className="ltr h-9 font-mono text-xs"
              />
              <Button onClick={() => findPath()} disabled={pathBusy} className="shrink-0">
                {pathBusy ? <Loader2 className="animate-spin" /> : <Route />}
                یافتن مسیر
              </Button>
            </div>

            {pathSuggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">پیشنهاد:</span>
                {pathSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setPathTarget(s);
                      findPath(s);
                    }}
                    className="ltr rounded-full border border-border bg-ink px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {pathError && (
              <p className="mt-2 rounded-lg border border-warn/35 bg-warn/10 p-2 text-[11px] text-warn">
                {pathError}
              </p>
            )}

            {pathResult?.found && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge tone="ok">
                    مسیر {fa(pathResult.steps.length)} مرحله‌ای پیدا شد
                  </Badge>
                  <CopyButton
                    text={pathResult.steps.map((s) => s.sql).join("\n")}
                    label="کپی کل مسیر"
                    message="زنجیرهٔ JOIN کپی شد."
                  />
                </div>
                {pathResult.warning && (
                  <p className="rounded-lg border border-warn/35 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
                    {pathResult.warning}
                  </p>
                )}
                <ol className="space-y-1.5">
                  {pathResult.steps.map((step, i) => (
                    <li
                      key={`${step.from_table}-${step.to_table}-${i}`}
                      className="flex items-start gap-2 rounded-lg border border-border bg-ink p-2"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 font-mono text-[10px] font-bold text-brand-text">
                        {fa(i + 1)}
                      </span>
                      <code className="ltr min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[10.5px] leading-5 text-foreground/90">
                        {step.sql}
                      </code>
                      {!step.verified && <Badge tone="warn">استنتاجی</Badge>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Section>

          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={relationQuery}
              onChange={(e) => setRelationQuery(e.target.value)}
              placeholder="فیلتر روابط بر اساس نام جدول یا ستون…"
              className="h-9 ps-8 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Section
              icon={ArrowUpRight}
              title="روابط خروجی"
              hint="این جدول به کجا ارجاع می‌دهد"
              actions={<Badge tone="brand">{fa(filteredOutgoing.length)}</Badge>}
              bodyClassName="space-y-1.5 p-2"
            >
              {filteredOutgoing.length ? (
                filteredOutgoing.map((j, i) => (
                  <RelationRow
                    key={`${j.from_col}-${j.to_table}-${i}`}
                    direction="out"
                    join={j}
                    onSelectTable={onSelectTable}
                    isDark={isDark}
                  />
                ))
              ) : (
                <p className="p-3 text-center text-[11px] text-muted-foreground">
                  رابطهٔ خروجی‌ای ثبت نشده است.
                </p>
              )}
            </Section>

            <Section
              icon={ArrowDownLeft}
              title="روابط ورودی"
              hint="چه جدول‌هایی به این جدول ارجاع می‌دهند"
              actions={<Badge tone="brand">{fa(filteredIncoming.length)}</Badge>}
              bodyClassName="space-y-1.5 p-2"
            >
              {filteredIncoming.length ? (
                filteredIncoming.map((j, i) => (
                  <RelationRow
                    key={`${j.from_table}-${j.from_col}-${i}`}
                    direction="in"
                    join={j}
                    onSelectTable={onSelectTable}
                    isDark={isDark}
                  />
                ))
              ) : (
                <p className="p-3 text-center text-[11px] text-muted-foreground">
                  هیچ جدولی به این جدول ارجاع نمی‌دهد.
                </p>
              )}
            </Section>
          </div>

          <Section
            icon={Layers}
            title={`هم‌اسکیماها در ${schema}`}
            hint="پرارتباط‌ترین جدول‌های همین ماژول"
            actions={
              <div className="relative w-40">
                <Input
                  value={neighborQuery}
                  onChange={(e) => setNeighborQuery(e.target.value)}
                  placeholder="فیلتر…"
                  className="h-7 text-[11px]"
                />
              </div>
            }
            bodyClassName="p-2"
          >
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {neighbors.slice(0, 30).map((n) => (
                <button
                  key={n.full_name}
                  type="button"
                  onClick={() => onSelectTable?.(n.full_name)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-ink p-2 text-start transition-colors hover:border-brand/40 hover:bg-surfaceHover"
                >
                  <div className="min-w-0">
                    <div className="ltr truncate font-mono text-[11.5px] font-semibold text-foreground">
                      {splitTable(n.full_name).name}
                    </div>
                    {n.title_fa && (
                      <div className="truncate text-[10px] text-muted-foreground">{n.title_fa}</div>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {fa(n.degree)} رابطه
                  </span>
                </button>
              ))}
              {neighbors.length === 0 && (
                <p className="col-span-full p-3 text-center text-[11px] text-muted-foreground">
                  جدول هم‌اسکیمای دیگری یافت نشد.
                </p>
              )}
            </div>
          </Section>
        </TabsContent>

        {/* ── ستون‌ها ── */}
        <TabsContent value="columns" className="space-y-3">
          <Section icon={Columns3} title="ستون‌های جدول" bodyClassName="space-y-2.5 p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={columnQuery}
                  onChange={(e) => setColumnQuery(e.target.value)}
                  placeholder="جست‌وجوی نام یا نوع ستون…"
                  className="h-9 ps-8 text-xs"
                />
              </div>
              <Select
                value={columnSort}
                onChange={(e) => setColumnSort(e.target.value)}
                className="h-9 text-xs sm:w-44"
                aria-label="ترتیب ستون‌ها"
              >
                <option value="ordinal">ترتیب اصلی جدول</option>
                <option value="name">نام (A→Z)</option>
                <option value="type">نوع داده</option>
                <option value="keys">اهمیت کلید</option>
              </Select>
            </div>

            <div className="flex flex-wrap gap-1">
              {COLUMN_FILTERS.map((f) => {
                const Icon = f.icon;
                const active = columnCategory === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setColumnCategory(f.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10.5px] font-medium transition-colors",
                      active
                        ? "border-brand/50 bg-brand/12 text-brand-text"
                        : "border-border bg-ink text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {f.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <Badge tone={picked.size ? "brand" : "muted"}>
                {picked.size ? `${fa(picked.size)} ستون انتخاب‌شده` : "همهٔ ستون‌ها"}
              </Badge>
              <Button variant="ghost" size="xs" onClick={pickKeyColumns}>
                <KeyRound /> انتخاب کلیدها
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPicked(new Set(columns.map((c) => c.name)))}
              >
                <CheckSquare /> انتخاب همه
              </Button>
              {picked.size > 0 && (
                <Button variant="ghost" size="xs" onClick={() => setPicked(new Set())}>
                  <X /> پاک کردن
                </Button>
              )}
              <CopyButton
                text={selectedNames.join(", ")}
                label="کپی فهرست"
                message={`${fa(selectedNames.length)} نام ستون کپی شد.`}
                className="ms-auto"
              />
              <CopyButton
                text={sqlQueries.select}
                label="کپی SELECT"
                message="کوئری SELECT کپی شد."
              />
            </div>

            {/*
              جدولی با ده‌ها ستون باید ناحیهٔ اسکرول خودش را داشته باشد: هم
              سرستون‌ها هنگام پیمایش می‌مانند، هم صفحه به‌خاطر یک جدول
              چندصد ردیفی بی‌انتها نمی‌شود.
            */}
            <div className="max-h-[62dvh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] border-collapse text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-ink text-[10.5px] text-muted-foreground shadow-[0_1px_0_rgb(var(--border))]">
                    <th className="w-9 bg-ink p-2" />
                    <th className="bg-ink p-2 text-start font-semibold">نام ستون</th>
                    <th className="bg-ink p-2 text-start font-semibold">نوع داده</th>
                    <th className="bg-ink p-2 text-start font-semibold">ویژگی‌ها</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleColumns.map((c) => {
                    const fk = fkByColumn.get(c.name);
                    const isPicked = picked.has(c.name);
                    return (
                      <tr
                        key={c.name}
                        className={cn(
                          "border-t border-border transition-colors",
                          isPicked ? "bg-brand/8" : "hover:bg-surfaceHover/60",
                        )}
                      >
                        <td className="p-2 align-top">
                          <button
                            type="button"
                            onClick={() => togglePick(c.name)}
                            aria-label={isPicked ? "حذف از انتخاب" : "افزودن به انتخاب"}
                            className="-m-2 flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:text-brand-text"
                          >
                            {isPicked ? (
                              <CheckSquare className="h-3.5 w-3.5 text-brand-text" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                        <td className="p-2 align-top">
                          <div className="ltr flex items-center gap-1.5 font-mono text-[12px] font-medium text-foreground">
                            {c.name}
                          </div>
                          {c.label_fa && (
                            <div className="mt-0.5 text-[11px] text-brand-text/85">{c.label_fa}</div>
                          )}
                          {enums[c.name] && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {fa(enums[c.name].length)} مقدار کددار
                            </div>
                          )}
                        </td>
                        <td className="ltr p-2 align-top font-mono text-[11px] text-muted-foreground">
                          {c.type}
                        </td>
                        <td className="p-2 align-top">
                          <div className="flex flex-wrap items-center gap-1">
                            {c.is_pk && (
                              <Badge tone="ok">
                                <KeyRound className="h-2.5 w-2.5" /> PK
                              </Badge>
                            )}
                            {fk && (
                              <button
                                type="button"
                                onClick={() => onSelectTable?.(fk.to_table)}
                                title={`پرش به ${fk.to_table}`}
                              >
                                <Badge tone="brand">
                                  <Link2 className="h-2.5 w-2.5" />
                                  <span className="ltr max-w-[9rem] truncate">{fk.to_table}</span>
                                </Badge>
                              </button>
                            )}
                            {indexed.has(c.name) && (
                              <Badge tone="info">
                                <ShieldCheck className="h-2.5 w-2.5" /> ایندکس
                              </Badge>
                            )}
                            {!c.nullable && <Badge tone="warn">اجباری</Badge>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleColumns.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-[11px] text-muted-foreground">
                        ستونی با این فیلتر یافت نشد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </TabsContent>

        {/* ── نمودار ── */}
        <TabsContent value="graph">
          <TableGraph table={table} onSelectTable={onSelectTable} />
        </TabsContent>

        {/* ── SQL ── */}
        <TabsContent value="sql" className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {SQL_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSqlTemplate(t.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                  sqlTemplate === t.id
                    ? "border-brand/50 bg-brand/12 text-brand-text"
                    : "border-border bg-ink text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
            {picked.size > 0 && sqlTemplate === "select" && (
              <Badge tone="brand" className="ms-auto">
                محدود به {fa(picked.size)} ستون انتخابی
              </Badge>
            )}
          </div>

          {hasFiscalYear && (
            <p className="flex items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 p-2 text-[11px] leading-relaxed text-warn">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              این جدول ستون FiscalYearRef دارد؛ پارامتر سال مالی در کوئری گنجانده شده و
              حذف آن خروجی را بی‌خطا ولی نادرست می‌کند.
            </p>
          )}

          <SqlBlock sql={sqlQueries[sqlTemplate]} title={`T-SQL · ${table.full_name}`} />
        </TabsContent>

        {/* ── ایندکس‌ها ── */}
        <TabsContent value="indexes">
          <Section icon={ShieldCheck} title="ایندکس‌های واقعی دیتابیس" bodyClassName="space-y-1.5 p-2">
            {(table.indexes || []).length ? (
              (table.indexes || []).map((ix) => (
                <div key={ix.name} className="rounded-lg border border-border bg-ink p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="ltr min-w-0 truncate font-mono text-[11.5px] font-semibold text-foreground">
                      {ix.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {ix.is_pk && <Badge tone="ok">کلید اصلی</Badge>}
                      {ix.unique && <Badge tone="info">یکتا</Badge>}
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ix.columns.map((col, i) => (
                      <span
                        key={col}
                        className="ltr inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        <span className="text-brand-text">{fa(i + 1)}</span>
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon={ShieldCheck}
                title="ایندکسی ثبت نشده است"
                description="برای این جدول ایندکسی در متادیتای استخراج‌شده وجود ندارد."
                className="border-0"
              />
            )}
          </Section>
        </TabsContent>

        {/* ── کدینگ ── */}
        {hasEnums && (
          <TabsContent value="enums">
            <Section
              icon={ListTree}
              title="مقادیر کددار (Enum)"
              actions={
                <Input
                  value={enumQuery}
                  onChange={(e) => setEnumQuery(e.target.value)}
                  placeholder="فیلتر…"
                  className="h-7 w-32 text-[11px]"
                />
              }
              bodyClassName="space-y-2 p-2"
            >
              {Object.entries(filteredEnums).map(([col, values]) => (
                <div key={col} className="rounded-lg border border-border bg-ink p-2.5">
                  <div className="ltr mb-1.5 flex items-center gap-1.5 font-mono text-[11.5px] font-semibold text-foreground">
                    <Hash className="h-3 w-3 text-brand-text" />
                    {col}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {values.map((v) => (
                      <span
                        key={String(v.value)}
                        className="inline-flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10.5px]"
                        title={v.observed ? `${v.observed} بار مشاهده شده` : undefined}
                      >
                        <span className="ltr font-mono font-bold text-brand-text">{v.value}</span>
                        <span className={v.label_fa ? "text-foreground" : "text-muted-foreground"}>
                          {v.label_fa || "بدون معنی ثبت‌شده"}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {Object.keys(filteredEnums).length === 0 && (
                <p className="p-4 text-center text-[11px] text-muted-foreground">
                  مقداری با این فیلتر یافت نشد.
                </p>
              )}
            </Section>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
