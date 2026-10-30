/**
 * اسکریپت تشخیصی مرحلهٔ ۰ — «حدس نزن، از خودِ پایگاه داده بپرس».
 *
 * برای هر جدول چهار بلوک می‌سازد (الگوی references/schema-discovery-queries.md):
 *   ۱) ساختار ستون‌ها از INFORMATION_SCHEMA
 *   ۲) ۵۰ ردیف نمونهٔ اخیر — یک ردیف هرگز چیزی را ثابت نمی‌کند
 *   ۳) توزیع واقعی مقادیر هر ستون فلگ/کد/وضعیت (GROUP BY)
 *   ۴) کلیدهای خارجی مرتبط
 * و کنار هر بلوک می‌نویسد نتیجه‌اش برای کدام تصمیم لازم است. فرضیه‌هایی که
 * دانش برنامه دربارهٔ معنای مقادیر دارد، به‌صورت کامنت کنار کوئری توزیع
 * می‌آید تا کاربر خروجی واقعی را با آن مقایسه کند.
 *
 * اسکریپت فقط-خواندنی است (SELECT) و با READ UNCOMMITTED اجرا می‌شود تا
 * روی پایگاه دادهٔ عملیاتی قفل نگیرد.
 */

const q = (name) => `[${String(name).replace(/]/g, "]]")}]`;
const lit = (s) => `N'${String(s).replace(/'/g, "''")}'`;

const FLAG_NAME = /^(State|Status|Type|Kind|Category|Mode|Nature|Entrance|Is[A-Z]\w*|Has[A-Z]\w*|\w+(Type|Status|State|Kind|Code|Category|Mode))$/;

/** ستون‌هایی که منطق گزارش معمولاً به معنای مقدارشان وابسته است. */
export function flagColumns(table, extra = []) {
  const want = new Set(extra.map((c) => String(c).toLowerCase()));
  const enums = table.enums || {};
  return (table.columns || []).filter((c) => {
    const name = c.name;
    const type = String(c.type || "").toLowerCase();
    if (want.has(name.toLowerCase())) return true;
    if (/^(n?varchar|n?char)\((max|[3-9]\d|\d{3,})\)/.test(type)) return false; // متن آزاد
    if (/(binary|image|xml|geography|geometry|timestamp|rowversion|uniqueidentifier)/.test(type)) return false;
    if (/^(date|datetime|datetime2|smalldatetime|time)/.test(type)) return false;
    if (/Ref$|ID$/.test(name) && !/Type|Status|State/.test(name)) return false;
    return Boolean(enums[name]) || type === "bit" || FLAG_NAME.test(name);
  }).slice(0, 14);
}

function orderColumn(table) {
  const names = (table.columns || []).map((c) => c.name);
  return ["Date", "DocumentDate", "EffectiveDate", "CreationDate", "LastModificationDate"].find((n) => names.includes(n))
    || table.primary_key?.[0]
    || null;
}

function hypotheses(table, column) {
  const values = table.enums?.[column] || [];
  if (!values.length) return [];
  return values.slice(0, 25).map((v) => `--     ${String(v.value).padEnd(6)} → ${v.label_fa || "؟"}${v.confidence ? `  (${v.confidence})` : ""}`);
}

/**
 * اسکریپت کامل برای فهرست جدول‌ها. `tables` همان پاسخ /table/… است.
 * `focus` ستون‌هایی که کاربر صریحاً می‌خواهد توزیعشان را ببیند.
 */
export function discoveryScript(tables, { focus = {}, sampleRows = 50, purpose = "" } = {}) {
  const list = (tables || []).filter(Boolean);
  const lines = [];
  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(
    "/* ════════════════════════════════════════════════════════════════════",
    "   اسکریپت تشخیصی (مرحلهٔ ۰) — کاوشگر پایگاه داده",
    `   تاریخ ساخت: ${stamp}`,
    `   جدول‌ها: ${list.map((t) => t.full_name).join("، ") || "—"}`,
    purpose ? `   هدف گزارش: ${purpose.replace(/\*\//g, "* /")}` : null,
    "",
    "   فقط‌خواندنی است (هیچ INSERT/UPDATE/DELETE ندارد).",
    "   روی پایگاه دادهٔ واقعی در SSMS اجرا کنید و همهٔ نتیجه‌ها را برگردانید",
    "   (متن، اسکرین‌شات یا خروجی Excel). تا این نتیجه‌ها نرسیده، کوئری نهایی",
    "   گزارش «فرضی / نیازمند تأیید» است.",
    "   ════════════════════════════════════════════════════════════════════ */",
    "SET NOCOUNT ON;",
    "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; -- بدون قفل روی پایگاه دادهٔ عملیاتی",
    "",
  );
  list.forEach((t, i) => {
    const [schema, ...rest] = t.full_name.split(".");
    const name = rest.join(".");
    const full = `${q(schema)}.${q(name)}`;
    const order = orderColumn(t);
    lines.push(
      `-- ═════ ${(i + 1).toLocaleString("fa-IR")}) جدول ${t.full_name}${t.title_fa ? ` — ${t.title_fa}` : ""} ═════`,
      "",
      "-- ۱) ساختار ستون‌ها: نوع داده و nullable — برای تعریف درست فیلدها و پارامترهای RDL",
      "SELECT c.ORDINAL_POSITION, c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.IS_NULLABLE, c.COLUMN_DEFAULT",
      "FROM INFORMATION_SCHEMA.COLUMNS c",
      `WHERE c.TABLE_SCHEMA = ${lit(schema)} AND c.TABLE_NAME = ${lit(name)}`,
      "ORDER BY c.ORDINAL_POSITION;",
      "",
      `-- ۲) ${sampleRows.toLocaleString("fa-IR")} ردیف نمونهٔ اخیر — برای دیدن مقدار واقعی هر ستون (یک ردیف هرگز کافی نیست)`,
      `SELECT TOP (${sampleRows}) * FROM ${full}${order ? ` ORDER BY ${q(order)} DESC` : ""};`,
      "",
    );
    const flags = flagColumns(t, focus[t.full_name] || []);
    if (flags.length) {
      lines.push("-- ۳) توزیع واقعی مقادیر — تنها راه اثبات معنای فلگ/کد/وضعیت (چند NULL؟ چند ۰؟ چند ۱؟)");
      for (const c of flags) {
        const hyp = hypotheses(t, c.name);
        if (hyp.length) lines.push(`--   فرضیهٔ فعلی دانش برنامه دربارهٔ ${c.name}:`, ...hyp);
        lines.push(`SELECT ${q(c.name)}, COUNT(*) AS Cnt FROM ${full} GROUP BY ${q(c.name)} ORDER BY ${q(c.name)};`);
      }
      lines.push("");
    }
  });
  if (list.length) {
    // با OBJECT_ID نام کامل (اسکیما + جدول)، تا جدول هم‌نامِ اسکیمای دیگر قاطی نشود
    const ids = [...new Set(list.map((t) => t.full_name))].map((f) => `OBJECT_ID(${lit(f)})`).join(", ");
    lines.push(
      "-- ═════ ۴) کلیدهای خارجی مرتبط — برای JOIN مطمئن (نه حدس از روی نام ستون) ═════",
      "SELECT fk.name AS ForeignKeyName,",
      "       SCHEMA_NAME(tp.schema_id) + '.' + tp.name AS ParentTable, cp.name AS ParentColumn,",
      "       SCHEMA_NAME(tr.schema_id) + '.' + tr.name AS ReferencedTable, cr.name AS ReferencedColumn",
      "FROM sys.foreign_keys fk",
      "JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id",
      "JOIN sys.tables tp ON tp.object_id = fkc.parent_object_id",
      "JOIN sys.columns cp ON cp.object_id = tp.object_id AND cp.column_id = fkc.parent_column_id",
      "JOIN sys.tables tr ON tr.object_id = fkc.referenced_object_id",
      "JOIN sys.columns cr ON cr.object_id = tr.object_id AND cr.column_id = fkc.referenced_column_id",
      `WHERE fkc.parent_object_id IN (${ids}) OR fkc.referenced_object_id IN (${ids})`,
      "ORDER BY ParentTable, ParentColumn;",
      "",
    );
  }
  lines.push(
    "/* نتیجه‌ها برای چه تصمیمی لازم‌اند:",
    "   • بلوک ۱: نوع هر فیلد و پارامتر گزارش (bigint/int/datetime/nvarchar) و nullable بودن.",
    "   • بلوک ۲: اینکه داده واقعاً چه شکلی است — تاریخ‌ها میلادی‌اند؟ کدها پرند یا NULL؟",
    "   • بلوک ۳: معنای واقعی State/Type/فلگ‌ها؛ اگر NULL زیاد است، منطق باید fallback داشته باشد.",
    "   • بلوک ۴: مسیر JOIN درست؛ رابطهٔ ReferenceRef بی‌ReferenceType هرگز کافی نیست. */",
  );
  return lines.filter((l) => l !== null).join("\n");
}
