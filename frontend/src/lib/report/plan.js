/**
 * طراح بصری کوئری — همان «طرح کوئری» اپ گزارش‌ساز راهکاران (QueryPlan →
 * SqlAssembler)، با قواعد مهارت:
 *   • بازهٔ تاریخ نیم‌باز، نه BETWEEN
 *   • پارامتر اختیاری با (@P IS NULL OR …)
 *   • GROUP BY خودکار وقتی ستون تجمیعی هست
 *   • نام مستعار انگلیسی یکتا + کامنت «-- عنوان فارسی» کنار هر ستون، که
 *     گزارش‌ساز آن را عنوان ستون RDL می‌کند
 *   • شناسه‌ها همیشه براکت‌دار ([User]، [Key] …)
 *
 * مسیر JOIN از گراف دانش برنامه می‌آید (/joinpath)، نه از حدس.
 */

export const AGGREGATES = ["", "SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"];
export const OPS = [
  { id: "=", label: "برابر" },
  { id: "<>", label: "نابرابر" },
  { id: ">=", label: "بزرگ‌تر یا برابر" },
  { id: "<=", label: "کوچک‌تر یا برابر" },
  { id: ">", label: "بزرگ‌تر" },
  { id: "<", label: "کوچک‌تر" },
  { id: "LIKE", label: "شامل (LIKE)" },
  { id: "IN", label: "یکی از (چندمقداری)" },
  { id: "OPTIONAL", label: "برابر — اختیاری (خالی = همه)" },
  { id: "RANGE", label: "بازهٔ تاریخ (نیم‌باز)" },
  { id: "IS NULL", label: "خالی باشد" },
  { id: "IS NOT NULL", label: "خالی نباشد" },
];

const q = (name) => `[${String(name).replace(/]/g, "]]")}]`;
const qTable = (full) => full.split(".").map(q).join(".");
const lit = (v) => {
  if (v === null || v === undefined || v === "") return "NULL";
  if (typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v).trim())) return String(v).trim();
  return `N'${String(v).replace(/'/g, "''")}'`;
};
export const safeName = (s, fallback = "Col") => {
  const clean = String(s || "").replace(/[^A-Za-z0-9_]/g, "");
  return /^[A-Za-z_]/.test(clean) ? clean : clean ? `C_${clean}` : fallback;
};

export function emptyPlan(base = "") {
  return { base, joins: [], columns: [], filters: [], orderBy: [], top: "", distinct: false };
}

/** نام مستعار کوتاه و یکتا برای هر جدول (Voucher → v، VoucherItem → vi). */
export function aliases(plan) {
  const out = new Map();
  const used = new Set();
  const tables = [plan.base, ...plan.joins.map((j) => j.table)].filter(Boolean);
  for (const full of tables) {
    if (out.has(full.toLowerCase())) continue;
    const bare = full.split(".").pop();
    const base = (bare.match(/[A-Z]/g) || [bare[0] || "t"]).join("").toLowerCase() || "t";
    let alias = base;
    for (let n = 2; used.has(alias) || /^(as|on|in|is|or|by|to|if|go)$/.test(alias); n += 1) alias = `${base}${n}`;
    used.add(alias);
    out.set(full.toLowerCase(), alias);
  }
  return out;
}

/** گام‌های /joinpath را به JOINهای طرح تبدیل می‌کند (بی‌تکرار جدول). */
export function joinsFromSteps(plan, steps, kind = "INNER") {
  const have = new Set([plan.base, ...plan.joins.map((j) => j.table)].map((t) => t.toLowerCase()));
  const added = [];
  for (const s of steps || []) {
    const fromIn = have.has(s.from_table.toLowerCase());
    const toIn = have.has(s.to_table.toLowerCase());
    if (fromIn && toIn) continue;
    const table = fromIn ? s.to_table : s.from_table;
    added.push({ table, kind, left: { table: fromIn ? s.from_table : s.to_table, column: fromIn ? s.from_col : s.to_col },
      right: { table, column: fromIn ? s.to_col : s.from_col }, verified: Boolean(s.verified), confidence: s.confidence || "" });
    have.add(table.toLowerCase());
  }
  return { ...plan, joins: [...plan.joins, ...added] };
}

function colExpr(alias, column, aggregate) {
  const ref = `${alias}.${q(column)}`;
  if (!aggregate) return ref;
  if (aggregate === "COUNT_DISTINCT") return `COUNT(DISTINCT ${ref})`;
  return `${aggregate}(${ref})`;
}

/** طرح ← SQL. خروجی: { sql, params: [{name, column, table, op}], warnings } */
export function planToSql(plan) {
  const warnings = [];
  if (!plan.base) return { sql: "", params: [], warnings: ["جدول مبنا انتخاب نشده."] };
  const al = aliases(plan);
  const A = (t) => al.get(String(t || plan.base).toLowerCase()) || "t";
  const usedNames = new Set();
  const cols = plan.columns.filter((c) => c.column);
  const select = cols.map((c) => {
    let name = safeName(c.alias || (c.aggregate ? `${c.aggregate === "COUNT_DISTINCT" ? "Count" : c.aggregate[0] + c.aggregate.slice(1).toLowerCase()}${c.column}` : c.column));
    for (let n = 2; usedNames.has(name.toLowerCase()); n += 1) name = `${safeName(c.alias || c.column)}${n}`;
    usedNames.add(name.toLowerCase());
    const label = String(c.label || "").replace(/[\r\n]+/g, " ").trim();
    return { text: `${colExpr(A(c.table), c.column, c.aggregate)} AS ${q(name)}`, label };
  });
  if (!select.length) warnings.push("هیچ ستونی انتخاب نشده؛ گزارش بدون ستون معنا ندارد.");

  const top = /^\d+$/.test(String(plan.top || "").trim()) && Number(plan.top) > 0 ? `TOP (${Number(plan.top)}) ` : "";
  const lines = [`SELECT ${plan.distinct ? "DISTINCT " : ""}${top}`.trimEnd()];
  select.forEach((s, i) => {
    const comma = i < select.length - 1 ? "," : "";
    lines.push(`    ${s.text}${comma}${s.label ? ` -- ${s.label}` : ""}`);
  });
  if (!select.length) lines.push("    1 AS [Placeholder]");
  lines.push(`FROM ${qTable(plan.base)} AS ${A(plan.base)}`);
  for (const j of plan.joins) {
    if (!j.table || !j.left?.column || !j.right?.column) continue;
    const kind = j.kind === "LEFT" ? "LEFT JOIN" : "INNER JOIN";
    lines.push(`${kind} ${qTable(j.table)} AS ${A(j.table)}`);
    lines.push(`    ON ${A(j.table)}.${q(j.right.column)} = ${A(j.left.table)}.${q(j.left.column)}${j.verified ? "" : " -- مسیر استنتاجی؛ پیش از تکیه تأیید شود"}`);
    if (/ReferenceRef$/i.test(j.left.column) || /ReferenceRef$/i.test(j.right.column)) {
      warnings.push(`پیوند ${j.table} روی ReferenceRef است؛ شرط ReferenceType را دستی به ON بیفزایید.`);
    }
  }

  const params = [];
  const addParam = (name, f, extra = {}) => {
    if (!params.some((p) => p.name.toLowerCase() === name.toLowerCase())) params.push({ name, table: f.table || plan.base, column: f.column, op: f.op, ...extra });
  };
  const where = [];
  for (const f of plan.filters) {
    if (!f.column) continue;
    const ref = `${A(f.table)}.${q(f.column)}`;
    const pname = safeName(f.param || f.column, "Param");
    switch (f.op) {
      case "IS NULL":
      case "IS NOT NULL":
        where.push(`${ref} ${f.op}`);
        break;
      case "RANGE": {
        const from = `From${safeName(f.param || f.column)}`;
        const to = `To${safeName(f.param || f.column)}`;
        where.push(`${ref} >= @${from} AND ${ref} < DATEADD(day, 1, @${to})`);
        addParam(from, f, { range: "from" });
        addParam(to, f, { range: "to" });
        break;
      }
      case "OPTIONAL":
        where.push(`(@${pname} IS NULL OR ${ref} = @${pname})`);
        addParam(pname, f, { optional: true });
        break;
      case "IN":
        where.push(`${ref} IN (@${pname})`);
        addParam(pname, f, { multi: true });
        break;
      case "LIKE":
        if (f.useValue) where.push(`${ref} LIKE ${lit(`%${f.value ?? ""}%`)}`);
        else { where.push(`${ref} LIKE N'%' + @${pname} + N'%'`); addParam(pname, f); }
        break;
      default:
        if (f.useValue) where.push(`${ref} ${f.op || "="} ${lit(f.value)}`);
        else { where.push(`${ref} ${f.op || "="} @${pname}`); addParam(pname, f); }
    }
  }
  if (where.length) lines.push(`WHERE ${where.join("\n  AND ")}`);

  const aggregated = cols.some((c) => c.aggregate);
  if (aggregated) {
    const groups = cols.filter((c) => !c.aggregate).map((c) => `${A(c.table)}.${q(c.column)}`);
    if (groups.length) lines.push(`GROUP BY ${[...new Set(groups)].join(", ")}`);
  }
  const order = plan.orderBy.filter((o) => o.column).map((o) => {
    const asAgg = aggregated && cols.find((c) => c.aggregate && c.column === o.column && (c.table || plan.base) === (o.table || plan.base));
    const expr = asAgg ? colExpr(A(o.table), o.column, asAgg.aggregate) : `${A(o.table)}.${q(o.column)}`;
    return `${expr}${o.dir === "DESC" ? " DESC" : ""}`;
  });
  if (aggregated) {
    const grouped = new Set(cols.filter((c) => !c.aggregate).map((c) => `${(c.table || plan.base).toLowerCase()}.${c.column.toLowerCase()}`));
    for (const o of plan.orderBy.filter((x) => x.column)) {
      const key = `${(o.table || plan.base).toLowerCase()}.${o.column.toLowerCase()}`;
      const isAgg = cols.some((c) => c.aggregate && c.column === o.column);
      if (!grouped.has(key) && !isAgg) warnings.push(`مرتب‌سازی روی ${o.column} با GROUP BY نمی‌خواند؛ آن را به ستون‌ها بیفزایید.`);
    }
  }
  if (order.length) lines.push(`ORDER BY ${order.join(", ")}`);
  return { sql: `${lines.join("\n")};`, params, warnings };
}

/** فیلترهای اجباری مهارت را به طرح می‌افزاید (اگر ستونش در جدول مبنا هست). */
export function withMandatoryFilters(plan, baseColumns = []) {
  const names = new Set(baseColumns.map((c) => c.name));
  const has = (col) => plan.filters.some((f) => f.column === col && (f.table || plan.base) === plan.base);
  const add = [];
  if (names.has("FiscalYearRef") && !has("FiscalYearRef")) add.push({ table: plan.base, column: "FiscalYearRef", op: "=", param: "FiscalYearRef" });
  if (names.has("BranchRef") && !has("BranchRef")) add.push({ table: plan.base, column: "BranchRef", op: "OPTIONAL", param: "BranchRef" });
  if (names.has("Date") && !has("Date")) add.push({ table: plan.base, column: "Date", op: "RANGE", param: "Date" });
  return { ...plan, filters: [...plan.filters, ...add] };
}
