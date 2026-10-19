import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  BadgeCheck,
  Bot,
  CircleSlash,
  KeyRound,
  Link2,
  Loader2,
  Settings,
  Square,
  Table2,
  Wand2,
} from "lucide-react";

import { ASK_ASSISTANT, HAS_ASSISTANT, errorMessage, http } from "@/lib/api";
import { cn, fa, faText } from "@/lib/utils";
import { EmptyState, SqlBlock } from "@/components/primitives";
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
*/

const SAMPLES = [
  "فهرست کارمندان به همراه نام واحد سازمانی‌شان",
  "جمع بدهکار و بستانکار هر سند حسابداری در سال مالی جاری",
  "سندهای پرداختی که وضعیتشان تأییدنشده است",
];

const STEP_LABEL = {
  retrieve: "بازیابی",
  select: "انتخاب جدول",
  context: "زمینه‌سازی",
  draft: "نگارش",
  verify: "بازبینی",
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

function Answer({ turn, onOpenTable }) {
  const { question, steps, running, result, error } = turn;

  return (
    <div className="anim-rise space-y-2.5">
      <div className="flex justify-start">
        <p className="max-w-[85%] rounded-lg rounded-ss-sm border border-border bg-surfaceHover px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
          {question}
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface/70 p-2.5">
        <StepTrail steps={steps} running={running} />

        {error && (
          <p className="rounded-md border border-err/40 bg-err/10 px-3 py-2 text-[11.5px] text-err">
            {error}
          </p>
        )}

        {result?.sql && (
          <>
            <SqlBlock sql={result.sql} title={`کوئری — ${fa(result.attempts)} تلاش`} />
            <Verdict check={result.check} />
          </>
        )}

        {result?.note && (
          <p className="whitespace-pre-line text-[12px] leading-relaxed text-foreground/90">
            {result.note}
          </p>
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
        {result?.joins?.length > 0 && (
          <details className="rounded-md border border-border/70 bg-ink/30">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] text-muted-foreground">
              <Link2 className="h-3 w-3" />
              {fa(result.joins.length)} پیوندی که از دانش پایگاه داده به مدل داده شد
            </summary>
            <ul className="ltr space-y-0.5 border-t border-border/70 px-2.5 py-2 text-start">
              {result.joins.map((j, i) => (
                <li key={i} className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {j}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

export default function AssistantView({ onOpenTable, onOpenSettings, settingsVersion = 0 }) {
  const [turns, setTurns] = useState([]);
  const [question, setQuestion] = useState("");
  const [ready, setReady] = useState(null);
  const [running, setRunning] = useState(false);
  const abort = useRef(null);
  const tail = useRef(null);

  useEffect(() => {
    if (!HAS_ASSISTANT) return;
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

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
  }, []);

  const ask = useCallback(
    async (text) => {
      const q = (text ?? question).trim();
      if (!q || running) return;
      setQuestion("");
      setRunning(true);

      const idx = turns.length;
      setTurns((prev) => [...prev, { question: q, steps: [], running: true }]);

      const patch = (fields) =>
        setTurns((prev) => prev.map((t, i) => (i === idx ? { ...t, ...fields } : t)));

      const controller = new AbortController();
      abort.current = controller;

      try {
        const steps = [];
        await ASK_ASSISTANT(q, {
          signal: controller.signal,
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
        patch({ running: false });
        setRunning(false);
        abort.current = null;
      }
    },
    [question, running, turns.length],
  );

  if (!HAS_ASSISTANT) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <EmptyState
          icon={Bot}
          title="دستیار روی این دستگاه در دسترس نیست"
          description="نمایشگر وبِ این گوشی (Android System WebView) قدیمی‌تر از آن است که برنامه بتواند از راهش به مدل زبانی وصل شود. آن را از Google Play به‌روز کنید و برنامه را دوباره باز کنید. بقیهٔ بخش‌ها آفلاین و بی‌تغییر کار می‌کنند."
        />
      </div>
    );
  }

  const needsKey = ready && !ready.ok;

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
                  به فارسی بپرسید چه می‌خواهید. دستیار اول جدول‌های مرتبط را از
                  ساختار همین پایگاه داده پیدا می‌کند، ستون‌ها و مسیرهای پیوند را
                  از دانش موجود برمی‌دارد، و کوئری را می‌نویسد — و پیش از
                  نشان‌دادن، تک‌تک نام جدول‌ها، ستون‌ها و پیوندها را با ساختار
                  واقعی می‌سنجد.
                </p>
              </div>

              {needsKey ? (
                <div className="rounded-lg border border-warn/40 bg-warn/8 p-3">
                  <p className="flex items-center gap-1.5 text-[12px] font-semibold text-warn">
                    <KeyRound className="h-3.5 w-3.5" />
                    هنوز کلید API ثبت نشده
                  </p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {ready.error ||
                      "دستیار برای نوشتن کوئری به یک مدل زبانی وصل می‌شود. کلید فقط روی همین دستگاه ذخیره می‌شود."}
                  </p>
                  <Button type="button" size="sm" className="mt-2.5" onClick={onOpenSettings}>
                    <Settings className="h-3.5 w-3.5" />
                    رفتن به تنظیمات
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">برای شروع، یکی را بزنید:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SAMPLES.map((s) => (
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
            <Answer key={i} turn={turn} onOpenTable={onOpenTable} />
          ))}
          <div ref={tail} />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/85 px-3 py-2.5 backdrop-blur-xl sm:px-4 lg:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-1.5">
          <Textarea
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
            disabled={running || needsKey}
            placeholder="مثلاً: فهرست کارمندان هر واحد سازمانی با تعدادشان"
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
              disabled={!question.trim() || needsKey}
              title="پرسیدن"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-[10px] leading-relaxed text-muted-foreground">
          دستیار کوئری را اجرا نمی‌کند — فقط می‌نویسد و با ساختار می‌سنجد. پیش از
          اجرا روی داده‌های واقعی، خودتان هم نگاهش کنید.
        </p>
      </div>
    </div>
  );
}
