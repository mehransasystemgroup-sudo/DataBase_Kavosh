/**
 * دستیار کوئری‌نویسی — همتای backend/core/assistant.py.
 *
 * همان شش مرحله و همان قاعدهٔ مرکزی: مدل زبانی هرگز ساختار پایگاه داده را از
 * خودش نمی‌سازد. ساختار را ما می‌دهیم، و هرچه بنویسد را ما می‌سنجیم. متن
 * پرامپت‌ها عیناً متن سرور است تا مدل در هر دو نسخه یک چیز بشنود.
 */

import { checkSql, extractSql, feedback } from "./sqlcheck.js";

export const MAX_CANDIDATES = 36;
export const MAX_CHOSEN = 7;
export const MAX_PINNED = 5;
export const DEFAULT_ATTEMPTS = 4;
// گسترش از راه روابط: چند نامزد برتر، و از هرکدام چند مرجع و چند جدول جزئیات
const EXPAND_SEEDS = 5;
const EXPAND_OUT = 4;
const EXPAND_IN = 3;
const EXPAND_WEIGHT = 0.6;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bracket = (full) => `[${full.replace(/\./g, "].[")}]`;

// ───────────────────────── ۰) فهم خواسته ─────────────────────────

export const MAX_HISTORY = 3;
export const MAX_KEYWORDS = 6;

export const UNDERSTAND_SYSTEM = `تو تحلیلگر نیازمندی‌های یک پایگاه دادهٔ سازمانی روی SQL Server هستی.
هنوز کوئری نمی‌نویسی؛ فقط باید دقیق بفهمی کاربر واقعاً چه می‌خواهد.

پرسش کاربر را (و اگر آمده، گفت‌وگوی قبلی را) بخوان و برداشتت را دقیقاً در
همین قالب بنویس، هر مورد در یک سطر. موردی که در پرسش نیامده را با «—» پر کن.

هدف: خواستهٔ کاربر در یک جملهٔ کامل و مستقل؛ اگر پرسش ادامهٔ گفت‌وگوی قبلی است، آنچه از قبل مانده را هم در همین جمله بیاور
نوع: کوئری یا راهنمایی
کلیدواژه‌ها: مفهوم‌های اصلی به فارسی، و اگر می‌دانی معادل انگلیسی‌شان، با «،» جدا
خروجی: ستون‌ها یا مقدارهایی که باید برگردد
فیلترها: شرط‌ها
گروه‌بندی: —
مرتب‌سازی: —
بازهٔ زمانی: —
فرض‌ها: هر فرضی که برای پرکردن جای خالی کردی
ابهام‌ها: پرسش‌هایی که پاسخشان نتیجه را عوض می‌کند، با «|» جدا؛ اگر نیست «—»

هیچ توضیح دیگری ننویس.`;

export const INTENT_FIELDS = [
  ["goal", "هدف"], ["mode", "نوع"], ["keywords", "کلیدواژه‌ها"],
  ["output", "خروجی"], ["filters", "فیلترها"], ["grouping", "گروه‌بندی"],
  ["ordering", "مرتب‌سازی"], ["period", "بازهٔ زمانی"],
  ["assumptions", "فرض‌ها"], ["questions", "ابهام‌ها"],
];

const EMPTY = new Set(["", "—", "-", "–", "ندارد", "هیچ", "نامشخص", "ندارد.", "—."]);

const normLabel = (text) =>
  text.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌ٔ\s*#_`]/gu, "").replace(/ۀ/g, "ه");

const LABELS = new Map(INTENT_FIELDS.map(([key, label]) => [normLabel(label), key]));
for (const [label, key] of [["کلیدواژه", "keywords"], ["فیلتر", "filters"],
  ["فرض", "assumptions"], ["ابهام", "questions"], ["پرسشهایروشنکننده", "questions"]]) {
  LABELS.set(label, key);
}

const emptyIntent = () => {
  const out = Object.fromEntries(INTENT_FIELDS.map(([key]) => [key, ""]));
  return Object.assign(out, { mode: "query", keywords: [], questions: [] });
};

/** همتای parse_intent: هر سطرِ «برچسب: مقدار»؛ بی‌«هدف»، برداشتی در کار نیست. */
export function parseIntent(reply) {
  const out = emptyIntent();
  for (const line of (reply || "").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*•]\s*)?([^:：]{1,30})[:：]\s*(.*)$/u);
    if (!m) continue;
    const key = LABELS.get(normLabel(m[1]));
    const value = m[2].trim().replace(/^\*+|\*+$/g, "").trim();
    if (!key || EMPTY.has(value)) continue;
    if (key === "keywords") {
      out.keywords = value.split(/[،,;؛]/).map((w) => w.trim())
        .filter((w) => w && !EMPTY.has(w)).slice(0, MAX_KEYWORDS);
    } else if (key === "questions") {
      out.questions = value.split("|").map((q) => q.trim())
        .filter((q) => q && !EMPTY.has(q)).slice(0, 4);
    } else if (key === "mode") {
      out.mode = value.includes("راهنما") ? "guidance" : "query";
    } else {
      out[key] = value;
    }
  }
  return out.goal ? out : emptyIntent();
}

export function briefText(intent) {
  if (!intent?.goal) return "";
  return INTENT_FIELDS
    .filter(([key]) => !["mode", "keywords", "questions"].includes(key) && intent[key])
    .map(([key, label]) => `${label}: ${intent[key]}`)
    .join("\n");
}

export function cleanHistory(history) {
  const out = [];
  for (const item of (Array.isArray(history) ? history : []).slice(-MAX_HISTORY)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const question = String(item.question ?? "").trim().slice(0, 2000);
    if (!question) continue;
    const sql = String(item.sql ?? "").trim().slice(0, 8000);
    const tables = (Array.isArray(item.tables) ? item.tables : [])
      .filter(Boolean).map((t) => String(t).slice(0, 128)).slice(0, 10);
    out.push({ question, sql, tables });
  }
  return out;
}

export function historyText(history) {
  if (!history.length) return "";
  const parts = ["## گفت‌وگوی قبلی", ""];
  history.forEach((item, i) => {
    parts.push(`پرسش ${i + 1}: ${item.question}`);
    if (item.sql) parts.push(`کوئری ${i + 1}:`, "```sql", item.sql, "```");
    parts.push("");
  });
  return parts.join("\n").trimEnd();
}

export function understandPrompt(question, history) {
  const head = historyText(history);
  return (head ? head + "\n\n" : "") + `## پرسش تازه\n\n${question}`;
}

// ───────────────────────── ۱) بازیابی ─────────────────────────

/** جدول‌های سنجاق‌شدهٔ کاربر — فقط آن‌هایی که واقعاً در ایندکس هستند. */
export function cleanPinned(kb, pinned) {
  const out = [];
  for (const full of [...(pinned || [])].slice(0, MAX_PINNED * 2)) {
    const info = kb.getTable(String(full).trim().slice(0, 128));
    if (info && !out.includes(info.full_name)) out.push(info.full_name);
  }
  return out.slice(0, MAX_PINNED);
}

/**
 * جدول‌های نامزد: جست‌وجو، کلیدواژه‌ها، گفت‌وگوی قبلی و سنجاق‌ها — و بعد
 * گسترش از راه روابط (مرجع‌ها و جدول‌های جزئیاتِ نامزدهای برتر).
 */
export function retrieve(kb, question, keywords = [], previous = [], pinned = []) {
  const seen = new Map();
  const add = (full, title, why, score) => {
    const row = seen.get(full);
    if (!row) seen.set(full, { full_name: full, title_fa: title, why, score });
    else if (score > row.score) Object.assign(row, { score, why });
  };

  for (const hit of kb.searchTables({ query: question, limit: MAX_CANDIDATES })) {
    add(hit.full_name, hit.title_fa, hit.why || "نام جدول", hit.score);
  }
  for (const col of kb.searchColumns(question, 20)) {
    const table = col.table || col.table_ref || "";
    if (table) add(table, col.title_fa, `ستون ${col.name}`, 1.0);
  }
  for (const word of [...new Set(keywords)].slice(0, MAX_KEYWORDS)) {
    for (const hit of kb.searchTables({ query: word, limit: 8 })) {
      add(hit.full_name, hit.title_fa, `کلیدواژهٔ «${word}»`, hit.score);
    }
    for (const col of kb.searchColumns(word, 8)) {
      const table = col.table || col.table_ref || "";
      if (table) add(table, col.title_fa, `ستون ${col.name}`, 1.0);
    }
  }
  const direct = [...seen.values()].sort((a, b) => b.score - a.score);
  const top = direct.length ? Math.max(...direct.map((r) => r.score)) : 1.0;
  for (const full of previous) {
    const info = kb.getTable(full);
    if (info) add(info.full_name, info.title_fa, "گفت‌وگوی قبلی", top + 1.0);
  }
  const pins = cleanPinned(kb, pinned);
  for (const full of pins) add(full, kb.getTable(full).title_fa, "انتخاب شما", top + 2.0);

  const seeds = pins.map((full) => [full, seen.get(full).score]);
  for (const row of direct.slice(0, EXPAND_SEEDS)) {
    if (!pins.includes(row.full_name)) seeds.push([row.full_name, row.score]);
  }
  for (const [seed, score] of seeds) {
    const related = kb.relatedTables(seed);
    const refs = related.filter((r) => r.direction === "out").slice(0, EXPAND_OUT);
    const details = related.filter((r) => r.direction === "in").slice(0, EXPAND_IN);
    for (const r of [...refs, ...details]) {
      add(r.full_name, r.title_fa, `مرتبط با ${seed}`, score * EXPAND_WEIGHT);
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

// ───────────────────────── ۲) انتخاب ─────────────────────────

export const SELECT_SYSTEM = `تو دستیار یک پایگاه دادهٔ سازمانی هستی.
از فهرست جدول‌هایی که داده می‌شود، فقط آن‌هایی را انتخاب کن که برای پاسخ به
پرسش کاربر لازم‌اند.

قواعد:
- فقط نام‌هایی را بنویس که عیناً در فهرست آمده‌اند.
- هر نام در یک سطر جدا، بدون شماره، بدون توضیح، بدون علامت.
- حداکثر ${MAX_CHOSEN} جدول.
- جدولی را انتخاب کن که دادهٔ خواسته‌شده واقعاً در آن است؛ مثلاً مبلغ و
  تعداد معمولاً در جدول اقلام و ردیف‌هاست، نه در جدول سربرگ.
- اگر خروجی باید نام یا شرح نشان دهد (نام شخص، شرح حساب، عنوان کالا)،
  جدول مرجعِ آن را هم انتخاب کن.
- از «پیوندهای مستقیم» ببین جدول‌ها چطور به هم می‌رسند؛ اگر دو جدولِ لازم
  مستقیم به هم وصل نیستند، جدول واسطه را هم بنویس.
- جدول‌هایی که کاربر خودش انتخاب کرده همیشه به کار می‌روند؛ لازم نیست تکرارشان کنی.
- اگر مطمئن نیستی، جدول‌های محتمل‌تر را بنویس.`;

const MAX_LINKS = 40;

/** پیوندهای مستقیم میان نامزدها، آن‌هایی که به نامزدهای برتر می‌رسند اول — همان candidate_links. */
export function candidateLinks(kb, candidates) {
  const rank = new Map(candidates.map((c, i) => [c.full_name, i]));
  const links = kb.linksBetween([...rank.keys()]);
  const key = (s) => [
    Math.min(rank.get(s.from_table), rank.get(s.to_table)),
    Math.max(rank.get(s.from_table), rank.get(s.to_table)),
  ];
  links.sort((a, b) => {
    const [a1, a2] = key(a);
    const [b1, b2] = key(b);
    return a1 - b1 || a2 - b2;
  });
  return links.slice(0, MAX_LINKS);
}

const linkLine = (step) => `${step.from_table}.${step.from_col} → ${step.to_table}`;

/** پرامپت انتخاب: نامزدها، دلیل نامزدی، و نقشهٔ پیوندهای مستقیم میانشان. */
export function selectPrompt(question, candidates, links = [], goal = "", pinned = []) {
  const listing = candidates
    .map((c) => c.full_name + (c.title_fa ? ` — ${c.title_fa}` : "") + (c.why ? `  · ${c.why}` : ""))
    .join("\n");
  const parts = [`## جدول‌های موجود\n${listing}`];
  const lines = links.map(linkLine);
  if (lines.length) parts.push("## پیوندهای مستقیم میان این جدول‌ها\n" + lines.join("\n"));
  if (pinned.length) parts.push("## جدول‌هایی که کاربر خودش انتخاب کرده\n" + pinned.join("\n"));
  parts.push(`## پرسش\n${question}`);
  if (goal) parts.push(`## هدف\n${goal}`);
  return parts.join("\n\n");
}

export function parseSelection(reply, candidates) {
  const text = (reply || "").toLowerCase();
  const found = [];
  for (const c of candidates) {
    const low = c.full_name.toLowerCase();
    const re = new RegExp(`(?<![\\w.])${escapeRe(low)}(?![\\w])`, "u");
    if (re.test(text) && !found.includes(c.full_name)) found.push(c.full_name);
  }
  return found.slice(0, MAX_CHOSEN);
}

// ───────────────────────── ۳) زمینه‌سازی ─────────────────────────

const MAX_DESCRIPTION = 200;
const MAX_REFS = 12;
const AUDIT_COLUMNS = ["Creator", "LastModifier"];

// مقایسهٔ رشته به ترتیب نقطهٔ کد — همان sorted پایتون
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function short(text, limit) {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length <= limit ? flat : chars.slice(0, limit).join("").trimEnd() + "…";
}

function tableBlock(kb, full) {
  const info = kb.getTable(full);
  if (!info) return "";
  let head = bracket(full);
  if (info.title_fa) head += ` — ${info.title_fa}`;
  if (info.row_count !== null && info.row_count !== undefined) head += `  (${info.row_count} ردیف)`;

  const lines = [head];
  const description = short(info.description_fa, MAX_DESCRIPTION);
  if (description && description !== info.title_fa) lines.push("  شرح: " + description);
  if (info.primary_key.length) lines.push("  کلید اصلی: " + info.primary_key.join(", "));
  const cols = info.columns.map((c) =>
    `${c.name}:${c.type || "?"}` + (c.label_fa ? `(${c.label_fa})` : ""));
  lines.push("  ستون‌ها: " + cols.join(", "));
  for (const [col, values] of Object.entries(info.enums || {})) {
    const shown = values.slice(0, 15).map((v) => `${v.value}=${v.label_fa || "?"}`).join(", ");
    lines.push(`  مقادیر ${col}: ${shown}`);
  }

  // ارجاع‌های تأییدشده، گروه‌شده بر پایهٔ جدول مقصد — همان _table_block
  const pairs = new Map();
  for (const j of info.outgoing) {
    if (j.verified && !AUDIT_COLUMNS.includes(j.from_col)) {
      pairs.set(`${j.from_col}\u0000${j.to_table}`, [j.from_col, j.to_table]);
    }
  }
  const targets = new Map();
  for (const [col, to] of [...pairs.values()].sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]))) {
    if (!targets.has(to)) targets.set(to, []);
    targets.get(to).push(col);
  }
  if (targets.size) {
    const groups = [...targets.entries()].sort((a, b) => cmp(a[1][0], b[1][0])).slice(0, MAX_REFS);
    const shown = groups
      .map(([to, cols]) => cols.slice(0, 3).join("/") + (cols.length > 3 ? "/…" : "") + "→" + bracket(to))
      .join(", ");
    lines.push("  ارجاع‌ها: " + shown);
  }
  for (const warning of info.warnings) {
    if (!warning.includes("تأییدنشده است")) lines.push("  هشدار: " + warning);
  }
  return lines.join("\n");
}

export function buildContext(kb, chosen) {
  const tables = [...new Set(chosen)];
  const joins = [];
  const bridges = [];
  const cautions = [];

  tables.forEach((a, i) => {
    for (const b of tables.slice(i + 1)) {
      // اول از میان خودِ جدول‌های انتخاب‌شده؛ فقط اگر نشد جدول واسطهٔ تازه.
      let path = kb.findJoinPath(a, b, { through: tables });
      if (!path || !path.length) {
        path = kb.findJoinPath(a, b);
        const caution = path && path.length ? kb.constructor.pathWarning(path) : null;
        if (caution) cautions.push(`- ${a} ↔ ${b}: ${caution}`);
      }
      if (!path || !path.length) continue;
      for (const step of path) {
        const clause = `${bracket(step.from_table)}.[${step.from_col}] = ${bracket(step.to_table)}.[${step.to_col}]`;
        const line = clause + (step.verified ? "" : "   (تأییدنشده — استنتاج از نام)");
        if (!joins.includes(line)) joins.push(line);
        for (const t of [step.from_table, step.to_table]) {
          if (!tables.includes(t) && !bridges.includes(t)) bridges.push(t);
        }
      }
    }
  });

  const everything = [...tables, ...bridges];
  const blocks = everything.map((t) => tableBlock(kb, t)).filter(Boolean);

  const parts = ["### جدول‌ها — فقط از همین‌ها و فقط با همین ستون‌ها استفاده کن", "", ...blocks];
  if (bridges.length) {
    parts.push("", "(جدول‌های " + bridges.join("، ") + " واسطهٔ پیوندند و برای همین آمده‌اند.)");
  }
  if (joins.length) parts.push("", "### پیوندهای شناخته‌شده — شرط JOIN را عیناً از این‌جا بردار", "", ...joins);
  else parts.push("", "(بین این جدول‌ها پیوند ثبت‌شده‌ای نیست.)");
  if (cautions.length) parts.push("", "### هشدار مسیرها — پیش از استفاده بسنج", "", ...cautions);
  return { context: parts.join("\n"), tables: everything, joins };
}

// ───────────────────────── ۴) نگارش ─────────────────────────

export const DRAFT_SYSTEM = `تو یک کارشناس ارشد T-SQL روی SQL Server هستی و به فارسی، دقیق و قدم‌به‌قدم پاسخ می‌دهی.

قواعد غیرقابل‌مذاکره:
۱. فقط از جدول‌ها و ستون‌هایی استفاده کن که در «ساختار» آمده‌اند. هیچ نام
   دیگری ننویس — اگر چیزی در ساختار نیست، یعنی وجود ندارد. جدولی که فقط در
   سطر «ارجاع‌ها» آمده و بلوک ستون‌هایش نیامده را نمی‌شناسی؛ از آن جز همان
   ستونِ پیوند چیزی ننویس.
۲. شرط‌های JOIN را عیناً از بخش «پیوندهای شناخته‌شده» یا سطر «ارجاع‌ها»
   بردار. پیوند از خودت نساز. پیوندِ «تأییدنشده» را فقط وقتی به کار ببر که
   راه دیگری نیست، و در «نکته‌ها» بگو.
۳. فقط خواندنی: SELECT، و در صورت نیاز WITH و DECLARE. هیچ
   INSERT/UPDATE/DELETE/DROP/EXEC ننویس.
۴. شناسه‌ها را داخل براکت بگذار: [SCHEMA].[Table].[Column] و برای هر جدول
   نام مستعار کوتاه بگذار.
۵. اگر جدولی ستون FiscalYearRef دارد، فیلتر سال مالی را حتماً بگذار؛ وگرنه
   خروجی بی‌خطا ولی غلط می‌شود.
۶. مقدارهای نمونه (سال مالی، تاریخ، کد، شناسه) را در ابتدای کوئری با DECLARE
   و نامی گویا تعریف کن تا کاربر فقط همان‌جا را عوض کند.
۷. برای ستونی که «مقادیر»ش آمده، در فیلتر فقط از همان مقدارها استفاده کن، و
   اگر خروجی برای خواندن است کنار عدد، شرح فارسی‌اش را با CASE برگردان.
۸. جدول مرجع (نام شخص، شرح حساب، عنوان کالا) را با LEFT JOIN بیاور تا ردیفی
   گم نشود، مگر خواسته صریحاً چیز دیگری باشد. در جمع و شمارش مراقب باش JOIN
   به جدول جزئیات ردیف‌ها را چند برابر نکند.
۹. اگر «گفت‌وگوی قبلی» آمده و پرسش تازه ادامهٔ آن است، کوئری قبلی را مبنا
   بگیر و فقط همان چیزی را عوض کن که خواسته شده.
۱۰. اگر جایی از خواسته مبهم است، معقول‌ترین برداشت را برگزین و آن را در
   «نکته‌ها» صریح بنویس؛ هیچ فرضی را بی‌صدا نکن.
۱۱. اگر دادهٔ لازم در ساختار نیست، کوئری ساختگی ننویس؛ بلوک \`\`\`sql نگذار و
   به‌جایش راهکار رسیدن به گزارش را قدم‌به‌قدم بگو: از کدام جدول‌های موجود،
   با چه کمبودی، و چه چیزی باید روشن شود.

قالب پاسخ — دقیقاً با همین عنوان‌ها:

### برداشت
یک یا دو جمله: این کوئری دقیقاً چه چیزی را برمی‌گرداند.

### مراحل
فهرست شماره‌دار و کوتاه از ساختن کوئری: از کدام جدول شروع می‌شود و چرا،
کدام پیوندها، چه فیلترهایی، چه گروه‌بندی و مرتب‌سازی‌ای. در هر مرحله نام
فارسی جدول یا ستون را هم بیاور.

\`\`\`sql
-- کوئری کامل
\`\`\`

### نکته‌ها
فرض‌هایی که کردی، آنچه کاربر باید پیش از اجرا بررسی یا جایگزین کند (مثلاً
مقدارهای DECLARE)، هشدارهای ساختار که به این گزارش مربوط‌اند، و اگر لازم
است یک نکتهٔ کارایی.

اگر کاربر کوئری نمی‌خواهد و فقط راهنمایی می‌خواهد، بلوک \`\`\`sql نگذار؛ به‌جایش
با همین سه عنوان قدم‌به‌قدم راهنمایی کن.`;

function preamble(history, intent) {
  const parts = [];
  const head = historyText(history);
  if (head) parts.push(head);
  const brief = briefText(intent);
  if (brief) parts.push("## برداشت از خواسته — اگر با پرسش نمی‌خواند، خودِ پرسش ملاک است\n\n" + brief);
  return parts.join("\n\n");
}

export function draftPrompt(question, context, history = [], intent = {}) {
  const extra = preamble(history, intent);
  return `## ساختار

${context}

${extra ? extra + "\n\n" : ""}## پرسش کاربر

${question}`;
}

export function repairPrompt(question, context, sql, result, history = [], intent = {}) {
  const extra = preamble(history, intent);
  return `## ساختار

${context}

${extra ? extra + "\n\n" : ""}## پرسش کاربر

${question}

## کوئری قبلی تو

\`\`\`sql
${sql}
\`\`\`

## ایرادهایی که بازبین گرفت

${feedback(result)}

کوئری را با توجه به همین ایرادها اصلاح کن. فقط از جدول‌ها و ستون‌های بخش
«ساختار» استفاده کن. دوباره کل کوئری اصلاح‌شده را داخل یک بلوک \`\`\`sql بده؛
اگر برداشت یا مراحل هم عوض شد، آن‌ها را با همان قالب بنویس.`;
}

const FENCED = /```(?:sql|tsql)?\s*\n([\s\S]*?)```/gi;

export function splitReply(reply) {
  const text = reply || "";
  const fenced = [...text.matchAll(FENCED)].map((m) => m[1]);
  let sql = "";
  let note = "";
  if (fenced.length) {
    sql = fenced.reduce((a, b) => (b.length > a.length ? b : a)).trim();
    note = text.replace(FENCED, "");
  } else {
    const candidate = extractSql(text);
    if (/^\s*(WITH|SELECT)\b/i.test(candidate)) sql = candidate;
    else note = text;
  }
  return { sql: sql.trim(), note: note.trim() };
}

// ───────────────────────── اجرای کامل ─────────────────────────

/**
 * `ask(system, user) → Promise<string>` تنها راه ارتباط با مدل است. `emit`
 * همان رویدادهایی را می‌فرستد که سرور با SSE می‌فرستد، با همان شکل.
 */
export async function run({
  question, kb, index, ask, emit, maxAttempts = DEFAULT_ATTEMPTS, signal, history = [], pinned = [],
}) {
  const draft = {
    sql: "", note: "", check: null, attempts: 0, tables: [], joins: [], kind: "query", intent: {},
  };
  const say = (type, message, data = {}) => {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    emit({ type, message, ...data });
  };
  const past = cleanHistory(history);
  const pins = cleanPinned(kb, pinned);

  say("understand", "فهم خواستهٔ شما");
  let intent;
  try {
    intent = parseIntent(await ask(UNDERSTAND_SYSTEM, understandPrompt(question, past)));
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    intent = emptyIntent();
  }
  draft.intent = intent;
  if (intent.goal) say("understand", intent.goal, { intent });
  else say("understand", "برداشت روشنی نیامد؛ با خودِ پرسش ادامه می‌دهیم");

  say("retrieve", "جست‌وجو در ساختار پایگاه داده");
  const previous = past.flatMap((item) => item.tables);
  const candidates = retrieve(kb, question, intent.keywords, previous, pins);
  if (!candidates.length) {
    draft.kind = "guidance";
    draft.note = "برای این پرسش جدول مرتبطی پیدا نشد. کمی مشخص‌تر بپرسید — " +
      "مثلاً نام فارسی جدول، نام یک ستون، یا ماژول موردنظر.";
    return draft;
  }
  say("retrieve", `${candidates.length} جدول نامزد پیدا شد`, {
    candidates: candidates.map((c) => c.full_name),
  });

  say("select", "انتخاب جدول‌های مرتبط");
  const links = candidateLinks(kb, candidates);
  let chosen = [];
  try {
    const reply = await ask(SELECT_SYSTEM, selectPrompt(question, candidates, links, intent.goal, pins));
    chosen = parseSelection(reply, candidates);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    chosen = [];
  }
  if (!chosen.length) {
    // مدل کمکی نکرد — با نتیجهٔ بازیابی ادامه می‌دهیم. بهتر از توقف است.
    const rest = candidates.map((c) => c.full_name).filter((t) => !pins.includes(t));
    chosen = [...pins, ...rest.slice(0, Math.max(0, 4 - pins.length))];
    say("select", "انتخاب مدل روشن نبود؛ با نتیجهٔ جست‌وجو ادامه می‌دهیم", { tables: chosen });
  } else {
    // جدول‌های سنجاق‌شده همیشه می‌مانند، هرچه مدل گفته باشد.
    chosen = [...pins, ...chosen.filter((t) => !pins.includes(t))].slice(0, MAX_CHOSEN);
    say("select", `${chosen.length} جدول انتخاب شد`, { tables: chosen });
  }

  say("context", "استخراج ستون‌ها و مسیرهای پیوند");
  const { context, tables, joins } = buildContext(kb, chosen);
  Object.assign(draft, { tables, joins });
  say("context", `${tables.length} جدول و ${joins.length} پیوند آماده شد`, { tables, joins });

  let userPrompt = draftPrompt(question, context, past, intent);
  let lastResult = null;
  let lastSql = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    draft.attempts = attempt;
    say("draft", attempt === 1 ? "نگارش کوئری" : `اصلاح کوئری — تلاش ${attempt} از ${maxAttempts}`, { attempt });
    const reply = await ask(DRAFT_SYSTEM, userPrompt);
    const { sql, note } = splitReply(reply);

    if (!sql) {
      draft.kind = "guidance";
      draft.note = note || reply;
      say("done", "پاسخ راهنمایی آماده شد");
      return draft;
    }

    lastSql = sql;
    draft.sql = sql;
    draft.note = note || draft.note;
    say("verify", "بازبینی کوئری با ساختار واقعی", { attempt });
    const result = checkSql(sql, index);
    lastResult = result;
    draft.check = result;

    const nErr = result.findings.filter((f) => f.severity === "error").length;
    const nWarn = result.findings.length - nErr;
    say("verify", result.ok && !nWarn ? "کوئری با ساختار پایگاه داده خواند" : `${nErr} خطا و ${nWarn} هشدار پیدا شد`, {
      attempt, ok: result.ok, findings: result.findings,
    });

    if (result.ok && !nWarn) break;
    // هشدارها خطا نیستند؛ یک دور برای برطرف‌کردنشان می‌ارزد، دو دور نه.
    if (result.ok && attempt >= 2) break;
    if (attempt === maxAttempts) break;
    userPrompt = repairPrompt(question, context, sql, result, past, intent);
  }

  draft.sql = lastSql;
  draft.check = lastResult;
  say("done", lastResult?.ok ? "کوئری تأیید شد" : "کوئری تأیید نشد — ایرادها در پاسخ آمده");
  return draft;
}
