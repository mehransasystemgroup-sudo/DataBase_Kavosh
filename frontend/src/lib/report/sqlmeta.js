/**
 * فهم ساختاری یک کوئری گزارش — بی‌نیاز به اتصال پایگاه داده.
 *
 * گزارش‌ساز از کوئری چهار چیز لازم دارد و هر چهار باید دقیق باشد، چون همه
 * مستقیم به RDL می‌روند:
 *   • ستون‌های خروجی — نام هر <Field> باید عیناً نام ستون SELECT باشد، وگرنه
 *     گزارش در Report Builder باز می‌شود و فقط هنگام اجرا می‌ترکد.
 *   • پارامترها — هر @نام که DECLARE نشده، یک QueryParameter و یک
 *     ReportParameter می‌خواهد، وگرنه SQL Server «Must declare the scalar
 *     variable» می‌دهد.
 *   • مقدارهای DECLARE شده — دستیار مقدار نمونه را با DECLARE بالای کوئری
 *     می‌گذارد؛ در گزارش همان‌ها باید پارامتر شوند.
 *   • جدول‌ها — برای نوع ستون، عنوان فارسی و قواعد سال مالی/وضعیت.
 *
 * تجزیه با node-sql-parser است (همان که بازبین کوئری دارد) و اگر کوئری برای
 * آن سنگین بود (SQL پویا، جدول موقت، رویهٔ ذخیره‌شده)، به خوانش متنیِ
 * محافظه‌کار برمی‌گردد که فقط آخرین SELECT سطح بالا را می‌خواند.
 */

import parserPkg from "node-sql-parser/build/transactsql.js";

const parser = new parserPkg.Parser();

const strip = (name) => String(name ?? "").trim().replace(/^[[\]"`]+|[[\]"`]+$/g, "");

/**
 * کامنت و رشته‌ها را با فاصلهٔ هم‌طول عوض می‌کند تا جست‌وجوی متنی در آن‌ها
 * گول نخورد و موقعیت‌ها همچنان با متن اصلی بخواند.
 *
 * `keepStrings` برای وقتی است که فقط کامنت‌ها باید بروند.
 */
export function blankNoise(sql, { keepStrings = false } = {}) {
  const s = String(sql ?? "");
  let out = "";
  let i = 0;
  const n = s.length;
  const blank = (text) => text.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "-" && next === "-") {
      const end = s.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(s.slice(i, stop));
      i = stop;
    } else if (c === "/" && next === "*") {
      // کامنت بلوکی T-SQL تودرتو می‌شود
      let depth = 1;
      let j = i + 2;
      while (j < n && depth) {
        if (s[j] === "/" && s[j + 1] === "*") { depth++; j += 2; } else if (s[j] === "*" && s[j + 1] === "/") { depth--; j += 2; } else j++;
      }
      out += blank(s.slice(i, j));
      i = j;
    } else if (c === "'" || ((c === "N" || c === "n") && next === "'" && !/[\w@#$]/.test(s[i - 1] || ""))) {
      const q = c === "'" ? i : i + 1;
      let j = q + 1;
      while (j < n) {
        if (s[j] === "'" && s[j + 1] === "'") j += 2;
        else if (s[j] === "'") { j++; break; } else j++;
      }
      out += keepStrings ? s.slice(i, j) : s.slice(i, q + 1) + blank(s.slice(q + 1, j - 1)) + (j - 1 > q ? "'" : "");
      i = j;
    } else if (c === "[") {
      const end = s.indexOf("]", i);
      const stop = end === -1 ? n : end + 1;
      out += s.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** متغیرهای DECLARE شده (و جدول‌متغیرها) — این‌ها پارامتر گزارش نیستند. */
export function declaredNames(sql) {
  const clean = blankNoise(sql);
  const names = new Set();
  const re = /\bDECLARE\b([\s\S]*?)(?=;|\bDECLARE\b|\bSELECT\b|\bSET\b|\bIF\b|\bWITH\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bEXEC(?:UTE)?\b|\bCREATE\b|\bWHILE\b|\bBEGIN\b|\bTRUNCATE\b|\bDROP\b|$)/gi;
  let m;
  while ((m = re.exec(clean))) {
    for (const v of m[1].matchAll(/@([A-Za-z_][\w$#]*)/g)) names.add(v[1].toLowerCase());
  }
  // پارامترهای sp_executesql داخل رشته‌اند و در blankNoise پاک شده‌اند؛ همین درست است.
  return names;
}

/** هر @نامی که کوئری به کار برده و خودش تعریف نکرده — یعنی پارامتر بیرونی. */
export function queryParameters(sql) {
  const clean = blankNoise(sql);
  const declared = declaredNames(sql);
  const seen = new Map();
  for (const m of clean.matchAll(/(^|[^@\w])@([A-Za-z_][\w$#]*)/g)) {
    const name = m[2];
    const key = name.toLowerCase();
    if (declared.has(key) || seen.has(key)) continue;
    seen.set(key, name);
  }
  return [...seen.values()];
}

const DECLARE_ITEM = /@([A-Za-z_][\w$#]*)\s+(?:AS\s+)?([A-Za-z_][\w]*(?:\s*\(\s*(?:\d+|max)\s*(?:,\s*\d+\s*)?\))?)\s*(?:=\s*((?:N?'(?:[^']|'')*'|[^,;\n]+?)))?\s*(?=,|;|\n|$)/gi;

/**
 * DECLARE های سطح بالای کوئری با نوع و مقدار نمونه.
 *
 * فقط DECLARE هایی که پیش از نخستین دستور دیگر آمده‌اند — یعنی همان «مقدارهای
 * نمونه» که دستیار بالای کوئری می‌گذارد. متغیری که وسط منطق کوئری تعریف و
 * مقداردهی شده، بخشی از منطق است و نباید پارامتر شود.
 */
export function leadingDeclares(sql) {
  const src = String(sql ?? "");
  const clean = blankNoise(src);
  const noComments = blankNoise(src, { keepStrings: true });
  const out = [];
  let pos = 0;
  const statementRe = /\s*DECLARE\b/iy;
  for (;;) {
    // از روی فاصله و کامنت (که در clean فاصله شده) بپر
    const ws = /\s*/y;
    ws.lastIndex = pos;
    ws.exec(clean);
    const begin = ws.lastIndex;
    statementRe.lastIndex = begin;
    if (!statementRe.exec(clean)) break;
    // پایان این DECLARE: نخستین «;» یا سطری که با کلیدواژهٔ دستور تازه شروع شود
    let end = clean.length;
    const semi = clean.indexOf(";", begin);
    const nextStmt = /\n\s*(SELECT|WITH|DECLARE|SET|IF|INSERT|EXEC|EXECUTE|CREATE|WHILE|BEGIN|;)\b/gi;
    nextStmt.lastIndex = begin + 7;
    const ns = nextStmt.exec(clean);
    if (semi !== -1) end = semi + 1;
    if (ns && ns.index < end) end = ns.index;
    // باقی سطرِ پس از «;» اگر فقط کامنت است، جزو همین DECLARE است
    const eol = clean.indexOf("\n", end);
    if (/^\s*$/.test(clean.slice(end, eol === -1 ? clean.length : eol))) end = eol === -1 ? clean.length : eol;
    const body = noComments.slice(begin, end);
    if (/\bTABLE\b/i.test(clean.slice(begin, end))) break; // جدول‌متغیر بخشی از منطق است
    const items = [];
    const inner = body.replace(/^\s*DECLARE\b/i, "").replace(/;\s*$/, "").replace(/\s+$/, "");
    for (const m of inner.matchAll(DECLARE_ITEM)) {
      items.push({ name: m[1], type: m[2].replace(/\s+/g, "").toLowerCase(), value: (m[3] ?? "").trim() });
    }
    if (!items.length) break;
    out.push({ start: begin, end, items });
    pos = end;
  }
  return out;
}

/** کوئری بدون DECLARE های آغازین — همان چیزی که CommandText گزارش می‌شود. */
export function withoutLeadingDeclares(sql) {
  const blocks = leadingDeclares(sql);
  if (!blocks.length) return String(sql ?? "").trim();
  const last = blocks[blocks.length - 1];
  const head = String(sql).slice(0, blocks[0].start);
  return (head.replace(/\s+$/, "") + "\n" + String(sql).slice(last.end).replace(/^\s*\n/, "")).trim();
}

/** مقدار نمونهٔ DECLARE ← مقدار پیش‌فرض پارامتر (بی‌گیومه و بی‌پیشوند N). */
export function literalValue(raw) {
  const v = String(raw ?? "").trim();
  const m = /^N?'((?:[^']|'')*)'$/i.exec(v);
  if (m) return m[1].replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^NULL$/i.test(v)) return null;
  return null; // عبارت (GETDATE() و …) — پیش‌فرض ثابت نمی‌شود
}

// ───────────────────────── ستون‌های خروجی ─────────────────────────

const AGG_TYPES = { SUM: "decimal", AVG: "decimal", COUNT: "int", COUNT_BIG: "bigint", MIN: null, MAX: null };

function functionName(n) {
  const parts = n?.name?.name;
  if (Array.isArray(parts)) return parts.map((p) => p.value).join(".").toUpperCase();
  return typeof n?.name === "string" ? n.name.toUpperCase() : "";
}

function castType(expr) {
  // CAST(x AS decimal(18,0)) — شکل‌های متفاوت در نسخه‌های تجزیه‌گر
  const t = expr?.target?.[0]?.dataType || expr?.target?.dataType;
  if (t) return String(t).toLowerCase();
  if (expr?.type === "function") {
    const fn = functionName(expr);
    if (fn === "CONVERT" || fn === "TRY_CONVERT") {
      const first = expr.args?.value?.[0];
      // CONVERT(nvarchar(10), …) نوع را به شکل «تابع» می‌خواند، CONVERT(int, …) به شکل ستون
      const name = first?.type === "function" ? functionName(first) : first?.column || first?.value || first?.dataType;
      if (typeof name === "string") return name.toLowerCase().replace(/\(.*/, "");
    }
    if (["FORMAT", "CONCAT", "STR", "LEFT", "RIGHT", "SUBSTRING", "REPLACE", "LTRIM", "RTRIM", "TRIM", "UPPER", "LOWER", "STRING_AGG", "CONCAT_WS"].includes(fn)) return "nvarchar";
    if (["DATEADD", "GETDATE", "SYSDATETIME", "EOMONTH", "DATEFROMPARTS"].includes(fn)) return "datetime";
    if (["DATEDIFF", "DATEPART", "YEAR", "MONTH", "DAY", "LEN", "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE"].includes(fn)) return "int";
  }
  return null;
}

/** نوع یک عبارت CASE: اگر همهٔ شاخه‌ها رشته‌اند، رشته. */
function caseType(expr) {
  const results = [...(expr.args || []).map((a) => a.result), expr.args?.find((a) => a.type === "else")?.result].filter(Boolean);
  if (results.length && results.every((r) => /string$/.test(r.type || ""))) return "nvarchar";
  if (results.length && results.every((r) => r.type === "number")) return "int";
  return null;
}

function parseTree(sql) {
  try {
    return parser.astify(sql, { database: "transactsql" });
  } catch {
    try {
      return parser.astify(sql.replace(/\bWITHIN\s+GROUP\s*\(\s*ORDER\s+BY[^()]*\)/gi, ""), { database: "transactsql" });
    } catch {
      return null;
    }
  }
}

function aliasMap(stmt) {
  const map = new Map();
  for (const f of stmt.from || []) {
    if (typeof f.table === "string" && !f.expr) {
      const full = f.db ? `${strip(f.db)}.${strip(f.table)}` : strip(f.table);
      map.set((f.as ? strip(f.as) : strip(f.table)).toLowerCase(), full);
    }
  }
  return map;
}

/** عنوان فارسی از کامنت کنار ستون: «v.Number AS DocNumber, -- شماره سند». */
function labelComments(sql) {
  const labels = new Map();
  for (const line of String(sql ?? "").split(/\r?\n/)) {
    const m = /(?:\bAS\s+)?\[?([A-Za-z_][\w]*)\]?\s*,?\s*--\s*(.+?)\s*$/i.exec(line);
    if (m && /[؀-ۿ]/.test(m[2])) labels.set(m[1].toLowerCase(), m[2].replace(/[,،]\s*$/, ""));
  }
  return labels;
}

/** آخرین SELECT سطح بالا که ستون نام‌دار برمی‌گرداند — خروجی نهایی گزارش. */
function finalSelect(tree) {
  const stmts = (Array.isArray(tree) ? tree : [tree]).filter(Boolean);
  for (let k = stmts.length - 1; k >= 0; k--) {
    let st = stmts[k];
    if (st.type !== "select") continue;
    // UNION: ستون‌ها از نخستین شاخه می‌آیند
    if (st.into?.expr || st.into?.type) continue; // SELECT … INTO #temp خروجی نیست
    return st;
  }
  return null;
}

/**
 * ستون‌های خروجی کوئری.
 *
 * هر ستون: { name, table, column, sqlType, aggregate, label, expression }
 *   name       نام نهایی (مستعار یا نام ستون) — همان نام Field گزارش
 *   table      جدول اصلی ستون اگر مستقیم از جدول آمده (برای نوع و عنوان)
 *   sqlType    نوعی که از خود عبارت پیداست (CAST، تجمیع، تابع)؛ وگرنه null
 *
 * خروجی { columns, star, method, error }:
 *   star       کوئری SELECT * دارد — ستون‌ها از روی کوئری قابل دانستن نیست
 *   method     "parser" یا "text"
 */
export function outputColumns(sql) {
  const src = String(sql ?? "");
  const labels = labelComments(src);
  const tree = parseTree(src);
  const stmt = tree ? finalSelect(tree) : null;
  if (stmt && Array.isArray(stmt.columns)) {
    const aliases = aliasMap(stmt);
    const columns = [];
    let star = false;
    for (const c of stmt.columns) {
      const e = c.expr || {};
      if (e.type === "column_ref" && strip(e.column) === "*") {
        star = true;
        continue;
      }
      let name = c.as ? strip(c.as) : "";
      let table = null;
      let column = null;
      let sqlType = null;
      let aggregate = null;
      if (e.type === "column_ref") {
        column = strip(typeof e.column === "object" ? e.column?.expr?.value : e.column);
        if (!name) name = column;
        const q = e.table ? strip(e.table).toLowerCase() : "";
        table = q ? aliases.get(q) || null : aliases.size === 1 ? [...aliases.values()][0] : null;
      } else if (e.type === "aggr_func") {
        aggregate = String(e.name || "").toUpperCase();
        sqlType = AGG_TYPES[aggregate] ?? null;
        const arg = e.args?.expr;
        if (arg?.type === "column_ref" && (aggregate === "MIN" || aggregate === "MAX" || aggregate === "SUM" || aggregate === "AVG")) {
          column = strip(arg.column);
          const q = arg.table ? strip(arg.table).toLowerCase() : "";
          table = q ? aliases.get(q) || null : aliases.size === 1 ? [...aliases.values()][0] : null;
          if (aggregate === "MIN" || aggregate === "MAX") sqlType = null;
        }
      } else if (e.type === "cast") {
        sqlType = castType(e);
      } else if (e.type === "function") {
        sqlType = castType(e);
      } else if (e.type === "case") {
        sqlType = caseType(e);
      } else if (e.type === "number") {
        sqlType = Number.isInteger(e.value) ? "int" : "decimal";
      } else if (/string$/.test(e.type || "")) {
        sqlType = "nvarchar";
      } else if (e.type === "binary_expr" && ["+", "-", "*", "/"].includes(e.operator)) {
        sqlType = null;
      }
      if (!name) name = "";
      columns.push({ name, table, column, sqlType, aggregate, label: labels.get(name.toLowerCase()) || "", expression: e.type || "" });
    }
    return { columns, star, method: "parser", error: null };
  }
  return { ...textColumns(src, labels), method: "text" };
}

/** خوانش متنی محافظه‌کار: فهرست ستون‌های آخرین SELECT سطح بالا. */
function textColumns(src, labels) {
  const clean = blankNoise(src);
  // آخرین SELECT در عمق صفر پرانتز
  let depth = 0;
  let lastSelect = -1;
  const upper = clean.toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && upper.startsWith("SELECT", i) && !/\w/.test(clean[i - 1] || "") && !/\w/.test(clean[i + 6] || "")) {
      // SELECT … INTO #temp خروجی نیست
      lastSelect = i;
    }
  }
  if (lastSelect === -1) return { columns: [], star: false, error: "SELECT سطح بالا پیدا نشد." };
  // پایان فهرست: FROM یا INTO در عمق صفر
  depth = 0;
  let stop = clean.length;
  let into = false;
  for (let i = lastSelect + 6; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && /\b/.test(ch)) {
      const word = /^(FROM|INTO|WHERE|GROUP|ORDER|UNION|;)\b/i.exec(clean.slice(i));
      if (word && !/\w/.test(clean[i - 1] || "")) {
        if (word[1].toUpperCase() === "INTO") into = true;
        stop = i;
        break;
      }
    }
  }
  if (into) return { columns: [], star: false, error: "آخرین SELECT خروجی را در جدول موقت می‌ریزد." };
  let list = clean.slice(lastSelect + 6, stop).replace(/^\s*(DISTINCT\s+)?(TOP\s*\(?\s*\d+\s*\)?\s*(PERCENT\s+)?(WITH\s+TIES\s+)?)?/i, "");
  const parts = [];
  depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const columns = [];
  let star = false;
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (/(^|\.)\*$/.test(p)) {
      star = true;
      continue;
    }
    let m = /\bAS\s+\[?([^\]\s]+)\]?\s*$/i.exec(p) || /^\[?([A-Za-z_][\w]*)\]?\s*=/.exec(p);
    let name = m ? m[1] : "";
    if (!name) {
      m = /(?:^|\.)\[?([A-Za-z_][\w]*)\]?\s*$/.exec(p);
      name = m ? m[1] : "";
    }
    if (!name) {
      const m2 = /\s\[?([A-Za-z_][\w]*)\]?\s*$/.exec(p);
      name = m2 ? m2[1] : "";
    }
    const agg = /^(SUM|AVG|COUNT|COUNT_BIG|MIN|MAX)\s*\(/i.exec(p);
    const aggregate = agg ? agg[1].toUpperCase() : null;
    columns.push({ name, table: null, column: null, sqlType: aggregate ? AGG_TYPES[aggregate] ?? null : null, aggregate, label: labels.get(name.toLowerCase()) || "", expression: "text" });
  }
  return { columns, star, error: null };
}

/** جدول‌هایی که کوئری از آن‌ها می‌خواند — «SCHEMA.Table» بی‌براکت. */
export function referencedTables(sql) {
  const tree = parseTree(String(sql ?? ""));
  const out = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (typeof node.table === "string" && node.type !== "column_ref" && "db" in node && node.db) {
      out.add(`${strip(node.db)}.${strip(node.table)}`);
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
  };
  if (tree) walk(tree);
  // متن همیشه هم خوانده می‌شود: SQL پویا و جدول‌هایی که تجزیه‌گر نخواند
  const clean = blankNoise(sql, { keepStrings: true });
  for (const m of clean.matchAll(/\b(?:FROM|JOIN|APPLY)\s+(\[?[A-Za-z_]\w*\]?)\s*\.\s*(\[?[A-Za-z_]\w*\]?)(?!\s*\()/gi)) {
    out.add(`${strip(m[1])}.${strip(m[2])}`);
  }
  return [...out].filter((t) => !/^(sys|INFORMATION_SCHEMA)\./i.test(t)).sort();
}

/** درخت تجزیه برای قواعد گزارش (lint) — یا null اگر تجزیه نشد. */
export function sqlTree(sql) {
  return parseTree(String(sql ?? ""));
}

// ───────────────────────── نگاشت نوع ─────────────────────────

const RDL_TYPES = {
  bigint: "System.Int64", int: "System.Int32", smallint: "System.Int16", tinyint: "System.Byte",
  bit: "System.Boolean", decimal: "System.Decimal", numeric: "System.Decimal", money: "System.Decimal",
  smallmoney: "System.Decimal", float: "System.Double", real: "System.Single",
  datetime: "System.DateTime", datetime2: "System.DateTime", smalldatetime: "System.DateTime",
  date: "System.DateTime", time: "System.TimeSpan", datetimeoffset: "System.DateTimeOffset",
  uniqueidentifier: "System.Guid",
};

const baseType = (t) => String(t || "").toLowerCase().replace(/\(.*$/, "").trim();

/** نوع SQL ← rd:TypeName. */
export const rdlType = (sqlType) => RDL_TYPES[baseType(sqlType)] || "System.String";

const NUMERIC = new Set(["bigint", "int", "smallint", "tinyint", "decimal", "numeric", "money", "smallmoney", "float", "real"]);
export const isNumericType = (sqlType) => NUMERIC.has(baseType(sqlType));
export const isIntegerType = (sqlType) => ["bigint", "int", "smallint", "tinyint"].includes(baseType(sqlType));
export const isDateType = (sqlType) => ["datetime", "datetime2", "smalldatetime", "date", "datetimeoffset"].includes(baseType(sqlType));

/** نوع SQL ← DataType پارامتر گزارش. */
export function paramDataType(sqlType) {
  const t = baseType(sqlType);
  if (t === "bit") return "Boolean";
  if (isDateType(t)) return "DateTime";
  // bigint هم Integer می‌شود (Int32 در SSRS). شناسه‌های این پایگاه داده فعلاً
  // خیلی کوچک‌ترند؛ اگر روزی از ۲٬۱۴۷٬۴۸۳٬۶۴۷ گذشت، نوع را String کنید — هشدار
  // اعتبارسنج همین را می‌گوید.
  if (isIntegerType(t)) return "Integer";
  if (NUMERIC.has(t)) return "Float";
  return "String";
}
