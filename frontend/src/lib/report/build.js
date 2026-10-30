/**
 * سازندهٔ RDL — از کوئری و چند انتخاب ساده تا فایلی که Report Builder 2016 باز
 * می‌کند و نرم‌افزار میزبان (راهکاران) بارگذاری.
 *
 * اصل طراحی (همان اصل ابزار گزارش‌ساز قبلی): بدنه و سلسله‌مراتب هر دو از یک
 * «مدل ردیف» ساخته می‌شوند. در RDL این دو باید دقیقاً بخوانند — اگر بدنه پنج
 * ردیف داشته باشد و سلسله‌مراتب چهار برگ، فایل باز نمی‌شود — و با ساختن هر دو
 * از یک منبع، این خطا از نظر ساختاری ممکن نیست. همین برای ستون‌ها: هر ستون یک
 * TablixColumn، یک TablixMember و در هر ردیف یک TablixCell.
 *
 * قراردادهای نرم‌افزار میزبان که این‌جا رعایت می‌شوند (مهارت گزارش‌سازی):
 *   • PageHeader و PageFooter هرگز ساخته نمی‌شوند؛ عنوان و خلاصهٔ فیلترها در
 *     بدنه می‌آیند و اگر تکرارشان در هر صفحه خواسته شود، ردیف ثابت تکرارشوندهٔ
 *     داخل Tablix می‌شوند (KeepWithGroup=After + RepeatOnNewPage).
 *   • پارامترهای سیستمی Sys_* به هر گزارش اضافه می‌شوند.
 *   • منبع داده به‌صورت پیش‌فرض ارجاع مشترک /DataSources/SgDataSource است.
 *   • قالب‌بندی سازمانی اعداد (Code.Util.Format) اختیاری است و اگر انتخاب شود
 *     CodeModule و Class لازمش هم اضافه می‌شود.
 *
 * ترتیب عنصرها همان ترتیبی است که خود Report Builder می‌نویسد.
 */

import { escapeAttr, escapeText } from "./xml.js";
import { cm, PAGE_SIZES } from "./units.js";
import { isDateType, isNumericType, rdlType } from "./sqlmeta.js";
import { rdlName, SYS_PARAMS } from "./rdl.js";

export const DEFAULT_PROFILE = {
  dataSource: "shared",
  dataSourceName: "ReportDataSource",
  dataSourceRef: "/DataSources/SgDataSource",
  connectString: "Data Source=YOUR_SERVER;Initial Catalog=YOUR_DATABASE",
  sysParams: true,
  numberFormat: "#,0;(#,0);-",
  utilFormat: false,
  fontFamily: "B Nazanin",
  fontSize: 9,
  headerFontSize: 10,
  titleFontSize: 13,
  page: "landscape_a4",
  margin: 0.5,
  language: "fa-IR",
  headerBg: "#E5E9E5",
  groupBg: "#F2F2F2",
  totalBg: "#D9D9D9",
  stripeBg: "#F8FAF8",
  borderColor: "LightGrey",
  rowHeight: 0.6,
  headerHeight: 0.75,
};

export const NUMBER_FORMATS = [
  { value: "#,0;(#,0);-", label: "۱٬۲۳۴ — منفی در پرانتز، صفر خط تیره" },
  { value: "#,0", label: "۱٬۲۳۴" },
  { value: "#,0.00;(#,0.00);-", label: "۱٬۲۳۴٫۵۶ — دو رقم اعشار" },
  { value: "0", label: "بدون جداکننده (کد، شماره)" },
  { value: "yyyy/MM/dd", label: "تاریخ ۲۰۲۴/۰۳/۲۰" },
  { value: "", label: "بی‌قالب" },
];

/** متن ثابتی که با «=» شروع شود را SSRS عبارت می‌خواند؛ رشتهٔ صریح می‌شود. */
const lit = (s) => (/^\s*=/.test(String(s)) ? `="${String(s).replace(/"/g, '""')}"` : String(s));
export const DATE_FORMAT = "yyyy/MM/dd";

// ───────────────────────── کمک‌ها ─────────────────────────

const ID_LIKE = /(ID|Ref|Code|Number|No|Year|YearMonth|Type|State|Status|Kind)$/;

/** آیا ستون عددی مقداری (جمع‌پذیر) است، نه شناسه یا کد؟ */
export function isMeasure(field) {
  if (!isNumericType(field.sqlType)) return false;
  if (field.aggregate === "COUNT" || field.aggregate === "SUM" || field.aggregate === "AVG") return true;
  return !ID_LIKE.test(field.name);
}

/** عرض پیش‌فرض ستون بر پایهٔ نوع و طول عنوان. */
export function defaultWidth(field) {
  const label = (field.label || field.name || "").length;
  if (isMeasure(field)) return Math.max(2.4, Math.min(3.2, label * 0.2 + 1.2));
  if (isNumericType(field.sqlType) || /(Code|Number|No)$/.test(field.name)) return 2.2;
  if (isDateType(field.sqlType) || /Date$/.test(field.name)) return 2.4;
  if (/(Title|Name|Description|Desc)$/i.test(field.name)) return 4.5;
  return Math.max(2.5, Math.min(4.5, label * 0.22 + 1));
}

/**
 * فیلدهای اولیهٔ گزارش از ستون‌های کوئری و (اگر هست) اطلاعات جدول‌ها.
 * `describe(table, column)` ← { type, label_fa } یا null.
 */
export function fieldsFromColumns(columns, describe = () => null) {
  const used = new Set();
  return columns.filter((c) => c.name).map((c, i) => {
    // نام فیلد لاتین و معتبر؛ نام ستون SQL (حتی فارسی) در DataField و عنوان می‌ماند
    const base = rdlName(c.name, `Field${i + 1}`);
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    used.add(name.toLowerCase());
    const info = c.table && c.column ? describe(c.table, c.column) : null;
    const sqlType = c.sqlType || info?.type || (c.aggregate ? "decimal" : null);
    const field = {
      name,
      dataField: c.name,
      label: c.label || (c.aggregate && info?.label_fa ? `${aggLabel(c.aggregate)} ${info.label_fa}` : info?.label_fa) || c.name,
      sqlType: sqlType || "nvarchar",
      aggregate: c.aggregate || null,
      visible: true,
    };
    field.total = isMeasure(field);
    field.format = isNumericType(field.sqlType) ? (isMeasure(field) ? DEFAULT_PROFILE.numberFormat : "0") : isDateType(field.sqlType) ? DATE_FORMAT : "";
    field.width = defaultWidth(field);
    return field;
  });
}

const aggLabel = (a) => ({ SUM: "جمع", AVG: "میانگین", COUNT: "تعداد", MIN: "کمینهٔ", MAX: "بیشینهٔ" }[a] || "");

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

/** نام‌ساز یکتا برای Textbox ها و گروه‌ها. */
function namer() {
  const used = new Set();
  return (base) => {
    const clean = rdlName(base, "tb");
    let name = clean;
    let k = 1;
    while (used.has(name.toLowerCase())) name = `${clean}${++k}`;
    used.add(name.toLowerCase());
    return name;
  };
}

// ───────────────────────── قطعه‌های XML ─────────────────────────

function textbox(name, value, o, pf) {
  const fontSize = o.size || pf.fontSize;
  const runStyle = [
    `<FontFamily>${escapeText(pf.fontFamily)}</FontFamily>`,
    `<FontSize>${fontSize}pt</FontSize>`,
    o.bold ? "<FontWeight>Bold</FontWeight>" : "",
    o.format ? `<Format>${escapeText(o.format)}</Format>` : "",
    o.color ? `<Color>${escapeText(o.color)}</Color>` : "",
  ].join("");
  const boxStyle = [
    o.border === false ? "<Border><Style>None</Style></Border>" : `<Border><Color>${escapeText(pf.borderColor)}</Color><Style>Solid</Style><Width>0.5pt</Width></Border>`,
    o.bg ? `<BackgroundColor>${escapeText(o.bg)}</BackgroundColor>` : "",
    "<VerticalAlign>Middle</VerticalAlign>",
    "<PaddingLeft>2pt</PaddingLeft><PaddingRight>2pt</PaddingRight><PaddingTop>1pt</PaddingTop><PaddingBottom>1pt</PaddingBottom>",
    "<Direction>RTL</Direction>",
  ].join("");
  const geometry = o.geometry
    ? `<Top>${cm(o.geometry.top)}</Top><Left>${cm(o.geometry.left)}</Left><Height>${cm(o.geometry.height)}</Height><Width>${cm(o.geometry.width)}</Width>`
    : "";
  return `<Textbox Name="${escapeAttr(name)}"><CanGrow>true</CanGrow><KeepTogether>true</KeepTogether>`
    + `<Paragraphs><Paragraph><TextRuns><TextRun><Value>${escapeText(value)}</Value><Style>${runStyle}</Style></TextRun></TextRuns>`
    + `<Style><TextAlign>${o.align || "Right"}</TextAlign></Style></Paragraph></Paragraphs>`
    + `<rd:DefaultName>${escapeText(name)}</rd:DefaultName>${geometry}<Style>${boxStyle}</Style></Textbox>`;
}

const cell = (inner, colSpan = 1) =>
  `<TablixCell><CellContents>${inner}${colSpan > 1 ? `<ColSpan>${colSpan}</ColSpan>` : ""}</CellContents></TablixCell>`
  + "<TablixCell />".repeat(Math.max(0, colSpan - 1));

const row = (height, cells) => `<TablixRow><Height>${cm(height)}</Height><TablixCells>${cells.join("")}</TablixCells></TablixRow>`;

/** عبارت مقدار یک فیلد با قالب سازمانی یا عادی. */
function valueExpr(field, pf, aggregate = "") {
  const ref = `Fields!${field.name}.Value`;
  const inner = aggregate ? `${aggregate}(${ref})` : ref;
  if (pf.utilFormat && isNumericType(field.sqlType) && field.format !== "0" && field.format !== "") {
    return `=Code.Util.Format(${inner}, Parameters!Sys_CurrentCulture.Value)`;
  }
  return `=${inner}`;
}

function alignOf(field) {
  if (isMeasure(field)) return "Left";
  if (isNumericType(field.sqlType) || isDateType(field.sqlType) || /(Date|Code|Number|No)$/.test(field.name)) return "Center";
  return "Right";
}

// ───────────────────────── مدل ردیف ─────────────────────────

/**
 * ردیف‌های جدول ساده/گروه‌بندی‌شده — بدنه و سلسله‌مراتب هر دو از همین.
 * هر ردیف: { kind, level?, member } که member نقش آن در درخت سلسله‌مراتب است.
 */
function rowModel(layout) {
  const rows = [];
  if (layout.repeatTitle) rows.push({ kind: "title" });
  rows.push({ kind: "header" });
  const groups = layout.kind === "group" ? layout.groups : [];
  const walk = (level) => {
    if (level >= groups.length) {
      rows.push({ kind: "detail" });
      return;
    }
    if (groups[level].header !== false) rows.push({ kind: "group_header", level });
    walk(level + 1);
    if (groups[level].total !== false) rows.push({ kind: "group_total", level });
  };
  walk(0);
  if (layout.grandTotal) rows.push({ kind: "grand_total" });
  return rows;
}

/** درخت TablixRowHierarchy متناظر با rowModel. */
function rowHierarchy(layout, groupNames, detailSort) {
  const top = [];
  if (layout.repeatTitle) top.push("<TablixMember><KeepWithGroup>After</KeepWithGroup><RepeatOnNewPage>true</RepeatOnNewPage></TablixMember>");
  top.push("<TablixMember><FixedData>true</FixedData><KeepWithGroup>After</KeepWithGroup><RepeatOnNewPage>true</RepeatOnNewPage></TablixMember>");
  const groups = layout.kind === "group" ? layout.groups : [];
  const nest = (level) => {
    if (level >= groups.length) {
      const sort = detailSort ? `<SortExpressions><SortExpression><Value>=Fields!${detailSort}.Value</Value></SortExpression></SortExpressions>` : "";
      return `<TablixMember><Group Name="${groupNames.details}" />${sort}</TablixMember>`;
    }
    const g = groups[level];
    const inner = [];
    if (g.header !== false) inner.push("<TablixMember><KeepWithGroup>After</KeepWithGroup></TablixMember>");
    inner.push(nest(level + 1));
    if (g.total !== false) inner.push("<TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember>");
    const pb = g.pageBreak ? "<PageBreak><BreakLocation>Between</BreakLocation></PageBreak>" : "";
    return `<TablixMember><Group Name="${groupNames.groups[level]}"><GroupExpressions><GroupExpression>=Fields!${g.field}.Value</GroupExpression></GroupExpressions>${pb}</Group>`
      + `<SortExpressions><SortExpression><Value>=Fields!${g.field}.Value</Value></SortExpression></SortExpressions>`
      + `<TablixMembers>${inner.join("")}</TablixMembers></TablixMember>`;
  };
  top.push(nest(0));
  if (layout.grandTotal) top.push("<TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember>");
  return `<TablixRowHierarchy><TablixMembers>${top.join("")}</TablixMembers></TablixRowHierarchy>`;
}

// ───────────────────────── جدول ─────────────────────────

function tableTablix(spec, pf, name, ds, top) {
  const layout = spec.layout;
  const groups = layout.kind === "group" ? layout.groups : [];
  const groupFields = new Set(groups.map((g) => g.field));
  const byName = new Map(spec.fields.map((f) => [f.name, f]));
  // ستون‌های فیزیکی: شمارهٔ ردیف (اختیاری) + فیلدهای نمایشی که فیلد گروه نیستند
  const cols = [];
  if (layout.rowNumber) cols.push({ kind: "rownum", width: 1, label: "ردیف" });
  for (const f of spec.fields) {
    if (f.visible === false || groupFields.has(f.name)) continue;
    cols.push({ kind: "field", field: f, width: f.width || defaultWidth(f), label: f.label || f.name });
  }
  if (!cols.length) throw new Error("هیچ ستونی برای نمایش انتخاب نشده است.");
  const n = cols.length;
  const groupNames = {
    groups: groups.map((g) => name(`grp_${g.field}`)),
    details: name("Details"),
  };
  const scope = groups.length ? groupNames.groups[groups.length - 1] : null;
  const rows = rowModel(layout);
  const firstMeasure = cols.findIndex((c) => c.kind === "field" && c.field.total);
  // عنوان «جمع» ستون‌های پیش از نخستین ستون جمع‌دار را می‌گیرد؛ اگر نخستین ستون
  // خودش جمع‌دار است، ردیف جمع عنوان ندارد تا جمعِ آن ستون از دست نرود
  const labelSpan = firstMeasure === -1 ? 1 : firstMeasure;

  const body = rows.map((r) => {
    if (r.kind === "title") {
      return row(0.9, [cell(textbox(name("txtTitleRow"), lit(spec.title || "گزارش"), { bold: true, size: pf.titleFontSize, align: "Center", border: false }, pf), n)]);
    }
    if (r.kind === "header") {
      return row(pf.headerHeight, cols.map((c) => cell(textbox(name(`hdr_${c.field?.name || "RowNo"}`), lit(c.label), { bold: true, size: pf.headerFontSize, bg: pf.headerBg, align: "Center" }, pf))));
    }
    if (r.kind === "group_header") {
      const g = groups[r.level];
      const f = byName.get(g.field);
      const label = (g.label || f?.label || g.field).replace(/"/g, '""');
      const shown = isDateType(f?.sqlType) ? `Format(Fields!${g.field}.Value, "${DATE_FORMAT}")` : `Fields!${g.field}.Value`;
      return row(pf.rowHeight + 0.05, [cell(textbox(name(`grpHdr_${g.field}`), `="${label}: " & ${shown}`, { bold: true, bg: pf.groupBg, align: "Right" }, pf), n)]);
    }
    if (r.kind === "detail") {
      const stripe = layout.stripes ? `=IIf(RowNumber(${scope ? `"${scope}"` : "Nothing"}) Mod 2 = 0, "${pf.stripeBg}", "Transparent")` : "";
      return row(pf.rowHeight, cols.map((c) => {
        if (c.kind === "rownum") {
          return cell(textbox(name("celRowNo"), `=RowNumber(${scope ? `"${scope}"` : "Nothing"})`, { align: "Center", bg: stripe }, pf));
        }
        const f = c.field;
        return cell(textbox(name(`cel_${f.name}`), valueExpr(f, pf), { align: alignOf(f), format: pf.utilFormat ? "" : f.format, bg: stripe }, pf));
      }));
    }
    const total = r.kind === "grand_total";
    const g = total ? null : groups[r.level];
    const label = total ? "جمع کل" : `جمع ${g.label || byName.get(g.field)?.label || g.field}`;
    const cells = labelSpan ? [cell(textbox(name(total ? "totLabel" : `grpTot_${g.field}`), lit(label), { bold: true, bg: pf.totalBg, align: "Right" }, pf), labelSpan)] : [];
    for (let i = labelSpan; i < n; i++) {
      const c = cols[i];
      if (c.kind === "field" && c.field.total) {
        cells.push(cell(textbox(name(`${total ? "tot" : "sub"}_${c.field.name}`), valueExpr(c.field, pf, "Sum"), { bold: true, bg: pf.totalBg, align: "Left", format: pf.utilFormat ? "" : c.field.format }, pf)));
      } else {
        cells.push(cell(textbox(name(`${total ? "totBlank" : "subBlank"}`), "", { bg: pf.totalBg }, pf)));
      }
    }
    return row(pf.rowHeight + 0.05, cells);
  });

  const width = cols.reduce((a, c) => a + c.width, 0);
  const height = rows.reduce((a, r) => a + (r.kind === "header" ? pf.headerHeight : r.kind === "title" ? 0.9 : r.kind === "detail" ? pf.rowHeight : pf.rowHeight + 0.05), 0);
  const detailSort = layout.sortField && byName.has(layout.sortField) ? layout.sortField : "";
  const xml = `<Tablix Name="${name("TablixMain")}"><TablixBody><TablixColumns>`
    + cols.map((c) => `<TablixColumn><Width>${cm(c.width)}</Width></TablixColumn>`).join("")
    + `</TablixColumns><TablixRows>${body.join("")}</TablixRows></TablixBody>`
    + `<TablixColumnHierarchy><TablixMembers>${"<TablixMember />".repeat(n)}</TablixMembers></TablixColumnHierarchy>`
    + rowHierarchy(layout, groupNames, detailSort)
    + `<RepeatColumnHeaders>true</RepeatColumnHeaders><RepeatRowHeaders>true</RepeatRowHeaders><LayoutDirection>RTL</LayoutDirection>`
    + `<DataSetName>${ds}</DataSetName><NoRowsMessage>داده‌ای برای نمایش وجود ندارد.</NoRowsMessage>`
    + `<Top>${cm(top)}</Top><Left>0cm</Left><Height>${cm(height)}</Height><Width>${cm(width)}</Width>`
    + `<Style><Border><Style>None</Style></Border></Style></Tablix>`;
  return { xml, width, height };
}

// ───────────────────────── ماتریس ─────────────────────────

function matrixTablix(spec, pf, name, ds, top) {
  const m = spec.layout.matrix || {};
  const byName = new Map(spec.fields.map((f) => [f.name, f]));
  const rowF = byName.get(m.row);
  const colF = byName.get(m.column);
  const valF = byName.get(m.value);
  if (!rowF || !colF || !valF) throw new Error("برای ماتریس باید فیلد سطر، فیلد ستون و فیلد مقدار را انتخاب کنید.");
  if (new Set([m.row, m.column, m.value]).size < 3) throw new Error("فیلدهای سطر، ستون و مقدار ماتریس باید متفاوت باشند.");
  const agg = m.aggregate || "Sum";
  const fmt = pf.utilFormat ? "" : valF.format || pf.numberFormat;
  const totals = spec.layout.grandTotal !== false;
  const rowW = rowF.width || defaultWidth(rowF);
  const valW = Math.max(2.2, valF.width || defaultWidth(valF));
  const valueOf = () => (pf.utilFormat && isNumericType(valF.sqlType) ? `=Code.Util.Format(${agg}(Fields!${valF.name}.Value), Parameters!Sys_CurrentCulture.Value)` : `=${agg}(Fields!${valF.name}.Value)`);
  const colGroup = name(`col_${colF.name}`);
  const rowGroup = name(`row_${rowF.name}`);

  const headerCells = [
    cell(textbox(name("hdrCorner"), rowF.label || rowF.name, { bold: true, size: pf.headerFontSize, bg: pf.headerBg, align: "Center" }, pf)),
    cell(textbox(name("hdrColumn"), `=Fields!${colF.name}.Value`, { bold: true, size: pf.headerFontSize, bg: pf.headerBg, align: "Center", format: isDateType(colF.sqlType) ? DATE_FORMAT : "" }, pf)),
  ];
  const dataCells = [
    cell(textbox(name("celRow"), `=Fields!${rowF.name}.Value`, { bold: true, bg: pf.groupBg, align: "Right", format: isDateType(rowF.sqlType) ? DATE_FORMAT : "" }, pf)),
    cell(textbox(name("celValue"), valueOf(), { align: "Left", format: fmt }, pf)),
  ];
  const totalCells = [
    cell(textbox(name("totLabel"), "جمع کل", { bold: true, bg: pf.totalBg, align: "Right" }, pf)),
    cell(textbox(name("totValue"), valueOf(), { bold: true, bg: pf.totalBg, align: "Left", format: fmt }, pf)),
  ];
  const widths = [rowW, valW];
  const colMembers = ["<TablixMember />",
    `<TablixMember><Group Name="${colGroup}"><GroupExpressions><GroupExpression>=Fields!${colF.name}.Value</GroupExpression></GroupExpressions></Group>`
    + `<SortExpressions><SortExpression><Value>=Fields!${colF.name}.Value</Value></SortExpression></SortExpressions></TablixMember>`];
  if (totals) {
    widths.push(valW);
    headerCells.push(cell(textbox(name("hdrRowTotal"), "جمع", { bold: true, size: pf.headerFontSize, bg: pf.totalBg, align: "Center" }, pf)));
    dataCells.push(cell(textbox(name("celRowTotal"), valueOf(), { bold: true, bg: pf.totalBg, align: "Left", format: fmt }, pf)));
    totalCells.push(cell(textbox(name("totAll"), valueOf(), { bold: true, bg: pf.totalBg, align: "Left", format: fmt }, pf)));
    colMembers.push("<TablixMember />");
  }
  const rows = [row(pf.headerHeight, headerCells), row(pf.rowHeight, dataCells)];
  const rowMembers = [
    "<TablixMember><FixedData>true</FixedData><KeepWithGroup>After</KeepWithGroup><RepeatOnNewPage>true</RepeatOnNewPage></TablixMember>",
    `<TablixMember><Group Name="${rowGroup}"><GroupExpressions><GroupExpression>=Fields!${rowF.name}.Value</GroupExpression></GroupExpressions></Group>`
    + `<SortExpressions><SortExpression><Value>=Fields!${rowF.name}.Value</Value></SortExpression></SortExpressions></TablixMember>`,
  ];
  if (totals) {
    rows.push(row(pf.rowHeight + 0.05, totalCells));
    rowMembers.push("<TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember>");
  }
  const width = widths.reduce((a, b) => a + b, 0);
  const height = pf.headerHeight + pf.rowHeight + (totals ? pf.rowHeight + 0.05 : 0);
  const xml = `<Tablix Name="${name("MatrixMain")}"><TablixBody><TablixColumns>`
    + widths.map((w) => `<TablixColumn><Width>${cm(w)}</Width></TablixColumn>`).join("")
    + `</TablixColumns><TablixRows>${rows.join("")}</TablixRows></TablixBody>`
    + `<TablixColumnHierarchy><TablixMembers>${colMembers.join("")}</TablixMembers></TablixColumnHierarchy>`
    + `<TablixRowHierarchy><TablixMembers>${rowMembers.join("")}</TablixMembers></TablixRowHierarchy>`
    + `<RepeatColumnHeaders>true</RepeatColumnHeaders><RepeatRowHeaders>true</RepeatRowHeaders><LayoutDirection>RTL</LayoutDirection>`
    + `<DataSetName>${ds}</DataSetName><NoRowsMessage>داده‌ای برای نمایش وجود ندارد.</NoRowsMessage>`
    + `<Top>${cm(top)}</Top><Left>0cm</Left><Height>${cm(height)}</Height><Width>${cm(width)}</Width>`
    + `<Style><Border><Style>None</Style></Border></Style></Tablix>`;
  return { xml, width, height };
}

// ───────────────────────── پارامترها ─────────────────────────

/** خلاصهٔ فیلترها برای زیر عنوان: «سال مالی: … | شعبه: …». */
function filterSummary(params) {
  const parts = params.filter((p) => !p.hidden && !p.system).map((p) => {
    const label = (p.prompt || p.name).replace(/"/g, '""');
    const ref = p.validValues ? `Parameters!${p.name}.Label` : `Parameters!${p.name}.Value`;
    const value = p.multiValue ? `Join(${ref}, "، ")` : p.validValues || p.dataType === "String" ? ref
      : p.dataType === "DateTime" ? `Format(${ref}, "${DATE_FORMAT}")` : `CStr(${ref})`;
    return `"${label}: " & ${p.nullable ? `IIf(IsNothing(Parameters!${p.name}.Value), "همه", ${value})` : value}`;
  });
  return parts.length ? `=${parts.join(' & "   |   " & ')}` : "";
}

export function paramXml(p) {
  // چندمقداری و تهی‌پذیر با هم در SSRS پذیرفته نیست
  const nullable = p.nullable && !p.multiValue;
  const parts = [`<DataType>${p.dataType || "String"}</DataType>`];
  if (nullable) parts.push("<Nullable>true</Nullable>");
  if (p.allowBlank) parts.push("<AllowBlank>true</AllowBlank>");
  if (p.multiValue) parts.push("<MultiValue>true</MultiValue>");
  const defaults = (p.defaults || []).filter((d) => d !== null && d !== undefined && d !== "");
  if (defaults.length) {
    parts.push(`<DefaultValue><Values>${defaults.map((d) => `<Value>${escapeText(d)}</Value>`).join("")}</Values></DefaultValue>`);
  } else if (nullable && (p.hidden || p.defaultNull)) {
    parts.push('<DefaultValue><Values><Value xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" /></Values></DefaultValue>');
  }
  parts.push(`<Prompt>${escapeText(p.prompt || p.name)}</Prompt>`);
  if (p.hidden) parts.push("<Hidden>true</Hidden>");
  if (p.validValues?.dataSet) {
    parts.push(`<ValidValues><DataSetReference><DataSetName>${escapeText(p.validValues.dataSet)}</DataSetName>`
      + `<ValueField>${escapeText(p.validValues.value)}</ValueField><LabelField>${escapeText(p.validValues.label)}</LabelField></DataSetReference></ValidValues>`);
  }
  return `<ReportParameter Name="${escapeAttr(p.name)}">${parts.join("")}</ReportParameter>`;
}

/** پارامترهای سیستمی میزبان — پنهان و تهی‌پذیر تا پیش‌نمایش Report Builder هم کار کند. */
export const sysParamSpecs = () => SYS_PARAMS.map((name) => ({
  name, dataType: "String", prompt: name, nullable: true, allowBlank: true, hidden: true, system: true, defaults: [],
}));

function dataSetXml(name, ds, sql, fields, queryParams) {
  const qp = queryParams.length
    ? `<QueryParameters>${queryParams.map((q) => `<QueryParameter Name="@${escapeAttr(q.name)}"><Value>${escapeText(q.value)}</Value></QueryParameter>`).join("")}</QueryParameters>`
    : "";
  return `<DataSet Name="${escapeAttr(name)}"><Query><DataSourceName>${escapeText(ds)}</DataSourceName>`
    + `<CommandText>${escapeText(sql)}</CommandText>${qp}<rd:UseGenericDesigner>true</rd:UseGenericDesigner></Query>`
    + `<Fields>${fields.map((f) => `<Field Name="${escapeAttr(f.name)}"><DataField>${escapeText(f.dataField || f.name)}</DataField><rd:TypeName>${rdlType(f.sqlType)}</rd:TypeName></Field>`).join("")}</Fields></DataSet>`;
}

// ───────────────────────── سند کامل ─────────────────────────

/**
 * spec ← { rdl, warnings }
 *
 * spec: {
 *   title, sql, fields: [{ name, dataField, label, sqlType, visible, total, format, width }],
 *   params: [{ name, dataType, prompt, nullable, allowBlank, multiValue, hidden, defaults, validValues }],
 *   helperDataSets: [{ name, sql, fields: [{ name, sqlType }] }],
 *   queryParams: نام @های کوئری (بی‌@) — هرکدام به پارامتر هم‌نامش وصل می‌شود,
 *   layout: { kind: "table"|"group"|"matrix", groups, grandTotal, rowNumber, stripes,
 *             repeatTitle, showFilters, sortField, matrix: { row, column, value, aggregate } },
 *   profile: DEFAULT_PROFILE را بازنویسی می‌کند,
 * }
 */
export function buildRdl(spec) {
  const pf = { ...DEFAULT_PROFILE, ...(spec.profile || {}) };
  const layout = { kind: "table", groups: [], grandTotal: true, rowNumber: true, stripes: true, repeatTitle: false, showFilters: true, ...(spec.layout || {}) };
  if (layout.kind === "group" && !(layout.groups || []).length) layout.kind = "table";
  if (pf.utilFormat) pf.sysParams = true;
  const name = namer();
  const warnings = [];
  const fields = spec.fields || [];
  if (!fields.length) throw new Error("کوئری هیچ ستون خروجی ندارد؛ پیش از ساخت گزارش ستون‌ها را مشخص کنید.");
  const fieldNames = new Set(fields.map((f) => f.name));
  for (const g of layout.groups || []) {
    if (!fieldNames.has(g.field)) throw new Error(`فیلد گروه «${g.field}» در فیلدهای گزارش نیست.`);
  }

  const page = PAGE_SIZES[pf.page] || PAGE_SIZES.landscape_a4;
  const content = page.width - 2 * pf.margin;

  // پارامترها: کاربر + سیستمی (بی‌تکرار)
  const userParams = (spec.params || []).filter((p) => p.name);
  const params = [...userParams];
  if (pf.sysParams) {
    for (const s of sysParamSpecs()) if (!params.some((p) => p.name.toLowerCase() === s.name.toLowerCase())) params.push(s);
  }
  const paramByLower = new Map(params.map((p) => [p.name.toLowerCase(), p]));
  for (const p of userParams) {
    const hasDefault = (p.defaults || []).some((d) => d !== "" && d != null) || (p.nullable && !p.multiValue);
    if (p.hidden && !hasDefault) warnings.push(`پارامتر پنهان «${p.prompt || p.name}» مقدار پیش‌فرض ندارد؛ گزارش بی‌آن اجرا نمی‌شود. پیش‌فرض بدهید یا پنهان را بردارید.`);
    if (p.multiValue && p.nullable) warnings.push(`پارامتر «${p.prompt || p.name}» چندمقداری است، پس تهی‌پذیر ساخته نشد (SSRS هر دو را با هم نمی‌پذیرد).`);
  }
  const queryParams = (spec.queryParams || []).map((q) => {
    const p = paramByLower.get(q.toLowerCase());
    if (!p) warnings.push(`پارامتر @${q} در کوئری هست ولی پارامتر گزارشِ هم‌نامی ندارد.`);
    // چندمقداری: در کوئری متنی «IN (@P)» را خود سرور گزارش بسط می‌دهد و آرایه می‌خواهد؛
    // فقط وقتی کوئری فهرست را با STRING_SPLIT می‌شکند، رشتهٔ Join شده لازم است.
    const value = p ? (p.multiValue && p.joinMulti ? `=Join(Parameters!${p.name}.Value, ",")` : `=Parameters!${p.name}.Value`) : `=Nothing`;
    return { name: q, value };
  });

  // دیتاست‌ها
  const dsName = pf.dataSourceName;
  const mainDs = "dsMain";
  const datasets = [dataSetXml(mainDs, dsName, spec.sql, fields, queryParams)];
  for (const h of spec.helperDataSets || []) {
    datasets.push(dataSetXml(h.name, dsName, h.sql, h.fields.map((f) => ({ ...f, dataField: f.name })), []));
  }

  // بدنه: عنوان، خلاصهٔ فیلترها، جدول
  let top = 0;
  const items = [];
  const summary = layout.showFilters ? filterSummary(userParams) : "";
  const built = (() => {
    const titleH = layout.repeatTitle && layout.kind !== "matrix" ? 0 : 0.9;
    const summaryH = summary ? 0.65 : 0;
    const tablixTop = titleH + summaryH + (titleH || summaryH ? 0.15 : 0);
    const t = layout.kind === "matrix" ? matrixTablix(spec, pf, name, mainDs, tablixTop) : tableTablix({ ...spec, layout }, pf, name, mainDs, tablixTop);
    return { ...t, titleH, summaryH, tablixTop };
  })();
  let width = built.width;
  if (layout.kind !== "matrix" && width > content + 0.01) {
    warnings.push(`جمع عرض ستون‌ها (${width.toFixed(1)}cm) از عرض قابل چاپ ${page.label} (${content.toFixed(1)}cm) بیشتر است؛ در PDF صفحهٔ اضافه می‌سازد. ستون‌ها را کم یا باریک کنید یا صفحهٔ بزرگ‌تر بگیرید.`);
  }
  const bandWidth = Math.max(Math.min(content, Math.max(width, 8)), width);
  if (built.titleH) {
    items.push(textbox(name("txtTitle"), lit(spec.title || "گزارش"), { bold: true, size: pf.titleFontSize, align: "Center", border: false, geometry: { top, left: 0, height: 0.9, width: bandWidth } }, pf));
    top += 0.9;
  }
  if (summary) {
    items.push(textbox(name("txtFilters"), summary, { size: Math.max(7, pf.fontSize - 1), align: "Right", border: false, color: "#444444", geometry: { top, left: 0, height: 0.65, width: bandWidth } }, pf));
    top += 0.65;
  }
  items.push(built.xml);
  width = Math.max(width, bandWidth);
  const bodyHeight = built.tablixTop + built.height + 0.2;

  // پارامترها، کد سازمانی
  const paramsXml = params.length ? `<ReportParameters>${params.map(paramXml).join("")}</ReportParameters>` : "";
  const code = pf.utilFormat
    ? "<CodeModules><CodeModule>SG.ReportingUtilities, Version=777.777.0.64672, Culture=neutral, PublicKeyToken=null</CodeModule></CodeModules>"
      + "<Classes><Class><ClassName>SG.Util</ClassName><InstanceName>Util</InstanceName></Class><Class><ClassName>SG.NumberUtil</ClassName><InstanceName>NumberUtil</InstanceName></Class></Classes>"
    : "";

  const dataSource = pf.dataSource === "embedded"
    ? `<DataSource Name="${escapeAttr(dsName)}"><ConnectionProperties><DataProvider>SQL</DataProvider><ConnectString>${escapeText(pf.connectString)}</ConnectString><IntegratedSecurity>true</IntegratedSecurity></ConnectionProperties><rd:SecurityType>Integrated</rd:SecurityType><rd:DataSourceID>${uuid()}</rd:DataSourceID></DataSource>`
    : `<DataSource Name="${escapeAttr(dsName)}"><DataSourceReference>${escapeText(pf.dataSourceRef)}</DataSourceReference><rd:SecurityType>None</rd:SecurityType><rd:DataSourceID>${uuid()}</rd:DataSourceID></DataSource>`;

  const comment = `<!-- ${(spec.title || "گزارش").replace(/-/g, "–")} = ساخته‌شده با کاوشگر پایگاه داده (گزارش‌ساز) -->`;
  const rdl = `<?xml version="1.0" encoding="utf-8"?>
${comment}
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
  <AutoRefresh>0</AutoRefresh>
  <DataSources>${dataSource}</DataSources>
  <DataSets>
    ${datasets.join("\n    ")}
  </DataSets>
  <ReportSections>
    <ReportSection>
      <Body>
        <ReportItems>
          ${items.join("\n          ")}
        </ReportItems>
        <Height>${cm(bodyHeight)}</Height>
        <Style />
      </Body>
      <Width>${cm(width)}</Width>
      <Page>
        <PageHeight>${cm(page.height)}</PageHeight>
        <PageWidth>${cm(page.width)}</PageWidth>
        <LeftMargin>${cm(pf.margin)}</LeftMargin>
        <RightMargin>${cm(pf.margin)}</RightMargin>
        <TopMargin>${cm(pf.margin)}</TopMargin>
        <BottomMargin>${cm(pf.margin)}</BottomMargin>
        <Style />
      </Page>
    </ReportSection>
  </ReportSections>
  ${paramsXml}
  ${code}
  <Language>${escapeText(pf.language)}</Language>
  <ConsumeContainerWhitespace>true</ConsumeContainerWhitespace>
  <rd:ReportUnitType>Cm</rd:ReportUnitType>
  <rd:ReportID>${uuid()}</rd:ReportID>
</Report>
`;
  return { rdl: rdl.replace(/\n\s*\n/g, "\n"), warnings, width };
}

// ───────────────────────── دیتاست‌های کمکی استاندارد ─────────────────────────

/** دیتاست‌های کمکیِ لیست کشویی برای پارامترهای شناخته‌شده (مهارت، بخش ۳ قراردادها). */
export const HELPERS = {
  FiscalYearRef: {
    dataSet: { name: "dsFiscalYear", sql: "SELECT FiscalYearID, Title FROM GNR3.FiscalYear ORDER BY Title DESC;", fields: [{ name: "FiscalYearID", sqlType: "bigint" }, { name: "Title", sqlType: "nvarchar" }] },
    validValues: { dataSet: "dsFiscalYear", value: "FiscalYearID", label: "Title" },
    prompt: "سال مالی",
    nullable: false,
  },
  BranchRef: {
    dataSet: { name: "dsBranch", sql: "-- ردیف NULL = «همهٔ شعب»: پارامتر تهی‌پذیر با لیست کشویی، مقدار تهی را فقط وقتی می‌پذیرد که در خود لیست باشد\nSELECT BranchID, Title FROM (\n    SELECT CAST(NULL AS bigint) AS BranchID, N'همهٔ شعب' AS Title, 0 AS Ord, N'' AS Code\n    UNION ALL\n    SELECT BranchID, Title, 1, Code FROM GNR3.Branch\n) b ORDER BY Ord, Code;", fields: [{ name: "BranchID", sqlType: "bigint" }, { name: "Title", sqlType: "nvarchar" }] },
    validValues: { dataSet: "dsBranch", value: "BranchID", label: "Title" },
    prompt: "شعبه",
    nullable: true,
    defaultNull: true,
    // چندمقداری مقدار تهی نمی‌پذیرد: فهرست بی‌ردیف «همهٔ شعب»
    multi: {
      dataSet: { name: "dsBranchList", sql: "SELECT BranchID, Title FROM GNR3.Branch ORDER BY Code;", fields: [{ name: "BranchID", sqlType: "bigint" }, { name: "Title", sqlType: "nvarchar" }] },
      validValues: { dataSet: "dsBranchList", value: "BranchID", label: "Title" },
    },
  },
};

/** پیشنهاد عنوان فارسی برای نام پارامتر رایج. */
export function paramPrompt(name) {
  const n = name.replace(/^@/, "");
  const known = {
    FiscalYearRef: "سال مالی", FiscalYearID: "سال مالی", BranchRef: "شعبه", BranchID: "شعبه",
    FromDate: "از تاریخ", ToDate: "تا تاریخ", StartDate: "از تاریخ", EndDate: "تا تاریخ",
    FromPersian: "از تاریخ (شمسی)", ToPersian: "تا تاریخ (شمسی)", YearMonth: "سال و ماه",
    IssueYearMonth: "سال و ماه صدور", EmployeeID: "کارمند", EmployeeRef: "کارمند", PartyRef: "طرف حساب",
    LedgerRef: "دفتر", AccountRef: "حساب", CompanyRef: "شرکت", State: "وضعیت",
  };
  return known[n] || n;
}
