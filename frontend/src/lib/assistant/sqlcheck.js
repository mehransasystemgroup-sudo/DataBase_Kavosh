/**
 * بازبینی کوئری در برابر ساختار واقعی — همتای backend/core/sqlcheck.py.
 *
 * نسخهٔ موبایل سروری ندارد، پس همان قاعده این‌جا در خودِ برنامه اجرا می‌شود:
 * مدل زبانی حق ندارد ساختار پایگاه داده را از خودش بسازد، و هرچه بنویسد
 * کلمه‌به‌کلمه با ایندکس سنجیده می‌شود. پیام‌ها عیناً همان پیام‌های سرور است،
 * چون همان‌ها به مدل پس داده می‌شوند؛ آزمونِ همسانی (sqlcheck.test.js) این را
 * با خروجیِ خودِ پایتون می‌سنجد.
 *
 * تجزیه‌گر این‌جا node-sql-parser است نه sqlglot. شکل درختش فرق دارد، پس به‌جای
 * ترجمهٔ خط‌به‌خط، همان چهار پرسش را از درخت می‌پرسیم: کدام جدول‌ها، کدام
 * ستون‌ها، کدام شرط‌های JOIN، و کدام مقایسه با مقدار ثابت.
 */

import parserPkg from "node-sql-parser/build/transactsql.js";

const parser = new parserPkg.Parser();

// همان فهرست WRITE_NODES پایتون، به نام‌هایی که این تجزیه‌گر می‌گذارد
const WRITE_TYPES = new Set([
  "insert", "replace", "update", "delete", "drop", "create", "alter", "merge", "truncate",
]);

// MERGE را این تجزیه‌گر نمی‌شناسد؛ کوئریِ تجزیه‌نشده‌ای که با فعل نوشتن شروع
// می‌شود باید همان «فقط خواندنی» را بگیرد، نه «نحو نامعتبر».
const WRITE_VERB = /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|MERGE|TRUNCATE)\b/i;

const finding = (severity, code, message, hint = "") => ({ severity, code, message, hint });

const strip = (name) => String(name ?? "").trim().replace(/^[[\]"`]+|[[\]"`]+$/g, "");

export class SchemaIndex {
  /** `all(sql)` همان KnowledgeBase.all است؛ همه یک بار در حافظه می‌آید. */
  constructor(all) {
    this.tables = new Map();
    this.byBare = new Map();
    for (const { full_name: full } of all("SELECT full_name FROM tables")) {
      this.tables.set(full.toLowerCase(), full);
      const bare = full.split(".").slice(1).join(".").toLowerCase() || full.toLowerCase();
      if (!this.byBare.has(bare)) this.byBare.set(bare, []);
      this.byBare.get(bare).push(full);
    }

    this.columns = new Map();
    for (const { table_ref: t, name } of all("SELECT table_ref, name FROM columns")) {
      const key = t.toLowerCase();
      if (!this.columns.has(key)) this.columns.set(key, new Map());
      this.columns.get(key).set(name.toLowerCase(), name);
    }

    this.edges = new Set();
    for (const j of all("SELECT from_table, from_col, to_table, to_col FROM joins")) {
      const [a, ac, b, bc] = [j.from_table, j.from_col, j.to_table, j.to_col].map((s) => s.toLowerCase());
      this.edges.add(`${a}\u0000${ac}\u0000${b}\u0000${bc}`);
      this.edges.add(`${b}\u0000${bc}\u0000${a}\u0000${ac}`);
    }

    this.enums = new Map();
    for (const e of all("SELECT table_ref, column, value FROM enums")) {
      const key = `${e.table_ref.toLowerCase()}\u0000${e.column.toLowerCase()}`;
      if (!this.enums.has(key)) this.enums.set(key, new Set());
      this.enums.get(key).add(String(e.value));
    }
  }

  resolveTable(name) {
    const key = name.toLowerCase();
    if (this.tables.has(key)) return this.tables.get(key);
    const matches = this.byBare.get(key) || [];
    return matches.length === 1 ? matches[0] : null;
  }

  candidatesFor(name) {
    const bare = strip(name).split(".").pop().toLowerCase();
    const exact = this.byBare.get(bare) || [];
    if (exact.length) return exact.slice(0, 5);
    const trimmed = bare.replace(/s+$/, "");
    if (trimmed.length < 4) return [];
    const near = new Set();
    for (const [b, names] of this.byBare) {
      if (b.startsWith(trimmed.slice(0, 6))) names.forEach((n) => near.add(n));
    }
    return [...near].sort().slice(0, 5);
  }

  hasColumn(table, column) {
    return this.columns.get(table.toLowerCase())?.has(column.toLowerCase()) ?? false;
  }

  nearColumns(table, column) {
    const cols = this.columns.get(table.toLowerCase());
    const stem = column.toLowerCase().slice(0, 4);
    if (!cols || !stem) return [];
    return [...cols].filter(([low]) => low.startsWith(stem)).map(([, real]) => real).sort().slice(0, 6);
  }

  edgeExists(a, ac, b, bc) {
    return this.edges.has([a, ac, b, bc].map((s) => s.toLowerCase()).join("\u0000"));
  }

  knownEdgesBetween(a, b) {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    return [...this.edges].sort()
      .map((e) => e.split("\u0000"))
      .filter(([x, , y]) => x === al && y === bl);
  }

  enumValues(table, column) {
    return this.enums.get(`${table.toLowerCase()}\u0000${column.toLowerCase()}`) || new Set();
  }
}

// ───────────────────────── گشتن در درخت ─────────────────────────

/** هر شیئی در درخت، با پدرش — درخت این تجزیه‌گر گره‌های نوع‌دار یکدست ندارد. */
function* walk(node) {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  yield node;
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") yield* walk(value);
  }
}

/** گره‌های FROM/JOIN که جدول واقعی‌اند (نه زیرپرس‌وجو). */
const isTableRef = (n) => typeof n.table === "string" && n.type !== "column_ref" && !n.expr && "db" in n;

const isColumn = (n) => n.type === "column_ref" && typeof n.column !== "object";

// آرگومانِ اولِ این تابع‌ها نوع داده یا بخش تاریخ است (CONVERT(date, …)،
// DATEADD(day, …))، نه ستون. sqlglot خودش این را می‌داند؛ این تجزیه‌گر نه.
const KEYWORD_FIRST_ARG = new Set([
  "CONVERT", "TRY_CONVERT", "DATEADD", "DATEDIFF", "DATEDIFF_BIG", "DATEPART", "DATENAME",
  "DATETRUNC", "DATE_BUCKET",
]);

function functionName(n) {
  const parts = n?.name?.name;
  if (Array.isArray(parts)) return parts.map((p) => p.value).join(".").toUpperCase();
  return typeof n?.name === "string" ? n.name.toUpperCase() : "";
}

/** ستون‌هایی که در واقع کلیدواژه‌اند و نباید سنجیده شوند. */
function keywordColumns(tree) {
  const skip = new Set();
  for (const n of walk(tree)) {
    if (n.type !== "function" || !KEYWORD_FIRST_ARG.has(functionName(n))) continue;
    const first = n.args?.value?.[0];
    if (first && isColumn(first) && !first.table) skip.add(first);
  }
  return skip;
}

function collectSources(tree) {
  const derived = new Set();
  for (const n of walk(tree)) {
    // CTE: { name: { value }, stmt }
    if (n.stmt && n.name && typeof n.name === "object" && n.name.value) {
      derived.add(String(n.name.value).toLowerCase());
    }
    // زیرپرس‌وجوی نام‌دار در FROM: { expr: { ast }, as }
    if (n.expr && n.expr.ast && n.as) derived.add(strip(n.as).toLowerCase());
  }

  const aliasToTable = new Map();
  const referenced = new Set();
  for (const n of walk(tree)) {
    if (!isTableRef(n)) continue;
    const name = strip(n.table);
    if (!name || derived.has(name.toLowerCase())) continue;
    const schema = n.db ? strip(n.db) : "";
    const full = schema ? `${schema}.${name}` : name;
    referenced.add(full);
    const alias = n.as ? strip(n.as) : name;
    aliasToTable.set(alias.toLowerCase(), full);
  }
  return { aliasToTable, referenced, derived };
}

function literalValues(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "number") return [String(node.value)];
  if (/string$/.test(node.type || "") && typeof node.value === "string") return [node.value];
  if (node.type === "expr_list" && Array.isArray(node.value)) return node.value.flatMap(literalValues);
  return [];
}

/** STRING_AGG(...) WITHIN GROUP (...) را این تجزیه‌گر نمی‌خواند؛ برای بازبینی بی‌اثر است. */
const tolerate = (sql) => sql.replace(/\bWITHIN\s+GROUP\s*\(\s*ORDER\s+BY[^()]*\)/gi, "");

function parse(sql) {
  try {
    return parser.astify(sql, { database: "transactsql" });
  } catch (first) {
    const relaxed = tolerate(sql);
    if (relaxed !== sql) {
      try {
        return parser.astify(relaxed, { database: "transactsql" });
      } catch {
        /* همان خطای نخست گزارش می‌شود */
      }
    }
    throw first;
  }
}

function firstLine(message) {
  return String(message || "").split("\n")[0].slice(0, 200);
}

// ───────────────────────── بازبینی ─────────────────────────

export function checkSql(sqlText, index) {
  const findings = [];
  const sql = (sqlText || "").trim();
  if (!sql) return result(false, [finding("error", "empty", "کوئری خالی است.")]);

  let statements;
  try {
    const ast = parse(sql);
    statements = (Array.isArray(ast) ? ast : [ast]).filter(Boolean);
  } catch (e) {
    if (WRITE_VERB.test(sql)) {
      return result(false, [finding(
        "error", "not_read_only",
        "این کوئری داده را تغییر می‌دهد؛ دستیار فقط کوئری خواندنی می‌سازد.",
        "فقط SELECT بنویسید.",
      )]);
    }
    return result(false, [finding(
      "error", "parse_error",
      `کوئری از نظر نحوی معتبر نیست: ${firstLine(e.message)}`,
      "کوئری باید T-SQL معتبر باشد.",
    )]);
  }
  if (!statements.length) return result(false, [finding("error", "empty", "کوئری خالی است.")]);

  const allTables = new Set();

  for (const tree of statements) {
    if ([...walk(tree)].some((n) => WRITE_TYPES.has(n.type))) {
      findings.push(finding(
        "error", "not_read_only",
        "این کوئری داده را تغییر می‌دهد؛ دستیار فقط کوئری خواندنی می‌سازد.",
        "فقط SELECT بنویسید.",
      ));
    }

    const { aliasToTable, referenced, derived } = collectSources(tree);

    // ── جدول‌ها ──
    const resolved = new Map();
    for (const name of [...referenced].sort()) {
      const real = index.resolveTable(name);
      if (real === null) {
        const near = index.candidatesFor(name);
        findings.push(finding(
          "error", "unknown_table",
          `جدول «${name}» در این پایگاه داده وجود ندارد.`,
          near.length ? "نزدیک‌ترین‌ها: " + near.join("، ")
            : "نام جدول را از فهرست جدول‌های داده‌شده بردارید.",
        ));
      } else {
        resolved.set(name.toLowerCase(), real);
        allTables.add(real);
      }
    }

    const aliasReal = new Map();
    for (const [alias, table] of aliasToTable) aliasReal.set(alias, resolved.get(table.toLowerCase()) ?? null);
    const inScope = [...resolved.values()];

    const nodes = [...walk(tree)];

    // ── ستون‌ها ──
    const keywords = keywordColumns(tree);
    for (const col of nodes.filter((n) => isColumn(n) && !keywords.has(n))) {
      const cname = strip(col.column);
      // @FiscalYearRef پارامتر است، نه ستون (تجزیه‌گر گاهی آن را ستون می‌خواند)
      if (!cname || cname === "*" || cname.startsWith("@")) continue;
      const qualifier = col.table ? strip(col.table).toLowerCase() : "";

      if (qualifier) {
        if (derived.has(qualifier)) continue;
        const table = aliasReal.get(qualifier);
        if (table == null) {
          if (!aliasReal.has(qualifier)) {
            findings.push(finding(
              "error", "unknown_alias",
              `نام مستعار «${qualifier}» به هیچ جدولی در FROM وصل نیست.`,
            ));
          }
          continue;
        }
        if (!index.hasColumn(table, cname)) {
          const near = index.nearColumns(table, cname);
          findings.push(finding(
            "error", "unknown_column",
            `ستون «${cname}» در جدول ${table} وجود ندارد.`,
            near.length ? "ستون‌های نزدیک: " + near.join("، ")
              : `ستون‌های ${table} را از متن ساختار بردارید.`,
          ));
        }
        continue;
      }

      if (derived.size) continue;
      const owners = inScope.filter((t) => index.hasColumn(t, cname));
      if (!owners.length && inScope.length) {
        findings.push(finding(
          "error", "unknown_column",
          `ستون «${cname}» در هیچ‌کدام از جدول‌های این کوئری نیست.`,
          "جدول‌های کوئری: " + [...inScope].sort().join("، "),
        ));
      } else if (owners.length > 1) {
        findings.push(finding(
          "warning", "ambiguous_column",
          `ستون «${cname}» در چند جدول هست و بدون نام جدول مبهم است.`,
          "نام جدول یا مستعارش را جلوی ستون بگذارید: " + [...owners].sort().join("، "),
        ));
      }
    }

    // ── مسیرهای JOIN ──
    for (const join of nodes.filter((n) => isTableRef(n) || (n.expr && n.expr.ast))) {
      if (!join.on) continue;
      for (const eq of walk(join.on)) {
        if (eq.type !== "binary_expr" || eq.operator !== "=") continue;
        const { left, right } = eq;
        if (!isColumn(left || {}) || !isColumn(right || {})) continue;
        const lt = aliasReal.get(strip(left.table).toLowerCase());
        const rt = aliasReal.get(strip(right.table).toLowerCase());
        if (!lt || !rt || lt === rt) continue;
        const lc = strip(left.column);
        const rc = strip(right.column);
        if (index.edgeExists(lt, lc, rt, rc)) continue;
        const known = index.knownEdgesBetween(lt, rt);
        let hint;
        if (known.length) {
          const pairs = new Set(known.map(([x, xc, y, yc]) =>
            `${index.tables.get(x) ?? x}.${xc} = ${index.tables.get(y) ?? y}.${yc}`));
          hint = "رابطهٔ شناخته‌شده: " + [...pairs].sort().join("؛ ");
        } else {
          hint = "بین این دو جدول رابطهٔ مستقیمی در دانش ما نیست.";
        }
        findings.push(finding(
          "warning", "unverified_join",
          `پیوند ${lt}.${lc} = ${rt}.${rc} در دانش پایگاه داده ثبت نشده است.`,
          hint,
        ));
      }
    }

    // ── مقدارهای کد و شرحی ──
    for (const eq of nodes) {
      if (eq.type !== "binary_expr" || !["=", "IN", "NOT IN"].includes(eq.operator)) continue;
      const target = eq.left;
      if (!target || !isColumn(target)) continue;
      let table = target.table ? aliasReal.get(strip(target.table).toLowerCase()) : null;
      if (table == null && inScope.length === 1) table = inScope[0];
      if (table == null) continue;
      const cname = strip(target.column);
      const allowed = index.enumValues(table, cname);
      if (!allowed.size) continue;
      const bad = literalValues(eq.right).filter((v) => !allowed.has(v));
      if (bad.length) {
        findings.push(finding(
          "warning", "unknown_enum_value",
          `مقدار ${bad.join("، ")} برای ${table}.${cname} در فهرست مقادیر شناخته‌شده نیست.`,
          "مقادیر مجاز: " + [...allowed].sort().slice(0, 12).join("، "),
        ));
      }
    }
  }

  const ok = !findings.some((f) => f.severity === "error");
  return result(ok, findings, [...allTables].sort());
}

function result(ok, findings, tables = []) {
  return { ok, findings, tables };
}

/** متن بازخورد برای مدل — همان چیزی که دور بعد اصلاحش می‌کند. */
export function feedback(check) {
  return check.findings
    .map((f) => `- [${f.severity === "error" ? "خطا" : "هشدار"}] ${f.message}` + (f.hint ? `\n  ${f.hint}` : ""))
    .join("\n");
}

const FENCE = /```(?:sql|tsql)?\s*\n([\s\S]*?)```/gi;

/** کوئری را از پاسخ مدل بیرون می‌کشد — مدل‌ها دور کوئری توضیح می‌نویسند. */
export function extractSql(text) {
  if (!text) return "";
  const fenced = [...text.matchAll(FENCE)].map((m) => m[1]);
  if (fenced.length) return fenced.reduce((a, b) => (b.length > a.length ? b : a)).trim();
  const m = /\b(WITH|SELECT)\b/i.exec(text);
  return m ? text.slice(m.index).trim() : text.trim();
}

export { FENCE };
