/**
 * دستیار کوئری‌نویسی — همتای backend/core/assistant.py.
 *
 * همان پنج مرحله و همان قاعدهٔ مرکزی: مدل زبانی هرگز ساختار پایگاه داده را از
 * خودش نمی‌سازد. ساختار را ما می‌دهیم، و هرچه بنویسد را ما می‌سنجیم. متن
 * پرامپت‌ها عیناً متن سرور است تا مدل در هر دو نسخه یک چیز بشنود.
 */

import { checkSql, extractSql, feedback } from "./sqlcheck.js";

export const MAX_CANDIDATES = 28;
export const MAX_CHOSEN = 7;
export const DEFAULT_ATTEMPTS = 4;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bracket = (full) => `[${full.replace(/\./g, "].[")}]`;

// ───────────────────────── ۱) بازیابی ─────────────────────────

export function retrieve(kb, question) {
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
- اگر مطمئن نیستی، جدول‌های محتمل‌تر را بنویس.`;

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

function tableBlock(kb, full) {
  const info = kb.getTable(full);
  if (!info) return "";
  let head = bracket(full);
  if (info.title_fa) head += ` — ${info.title_fa}`;
  if (info.row_count !== null && info.row_count !== undefined) head += `  (${info.row_count} ردیف)`;

  const lines = [head];
  if (info.primary_key.length) lines.push("  کلید اصلی: " + info.primary_key.join(", "));
  const cols = info.columns.map((c) =>
    `${c.name}:${c.type || "?"}` + (c.label_fa ? `(${c.label_fa})` : ""));
  lines.push("  ستون‌ها: " + cols.join(", "));
  for (const [col, values] of Object.entries(info.enums || {})) {
    const shown = values.slice(0, 15).map((v) => `${v.value}=${v.label_fa || "?"}`).join(", ");
    lines.push(`  مقادیر ${col}: ${shown}`);
  }
  return lines.join("\n");
}

export function buildContext(kb, chosen) {
  const tables = [...new Set(chosen)];
  const joins = [];
  const bridges = [];

  tables.forEach((a, i) => {
    for (const b of tables.slice(i + 1)) {
      const path = kb.findJoinPath(a, b);
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
  return { context: parts.join("\n"), tables: everything, joins };
}

// ───────────────────────── ۴) نگارش ─────────────────────────

export const DRAFT_SYSTEM = `تو یک کارشناس ارشد T-SQL روی SQL Server هستی و به فارسی پاسخ می‌دهی.

قواعد غیرقابل‌مذاکره:
۱. فقط از جدول‌ها و ستون‌هایی استفاده کن که در «ساختار» آمده‌اند. هیچ نام
   دیگری ننویس — اگر چیزی در ساختار نیست، یعنی وجود ندارد.
۲. شرط‌های JOIN را عیناً از بخش «پیوندهای شناخته‌شده» بردار. پیوند از خودت
   نساز.
۳. فقط SELECT. هیچ INSERT/UPDATE/DELETE/DROP ننویس.
۴. شناسه‌ها را داخل براکت بگذار: [SCHEMA].[Table].[Column]
۵. کوئری را داخل یک بلوک \`\`\`sql بگذار و بیرون آن، دو سه جملهٔ فارسی بنویس
   که می‌گوید کوئری چه می‌کند.

اگر پرسش کاربر اصلاً کوئری نمی‌خواهد و فقط راهنمایی می‌خواهد، بلوک \`\`\`sql
نگذار و فقط فارسی توضیح بده.`;

export const draftPrompt = (question, context) => `## ساختار

${context}

## پرسش کاربر

${question}`;

export const repairPrompt = (question, context, sql, result) => `## ساختار

${context}

## پرسش کاربر

${question}

## کوئری قبلی تو

\`\`\`sql
${sql}
\`\`\`

## ایرادهایی که بازبین گرفت

${feedback(result)}

کوئری را با توجه به همین ایرادها اصلاح کن. فقط از جدول‌ها و ستون‌های بخش
«ساختار» استفاده کن. دوباره کل کوئری اصلاح‌شده را داخل یک بلوک \`\`\`sql بده.`;

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
export async function run({ question, kb, index, ask, emit, maxAttempts = DEFAULT_ATTEMPTS, signal }) {
  const draft = { sql: "", note: "", check: null, attempts: 0, tables: [], joins: [], kind: "query" };
  const say = (type, message, data = {}) => {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    emit({ type, message, ...data });
  };

  say("retrieve", "جست‌وجو در ساختار پایگاه داده");
  const candidates = retrieve(kb, question);
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
  const listing = candidates
    .map((c) => c.full_name + (c.title_fa ? ` — ${c.title_fa}` : ""))
    .join("\n");
  let chosen = [];
  try {
    const reply = await ask(SELECT_SYSTEM, `## جدول‌های موجود\n${listing}\n\n## پرسش\n${question}`);
    chosen = parseSelection(reply, candidates);
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    chosen = [];
  }
  if (!chosen.length) {
    chosen = candidates.slice(0, 4).map((c) => c.full_name);
    say("select", "انتخاب مدل روشن نبود؛ با نتیجهٔ جست‌وجو ادامه می‌دهیم", { tables: chosen });
  } else {
    say("select", `${chosen.length} جدول انتخاب شد`, { tables: chosen });
  }

  say("context", "استخراج ستون‌ها و مسیرهای پیوند");
  const { context, tables, joins } = buildContext(kb, chosen);
  Object.assign(draft, { tables, joins });
  say("context", `${tables.length} جدول و ${joins.length} پیوند آماده شد`, { tables, joins });

  let userPrompt = draftPrompt(question, context);
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
    userPrompt = repairPrompt(question, context, sql, result);
  }

  draft.sql = lastSql;
  draft.check = lastResult;
  say("done", lastResult?.ok ? "کوئری تأیید شد" : "کوئری تأیید نشد — ایرادها در پاسخ آمده");
  return draft;
}
