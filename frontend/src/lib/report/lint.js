/**
 * بازبینی گزارش‌محور کوئری — قواعد مهارت گزارش‌سازی راهکاران.
 *
 * بازبین ساختاری (assistant/sqlcheck.js) می‌پرسد «این جدول و ستون وجود دارد؟».
 * این‌جا پرسش دیگری است: «اگر همین کوئری پشت یک گزارش برود، عددش درست است؟».
 * بدترین باگ‌های گزارش هیچ خطایی نمی‌دهند — فقط عدد غلط:
 *   • فیلتر نکردن سال مالی/شعبه (جمع چند سال یا چند شعبه)
 *   • نادیده گرفتن State (سند باطل و موقت در جمع)
 *   • BETWEEN روی datetime (رکوردهای ساعت‌دار روز آخر جا می‌مانند)
 *   • JOIN روی ReferenceRef بدون ReferenceType (رکوردهای بی‌ربط به هم می‌چسبند)
 * و چند قاعدهٔ ویژهٔ RDL: ستون بی‌نام یا تکراری، SELECT *، FORMAT() که در Excel
 * عدد را متن می‌کند، Version که هرگز نباید در گزارش بیاید.
 *
 * ورودی `describe(full)` باید جزئیات جدول را برگرداند (همان پاسخ /table/…) یا
 * null؛ ناهمگام است چون روی دسکتاپ از سرور و روی گوشی از ایندکس محلی می‌آید.
 */

import { blankNoise, outputColumns, sqlTree } from "./sqlmeta.js";

const finding = (severity, code, message, hint = "") => ({ severity, code, message, hint });
const strip = (name) => String(name ?? "").trim().replace(/^[[\]"`]+|[[\]"`]+$/g, "");

function* walk(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  yield node;
  for (const value of Object.values(node)) if (value && typeof value === "object") yield* walk(value);
}

const isColumn = (n) => n?.type === "column_ref" && typeof n.column !== "object";

/** همهٔ نام‌های مستعار ← جدول، و جدول‌های هر دستور. */
function scopes(tree) {
  const aliases = new Map();
  const tables = new Set();
  for (const n of walk(tree)) {
    if (typeof n.table === "string" && n.type !== "column_ref" && "db" in n && !n.expr) {
      const full = n.db ? `${strip(n.db)}.${strip(n.table)}` : strip(n.table);
      if (!n.db) continue; // جدول موقت یا CTE
      tables.add(full);
      aliases.set((n.as ? strip(n.as) : strip(n.table)).toLowerCase(), full);
    }
  }
  return { aliases, tables };
}

/** ستون‌هایی که در شرط‌ها (WHERE، ON، HAVING) آمده‌اند. */
function conditionColumns(tree) {
  const out = [];
  for (const n of walk(tree)) {
    for (const key of ["where", "on", "having"]) {
      if (n[key] && typeof n[key] === "object") for (const c of walk(n[key])) if (isColumn(c)) out.push(c);
    }
  }
  return out;
}

function selectColumns(tree) {
  const out = [];
  for (const n of walk(tree)) {
    if (n.type === "select" && Array.isArray(n.columns)) {
      for (const col of n.columns) for (const c of walk(col.expr)) if (isColumn(c)) out.push(c);
    }
  }
  return out;
}

function orderColumns(tree) {
  const out = [];
  for (const n of walk(tree)) {
    if (Array.isArray(n.orderby)) for (const c of walk(n.orderby)) if (isColumn(c)) out.push(c);
    if (Array.isArray(n.groupby?.columns)) for (const c of walk(n.groupby.columns)) if (isColumn(c)) out.push(c);
  }
  return out;
}

/**
 * بازبینی گزارش‌محور. خروجی: { findings, tables } — یافته‌ها هم‌شکل بازبین ساختاری.
 */
export async function lintReportSql(sql, describe) {
  const text = String(sql ?? "");
  const clean = blankNoise(text);
  const F = [];
  if (!text.trim()) return { findings: [], tables: [] };

  const tree = sqlTree(text);
  const { aliases, tables } = tree ? scopes(tree) : { aliases: new Map(), tables: new Set() };
  // جدول‌هایی که تجزیه‌گر نخواند (SQL پویا، کوئری پیچیده) از متن خوانده می‌شوند
  for (const m of clean.matchAll(/\b(?:FROM|JOIN|APPLY)\s+(\[?[A-Za-z_]\w*\]?)\s*\.\s*(\[?[A-Za-z_]\w*\]?)(?:\s+(?:AS\s+)?(\[?[A-Za-z_]\w*\]?))?/gi)) {
    const full = `${strip(m[1])}.${strip(m[2])}`;
    if (/^(sys|INFORMATION_SCHEMA)\./i.test(full)) continue;
    tables.add(full);
    const alias = m[3] && !/^(ON|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FULL|GROUP|ORDER|WITH|UNION|AS)$/i.test(strip(m[3])) ? strip(m[3]) : strip(m[2]);
    if (!aliases.has(alias.toLowerCase())) aliases.set(alias.toLowerCase(), full);
  }

  const details = new Map();
  await Promise.all([...tables].map(async (full) => {
    try {
      const d = await describe(full);
      if (d) details.set(full.toLowerCase(), d);
    } catch {
      /* جدول ناشناخته — بازبین ساختاری خودش می‌گوید */
    }
  }));
  const colsOf = (full) => {
    const d = details.get(String(full).toLowerCase());
    return d ? new Map(d.columns.map((c) => [c.name.toLowerCase(), c])) : null;
  };
  const known = [...tables].filter((t) => details.has(t.toLowerCase()));
  const display = (full) => details.get(full.toLowerCase())?.full_name || full;

  /** جدول یک ستون: با مستعار، یا تنها جدولی که آن ستون را دارد. */
  const ownerOf = (col) => {
    if (col.table) return aliases.get(strip(col.table).toLowerCase()) || null;
    const name = strip(col.column).toLowerCase();
    const owners = known.filter((t) => colsOf(t)?.has(name));
    return owners.length === 1 ? owners[0] : null;
  };
  const refsIn = (cols) => cols.map((c) => ({ table: ownerOf(c), column: strip(c.column).toLowerCase() }));
  const conds = tree ? refsIn(conditionColumns(tree)) : [];
  const selected = tree ? refsIn(selectColumns(tree)) : [];
  const ordered = tree ? refsIn(orderColumns(tree)) : [];
  const usedIn = (list, table, column) => list.some((r) => r.column === column && (r.table == null ? true : r.table.toLowerCase() === table.toLowerCase()));
  // بی‌درخت: جست‌وجوی متنی محافظه‌کار (کمتر هشدار می‌دهد، نه بیشتر)
  const textMentions = (column) => new RegExp(`\\b${column}\\b`, "i").test(clean);
  const textCondition = (column) => new RegExp(`\\b${column}\\]?\\s*(=|IN\\b|<|>|IS\\b)|(=|IN\\s*\\()\\s*[^,;]*\\b${column}\\b`, "i").test(clean);

  // ── سال مالی و شعبه ──
  // یک فیلتر روی سند سرآیند کافی است (اقلام با JOIN به همان سند محدود می‌شوند)؛
  // پس فقط وقتی هشدار می‌دهیم که هیچ جدولی از کوئری روی آن ستون فیلتر نشده باشد.
  const filteredAnywhere = (column) => known.some((t) => colsOf(t).has(column) && (tree ? usedIn(conds, t, column) : textCondition(column)));
  const withCol = (column, test = () => true) => known.filter((t) => colsOf(t).has(column) && test(t));
  const fy = withCol("fiscalyearref");
  if (fy.length && !filteredAnywhere("fiscalyearref")) {
    F.push(finding("error", "fiscal_year", `${fy.map(display).join("، ")} ستون FiscalYearRef دارد ولی کوئری روی سال مالی فیلتر نمی‌کند.`,
      "گزارش اسناد چند سال مالی را با هم جمع می‌زند — بی‌هیچ خطایی، فقط عدد غلط. بنویسید: WHERE x.[FiscalYearRef] = @FiscalYearRef (به‌صورت پارامتر گزارش، نه عدد ثابت)."));
  }
  const br = withCol("branchref", (t) => {
    const target = details.get(t.toLowerCase())?.outgoing?.find((o) => o.from_col === "BranchRef")?.to_table;
    return !target || /GNR3\.Branch$/i.test(target);
  });
  if (br.length && !filteredAnywhere("branchref")) {
    F.push(finding("warning", "branch", `${br.map(display).join("، ")} ستون BranchRef دارد ولی کوئری روی شعبه فیلتر نمی‌کند.`,
      "اگر گزارش عمداً برای همهٔ شعب است، پارامتر اختیاری بگذارید: AND (@BranchRef IS NULL OR x.[BranchRef] = @BranchRef)."));
  }

  for (const full of known) {
    const cols = colsOf(full);
    const name = display(full);
    const filtered = (column) => (tree ? usedIn(conds, full, column) : textCondition(column));

    // ── وضعیت ──
    if (cols.has("state")) {
      const inFilter = filtered("state");
      const inSelect = tree ? usedIn(selected, full, "state") : textMentions("state");
      if (!inFilter && !inSelect) {
        F.push(finding("warning", "state", `جدول ${name} ستون State دارد ولی کوئری نه رویش فیلتر می‌کند نه نشانش می‌دهد.`,
          "اسناد «موقت» و «باطل‌شده» هم در جمع می‌آیند. یا فیلتر وضعیت بگذارید، یا اگر معنای مقادیر هنوز اثبات نشده، State را با CASE … ELSE نمایش دهید و صریحاً بنویسید که فیلتر اعمال نشده."));
      }
      const enumsKnown = details.get(full.toLowerCase())?.enums?.State;
      if (inFilter && !enumsKnown?.length) {
        F.push(finding("info", "state_unproven", `معنای مقادیر State در ${name} در دانش برنامه ثبت نشده.`,
          "پیش از تکیه بر فیلتر وضعیت در گزارش مالی، توزیع واقعی را بگیرید (SELECT State, COUNT(*) … GROUP BY State) — اسکریپت تشخیصی همین را می‌سازد."));
      }
    }
    // ── Version ──
    if (cols.has("version") && tree && (usedIn(selected, full, "version") || usedIn(conds, full, "version") || usedIn(ordered, full, "version"))) {
      F.push(finding("warning", "version", `ستون Version جدول ${name} در کوئری آمده.`, "Version از نوع rowversion است، نه شمارهٔ نسخه؛ هرگز نمایشش ندهید و رویش JOIN یا مرتب‌سازی نکنید."));
    }
    // ── CreationDate در برابر Date ──
    if (cols.has("creationdate") && cols.has("date") && tree && (usedIn(conds, full, "creationdate") || usedIn(selected, full, "creationdate")) && !usedIn(conds, full, "date")) {
      F.push(finding("info", "creation_date", `کوئری از CreationDate جدول ${name} استفاده می‌کند در حالی که ستون Date هم دارد.`,
        "CreationDate تاریخ ثبت در سیستم است، نه تاریخ سند. گزارش مالی تقریباً همیشه باید با [Date] فیلتر و مرتب شود."));
    }
  }

  // ── ReferenceRef بدون ReferenceType ──
  if (tree) {
    for (const n of walk(tree)) {
      if (!n.on || typeof n.on !== "object") continue;
      const cols = [...walk(n.on)].filter(isColumn).map((c) => strip(c.column).toLowerCase());
      for (const ref of cols.filter((c) => c.endsWith("referenceref"))) {
        const type = ref.replace(/ref$/, "type");
        if (!cols.includes(type)) {
          F.push(finding("warning", "reference_type", `پیوند روی ${ref} بدون شرط ${type} است.`,
            "ReferenceRef رابطهٔ چندریختی است و شناسه‌ها بین جدول‌ها تکراری‌اند؛ بی‌شرط ReferenceType رکوردهای بی‌ربط به هم می‌چسبند. شرط x.ReferenceType = <کد> را به همان ON اضافه کنید."));
          break;
        }
      }
    }
  } else if (/\bReferenceRef\b/i.test(clean) && !/\bReferenceType\b/i.test(clean)) {
    F.push(finding("warning", "reference_type", "کوئری از ReferenceRef استفاده می‌کند ولی هیچ شرطی روی ReferenceType ندارد.", "بی‌شرط ReferenceType رکوردهای بی‌ربط به هم می‌چسبند."));
  }

  // ── BETWEEN روی تاریخ ──
  for (const m of clean.matchAll(/([\w\]\[.]+)\s+(NOT\s+)?BETWEEN\b/gi)) {
    const col = strip(m[1].split(".").pop());
    const isDate = /date|time/i.test(col) || known.some((t) => /date|time/i.test(colsOf(t)?.get(col.toLowerCase())?.type || ""));
    if (isDate) {
      F.push(finding("warning", "between_date", `بازهٔ تاریخ با BETWEEN روی ${col} نوشته شده.`,
        "datetime جزء ساعت دارد و BETWEEN @From AND @To رکوردهای ساعت‌دار روز آخر را جا می‌اندازد. بنویسید: x.[Date] >= @FromDate AND x.[Date] < DATEADD(day, 1, @ToDate)."));
      break;
    }
  }

  // ── IsDeleted ──
  if (/\bIsDeleted\b\s*=\s*0/i.test(clean)) {
    F.push(finding("info", "is_deleted", "کوئری فیلتر IsDeleted = 0 دارد.", "در این پایگاه داده حذف نرم سراسری نیست (فقط ۵ ستون IsDeleted در کل)؛ مطمئن شوید این ستون در همین جدول واقعاً هست و معنایش همین است."));
  }

  // ── شناسه‌های رزرو بی‌براکت ──
  const reserved = [...clean.matchAll(/(?:^|[^\w[\]])(?:[A-Za-z_]\w*|\])\s*\.\s*(User|Key|Left|Right|Order|Group)\b(?!\s*\()/g)].map((m) => m[1]);
  if (reserved.length) {
    F.push(finding("warning", "reserved_word", `نام‌های ${[...new Set(reserved)].join("، ")} بی‌براکت آمده‌اند.`, "این‌ها کلمهٔ رزرو T-SQL‌اند؛ همیشه با براکت بنویسید: SYS3.[User]، x.[Key]."));
  }

  // ── خروجی برای RDL ──
  const out = outputColumns(text);
  if (out.star) {
    F.push(finding("warning", "select_star", "خروجی نهایی SELECT * دارد.", "در گزارش، فیلدها باید یک‌به‌یک با ستون‌ها بخوانند؛ با * هر تغییر جدول گزارش را بی‌صدا می‌شکند. ستون‌ها را صریح و با نام مستعار بنویسید."));
  }
  const unnamed = out.columns.filter((c) => !c.name);
  if (unnamed.length) {
    F.push(finding("error", "unnamed_column", `${unnamed.length} ستون خروجی نام ندارد.`, "هر عبارت محاسبه‌ای در SELECT نام مستعار می‌خواهد (… AS TotalDebit)؛ این نام، نام فیلد گزارش می‌شود."));
  }
  const seen = new Map();
  for (const c of out.columns.filter((x) => x.name)) seen.set(c.name.toLowerCase(), (seen.get(c.name.toLowerCase()) || 0) + 1);
  const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dups.length) {
    F.push(finding("error", "duplicate_column", `نام ستون خروجی تکراری است: ${dups.join("، ")}`, "دیتاست گزارش فیلد تکراری نمی‌پذیرد؛ به هرکدام نام مستعار یکتا بدهید."));
  }
  const nonLatin = out.columns.filter((c) => c.name && !/^[A-Za-z_][\w]*$/.test(c.name));
  if (nonLatin.length) {
    F.push(finding("info", "field_names", `نام ستون‌های ${nonLatin.map((c) => c.name).join("، ")} لاتین ساده نیست.`, "گزارش‌ساز برای نام فیلد آن را بازنویسی می‌کند؛ نام مستعار انگلیسی بدون فاصله بدهید و عنوان فارسی را با کامنت «-- عنوان» کنارش بنویسید."));
  }
  if (/\bFORMAT\s*\(/i.test(clean)) {
    F.push(finding("warning", "format_function", "کوئری از FORMAT() استفاده می‌کند.", "عدد قالب‌خورده در SQL متن می‌شود و در خروجی Excel جمع‌پذیر نیست. نوع عددی را نگه دارید و قالب را در RDL بدهید (برای تاریخ شمسی FORMAT روی تاریخ اشکالی ندارد)."));
  }
  const rawDates = out.columns.filter((c) => c.table && c.column && known.some((t) => t.toLowerCase() === c.table.toLowerCase()) && /^(datetime|date|smalldatetime|datetime2)$/i.test(colsOf(c.table)?.get(c.column.toLowerCase())?.type || ""));
  if (rawDates.length) {
    F.push(finding("info", "gregorian_date", `ستون‌های ${rawDates.map((c) => c.name).join("، ")} تاریخ میلادی خام‌اند.`,
      "همهٔ تاریخ‌های این پایگاه داده میلادی‌اند. تاریخ شمسی را در SQL به رشته تبدیل کنید (توابع SYS3 یا FORMAT(x.[Date], N'yyyy/MM/dd', N'fa-IR')) تا در PDF و Excel یکسان دیده شود."));
  }

  return { findings: F, tables: known.map(display) };
}
