import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Compass,
  Database,
  Filter,
  Hash,
  Layers,
  Loader2,
  Network,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Type,
  X,
} from "lucide-react";

import { errorMessage, http } from "@/lib/api";
import { cn, fa, faCompact, splitTable } from "@/lib/utils";
import { schemaAccent, schemaLabel } from "@/lib/schemaTheme";
import { useTheme } from "@/context/ThemeContext";
import { Badge, EmptyState, LoadingBar } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/sonner";
import TableDetail from "@/views/TableDetail";

const DATA_STATUS = [
  { id: "all", label: "همه" },
  { id: "with_data", label: "دارای داده" },
  { id: "no_data", label: "خالی" },
];

const FIELD_TYPES = [
  { id: "", label: "همهٔ نوع فیلدها" },
  { id: "int", label: "عددی صحیح — int, bigint" },
  { id: "decimal", label: "اعشاری و مالی — decimal, money" },
  { id: "varchar", label: "متنی — varchar, nvarchar, text" },
  { id: "datetime", label: "تاریخ و زمان — date, datetime" },
  { id: "bit", label: "بولی — bit" },
  { id: "uniqueidentifier", label: "شناسهٔ یکتا — GUID" },
  { id: "binary", label: "باینری و مدیا — binary, image" },
  { id: "custom", label: "نوع دلخواه…" },
];

const ROW_PRESETS = [
  { id: "all", label: "همه", min: "", max: "" },
  { id: "1_1k", label: "۱ تا ۱ هزار", min: 1, max: 1000 },
  { id: "1k_50k", label: "۱ تا ۵۰ هزار", min: 1000, max: 50000 },
  { id: "50k", label: "بیش از ۵۰ هزار", min: 50000, max: "" },
  { id: "1m", label: "بیش از ۱ میلیون", min: 1000000, max: "" },
  { id: "custom", label: "بازهٔ دلخواه", min: "", max: "" },
];

const SORTS = [
  { id: "score", label: "مرتبط‌ترین" },
  { id: "row_count_desc", label: "پرحجم‌ترین (ردیف ↓)" },
  { id: "row_count_asc", label: "کم‌حجم‌ترین (ردیف ↑)" },
  { id: "n_cols", label: "بیشترین ستون" },
  { id: "name", label: "الفبایی (A→Z)" },
];

const INITIAL = {
  dataStatus: "all",
  fieldType: "",
  customFieldType: "",
  rowPreset: "all",
  minRows: "",
  maxRows: "",
  schema: "",
  sortBy: "score",
};

function activeFilterCount(f) {
  let n = 0;
  if (f.dataStatus !== "all") n += 1;
  if (f.fieldType) n += 1;
  if (f.minRows !== "" || f.maxRows !== "") n += 1;
  if (f.schema) n += 1;
  if (f.sortBy !== "score") n += 1;
  return n;
}

function sortParams(sortBy) {
  if (sortBy === "row_count_desc") return { sortBy: "row_count", sortOrder: "desc" };
  if (sortBy === "row_count_asc") return { sortBy: "row_count", sortOrder: "asc" };
  if (sortBy === "name") return { sortBy: "name", sortOrder: "asc" };
  if (sortBy === "n_cols") return { sortBy: "n_cols", sortOrder: "desc" };
  return { sortBy: "score", sortOrder: "desc" };
}

/** کارت یک نتیجه در فهرست جست‌وجو. */
function ResultCard({ hit, selected, onOpen, isDark }) {
  const { schema, name } = splitTable(hit.full_name);
  const accent = schemaAccent(schema, isDark);

  return (
    <button
      type="button"
      onClick={() => onOpen(hit.full_name)}
      className={cn(
        "group block w-full rounded-lg border p-2.5 text-start transition-all duration-150",
        selected
          ? "border-brand/55 bg-brand/10 shadow-sm"
          : "border-transparent bg-surface/60 hover:border-border hover:bg-surfaceHover",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
              style={{ color: accent.text, background: accent.soft }}
            >
              {schema}
            </span>
            <span className="ltr truncate font-mono text-[12.5px] font-semibold text-foreground">
              {name}
            </span>
          </div>
          {hit.title_fa && (
            <div className="mt-1 truncate text-[11.5px] text-muted-foreground">{hit.title_fa}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {hit.has_data ? (
            <Badge tone="ok">{faCompact(hit.row_count)} ردیف</Badge>
          ) : (
            <Badge tone="warn">بدون داده</Badge>
          )}
          {!hit.in_live_db && <Badge tone="err">خارج از دیتابیس</Badge>}
        </div>
      </div>

      {hit.matched_columns?.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Type className="h-2.5 w-2.5 shrink-0 text-brand-text" />
          {hit.matched_columns.slice(0, 3).map((c) => (
            <span
              key={c.name}
              className="ltr rounded bg-brand/10 px-1 py-px font-mono text-[9.5px] text-brand-text"
            >
              {c.name}
              <span className="text-muted-foreground"> · {c.type}</span>
            </span>
          ))}
          {hit.matched_columns.length > 3 && (
            <span className="font-mono text-[9.5px] text-muted-foreground">
              +{fa(hit.matched_columns.length - 3)}
            </span>
          )}
        </div>
      )}

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">{hit.why}</span>
        <span className="shrink-0 font-mono">{fa(hit.n_cols)} ستون</span>
      </div>
    </button>
  );
}

export default function ExplorerView({ health, focusTable, onOpenSchemaGraph }) {
  const { isDark } = useTheme();

  const [q, setQ] = useState("");
  const [filters, setFilters] = useState(INITIAL);
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const [schemas, setSchemas] = useState([]);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const searchRef = useRef(null);
  const requestId = useRef(0);
  const filterCount = activeFilterCount(filters);

  // میان‌بر «/» برای پریدن به جست‌وجو — بدون اینکه تایپ داخل فیلدها را بدزدد
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    http
      .get("/schemas")
      .then(({ data }) => setSchemas(data.schemas || []))
      .catch(() => setSchemas([]));
  }, []);

  const runSearch = useCallback(
    async (query, f) => {
      const text = query.trim();
      const hasFilters = activeFilterCount(f) > 0;
      if (!text && !hasFilters) {
        setResults([]);
        setSearched(false);
        return;
      }

      const id = (requestId.current += 1);
      setBusy(true);
      try {
        const { data } = await http.get("/search", {
          params: {
            q: text,
            schema: f.schema || undefined,
            dataStatus: f.dataStatus,
            fieldType:
              (f.fieldType === "custom" ? f.customFieldType.trim() : f.fieldType) || undefined,
            minRows: f.minRows !== "" ? f.minRows : undefined,
            maxRows: f.maxRows !== "" ? f.maxRows : undefined,
            ...sortParams(f.sortBy),
            limit: 80,
          },
        });
        if (id !== requestId.current) return; // پاسخ کهنه — نتیجه‌ی تازه‌تر آمده
        setResults(data.results || []);
        setSearched(true);
      } catch (e) {
        if (id === requestId.current) toast.error(errorMessage(e, "جست‌وجو ناموفق بود."));
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [],
  );

  // جست‌وجوی خودکار با تأخیر کوتاه: کاربر تایپ می‌کند، نتیجه خودش می‌آید.
  useEffect(() => {
    const t = setTimeout(() => runSearch(q, filters), 320);
    return () => clearTimeout(t);
  }, [q, filters, runSearch]);

  const openTable = useCallback(async (fullName) => {
    setDetailLoading(true);
    try {
      const { data } = await http.get(`/table/${encodeURIComponent(fullName)}`);
      setDetail(data);
    } catch (e) {
      toast.error(errorMessage(e, "بارگذاری جدول ناموفق بود."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // درخواست باز کردن جدول از بیرون (مثلاً کلیک روی گره در گراف اسکیما)
  useEffect(() => {
    if (focusTable?.name) openTable(focusTable.name);
  }, [focusTable, openTable]);

  const patch = useCallback((next) => setFilters((f) => ({ ...f, ...next })), []);

  const resetFilters = useCallback(() => {
    setFilters(INITIAL);
    toast.success("فیلترها بازنشانی شد.");
  }, []);

  const applyRowPreset = useCallback(
    (preset) => {
      patch({
        rowPreset: preset.id,
        minRows: preset.id === "custom" ? filters.minRows : preset.min === "" ? "" : String(preset.min),
        maxRows: preset.id === "custom" ? filters.maxRows : preset.max === "" ? "" : String(preset.max),
      });
    },
    [patch, filters.minRows, filters.maxRows],
  );

  const topSchemas = useMemo(() => schemas.slice(0, 8), [schemas]);

  const chips = useMemo(() => {
    const out = [];
    if (filters.dataStatus !== "all")
      out.push({
        key: "dataStatus",
        icon: Database,
        text: filters.dataStatus === "with_data" ? "دارای داده" : "بدون داده",
        clear: () => patch({ dataStatus: "all" }),
      });
    if (filters.fieldType)
      out.push({
        key: "fieldType",
        icon: Type,
        text: `نوع: ${filters.fieldType === "custom" ? filters.customFieldType || "دلخواه" : filters.fieldType}`,
        clear: () => patch({ fieldType: "", customFieldType: "" }),
      });
    if (filters.minRows !== "" || filters.maxRows !== "")
      out.push({
        key: "rows",
        icon: Hash,
        text: `${filters.minRows ? fa(filters.minRows) : "۰"} تا ${filters.maxRows ? fa(filters.maxRows) : "∞"}`,
        clear: () => patch({ rowPreset: "all", minRows: "", maxRows: "" }),
      });
    if (filters.schema)
      out.push({
        key: "schema",
        icon: Layers,
        text: `اسکیما: ${filters.schema}`,
        clear: () => patch({ schema: "" }),
      });
    if (filters.sortBy !== "score")
      out.push({
        key: "sort",
        icon: SlidersHorizontal,
        text: SORTS.find((s) => s.id === filters.sortBy)?.label || "",
        clear: () => patch({ sortBy: "score" }),
      });
    return out;
  }, [filters, patch]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* ── ستون جست‌وجو ── */}
      <aside
        className={cn(
          "flex w-full min-w-0 shrink-0 flex-col border-e border-border bg-surface/40 md:w-[360px] lg:w-[400px] xl:w-[440px]",
          detail ? "hidden md:flex" : "flex",
        )}
      >
        <div className="space-y-2 border-b border-border bg-surface/70 p-3">
          <div className="flex gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQ("");
                    e.currentTarget.blur();
                  }
                }}
                placeholder="نام جدول، ستون، اسکیما یا عنوان فارسی…  ( / )"
                aria-label="جست‌وجوی جدول"
                className="h-9 ps-8 pe-8 text-xs"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="پاک کردن جست‌وجو"
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              title="فیلترهای پیشرفته"
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors",
                showFilters || filterCount
                  ? "border-brand/50 bg-brand/12 text-brand-text"
                  : "border-border bg-ink text-muted-foreground hover:border-borderStrong hover:text-foreground",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {filterCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] font-bold leading-none text-brand-foreground">
                  {fa(filterCount)}
                </span>
              )}
            </button>
          </div>

          {showFilters && (
            <div className="animate-fade-up space-y-3 rounded-lg border border-brand/20 bg-ink p-2.5">
              <div className="flex items-center justify-between border-b border-border pb-1.5">
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-foreground">
                  <Filter className="h-3 w-3 text-brand-text" />
                  فیلترهای پیشرفته
                </span>
                {filterCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="flex items-center gap-1 text-[10.5px] text-err transition-colors hover:opacity-80"
                  >
                    <RotateCcw className="h-3 w-3" />
                    بازنشانی
                  </button>
                )}
              </div>

              {/* وضعیت داده */}
              <div className="space-y-1.5">
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
                  <Database className="h-3 w-3 text-brand-text" />
                  وضعیت داده در نصب فعلی
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-surface p-1">
                  {DATA_STATUS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => patch({ dataStatus: o.id })}
                      className={cn(
                        "truncate rounded-xs px-2 py-1 text-[11px] font-medium transition-colors",
                        filters.dataStatus === o.id
                          ? "bg-brand text-brand-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* نوع فیلد */}
              <div className="space-y-1.5">
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
                  <Type className="h-3 w-3 text-brand-text" />
                  نوع دادهٔ ستون‌ها
                </span>
                <Select
                  value={filters.fieldType}
                  onChange={(e) => patch({ fieldType: e.target.value })}
                  className="h-8 text-[11px]"
                  aria-label="نوع دادهٔ ستون"
                >
                  {FIELD_TYPES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
                {filters.fieldType === "custom" && (
                  <Input
                    value={filters.customFieldType}
                    onChange={(e) => patch({ customFieldType: e.target.value })}
                    placeholder="nvarchar(max) · money · float …"
                    className="ltr h-8 font-mono text-[11px]"
                  />
                )}
              </div>

              {/* تعداد ردیف */}
              <div className="space-y-1.5">
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground">
                  <Hash className="h-3 w-3 text-brand-text" />
                  تعداد ردیف‌ها
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {ROW_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyRowPreset(p)}
                      className={cn(
                        "truncate rounded-sm border px-1.5 py-1 text-[10px] font-medium transition-colors",
                        filters.rowPreset === p.id
                          ? "border-brand/60 bg-brand/12 text-brand-text"
                          : "border-border bg-surface text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {(filters.rowPreset === "custom" ||
                  filters.minRows !== "" ||
                  filters.maxRows !== "") && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={filters.minRows}
                      onChange={(e) => patch({ minRows: e.target.value, rowPreset: "custom" })}
                      placeholder="حداقل"
                      className="ltr h-8 font-mono text-[11px]"
                    />
                    <Input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={filters.maxRows}
                      onChange={(e) => patch({ maxRows: e.target.value, rowPreset: "custom" })}
                      placeholder="حداکثر"
                      className="ltr h-8 font-mono text-[11px]"
                    />
                  </div>
                )}
              </div>

              {/* اسکیما و مرتب‌سازی */}
              <div className="grid grid-cols-1 gap-2 border-t border-border pt-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-[10.5px] font-semibold text-muted-foreground">اسکیما</span>
                  <Select
                    value={filters.schema}
                    onChange={(e) => patch({ schema: e.target.value })}
                    className="h-8 text-[11px]"
                    aria-label="فیلتر اسکیما"
                  >
                    <option value="">همهٔ اسکیماها</option>
                    {schemas.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}
                        {schemaLabel(s.id) ? ` · ${schemaLabel(s.id)}` : ""} ({s.table_count})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-[10.5px] font-semibold text-muted-foreground">
                    ترتیب نتایج
                  </span>
                  <Select
                    value={filters.sortBy}
                    onChange={(e) => patch({ sortBy: e.target.value })}
                    className="h-8 text-[11px]"
                    aria-label="ترتیب نتایج"
                  >
                    {SORTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => {
                const Icon = c.icon;
                return (
                  <span
                    key={c.key}
                    className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10.5px] text-brand-text"
                  >
                    <Icon className="h-2.5 w-2.5" />
                    <span className="max-w-[9rem] truncate">{c.text}</span>
                    <button
                      type="button"
                      onClick={c.clear}
                      aria-label="حذف فیلتر"
                      className="rounded p-0.5 transition-colors hover:text-err"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={resetFilters}
                className="ms-auto text-[10px] text-muted-foreground underline transition-colors hover:text-err"
              >
                پاک کردن همه
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {busy ? (
                <span className="flex items-center gap-1 text-brand-text">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  در حال جست‌وجو…
                </span>
              ) : filterCount > 0 ? (
                <span className="text-brand-text">{fa(filterCount)} فیلتر فعال</span>
              ) : (
                "جست‌وجو در ساختار پایگاه داده"
              )}
            </span>
            {results.length > 0 && (
              <span className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground">
                {fa(results.length)} جدول
              </span>
            )}
          </div>
        </div>

        <LoadingBar show={busy} />

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {results.map((hit) => (
              <ResultCard
                key={hit.full_name}
                hit={hit}
                selected={detail?.full_name === hit.full_name}
                onOpen={openTable}
                isDark={isDark}
              />
            ))}

            {!busy && results.length === 0 && searched && (
              <EmptyState
                icon={Search}
                title="جدولی با این شرایط پیدا نشد"
                description="عبارت کوتاه‌تری امتحان کنید یا فیلترها را کمی باز بگذارید."
                action={
                  filterCount > 0 ? (
                    <Button variant="soft" size="sm" onClick={resetFilters}>
                      <RotateCcw /> بازنشانی فیلترها
                    </Button>
                  ) : null
                }
                className="border-0 bg-transparent"
              />
            )}

            {!busy && results.length === 0 && !searched && (
              <div className="p-1">
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Compass className="h-3.5 w-3.5 text-brand-text" />
                    شروع سریع از اسکیماها
                  </span>
                  <span className="text-[10px]">
                    {health?.kb?.schemas ? `${fa(health.kb.schemas)} اسکیما` : ""}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-1.5 xs:grid-cols-2 sm:grid-cols-2">
                  {topSchemas.map((s) => {
                    const accent = schemaAccent(s.id, isDark);
                    return (
                      <div
                        key={s.id}
                        className="group flex items-stretch gap-1 rounded-lg border border-border bg-ink/70 p-2 transition-colors hover:border-brand/40 hover:bg-surfaceHover"
                      >
                        <button
                          type="button"
                          onClick={() => patch({ schema: s.id, sortBy: "row_count_desc" })}
                          className="flex min-w-0 flex-1 flex-col items-start text-start"
                        >
                          <span
                            className="font-mono text-xs font-bold"
                            style={{ color: accent.text }}
                          >
                            {s.id}
                          </span>
                          <span className="mt-0.5 truncate text-[11px] text-foreground">
                            {schemaLabel(s.id) || "بدون عنوان فارسی"}
                          </span>
                          <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            {fa(s.table_count)} جدول · {fa(s.with_data)} با داده
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenSchemaGraph?.(s.id)}
                          title={`گراف روابط اسکیمای ${s.id}`}
                          aria-label={`گراف روابط اسکیمای ${s.id}`}
                          className="flex w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-brand/12 hover:text-brand-text"
                        >
                          <Network className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <p className="mt-3 rounded-lg border border-border bg-surface/40 p-2.5 text-center text-[11px] leading-relaxed text-muted-foreground">
                  کلمه‌ای مثل «سند»، «فاکتور»، «انبار» یا نام دقیق جدول را بنویسید؛
                  نتیجه هم‌زمان با تایپ به‌روز می‌شود.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* ── ستون جزئیات ── */}
      <section
        className={cn(
          "min-w-0 flex-1 overflow-y-auto",
          detail ? "block" : "hidden md:block",
        )}
      >
        {detailLoading && !detail ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-brand-text" />
            در حال بارگذاری جدول…
          </div>
        ) : detail ? (
          <div className="p-3 sm:p-4 lg:p-5">
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="mb-3 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground md:hidden"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              بازگشت به فهرست
            </button>
            <TableDetail
              table={detail}
              loading={detailLoading}
              onSelectTable={openTable}
              onOpenSchemaGraph={onOpenSchemaGraph}
              onRefresh={() => openTable(detail.full_name)}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={Database}
              title="یک جدول را برای کاوش انتخاب کنید"
              description="ستون‌ها، کلیدها، ایندکس‌ها، مقادیر کدینگ، روابط ورودی و خروجی و نمودار گرافیکی هر جدول این‌جا نمایش داده می‌شود."
              className="max-w-lg"
            />
          </div>
        )}
      </section>
    </div>
  );
}
