/**
 * از کوئری تا «طرح گزارش»: فیلدها، پارامترها و نوع هرکدام.
 *
 * تابع خالص است — جزئیات جدول‌ها (پاسخ /table) را از بیرون می‌گیرد — تا هم در
 * زبانهٔ گزارش‌ساز و هم در آزمون‌ها همان رفتار را داشته باشد.
 */

import { fieldsFromColumns, HELPERS, paramPrompt } from "./build.js";
import { blankNoise, leadingDeclares, literalValue, outputColumns, paramDataType, queryParameters, referencedTables, withoutLeadingDeclares } from "./sqlmeta.js";

/** نوع SQL ستونی که پارامتر با آن مقایسه می‌شود (col = @P، col IN (@P)، col >= @P …). */
export function paramSqlType(sql, name, details) {
  const clean = blankNoise(sql);
  const p = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\[?(\\w+)\\]?\\s*(?:=|<>|!=|<=|>=|<|>|\\bLIKE\\b|\\bIN\\s*\\()\\s*@${p}\\b`, "i"),
    new RegExp(`@${p}\\s*(?:=|<>|!=|<=|>=|<|>)\\s*(?:\\w+\\.)?\\[?(\\w+)\\]?`, "i"),
    new RegExp(`\\[?(\\w+)\\]?\\s*(?:<|<=)\\s*DATEADD\\s*\\([^)]*@${p}\\b`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(clean);
    if (!m) continue;
    const col = m[1].toLowerCase();
    for (const d of details.values()) {
      const hit = d?.columns?.find((c) => c.name.toLowerCase() === col);
      if (hit) return hit.type;
    }
  }
  if (/date/i.test(name)) return "datetime";
  if (/(Ref|ID)$/.test(name)) return "bigint";
  return null;
}

/** پارامتر گزارش برای یک @نام کوئری. */
export function paramFor(name, sql, details) {
  const clean = blankNoise(sql);
  const p = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sqlType = paramSqlType(sql, name, details);
  const helper = HELPERS[name] || null;
  const optional = new RegExp(`@${p}\\s+IS\\s+NULL`, "i").test(clean);
  const multi = new RegExp(`\\bIN\\s*\\(\\s*@${p}\\s*\\)`, "i").test(clean);
  const split = new RegExp(`STRING_SPLIT\\s*\\(\\s*@${p}\\b`, "i").test(clean);
  return {
    name,
    sqlType: sqlType || "",
    dataType: multi || split ? (paramDataType(sqlType) === "Integer" ? "Integer" : "String") : paramDataType(sqlType),
    prompt: helper?.prompt || paramPrompt(name),
    // چندمقداری هرگز تهی‌پذیر نیست (SSRS نمی‌پذیرد)
    nullable: multi || split ? false : helper ? helper.nullable : optional,
    allowBlank: false,
    multiValue: multi || split,
    joinMulti: split,
    hidden: false,
    defaults: [],
    useHelper: Boolean(helper),
    defaultNull: !(multi || split) && (helper?.defaultNull || false),
  };
}

/**
 * کوئری ← { body, columns, fields, params, tables, notes }
 * `details` نگاشت «نام کامل کوچک‌شده ← پاسخ /table».
 */
export function analyzeSql(sql, details = new Map()) {
  const body = withoutLeadingDeclares(sql);
  const out = outputColumns(body);
  const notes = [];
  if (out.star) notes.push("خروجی SELECT * دارد؛ فیلدها از ساختار جدول حدس زده شدند. ستون‌ها را صریح بنویسید.");
  if (out.error && out.method === "text") notes.push("تجزیه‌گر کوئری را کامل نخواند؛ ستون‌ها از متن خوانده شدند — نام و نوع هر فیلد را بازبینی کنید.");
  const describe = (table, column) => {
    const d = details.get(String(table).toLowerCase());
    const c = d?.columns?.find((x) => x.name.toLowerCase() === String(column).toLowerCase());
    return c ? { type: c.type, label_fa: c.label_fa || "" } : null;
  };
  let columns = out.columns;
  if (out.star && !columns.length) {
    // SELECT * از یک جدول: ستون‌ها را از ساختار بگیر
    const tables = referencedTables(body);
    const d = tables.length === 1 ? details.get(tables[0].toLowerCase()) : null;
    if (d) columns = d.columns.filter((c) => !/^(timestamp|rowversion)$/i.test(c.type)).map((c) => ({ name: c.name, table: d.full_name, column: c.name, sqlType: c.type, aggregate: null, label: c.label_fa || "" }));
  }
  const fields = fieldsFromColumns(columns, describe);
  // DECLARE های آغازین (فایل آزمون SSMS) نوع و مقدار نمونهٔ پارامتر را می‌دهند
  const declared = new Map(leadingDeclares(sql).flatMap((blk) => blk.items).map((d) => [d.name.toLowerCase(), d]));
  const params = queryParameters(body).map((name) => {
    const p = paramFor(name, body, details);
    const d = declared.get(name.toLowerCase());
    if (!d) return p;
    const value = literalValue(d.value);
    return {
      ...p,
      sqlType: d.type || p.sqlType,
      dataType: p.multiValue ? p.dataType : paramDataType(d.type) || p.dataType,
      // مقدار نمونهٔ تاریخ یا شناسهٔ کشویی پیش‌فرض ثابت گزارش نمی‌شود
      defaults: value != null && !p.useHelper && paramDataType(d.type) !== "DateTime" ? [value] : p.defaults,
    };
  });
  if (declared.size) notes.push("نوع و مقدار نمونهٔ پارامترها از DECLARE های آغاز کوئری خوانده شد؛ DECLARE ها در CommandText نمی‌آیند.");
  return { body, columns, fields, params, tables: referencedTables(body), notes };
}

/** ویرایش‌های کاربر روی فیلدها/پارامترها با تحلیل تازه حفظ می‌شود (بر پایهٔ نام). */
export function mergeByName(fresh, previous, keep) {
  const prev = new Map((previous || []).map((x) => [x.name.toLowerCase(), x]));
  const merged = fresh.map((x) => {
    const old = prev.get(x.name.toLowerCase());
    if (!old) return x;
    const kept = Object.fromEntries(keep.filter((k) => k in old).map((k) => [k, old[k]]));
    return { ...x, ...kept };
  });
  // ترتیبی که کاربر چیده بود حفظ شود؛ فیلدهای تازه در انتها
  const order = new Map((previous || []).map((x, i) => [x.name.toLowerCase(), i]));
  return merged.sort((a, b) => (order.get(a.name.toLowerCase()) ?? 1e6 + fresh.indexOf(a)) - (order.get(b.name.toLowerCase()) ?? 1e6 + fresh.indexOf(b)));
}

export const FIELD_KEEP = ["label", "visible", "total", "format", "width", "hideEmpty"];
export const PARAM_KEEP = ["prompt", "dataType", "nullable", "allowBlank", "multiValue", "hidden", "defaults", "useHelper"];

/** طرح UI ← spec سازندهٔ RDL. */
export function toBuildSpec({ title, body, fields, params, layout, profile }) {
  const helperDataSets = [];
  const builtParams = params.map((p) => {
    const base = p.useHelper ? HELPERS[p.name] : null;
    const helper = base && p.multiValue && base.multi ? { ...base, ...base.multi } : base;
    if (helper && !helperDataSets.some((h) => h.name === helper.dataSet.name)) helperDataSets.push(helper.dataSet);
    const defaults = (p.defaults || []).filter((d) => d !== "" && d != null);
    return {
      name: p.name,
      dataType: p.dataType,
      prompt: p.prompt || p.name,
      nullable: Boolean(p.nullable) && !p.multiValue,
      allowBlank: Boolean(p.allowBlank) && p.dataType === "String",
      multiValue: Boolean(p.multiValue),
      joinMulti: Boolean(p.joinMulti),
      hidden: Boolean(p.hidden),
      defaults,
      defaultNull: Boolean(helper?.defaultNull && p.nullable && !p.multiValue),
      validValues: helper ? helper.validValues : null,
    };
  });
  return {
    title,
    sql: body,
    fields,
    params: builtParams,
    helperDataSets,
    queryParams: params.map((p) => p.name),
    layout,
    profile,
  };
}
