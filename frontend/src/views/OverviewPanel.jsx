import { useMemo } from "react";
import { Columns3, Compass, Database, Link2, Network, Tag } from "lucide-react";

import { cn, fa } from "@/lib/utils";
import { schemaAccent, schemaLabel } from "@/lib/schemaTheme";

/*
  صفحهٔ نخست — چیزی که پیش از انتخاب هیچ جدولی دیده می‌شود.

  پیش از این، ستون جزئیات تا وقتی کاربر روی جدولی کلیک نکرده بود یک کارت
  کوچکِ «یک جدول انتخاب کنید» وسط هزار پیکسل فضای خالی نشان می‌داد، و
  فهرست اسکیماها — تنها چیزی که واقعاً در آن لحظه به درد می‌خورد — در ریل
  ۴۲۰ پیکسلی کنار فشرده شده بود و فقط ۸ تا از ۳۸ اسکیما را جا می‌داد.

  این کامپوننت همان فضا را به در ورودی برنامه تبدیل می‌کند: مقیاس پایگاه
  داده در یک نگاه، و همهٔ ماژول‌ها به‌صورت شبکه‌ای که با پهنای نمایشگر باز
  می‌شود. ریل کنار برای جست‌وجو می‌ماند، که کار خودش است.
*/

function MetricCard({ icon: Icon, label, value, hint, index }) {
  return (
    <div
      className="anim-stagger rounded-lg border border-border bg-surface/70 p-3"
      style={{ "--i": index }}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-brand-text" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-mono text-xl font-bold leading-none tracking-tight text-foreground">
        {value}
      </div>
      {hint && <div className="mt-1 truncate text-[10.5px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SchemaCard({ schema, index, isDark, onOpen, onGraph }) {
  const accent = schemaAccent(schema.id, isDark);
  const total = schema.table_count || 0;
  const withData = schema.with_data || 0;
  // سهم جدول‌های دارای داده — همان چیزی که می‌گوید این ماژول نزد این مشتری
  // فعال بوده یا نه، و مهم‌ترین تفاوت بین دو اسکیمای هم‌اندازه است.
  const ratio = total > 0 ? Math.round((withData / total) * 100) : 0;

  return (
    <div
      className={cn(
        "anim-stagger group relative flex items-stretch gap-1 rounded-lg border border-border",
        "bg-surface/70 p-2.5 transition-colors duration-150 hover:border-brand/45 hover:bg-surfaceHover",
      )}
      style={{ "--i": index }}
    >
      <button
        type="button"
        onClick={() => onOpen(schema.id)}
        className="flex min-w-0 flex-1 flex-col items-start text-start"
      >
        <div className="flex w-full items-center gap-1.5">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
            style={{ color: accent.text, background: accent.soft }}
          >
            {schema.id}
          </span>
          <span className="ms-auto shrink-0 text-[10.5px] text-muted-foreground">
            {fa(total)} جدول
          </span>
        </div>

        <span className="mt-1.5 line-clamp-1 text-[12.5px] font-medium text-foreground">
          {schemaLabel(schema.id) || "بدون عنوان فارسی"}
        </span>

        {/* نوار سهم داده — عرض کامل کارت، تا مقایسهٔ چشمی بین کارت‌ها ممکن باشد */}
        <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-borderStrong/45">
          <span
            className="block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${ratio}%`, background: accent.text }}
          />
        </span>
        <span className="mt-1 truncate text-[10.5px] text-muted-foreground">
          {withData > 0 ? `${fa(withData)} جدول با داده` : "بدون داده در این نصب"}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onGraph(schema.id)}
        title={`گراف روابط اسکیمای ${schema.id}`}
        aria-label={`گراف روابط اسکیمای ${schema.id}`}
        className="flex w-8 shrink-0 items-center justify-center self-start rounded-md py-1.5 text-muted-foreground transition-colors hover:bg-brand/12 hover:text-brand-text"
      >
        <Network className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function OverviewPanel({ health, schemas, isDark, onOpenSchema, onOpenGraph }) {
  // بزرگ‌ترین ماژول‌ها اول — کاربری که تازه رسیده، از جایی شروع می‌کند که
  // بیشترین چیز برای دیدن دارد، نه از حرف الفبا.
  const ordered = useMemo(
    () => [...schemas].sort((a, b) => (b.table_count || 0) - (a.table_count || 0)),
    [schemas],
  );

  const kb = health?.kb;
  const titled = Number(kb?.with_title_fa || 0);
  const tables = Number(kb?.tables || 0);
  const coverage = tables > 0 ? Math.round((titled / tables) * 100) : 0;

  return (
    <div className="anim-fade">
      <div className="mb-4">
        <h1 className="text-base font-extrabold tracking-tight text-foreground">
          ساختار پایگاه دادهٔ شما
        </h1>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          از ریل کنار جست‌وجو کنید، یا از همین‌جا وارد یکی از ماژول‌ها شوید.
        </p>
      </div>

      {kb && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            index={0}
            icon={Database}
            label="جدول"
            value={fa(kb.tables)}
            hint={`${fa(kb.active_tables)} با داده در این نصب`}
          />
          <MetricCard index={1} icon={Columns3} label="ستون" value={fa(kb.columns)} />
          <MetricCard
            index={2}
            icon={Link2}
            label="رابطه"
            value={fa(kb.joins)}
            hint="مسیرهای JOIN شناخته‌شده"
          />
          <MetricCard
            index={3}
            icon={Tag}
            label="عنوان فارسی"
            value={fa(kb.with_title_fa)}
            hint={`${fa(coverage)}٪ از جدول‌ها`}
          />
          <MetricCard
            index={4}
            icon={Compass}
            label="ماژول"
            value={fa(kb.schemas)}
            hint={kb.schema_titles ? `${fa(kb.schema_titles)} با نام فارسی` : undefined}
          />
        </div>
      )}

      <div className="mb-2 flex items-center justify-between px-0.5">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <Compass className="h-3.5 w-3.5 text-brand-text" />
          ماژول‌ها
        </h2>
        <span className="text-[10.5px] text-muted-foreground">
          {ordered.length ? `${fa(ordered.length)} ماژول` : ""}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {ordered.map((s, i) => (
          <SchemaCard
            key={s.id}
            schema={s}
            // تأخیر پلکانی فقط برای موج ورود است؛ سقفش در CSS بسته شده تا
            // کارت سی‌ام هم بی‌جهت منتظر نماند.
            index={i}
            isDark={isDark}
            onOpen={onOpenSchema}
            onGraph={onOpenGraph}
          />
        ))}
      </div>
    </div>
  );
}
