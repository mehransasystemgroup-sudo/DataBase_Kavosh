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

const isParam = (n) => n?.type === "column_ref" && /^@/.test(String(n.column));
const isRealColumn = (n) => isColumn(n) && !isParam(n);

/**
 * ستون‌هایی که واقعاً فیلتر شده‌اند: هر ستونِ WHERE و HAVING، ولی از ON فقط
 * ستونی که با پارامتر یا مقدار ثابت مقایسه شده — «fy.FiscalYearID = v.FiscalYearRef»
 * فقط پیوند برای نمایش عنوان سال است، نه محدود کردن سال مالی.
 */
function conditionColumns(tree) {
  const out = [];
  for (const n of walk(tree)) {
    for (const key of ["where", "having"]) {
      if (n[key] && typeof n[key] === "object") for (const c of walk(n[key])) if (isRealColumn(c)) out.push(c);
    }
    if (n.on && typeof n.on === "object") {
      for (const e of walk(n.on)) {
        if (e.type !== "binary_expr" || ["AND", "OR"].includes(String(e.operator).toUpperCase())) continue;
        const sides = [e.left, e.right];
        const cols = sides.filter(isRealColumn);
        if (cols.length === 1 && !sides.some((x) => x && x.type === "column_ref" && !isParam(x) && x !== cols[0])) {
          // یک طرف ستون، طرف دیگر پارامتر/ثابت/فهرست
          const other = sides.find((x) => x !== cols[0]);
          if (!other || other.type !== "column_ref" || isParam(other)) out.push(cols[0]);
        }
      }
    }
  }
  return out;
}

/** آیا این دو طرفِ یک مقایسه «ستون در برابر پارامتر/ثابت» است؟ ستونش را برمی‌گرداند. */
function pinnedColumn(e) {
  const sides = [e.left, e.right];
  const cols = sides.filter(isRealColumn);
  if (cols.length !== 1) return null;
  const other = sides.find((x) => x !== cols[0]);
  return !other || other.type !== "column_ref" || isParam(other) ? cols[0] : null;
}

/** فقط =، IN و BETWEEN با پارامتر یا ثابت سطر را به مقدار معین محدود می‌کند (نه > 0، IS NOT NULL، <>). */
const PIN_OPS = new Set(["=", "IN", "BETWEEN"]);

const isNullTest = (e) => e?.type === "binary_expr" && String(e.operator).toUpperCase() === "IS" && isParam(e.left);

/**
 * مقایسه‌های تکیِ زیر AND. OR محدودکننده نیست، جز الگوی پارامتر اختیاری
 * «(@P IS NULL OR x = @P)» که شاخهٔ دیگرش را می‌شماریم.
 */
function* conjuncts(expr) {
  if (!expr || typeof expr !== "object") return;
  const op = expr.type === "binary_expr" ? String(expr.operator).toUpperCase() : "";
  if (op === "AND") {
    yield* conjuncts(expr.left);
    yield* conjuncts(expr.right);
    return;
  }
  if (op === "OR" && (isNullTest(expr.left) || isNullTest(expr.right))) {
    yield* conjuncts(isNullTest(expr.left) ? expr.right : expr.left);
    return;
  }
  yield expr;
}

function* rowSources(node) {
  // زیرکوئری درون WHERE/HAVING/ON فقط ردیف‌ها را کم می‌کند (IN، EXISTS)، نه زیاد؛ پس سنجیده نمی‌شود
  if (Array.isArray(node)) {
    for (const item of node) yield* rowSources(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.type === "select") yield node;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object" && !["where", "having", "on"].includes(k)) yield* rowSources(v);
  }
}

/** نام ستون خروجی ← عبارت ستونی در یک SELECT (برای جدول مشتق و CTE). */
function outputMap(select) {
  const out = new Map();
  for (const c of Array.isArray(select?.columns) ? select.columns : []) {
    if (!isRealColumn(c.expr)) continue;
    out.set((c.as ? strip(c.as) : strip(c.expr.column)).toLowerCase(), c.expr);
  }
  return out;
}

/**
 * هر SELECT جدا (شاخه‌های UNION هم جدا): جدول‌های خودش، ستون‌های فیلترشده‌اش،
 * و برابری‌های ستون‌به‌ستون برای انتقال فیلتر — «v.FiscalYearRef = fy.FiscalYearID
 * AND fy.FiscalYearID = @P» یعنی v.FiscalYearRef هم محدود است. فیلتر بیرونی روی
 * ستون جدول مشتق یا CTE به ستون درونی همان SELECT برمی‌گردد.
 */
function selectScopes(tree) {
  const out = [];
  const mapped = [];
  const byNode = new Map();
  const ctes = new Map();
  for (const n of walk(tree)) {
    for (const w of Array.isArray(n.with) ? n.with : []) {
      const name = strip(w?.name?.value ?? w?.name).toLowerCase();
      if (name && w?.stmt?.ast) ctes.set(name, w.stmt.ast);
    }
  }
  for (const n of rowSources(tree)) {
    const aliases = new Map();
    const derived = new Map();
    const tables = [];
    const filtered = [];
    const equal = [];
    for (const f of Array.isArray(n.from) ? n.from : []) {
      const join = String(f?.join || "").toUpperCase();
      const outer = /LEFT|RIGHT|FULL/.test(join);
      if (f?.expr?.ast && f.as) derived.set(strip(f.as).toLowerCase(), f.expr.ast);
      else if (typeof f?.table === "string" && !f.db && ctes.has(strip(f.table).toLowerCase())) {
        derived.set((f.as ? strip(f.as) : strip(f.table)).toLowerCase(), ctes.get(strip(f.table).toLowerCase()));
      } else if (typeof f?.table === "string" && f.db && !f.expr) {
        const full = `${strip(f.db)}.${strip(f.table)}`;
        tables.push(full);
        aliases.set((f.as ? strip(f.as) : strip(f.table)).toLowerCase(), full);
      }
      for (const e of conjuncts(f?.on)) {
        if (e?.type !== "binary_expr") continue;
        if (e.operator === "=" && isRealColumn(e.left) && isRealColumn(e.right)) equal.push([e.left, e.right]);
        // شرط ON در LEFT/RIGHT JOIN سمت حفظ‌شده را محدود نمی‌کند (ردیف‌ها با NULL می‌مانند)
        else if (!outer && PIN_OPS.has(String(e.operator).toUpperCase())) {
          const c = pinnedColumn(e);
          if (c) filtered.push(c);
        }
      }
    }
    for (const key of ["where", "having"]) {
      for (const e of conjuncts(n[key])) {
        if (e?.type !== "binary_expr") continue;
        if (e.operator === "=" && isRealColumn(e.left) && isRealColumn(e.right)) {
          // «x.F = x.F» چیزی را محدود نمی‌کند
          if (strip(e.left.table) !== strip(e.right.table) || strip(e.left.column) !== strip(e.right.column)) equal.push([e.left, e.right]);
        } else if (PIN_OPS.has(String(e.operator).toUpperCase())) {
          const c = pinnedColumn(e);
          if (c) filtered.push(c);
        }
      }
    }
    const scope = { node: n, aliases, derived, tables, filtered, equal };
    byNode.set(n, scope);
    out.push(scope);
  }
  // فیلتر بیرونی روی x.F از جدول مشتق/CTE ← فیلتر روی ستون درونی معادلش
  for (const sc of out) {
    for (const c of sc.filtered) {
      const inner = c.table ? sc.derived.get(strip(c.table).toLowerCase()) : null;
      if (!inner) continue;
      for (const node of rowSources(inner)) {
        const target = byNode.get(node);
        const col = outputMap(node).get(strip(c.column).toLowerCase());
        if (target && col) {
          target.filtered.push(col);
          mapped.push({ col, aliases: target.aliases });
        }
      }
    }
  }
  out.mapped = mapped;
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
  // هر SELECT (و هر شاخهٔ UNION) جدا سنجیده می‌شود: یک شاخهٔ بی‌فیلتر همهٔ سال‌ها را جمع می‌زند
  const unfilteredFy = [];
  const scoped = tree ? selectScopes(tree) : [];
  // فیلتر بیرونی جدول مشتق/CTE که به ستون درونی برگشت، برای قاعدهٔ شعبه هم حساب است
  for (const { col, aliases: local } of scoped.mapped || []) {
    const t = col.table ? local.get(strip(col.table).toLowerCase()) : null;
    conds.push({ table: t || ownerOf(col), column: strip(col.column).toLowerCase() });
  }
  if (tree && fy.length) {
    for (const sc of scoped) {
      // هویت هر جدول مستعار آن است، نه نامش: v1 و v2 هر دو FIN3.Voucher ولی دو ردیف‌اند
      const units = [...sc.aliases.entries()];
      const tableOf = (alias) => sc.aliases.get(alias);
      const own = units.filter(([, t]) => colsOf(t)?.has("fiscalyearref")).map(([a]) => a);
      if (!own.length) continue;
      const aliasOf = (c) => {
        if (c.table) return sc.aliases.has(strip(c.table).toLowerCase()) ? strip(c.table).toLowerCase() : null;
        const name = strip(c.column).toLowerCase();
        const hits = units.filter(([, t]) => colsOf(t)?.has(name));
        return hits.length === 1 ? hits[0][0] : null;
      };
      const pk = (alias) => `${tableOf(alias).split(".").pop().toLowerCase()}id`;
      const key = (c) => `${aliasOf(c) ?? "?"}|${strip(c.column).toLowerCase()}`;
      const pinned = new Set(sc.filtered.map(key));
      // هر فیلتر روی یک جدول، کلید آن (قرارداد XxxID) را هم محدود می‌کند:
      // «fy.Title = @Year» یعنی یک سال مالی، پس v.FiscalYearRef = fy.FiscalYearID هم محدود است
      for (const k of [...pinned]) {
        const alias = k.split("|")[0];
        if (alias !== "?") pinned.add(`${alias}|${pk(alias)}`);
      }
      for (let changed = true; changed;) {
        changed = false;
        for (const [a, b] of sc.equal) {
          const [ka, kb] = [key(a), key(b)];
          if (pinned.has(ka) !== pinned.has(kb)) {
            pinned.add(ka);
            pinned.add(kb);
            changed = true;
          }
        }
      }
      // جدولی «پوشیده» است که سال مالی‌اش فیلتر شده، یا با کلید اصلی به ردیف پوشیده‌ای
      // وصل است (اقلام ← سند سرآیند، یا برعکس). پیوند با Number و مانند آن کافی نیست.
      const covered = new Set(own.filter((a) => pinned.has(`${a}|fiscalyearref`)));
      if (pinned.has("?|fiscalyearref") && own.length === 1) covered.add(own[0]);
      const isPk = (c) => {
        const alias = aliasOf(c);
        return alias != null && strip(c.column).toLowerCase() === pk(alias);
      };
      for (let changed = true; changed;) {
        changed = false;
        for (const [a, b] of sc.equal) {
          if (!isPk(a) && !isPk(b)) continue;
          const [x, y] = [aliasOf(a), aliasOf(b)];
          if (x == null || y == null) continue;
          if (covered.has(x) !== covered.has(y)) {
            covered.add(x);
            covered.add(y);
            changed = true;
          }
        }
      }
      for (const a of own) if (!covered.has(a) && !unfilteredFy.includes(tableOf(a))) unfilteredFy.push(tableOf(a));
    }
  } else if (fy.length && !filteredAnywhere("fiscalyearref")) {
    unfilteredFy.push(...fy);
  }
  if (unfilteredFy.length) {
    F.push(finding("error", "fiscal_year", `${unfilteredFy.map(display).join("، ")} ستون FiscalYearRef دارد ولی ${scoped.length > 1 ? "دست‌کم یکی از SELECTهای کوئری (یا شاخه‌های UNION)" : "کوئری"} روی سال مالی فیلتر نمی‌کند.`,
      "گزارش اسناد چند سال مالی را با هم جمع می‌زند — بی‌هیچ خطایی، فقط عدد غلط. بنویسید: WHERE x.[FiscalYearRef] = @FiscalYearRef (به‌صورت پارامتر گزارش، نه عدد ثابت)."));
  }
  // جدول اقلام بی‌FiscalYearRef که سرآیندش (جدول مرجعش) سال مالی دارد ولی در کوئری نیست
  if (!fy.length) {
    const headers = new Map();
    await Promise.all(known.flatMap((t) => (details.get(t.toLowerCase())?.outgoing || [])
      // سرآیند به قرارداد نام: VoucherItem ← Voucher، از راه VoucherRef
      .filter((o) => {
        const head = String(o.to_table || "").split(".").pop();
        return head && o.from_col === `${head}Ref` && t.split(".").pop().startsWith(head) && t.split(".").pop() !== head
          && ![...tables].some((x) => x.toLowerCase() === o.to_table.toLowerCase());
      })
      .map(async (o) => {
        try {
          const d = await describe(o.to_table);
          if (d?.columns?.some((c) => c.name.toLowerCase() === "fiscalyearref")) headers.set(o.to_table, { from: t, col: o.from_col });
        } catch { /* ناشناخته */ }
      })));
    for (const [header, { from, col }] of headers) {
      F.push(finding("warning", "header_fiscal_year", `${display(from)} خودش FiscalYearRef ندارد، ولی جدول سرآیندش ${header} (از راه ${col}) دارد و در کوئری نیست.`,
        `اقلام چند سال مالی با هم می‌آیند. سرآیند را JOIN و روی سال مالی فیلتر کنید: JOIN ${header} h ON h.[${header.split(".").pop()}ID] = x.[${col}] … WHERE h.[FiscalYearRef] = @FiscalYearRef.`));
    }
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

  // ── پارامتر اختیاری که چندمقداری هم هست ──
  for (const m of clean.matchAll(/@([\w\u0600-\u06FF\u200C]+)\s+IS\s+NULL/gi)) {
    if (new RegExp(`\\bIN\\s*\\(\\s*@${m[1]}\\s*\\)`, "i").test(clean)) {
      F.push(finding("warning", "multi_optional", `@${m[1]} هم با IS NULL اختیاری شده و هم با IN (@${m[1]}) چندمقداری.`,
        "پارامتر چندمقداری در SSRS نمی‌تواند تهی باشد و با چند مقدار «@P IS NULL» به فهرست بسط می‌یابد و خطا می‌دهد. یا تک‌مقداری و اختیاری بگیرید، یا چندمقداری بی‌IS NULL (همه = انتخاب همهٔ گزینه‌ها)."));
      break;
    }
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
  const nonLatin = out.columns.filter((c) => c.name && !/^[A-Za-z][\w]*$/.test(c.name));
  if (nonLatin.length) {
    F.push(finding("info", "field_names", `نام ستون‌های ${nonLatin.map((c) => c.name).join("، ")} لاتین ساده نیست.`, "گزارش‌ساز برای نام فیلد آن را بازنویسی می‌کند؛ نام مستعار انگلیسی بدون فاصله بدهید و عنوان فارسی را با کامنت «-- عنوان» کنارش بنویسید."));
  }
  // FORMAT روی عدد بد است؛ روی تاریخ (الگوی yyyy/MM/dd یا ستون تاریخ) همان توصیهٔ خود مهارت است
  const textKeep = blankNoise(text, { keepStrings: true });
  const numericFormat = [...textKeep.matchAll(/\bFORMAT\s*\(\s*([^,]+?)\s*,\s*(N?'[^']*')/gi)].filter((m) => {
    if (/[yMd]{2}|HH|mm/.test(m[2])) return false;
    const col = strip(m[1].split(".").pop()).toLowerCase();
    const owner = known.find((t) => colsOf(t)?.has(col));
    const type = owner ? colsOf(owner).get(col).type : "";
    return !/date|time/i.test(type) && !/date/i.test(col);
  });
  if (numericFormat.length) {
    F.push(finding("warning", "format_function", "کوئری عدد را با FORMAT() به متن تبدیل می‌کند.", "عدد قالب‌خورده در SQL متن می‌شود و در خروجی Excel جمع‌پذیر نیست. نوع عددی را نگه دارید و قالب را در RDL بدهید."));
  }
  const rawDates = out.columns.filter((c) => c.table && c.column && known.some((t) => t.toLowerCase() === c.table.toLowerCase()) && /^(datetime|date|smalldatetime|datetime2)$/i.test(colsOf(c.table)?.get(c.column.toLowerCase())?.type || ""));
  if (rawDates.length) {
    F.push(finding("info", "gregorian_date", `ستون‌های ${rawDates.map((c) => c.name).join("، ")} تاریخ میلادی خام‌اند.`,
      "همهٔ تاریخ‌های این پایگاه داده میلادی‌اند. تاریخ شمسی را در SQL به رشته تبدیل کنید (توابع SYS3 یا FORMAT(x.[Date], N'yyyy/MM/dd', N'fa-IR')) تا در PDF و Excel یکسان دیده شود."));
  }

  return { findings: F, tables: known.map(display) };
}
