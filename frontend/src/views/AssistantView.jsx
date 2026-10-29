import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  BadgeCheck,
  Cpu,
  CircleSlash,
  Compass,
  Download,
  HelpCircle,
  KeyRound,
  Layers,
  Lightbulb,
  Link2,
  ListOrdered,
  Loader2,
  MessageSquarePlus,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  Square,
  Table2,
  Wand2,
  WifiOff,
  X,
} from "lucide-react";

import { ASK_ASSISTANT, CAN_DOWNLOAD, HAS_ASSISTANT, errorMessage, http } from "@/lib/api";
import { cn, fa, faText } from "@/lib/utils";
import { answerOffline, OFFLINE_SAMPLES } from "@/lib/assistant/offline";
import { CopyButton, SqlBlock } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/*
  دستیار کوئری‌نویسی.

  آنچه این صفحه نشان می‌دهد عمداً بیشتر از «یک کوئری» است، چون ادعای دقت
  بدون نشان‌دادنِ دلیلش بی‌ارزش است. برای هر پاسخ سه چیز دیده می‌شود:

    • مراحلی که طی شد — با مدل ضعیف‌تر، دورهای اصلاح بیشتر می‌شود و همین
      جدول زمانی می‌گوید چرا طول کشید. سکوتِ طولانی از «گیر کرده» قابل
      تشخیص نیست.
    • نتیجهٔ بازبینی — کوئری با ساختار واقعی سنجیده شده یا نه، و اگر ایرادی
      مانده، دقیقاً چه.
    • جدول‌ها و پیوندهایی که کوئری رویشان ساخته شده، با پیوند به خودِ جدول
      در تب کاوش.

  کوئریِ تأییدنشده هرگز به‌شکل تأییدشده نشان داده نمی‌شود.

  دو موتور پشت این صفحه است:
    • آفلاین (lib/assistant/offline.js) — پرسش‌های ساختاری مثل «ارتباط سند و
      طرف حساب»، «ستون‌های جدول کارمند» یا «مقادیر وضعیت سند» را بی‌مدل و
      بی‌کلید، از همان دانش پایگاه داده پاسخ می‌دهد. سریع است و رایگان.
    • هوشمند (مدل زبانی، با کلید API) — برای محاسبه، شرط، بازهٔ زمانی و
      پرسش‌های آزاد.
  در حالت «خودکار» پرسش ساده آفلاین پاسخ می‌گیرد و بقیه به مدل می‌رود. بی‌کلید
  همه‌چیز آفلاین است و اگر پرسش پیشرفته باشد، پاسخ پایه با این توضیح می‌آید
  که پاسخ کامل کلید می‌خواهد.

  و پیش از همهٔ این‌ها، «برداشت»: دستیار اول می‌گوید خواستهٔ شما را چه
  فهمیده — هدف، خروجی، فیلترها، فرض‌ها — و اگر جایی مبهم است، همان را
  می‌پرسد. اگر برداشت غلط باشد، کاربر همان‌جا می‌بیند، نه بعد از اجرای
  کوئری روی داده‌های واقعی.

  پرسش‌ها یک گفت‌وگویند: سه پرسش‌وپاسخ آخر همراه پرسش تازه می‌رود، تا
  «حالا فقط امسال» روی کوئری قبلی ساخته شود.

  گفت‌وگو و جدول‌های سنجاق‌شده در localStorage می‌مانند: رفتن به زبانهٔ
  جدول‌ها برای نگاه‌کردن به یک ستون نباید گفت‌وگو را پاک کند. جدول سنجاق‌شده
  (از همین‌جا یا با دکمهٔ «پرسش از دستیار» در صفحهٔ جدول) همیشه در زمینهٔ
  پاسخ هست، هرچه جست‌وجو پیدا کند.
*/

const TURNS_KEY = "kavosh.assistant.turns.v1";
const PINNED_KEY = "kavosh.assistant.pinned.v1";
const MAX_SAVED_TURNS = 20;
const MAX_PINNED = 5;

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* حافظهٔ مرورگر پر یا بسته است — گفت‌وگو فقط در همین نشست می‌ماند */
  }
}

/** گفت‌وگوی ذخیره‌شده؛ پرسشی که هنگام بستن نیمه‌کاره بود، همین را می‌گوید. */
function loadTurns() {
  const turns = loadJson(TURNS_KEY, []);
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((t) => t && typeof t.question === "string")
    .map((t) => (t.running ? { ...t, running: false, error: t.error || "این پرسش نیمه‌کاره ماند." } : t));
}

function loadPinned() {
  const pinned = loadJson(PINNED_KEY, []);
  return Array.isArray(pinned) ? pinned.filter((p) => typeof p === "string").slice(0, MAX_PINNED) : [];
}

/** کل پاسخ به‌صورت متن — برای کپی در گزارش یا پیام. */
function answerText(turn) {
  const { question, result } = turn;
  const parts = [`پرسش: ${question}`];
  if (result?.note) parts.push(result.note.trim());
  if (result?.sql) parts.push("```sql\n" + result.sql.trim() + "\n```");
  return parts.join("\n\n");
}

function downloadSql(turn) {
  const header = `-- ${turn.question.replace(/\s+/g, " ")}\n-- کاوشگر پایگاه داده — دستیار کوئری‌نویسی\n\n`;
  const blob = new Blob([header + turn.result.sql.trim() + "\n"], { type: "application/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kavosh-query.sql";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const AI_SAMPLES = [
  "فهرست کارمندان به همراه نام واحد سازمانی‌شان",
  "جمع بدهکار و بستانکار هر سند حسابداری در سال مالی جاری",
  "سندهای پرداختی که وضعیتشان تأییدنشده است",
  "گردش حساب هر طرف حساب به تفکیک ماه",
];

const STEP_LABEL = {
  understand: "فهم خواسته",
  retrieve: "بازیابی",
  select: "انتخاب جدول",
  context: "زمینه‌سازی",
  draft: "نگارش",
  verify: "بازبینی",
  model: "مدل",
  offline: "آفلاین",
  done: "پایان",
  error: "خطا",
};

function StepTrail({ steps, running }) {
  if (!steps.length) return null;
  const last = steps[steps.length - 1];
  return (
    <details className="group rounded-md border border-border bg-ink/40" open={running}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand-text" />
        ) : (
          <BadgeCheck className="h-3 w-3 shrink-0 text-ok" />
        )}
        <span className="truncate">
          {running ? faText(last.message) : `${fa(steps.length)} مرحله`}
        </span>
        <span className="ms-auto shrink-0 text-[10px] opacity-60 group-open:hidden">جزئیات</span>
      </summary>
      <ol className="space-y-1 border-t border-border/70 px-2.5 py-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[10.5px] leading-relaxed">
            <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-brand/70" />
            <span className="shrink-0 font-medium text-brand-text">
              {STEP_LABEL[s.type] || s.type}
            </span>
            <span className="min-w-0 text-muted-foreground">{faText(s.message)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Verdict({ check }) {
  if (!check) return null;
  const errors = check.findings.filter((f) => f.severity === "error");
  const warnings = check.findings.filter((f) => f.severity === "warning");

  const tone = errors.length ? "err" : warnings.length ? "warn" : "ok";
  const Icon = errors.length ? CircleSlash : warnings.length ? AlertTriangle : BadgeCheck;
  const headline = errors.length
    ? "این کوئری با ساختار پایگاه دادهٔ شما نمی‌خواند"
    : warnings.length
      ? "کوئری معتبر است، ولی نکته‌ای هست"
      : "با ساختار پایگاه دادهٔ شما بررسی و تأیید شد";

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        tone === "ok" && "border-ok/40 bg-ok/8",
        tone === "warn" && "border-warn/40 bg-warn/8",
        tone === "err" && "border-err/40 bg-err/8",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11.5px] font-semibold",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "err" && "text-err",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {headline}
      </p>
      {check.findings.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {check.findings.map((f, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-foreground/90">
              <span className="text-muted-foreground">
                {f.severity === "error" ? "خطا" : "هشدار"}:
              </span>{" "}
              {f.message}
              {f.hint && (
                <span className="block ps-3 text-[10.5px] text-muted-foreground">{f.hint}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


const INTENT_ROWS = [
  ["output", "خروجی"],
  ["filters", "فیلترها"],
  ["grouping", "گروه‌بندی"],
  ["ordering", "مرتب‌سازی"],
  ["period", "بازهٔ زمانی"],
  ["assumptions", "فرض‌ها"],
];

/** آنچه دستیار از خواسته فهمید — تا اگر غلط است، همین‌جا دیده شود. */
function IntentCard({ intent, onClarify }) {
  if (!intent?.goal) return null;
  const rows = INTENT_ROWS.filter(([key]) => intent[key]);
  return (
    <div className="rounded-md border border-brand/30 bg-brand/5 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-text">
        <Target className="h-3.5 w-3.5 shrink-0" />
        برداشت من از خواستهٔ شما
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-foreground">{intent.goal}</p>
      {rows.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] leading-relaxed">
          {rows.map(([key, label]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{label}:</dt>
              <dd className="min-w-0 text-foreground/90">{intent[key]}</dd>
            </div>
          ))}
        </dl>
      )}
      {intent.questions?.length > 0 && (
        <div className="mt-2 border-t border-brand/20 pt-1.5">
          <p className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <HelpCircle className="h-3 w-3" />
            برای دقیق‌تر شدن پاسخ، این‌ها را روشن کنید:
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {intent.questions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onClarify(q)}
                title="پاسخ این پرسش را بنویسید تا کوئری اصلاح شود"
                className="rounded border border-border bg-surface px-2 py-0.5 text-start text-[11px] text-foreground transition-colors hover:border-brand/45 hover:text-brand-text"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * پاسخ مدل در قالب «### برداشت / ### مراحل / ### نکته‌ها» می‌آید. اگر مدل
 * قالب را رعایت نکرده باشد، کل متن یک بخشِ بی‌عنوان می‌شود — همان رفتار قبلی.
 */
function splitSections(note) {
  const sections = [];
  let current = { title: "", lines: [] };
  for (const line of (note || "").split(/\r?\n/)) {
    const m = line.match(/^\s*#{2,4}\s*(.+?)\s*#*\s*$/);
    if (m) {
      if (current.title || current.lines.some((l) => l.trim())) sections.push(current);
      current = { title: m[1].replace(/\*\*/g, "").trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title || current.lines.some((l) => l.trim())) sections.push(current);
  return sections.map((sec) => ({ title: sec.title, body: sec.lines.join("\n").trim() }));
}

const SECTION_ICON = { برداشت: Target, مراحل: ListOrdered, "نکته‌ها": Lightbulb, راهکار: Compass };

function Inline({ text }) {
  // فقط `کد` و **پررنگ** — بقیهٔ مارک‌داون این‌جا لازم نیست
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith("`") ? (
      <code key={i} className="ltr rounded bg-ink/60 px-1 font-mono text-[10.5px] text-brand-text">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith("**") ? (
      <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function SectionBody({ body }) {
  const lines = body.split("\n").filter((l) => l.trim());
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const step = line.match(/^\s*([0-9۰-۹]+)[.)\-–]\s*(.*)$/);
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (step) {
          return (
            <div key={i} className="flex gap-2">
              <span className="mt-px flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-brand/15 px-1 text-[10px] font-bold text-brand-text">
                {faText(step[1])}
              </span>
              <span className="min-w-0"><Inline text={step[2]} /></span>
            </div>
          );
        }
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 ps-1">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              <span className="min-w-0"><Inline text={bullet[1]} /></span>
            </div>
          );
        }
        return <p key={i}><Inline text={line} /></p>;
      })}
    </div>
  );
}

function Section({ title, body }) {
  if (!body) return null;
  const Icon = SECTION_ICON[title];
  return (
    <div className="text-[12px] leading-relaxed text-foreground/90">
      {title && (
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand-text">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
          {title}
        </p>
      )}
      <SectionBody body={body} />
    </div>
  );
}

/** «شاید منظورتان…»: همان پرسش با جدولی دیگر. */
function Choices({ choices, onAsk }) {
  if (!choices?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
        <HelpCircle className="h-3 w-3" />
        شاید منظورتان جدول دیگری است:
      </span>
      {choices.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onAsk(c.question)}
          title={`پرسیدن دوباره با ${c.label}`}
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-start text-[10.5px] text-foreground transition-colors hover:border-brand/45 hover:text-brand-text"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function Answer({ turn, onOpenTable, onClarify, onAsk, aiReady }) {
  const { question, steps, running, result, error } = turn;
  const offline = Boolean(result?.offline);
  const sections = splitSections(result?.note);
  const isNotes = (sec) => sec.title.startsWith("نکته");
  const before = result?.sql ? sections.filter((sec) => !isNotes(sec)) : sections;
  const after = result?.sql ? sections.filter(isNotes) : [];

  return (
    <div className="anim-rise space-y-2.5">
      <div className="flex justify-start">
        <p className="max-w-[85%] rounded-lg rounded-ss-sm border border-border bg-surfaceHover px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          {question}
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface/70 p-2.5">
        {offline ? (
          <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
            <Cpu className="h-3 w-3 shrink-0 text-brand-text" />
            پاسخ آفلاین — ساخته‌شده از دانش پایگاه داده، بدون هوش مصنوعی و بدون کلید API
          </p>
        ) : running && !steps.length ? (
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-brand-text" />
            در حال یافتن پاسخ…
          </p>
        ) : (
          <StepTrail steps={steps} running={running} />
        )}

        {error && (
          <p className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[11.5px] text-err">
            {error}
          </p>
        )}

        <IntentCard intent={result?.intent} onClarify={onClarify} />

        {/* «نکته‌ها» بعد از کوئری می‌آید: اول ببیند چه ساخته شد، بعد چه را بسنجد */}
        {before.map((sec, i) => <Section key={`b${i}`} {...sec} />)}

        {result?.sql && (
          <>
            <SqlBlock
              sql={result.sql}
              title={offline ? "کوئری — ساخته‌شده بدون هوش مصنوعی" : `کوئری — ${fa(result.attempts)} تلاش`}
              actions={
                CAN_DOWNLOAD && (
                  <button
                    type="button"
                    onClick={() => downloadSql(turn)}
                    title="ذخیره به‌صورت فایل .sql"
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text sm:min-h-8"
                  >
                    <Download className="h-3 w-3" />
                    <span dir="ltr">.sql</span>
                  </button>
                )
              }
            />
            <Verdict check={result.check} />
          </>
        )}

        {after.map((sec, i) => <Section key={`a${i}`} {...sec} />)}

        {offline && result.needsAi && (
          <div className="rounded-md border border-warn/40 bg-warn/8 px-3 py-2 text-[11px] leading-relaxed text-foreground/90">
            <p className="flex items-center gap-1.5 font-semibold text-warn">
              <KeyRound className="h-3.5 w-3.5 shrink-0" />
              {result.sql ? "این فقط پایهٔ کوئری است" : "این پرسش پاسخ آفلاین ندارد"}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {aiReady
                ? "برای محاسبه، شرط و بازهٔ زمانی، همین پرسش را از دستیار هوشمند بپرسید."
                : "محاسبه، شرط، بازهٔ زمانی و پرسش‌های آزاد به دستیار هوشمند نیاز دارد. با ثبت کلید API در تنظیمات فعال می‌شود."}
            </p>
          </div>
        )}

        <Choices choices={result?.choices} onAsk={onAsk} />

        {result && !running && (
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {offline && aiReady && (
              <button
                type="button"
                onClick={() => onAsk(question, "ai")}
                title="همین پرسش با مدل زبانی پاسخ داده شود"
                className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2.5 text-[11px] text-brand-text transition-colors hover:bg-brand/20 sm:min-h-8"
              >
                <Sparkles className="h-3 w-3" />
                پرسش از دستیار هوشمند
              </button>
            )}
            <CopyButton
              text={answerText(turn)}
              label="کپی کل پاسخ"
              message="کل پاسخ (توضیح و کوئری) کپی شد."
            />
          </div>
        )}

        {/*
          چیپ‌ها جدول‌هایی‌اند که *خودِ کوئری* به آن‌ها اشاره کرده (خروجی
          بازبین), نه جدول‌هایی که به مدل نشان داده شد. آن دومی معمولاً
          بیشتر است و کنار یک کوئری، گمراه‌کننده: کاربر فکر می‌کند کوئری
          روی همهٔ آن‌ها کار می‌کند.
        */}
        {result?.check?.tables?.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <Table2 className="h-3 w-3" />
              جدول‌های این کوئری:
            </span>
            {result.check.tables.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onOpenTable(t)}
                title={`باز کردن ${t} در کاوش جدول‌ها`}
                className="ltr rounded border border-border bg-ink/50 px-1.5 py-0.5 font-mono text-[10.5px] text-brand-text transition-colors hover:border-brand/45 hover:bg-brand/10"
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* زمینه‌ای که مدل داشت — برای وقتی کاربر می‌خواهد بداند چرا این کوئری */}
        {(result?.tables?.length > 0 || result?.joins?.length > 0) && (
          <details className="rounded-md border border-border/70 bg-ink/30">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
              <Link2 className="h-3 w-3" />
              {offline ? "جدول‌ها و پیوندهای به‌کاررفته" : "زمینهٔ داده‌شده به مدل"}:{" "}
              {fa(result.tables?.length || 0)} جدول و {fa(result.joins?.length || 0)} پیوند از دانش پایگاه داده
            </summary>
            {result.tables?.length > 0 && (
              <div className="flex flex-wrap gap-1 border-t border-border/70 px-2.5 py-2">
                {result.tables.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onOpenTable(t)}
                    className="ltr rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            {result.joins?.length > 0 && (
              <ul className="ltr space-y-0.5 border-t border-border/70 px-2.5 py-2 text-start">
                {result.joins.map((j, i) => (
                  <li key={i} className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {j}
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * جدول‌های سنجاق‌شده و افزودنشان با جست‌وجو.
 *
 * وقتی کاربر خودش می‌داند گزارش از کدام جدول درمی‌آید، نباید منتظر بماند که
 * جست‌وجو همان را پیدا کند. جدول سنجاق‌شده همیشه به مدل داده می‌شود و
 * جدول‌های مرتبطش (مرجع‌ها و جزئیات) هم نامزد می‌شوند.
 */
function TablePicker({ pinned, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    if (!open || !q.trim()) {
      setHits([]);
      return undefined;
    }
    const id = ++request.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await http.get("/search", { params: { q: q.trim(), limit: 8 } });
        if (id === request.current) setHits(data.results || []);
      } catch {
        if (id === request.current) setHits([]);
      } finally {
        if (id === request.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const add = (full) => {
    if (!pinned.includes(full)) onChange([...pinned, full].slice(0, MAX_PINNED));
    setQ("");
    setHits([]);
    setOpen(false);
  };

  const full = pinned.length >= MAX_PINNED;

  return (
    <div className="mx-auto mb-1.5 w-full max-w-3xl">
      <div className="flex flex-wrap items-center gap-1">
        <span className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <Pin className="h-3 w-3" />
          جدول‌های سنجاق‌شده:
        </span>
        {pinned.map((t) => (
          <span
            key={t}
            className="ltr inline-flex items-center gap-1 rounded border border-brand/35 bg-brand/10 py-0.5 pe-0.5 ps-1.5 font-mono text-[10.5px] text-brand-text"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(pinned.filter((p) => p !== t))}
              disabled={disabled}
              title="برداشتن"
              className="rounded p-0.5 transition-colors hover:bg-brand/20"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {!pinned.length && !open && (
          <span className="text-[10.5px] text-muted-foreground/80">هیچ — دستیار خودش پیدا می‌کند</span>
        )}
        {!open && !full && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-brand/45 hover:text-brand-text"
          >
            <Plus className="h-3 w-3" />
            افزودن جدول
          </button>
        )}
      </div>
      {open && (
        <div className="relative mt-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && hits[0]) {
                  e.preventDefault();
                  add(hits[0].full_name);
                }
              }}
              placeholder="نام فارسی یا انگلیسی جدول، مثلاً «قلم سند» یا VoucherItem"
              className="h-9 min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="بستن"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {hits.length > 0 && (
            <ul className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
              {hits.map((h) => (
                <li key={h.full_name}>
                  <button
                    type="button"
                    onClick={() => add(h.full_name)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-start transition-colors hover:bg-surfaceHover"
                  >
                    <Table2 className="h-3.5 w-3.5 shrink-0 text-brand-text" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-foreground">
                        {h.title_fa || h.full_name}
                      </span>
                      <span className="ltr block truncate text-start font-mono text-[10px] text-muted-foreground">
                        {h.full_name}
                      </span>
                    </span>
                    {h.has_data ? (
                      <span className="shrink-0 text-[10px] text-ok">{fa(h.row_count || 0)} ردیف</span>
                    ) : (
                      <span className="shrink-0 text-[10px] text-warn">بی‌داده</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function AssistantView({
  onOpenTable, onOpenSettings, settingsVersion = 0, pinnedFromRoute = "", onClearRoutePin,
}) {
  const [turns, setTurns] = useState(loadTurns);
  const [pinned, setPinned] = useState(loadPinned);
  const [question, setQuestion] = useState("");
  const [ready, setReady] = useState(null);
  const [running, setRunning] = useState(false);
  const abort = useRef(null);
  const tail = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (!HAS_ASSISTANT) {
      setReady({ ok: false, noAi: true });
      return;
    }
    http
      .get("/settings")
      .then(({ data }) => {
        const active = data.providers.find((p) => p.id === data.provider);
        setReady({ ok: Boolean(active?.has_key) || data.provider === "custom", conf: data });
      })
      .catch((e) => setReady({ ok: false, error: errorMessage(e) }));
  }, [settingsVersion]);

  useEffect(() => {
    tail.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  // گفت‌وگو با رفتن به زبانهٔ دیگر پاک نمی‌شود
  useEffect(() => {
    saveJson(TURNS_KEY, turns.slice(-MAX_SAVED_TURNS));
  }, [turns]);

  useEffect(() => {
    saveJson(PINNED_KEY, pinned);
  }, [pinned]);

  // «پرسش از دستیار» در صفحهٔ جدول: #/assistant/<جدول> → سنجاق، و نشانی تمیز
  useEffect(() => {
    if (!pinnedFromRoute) return;
    setPinned((prev) => (prev.includes(pinnedFromRoute) ? prev : [...prev, pinnedFromRoute].slice(-MAX_PINNED)));
    onClearRoutePin?.();
    requestAnimationFrame(() => input.current?.focus());
  }, [pinnedFromRoute, onClearRoutePin]);

  // ترک صفحه وسط پاسخ: درخواست بسته می‌شود، نه اینکه بی‌صاحب ادامه دهد
  useEffect(() => () => abort.current?.abort(), []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
  }, []);

  const aiReady = Boolean(HAS_ASSISTANT && ready?.ok);

  /**
   * پرسیدن. `mode`: "auto" (پیش‌فرض) ساده را آفلاین و بقیه را به مدل می‌دهد،
   * "ai" مستقیم به مدل می‌رود (دکمهٔ «پرسش از دستیار هوشمند»).
   */
  const ask = useCallback(
    async (text, mode = "auto") => {
      const q = (text ?? question).trim();
      if (!q || running) return;
      setQuestion("");
      setRunning(true);

      // سه پرسش‌وپاسخ آخرِ کامل، تا پرسش تازه بتواند ادامهٔ گفت‌وگو باشد
      const history = turns
        .filter((t) => t.result)
        .slice(-3)
        .map((t) => ({
          question: t.question,
          sql: t.result.sql || "",
          tables: t.result.check?.tables || [],
        }));

      const idx = turns.length;
      setTurns((prev) => [...prev, { question: q, steps: [], running: true }]);

      const patch = (fields) =>
        setTurns((prev) => prev.map((t, i) => (i === idx ? { ...t, ...fields } : t)));

      const controller = new AbortController();
      abort.current = controller;

      try {
        if (mode !== "ai") {
          const off = await answerOffline(http, q, { pinned });
          if (controller.signal.aborted) return;
          // با کلید: فقط پرسش ساختاریِ روشن آفلاین می‌ماند؛ پیشرفته و مبهم به مدل
          const keep = off.handled && (!aiReady || (!off.advanced && off.intent !== "unknown"));
          if (keep) {
            patch({ result: { ...off.result, needsAi: off.advanced }, running: false });
            return;
          }
          if (!aiReady) {
            patch({
              running: false,
              result: {
                type: "result", offline: true, needsAi: true, sql: "", tables: [], joins: [], choices: [],
                note: "### برداشت\nجدولی که این پرسش درباره‌اش باشد در دانش پایگاه داده پیدا نشد.\n\n### راهکار\n- نام جدول را به فارسی یا لاتین بیاورید؛ مثلاً «ستون‌های جدول سند حسابداری» یا «ارتباط FIN3.Voucher و GNR3.Party».\n- یا جدول را از پایین صفحه سنجاق کنید و دوباره بپرسید.",
              },
            });
            return;
          }
        }

        const steps = [];
        await ASK_ASSISTANT(q, {
          signal: controller.signal,
          history,
          tables: pinned,
          onEvent: (event) => {
            if (event.type === "result") {
              patch({ result: event, running: false });
            } else if (event.type === "error") {
              patch({ error: event.message, running: false });
            } else {
              steps.push(event);
              patch({ steps: [...steps] });
            }
          },
        });
      } catch (e) {
        if (e.name !== "AbortError") patch({ error: errorMessage(e), running: false });
        else patch({ error: "متوقف شد.", running: false });
      } finally {
        if (controller.signal.aborted) patch({ error: "متوقف شد.", running: false });
        patch({ running: false });
        if (abort.current === controller) {
          setRunning(false);
          abort.current = null;
        }
      }
    },
    [question, running, turns, pinned, aiReady],
  );

  const clarify = useCallback((q) => {
    setQuestion(`دربارهٔ «${q}»: `);
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, []);

  const fresh = useCallback(() => {
    stop();
    setTurns([]);
    setQuestion("");
  }, [stop]);

  const offlineOnly = ready && !aiReady;
  const samples = offlineOnly ? OFFLINE_SAMPLES : [...OFFLINE_SAMPLES.slice(0, 2), ...AI_SAMPLES.slice(0, 3)];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 lg:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {turns.length === 0 && (
            <div className="anim-fade space-y-4">
              <div>
                <h1 className="flex items-center gap-2 text-base font-extrabold tracking-tight text-foreground">
                  <Wand2 className="h-4 w-4 text-brand-text" />
                  دستیار کوئری‌نویسی
                </h1>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  به فارسی بپرسید چه می‌خواهید. دستیار اول می‌گوید خواستهٔ شما را
                  چه فهمیده و اگر جایی مبهم است می‌پرسد. بعد جدول‌های مرتبط را از
                  ساختار همین پایگاه داده پیدا می‌کند، ستون‌ها و مسیرهای پیوند را
                  از دانش موجود برمی‌دارد، و کوئری را قدم‌به‌قدم توضیح می‌دهد — و
                  پیش از نشان‌دادن، تک‌تک نام جدول‌ها، ستون‌ها و پیوندها را با
                  ساختار واقعی می‌سنجد.
                </p>
                <ul className="mt-2.5 grid gap-1.5 text-[11px] leading-relaxed text-muted-foreground sm:grid-cols-3">
                  <li className="flex gap-1.5 rounded-md border border-border bg-surface/60 p-2">
                    <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-text" />
                    روابط را می‌شناسد: جدول‌های مرجع (نام شخص، شرح حساب) و جدول‌های جزئیات (اقلام سند) را خودش پیدا می‌کند.
                  </li>
                  <li className="flex gap-1.5 rounded-md border border-border bg-surface/60 p-2">
                    <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-text" />
                    اگر جدول را می‌دانید، سنجاقش کنید — از پایین همین صفحه یا با «پرسش از دستیار» در صفحهٔ جدول.
                  </li>
                  <li className="flex gap-1.5 rounded-md border border-border bg-surface/60 p-2">
                    <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-text" />
                    اگر داده‌ای در ساختار نباشد، کوئری نمی‌سازد؛ راهکار رسیدن به گزارش را می‌گوید.
                  </li>
                </ul>
              </div>

              {aiReady && (
                <p className="flex items-start gap-1.5 rounded-md border border-border bg-surface/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-text" />
                  پرسش‌های ساختاری (ارتباط دو جدول، ستون‌ها، مقادیر کددار، یافتن جدول) فوری و بدون
                  مصرف API از دانش پایگاه داده پاسخ می‌گیرند؛ محاسبه، شرط و بازهٔ زمانی به دستیار
                  هوشمند می‌رود. زیر هر پاسخ آفلاین می‌توانید همان پرسش را از دستیار هوشمند هم بپرسید.
                </p>
              )}
              {offlineOnly ? (
                <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-text">
                    <WifiOff className="h-3.5 w-3.5" />
                    حالت آفلاین — بدون هوش مصنوعی
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    پرسش‌های ساختاری همین حالا و بی‌کلید پاسخ می‌گیرند: ارتباط و مسیر
                    پیوند دو جدول، ستون‌ها و روابط یک جدول، مقادیر کددار و کد و شرح،
                    یافتن جدول، فهرست و تعداد (به تفکیک یک جدول دیگر).
                    {ready.noAi
                      ? " دستیار هوشمند روی این دستگاه در دسترس نیست، چون نمایشگر وب گوشی (Android System WebView) قدیمی است؛ با به‌روزرسانی آن از Google Play فعال می‌شود."
                      : " برای محاسبه (جمع، میانگین)، شرط، بازهٔ زمانی و پرسش‌های آزاد، کلید API را در تنظیمات ثبت کنید؛ کلید فقط روی همین دستگاه می‌ماند."}
                  </p>
                  {ready.error && <p className="mt-1 text-[11px] text-warn">{ready.error}</p>}
                  {!ready.noAi && (
                    <Button type="button" size="sm" variant="outline" className="mt-2.5" onClick={onOpenSettings}>
                      <Settings className="h-3.5 w-3.5" />
                      ثبت کلید API
                    </Button>
                  )}
                </div>
              ) : null}
              {ready && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">برای شروع، یکی را بزنید:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {samples.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[11.5px] text-foreground transition-colors hover:border-brand/45 hover:bg-surfaceHover hover:text-brand-text"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {turns.map((turn, i) => (
            <Answer
              key={i}
              turn={turn}
              onOpenTable={onOpenTable}
              onClarify={clarify}
              onAsk={ask}
              aiReady={aiReady}
            />
          ))}
          <div ref={tail} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/85 px-3 py-2.5 backdrop-blur-xl sm:px-4 lg:px-6">
        <TablePicker pinned={pinned} onChange={setPinned} disabled={running} />
        <div className="mx-auto flex w-full max-w-3xl items-end gap-1.5">
          <Textarea
            ref={input}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              // Enter می‌فرستد، Shift+Enter سطر تازه — قرارداد آشنای هر چتی
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            rows={1}
            disabled={running}
            placeholder={
              offlineOnly
                ? "مثلاً: ارتباط سند حسابداری و طرف حساب"
                : "مثلاً: فهرست کارمندان هر واحد سازمانی با تعدادشان"
            }
            className="max-h-40 min-h-[42px] resize-y text-[12.5px]"
          />
          {running ? (
            <Button type="button" variant="outline" size="icon" onClick={stop} title="توقف">
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={() => ask()}
              disabled={!question.trim()}
              title="پرسیدن"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mx-auto mt-1.5 flex w-full max-w-3xl items-start gap-2">
          <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground">
            {turns.length > 0 && !offlineOnly
              ? "پرسش بعدی ادامهٔ همین گفت‌وگوست؛ مثلاً «حالا فقط امسال» یا «به تفکیک واحد». "
              : ""}
            {offlineOnly && (
              <span className="text-brand-text">
                حالت آفلاین: هر پرسش جداگانه پاسخ می‌گیرد و پرسش‌های پیشرفته کلید API می‌خواهند.{" "}
              </span>
            )}
            دستیار کوئری را اجرا نمی‌کند — فقط می‌نویسد و با ساختار می‌سنجد. پیش از
            اجرا روی داده‌های واقعی، خودتان هم نگاهش کنید.
          </p>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={fresh}
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-surfaceHover hover:text-brand-text"
              title="پرسش‌های قبلی کنار گذاشته می‌شوند"
            >
              <MessageSquarePlus className="h-3 w-3" />
              گفت‌وگوی تازه
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
