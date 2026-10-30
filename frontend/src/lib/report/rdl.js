/**
 * کالبدشکافی و اعتبارسنجی فایل RDL (Report Builder 2016 / SSRS).
 *
 * این همان چک‌لیست مرحلهٔ ۴ مهارت گزارش‌سازی است، به‌اضافهٔ قراردادهای
 * نرم‌افزار میزبان (راهکاران) — و بیش از اسکریپت پایتونیِ validate_rdl.py:
 * آن اسکریپت با regex می‌شمرد و ردیف‌های تک‌سلولی را عمداً نادیده می‌گرفت؛
 * این‌جا درخت واقعی XML ساخته می‌شود، ColSpan جمع زده می‌شود، برگ‌های
 * سلسله‌مراتب سطری با ردیف‌ها مقایسه می‌شوند و ارجاع‌ها (فیلد، پارامتر،
 * دیتاست) تک‌تک دنبال می‌شوند.
 *
 * سطح یافته‌ها عمداً محافظه‌کار است:
 *   error    گزارش قطعاً باز نمی‌شود، اجرا نمی‌شود یا در نرم‌افزار میزبان
 *            بارگذاری نمی‌شود.
 *   warning  گزارش اجرا می‌شود ولی احتمالاً عدد یا ظاهر غلط می‌دهد.
 *   info     دانستنی؛ کاری لازم نیست.
 * «خطا»ی کاذب بدتر از نبودنش است — کاربر به اعتبارسنج بی‌اعتماد می‌شود.
 */

import { ancestor, childText, elements, findAll, kid, kids, local, pathOf, textOf, tryParse } from "./xml.js";
import { near, toCm } from "./units.js";
import { blankNoise, declaredNames, outputColumns, queryParameters } from "./sqlmeta.js";

export const NS_2016 = "http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition";
export const NS_RD = "http://schemas.microsoft.com/SQLServer/reporting/reportdesigner";

export const SYS_PARAMS = [
  "Sys_CompanyID", "Sys_CompanyName", "Sys_UserID", "Sys_UserName",
  "Sys_CurrentCulture", "Sys_CurrentCalendar", "Sys_IsSecondLanguageActive",
];

const REPORT_ITEMS = new Set(["Textbox", "Rectangle", "Tablix", "Chart", "Image", "Line", "Subreport", "GaugePanel", "Map", "CustomReportItem"]);

const finding = (severity, code, message, hint = "", where = "") => ({ severity, code, message, hint, where });

function versionOf(ns) {
  const m = /reporting\/(\d{4})\/\d{2}\/reportdefinition/i.exec(ns || "");
  return m ? m[1] : "";
}

/** متن همهٔ عبارت‌های یک زیردرخت — Value، Hidden، GroupExpression و … */
function expressions(node) {
  const out = [];
  const visit = (el) => {
    for (const c of elements(el)) {
      if (!elements(c).length) {
        const t = textOf(c).trim();
        if (t.startsWith("=")) out.push({ el: c, text: t });
      }
      visit(c);
    }
  };
  visit(node);
  return out;
}

const fieldRefs = (expr) => [...expr.matchAll(/\bFields!([A-Za-z_][\w]*)\b/g)].map((m) => m[1]);
const paramRefs = (expr) => [...expr.matchAll(/\bParameters!([A-Za-z_][\w]*)\b/g)].map((m) => m[1]);

/** برگ‌های یک درخت TablixMembers — هر عضو بی‌فرزند یک ردیف/ستون فیزیکی است. */
function leaves(membersEl) {
  const out = [];
  for (const m of kids(membersEl, "TablixMember")) {
    const inner = kid(m, "TablixMembers");
    if (inner && kids(inner, "TablixMember").length) out.push(...leaves(inner));
    else out.push(m);
  }
  return out;
}

/**
 * نام لاتینِ معتبر برای Field، Textbox، Group و… — Report Builder نامی را که با
 * حرف شروع نشود یا نویسهٔ غیرمجاز داشته باشد نمی‌پذیرد. عنوان فارسی جای خودش
 * (سرستون) را دارد؛ نام درونی لاتین می‌ماند تا روی هر نسخه‌ای بی‌دردسر باز شود.
 */
export function rdlName(base, fallback = "F") {
  let n = String(base ?? "").replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/[A-Za-z]/.test(n)) return fallback;
  if (!/^[A-Za-z]/.test(n)) n = `${fallback}_${n}`;
  return n;
}

// حرف: لاتین یا حروف فارسی/عربی (بی‌رقم و بی‌نشانه)؛ ادامه: حرف، رقم، _
const NAME_START = "A-Za-z\u0621-\u063A\u0641-\u064A\u0671-\u06D3\u06FA-\u06FC\uFB50-\uFDFB\uFE70-\uFEFC";
const VALID_NAME = new RegExp(`^[${NAME_START}][${NAME_START}0-9\u0660-\u0669\u06F0-\u06F9_]*$`);
export const isValidRdlName = (name) => VALID_NAME.test(String(name ?? ""));

/** برگ‌های سلسله‌مراتب ستونی/سطری به ترتیب سند — همان ترتیبِ ستون‌ها و ردیف‌ها. */
export { leaves as memberLeaves };

/**
 * شبکهٔ کامل سلول‌های Tablix: برای هر ردیفِ شکل کامل (یک TablixCell به‌ازای هر
 * ستون) و هر ستون، «سلول مبدأ» آن خانه — خودش، یا سلولی از همین ردیف (ColSpan)
 * یا ردیف‌های بالاتر (RowSpan) که آن را پوشانده.
 *   origin: { r0, c0, cs, rs, cell, empty }
 * overlaps: خانه‌هایی که پوشیده‌اند ولی خودشان محتوا دارند.
 * ردیف شکل فشرده null می‌ماند.
 */
export function cellGrid(t) {
  const n = t.columns.length;
  const covered = new Map();
  const overlaps = [];
  const grid = t.rows.map((row, r) => {
    if (row.cells.length !== n) return null;
    return row.cells.map((cell, c) => {
      const over = covered.get(`${r},${c}`);
      if (over) {
        if (!cell.empty) overlaps.push({ r, c, origin: over });
        return over;
      }
      const origin = cell.empty
        ? { r0: r, c0: c, cs: 1, rs: 1, cell, empty: true }
        : { r0: r, c0: c, cs: cell.colSpan, rs: cell.rowSpan, cell, empty: false };
      for (let dr = 0; dr < origin.rs; dr++) {
        for (let dc = 0; dc < origin.cs; dc++) if (dr || dc) covered.set(`${r + dr},${c + dc}`, origin);
      }
      return origin;
    });
  });
  return { grid, overlaps };
}

function memberIsDetails(member) {
  const g = kid(member, "Group");
  return g && !kid(g, "GroupExpressions");
}

// ───────────────────────── کالبدشکافی ─────────────────────────

function readDataSets(root) {
  const dsRoot = kid(root, "DataSets");
  return kids(dsRoot, "DataSet").map((ds) => {
    const q = kid(ds, "Query");
    const fieldsEl = kid(ds, "Fields");
    const fields = kids(fieldsEl, "Field").map((f) => ({
      name: f.attrs.Name || "",
      dataField: childText(f, "DataField"),
      value: childText(f, "Value"),
      typeName: childText(f, "TypeName"),
      el: f,
    }));
    return {
      name: ds.attrs.Name || "",
      dataSource: childText(q, "DataSourceName"),
      commandType: childText(q, "CommandType") || "Text",
      commandText: textOf(kid(q, "CommandText")),
      queryParams: kids(kid(q, "QueryParameters"), "QueryParameter").map((qp) => ({
        name: qp.attrs.Name || "",
        value: childText(qp, "Value"),
      })),
      fields,
      sharedRef: childText(kid(ds, "SharedDataSet"), "SharedDataSetReference"),
      el: ds,
    };
  });
}

function readParams(root) {
  return kids(kid(root, "ReportParameters"), "ReportParameter").map((p) => {
    const vv = kid(p, "ValidValues");
    const dsr = kid(vv, "DataSetReference");
    const dv = kid(p, "DefaultValue");
    return {
      name: p.attrs.Name || "",
      dataType: childText(p, "DataType") || "String",
      prompt: childText(p, "Prompt"),
      hidden: childText(p, "Hidden") === "true",
      nullable: childText(p, "Nullable") === "true",
      allowBlank: childText(p, "AllowBlank") === "true",
      multiValue: childText(p, "MultiValue") === "true",
      validValues: dsr
        ? { dataSet: childText(dsr, "DataSetName"), value: childText(dsr, "ValueField"), label: childText(dsr, "LabelField") }
        : vv
          ? { list: findAll(vv, "ParameterValue").map((pv) => ({ value: childText(pv, "Value"), label: childText(pv, "Label") })) }
          : null,
      defaults: findAll(dv, "Value").map((v) => textOf(v).trim()),
      defaultFromDataSet: childText(kid(dv, "DataSetReference"), "DataSetName"),
      el: p,
    };
  });
}

function readTablix(t) {
  const body = kid(t, "TablixBody");
  const columns = kids(kid(body, "TablixColumns"), "TablixColumn").map((c) => ({ width: childText(c, "Width"), cm: toCm(childText(c, "Width")) }));
  const rows = kids(kid(body, "TablixRows"), "TablixRow").map((r) => {
    const cells = kids(kid(r, "TablixCells"), "TablixCell").map((cell) => {
      const contents = kid(cell, "CellContents");
      const item = contents ? elements(contents).find((e) => REPORT_ITEMS.has(local(e.name))) : null;
      return {
        empty: !contents,
        colSpan: parseInt(childText(contents, "ColSpan") || "1", 10) || 1,
        rowSpan: parseInt(childText(contents, "RowSpan") || "1", 10) || 1,
        item: item ? { type: local(item.name), name: item.attrs.Name || "", value: item.name === "Textbox" ? valuesOf(item).join(" ") : "" } : null,
        el: cell,
      };
    });
    return { height: childText(r, "Height"), cm: toCm(childText(r, "Height")), cells, el: r };
  });
  const colH = kid(kid(t, "TablixColumnHierarchy"), "TablixMembers");
  const rowH = kid(kid(t, "TablixRowHierarchy"), "TablixMembers");
  const groups = findAll(t, "Group").filter((g) => ancestor(g, "Tablix") === t).map((g) => ({
    name: g.attrs.Name || "",
    expressions: findAll(kid(g, "GroupExpressions"), "GroupExpression").map((e) => textOf(e).trim()),
    details: !kid(g, "GroupExpressions"),
    pageBreak: childText(kid(g, "PageBreak"), "BreakLocation"),
  }));
  return {
    name: t.attrs.Name || "",
    dataSet: childText(t, "DataSetName"),
    direction: childText(t, "LayoutDirection") || childText(t, "Direction") || "LTR",
    columns,
    rows,
    colLeaves: colH ? leaves(colH).length : 0,
    rowLeaves: rowH ? leaves(rowH).length : 0,
    rowMembers: rowH,
    colMembers: colH,
    groups,
    top: toCm(childText(t, "Top")) ?? 0,
    left: toCm(childText(t, "Left")) ?? 0,
    width: toCm(childText(t, "Width")),
    height: toCm(childText(t, "Height")),
    hasCorner: Boolean(kid(t, "TablixCorner")),
    el: t,
  };
}

/** مقدار TextRunهای یک Textbox. */
function valuesOf(tb) {
  return findAll(tb, "TextRun").map((tr) => textOf(kid(tr, "Value")).trim()).filter(Boolean);
}

/**
 * کالبدشکافی کامل RDL — خروجی ساده، برای نمایش و برای اعتبارسنجی.
 * اگر XML خراب باشد: { ok: false, error }.
 */
export function inspectRdl(text) {
  const { doc, error } = tryParse(text);
  if (error) return { ok: false, error: { message: error.message, line: error.line, col: error.col, reason: error.reason } };
  const root = doc.root;
  if (local(root.name) !== "Report") {
    return { ok: false, error: { message: `ریشهٔ فایل <${root.name}> است، نه <Report> — این فایل RDL نیست.`, line: 1, col: 1 } };
  }
  const ns = root.attrs.xmlns || "";
  const sections = kid(root, "ReportSections");
  // RDL 2008 بخش ندارد: Body و Page مستقیم زیر Report‌اند
  const sectionEls = sections ? kids(sections, "ReportSection") : [root];
  const section = sectionEls[0];
  const bodyEl = kid(section, "Body");
  const pageEl = kid(section, "Page") || kid(root, "Page");

  const tablixes = findAll(root, "Tablix").map(readTablix);
  const textboxes = findAll(root, "Textbox").map((tb) => ({ name: tb.attrs.Name || "", values: valuesOf(tb), el: tb }));
  const itemNames = [];
  for (const el of findAll(root, "ReportItems")) {
    for (const c of elements(el)) if (REPORT_ITEMS.has(local(c.name))) itemNames.push(c.attrs.Name || "");
  }
  // آیتم‌های داخل سلول‌ها مستقیم زیر CellContents‌اند، نه ReportItems
  for (const cc of findAll(root, "CellContents")) {
    for (const c of elements(cc)) if (REPORT_ITEMS.has(local(c.name))) itemNames.push(c.attrs.Name || "");
  }

  const subreports = findAll(root, "Subreport").map((s) => ({
    name: s.attrs.Name || "",
    reportName: childText(s, "ReportName"),
    params: kids(kid(s, "Parameters"), "Parameter").map((p) => ({ name: p.attrs.Name || "", value: childText(p, "Value") })),
    el: s,
  }));

  const bodyItems = elements(kid(bodyEl, "ReportItems")).filter((e) => REPORT_ITEMS.has(local(e.name))).map((e) => ({
    type: local(e.name),
    name: e.attrs.Name || "",
    top: toCm(childText(e, "Top")) ?? 0,
    left: toCm(childText(e, "Left")) ?? 0,
    width: toCm(childText(e, "Width")),
    height: toCm(childText(e, "Height")),
    repeatWith: childText(e, "RepeatWith"),
    el: e,
  }));

  const sgltCount = (text.match(/>\s*sglt:[^<]+</g) || []).length;
  const fonts = {};
  for (const f of findAll(root, "FontFamily")) {
    const v = textOf(f).trim();
    if (v) fonts[v] = (fonts[v] || 0) + 1;
  }

  return {
    ok: true,
    doc,
    root,
    namespace: ns,
    version: versionOf(ns),
    language: childText(root, "Language"),
    reportId: childText(root, "ReportID"),
    dataSources: kids(kid(root, "DataSources"), "DataSource").map((d) => ({
      name: d.attrs.Name || "",
      reference: childText(d, "DataSourceReference"),
      connectString: childText(kid(d, "ConnectionProperties"), "ConnectString"),
    })),
    dataSets: readDataSets(root),
    params: readParams(root),
    tablixes,
    textboxes,
    itemNames,
    subreports,
    bodyItems,
    body: { height: toCm(childText(bodyEl, "Height")), el: bodyEl },
    sectionWidth: toCm(childText(section, "Width")) ?? toCm(childText(root, "Width")),
    sectionEl: section,
    sectionCount: sectionEls.length,
    page: {
      width: toCm(childText(pageEl, "PageWidth")) ?? toCm(childText(root, "PageWidth")),
      height: toCm(childText(pageEl, "PageHeight")) ?? toCm(childText(root, "PageHeight")),
      left: toCm(childText(pageEl, "LeftMargin")) ?? toCm(childText(root, "LeftMargin")) ?? 0,
      right: toCm(childText(pageEl, "RightMargin")) ?? toCm(childText(root, "RightMargin")) ?? 0,
      top: toCm(childText(pageEl, "TopMargin")) ?? 0,
      bottom: toCm(childText(pageEl, "BottomMargin")) ?? 0,
    },
    pageHeader: kid(pageEl, "PageHeader") || kid(root, "PageHeader"),
    pageFooter: kid(pageEl, "PageFooter") || kid(root, "PageFooter"),
    codeModules: findAll(kid(root, "CodeModules"), "CodeModule").map((c) => textOf(c).trim()),
    classes: findAll(kid(root, "Classes"), "Class").map((c) => ({ className: childText(c, "ClassName"), instance: childText(c, "InstanceName") })),
    hasCode: Boolean(kid(root, "Code")),
    sgltCount,
    fonts,
    text,
  };
}

/** خلاصهٔ قابل نمایش (بدون ارجاع به گره‌های درخت). */
export function summarize(info) {
  if (!info.ok) return { ok: false, error: info.error };
  return {
    ok: true,
    version: info.version,
    language: info.language,
    dataSources: info.dataSources,
    dataSets: info.dataSets.map((d) => ({
      name: d.name, dataSource: d.dataSource, commandType: d.commandType, commandText: d.commandText,
      queryParams: d.queryParams, fields: d.fields.map(({ name, dataField, value, typeName }) => ({ name, dataField, value, typeName })),
    })),
    params: info.params.map(({ el, ...p }) => p),
    tablixes: info.tablixes.map((t) => ({
      name: t.name, dataSet: t.dataSet, columns: t.columns.length, rows: t.rows.length,
      width: t.width, groups: t.groups.map((g) => g.name), headers: headerTexts(t),
    })),
    subreports: info.subreports.map(({ el, ...s }) => s),
    textboxCount: info.textboxes.length,
    sectionWidth: info.sectionWidth,
    page: info.page,
    hasPageHeader: Boolean(info.pageHeader),
    hasPageFooter: Boolean(info.pageFooter),
    sgltCount: info.sgltCount,
    codeModules: info.codeModules,
    fonts: info.fonts,
  };
}

/** متن ردیف اول Tablix — معمولاً عنوان ستون‌ها، برای نمایش. */
function headerTexts(t) {
  const first = t.rows[0];
  if (!first) return [];
  return first.cells.map((c) => (c.item?.value || "").replace(/^=/, "").slice(0, 40));
}

// ───────────────────────── اعتبارسنجی ─────────────────────────

/**
 * چک‌لیست کامل. ورودی متن RDL؛ خروجی { ok, findings, info, stats }.
 * `ok` یعنی هیچ «خطا»یی نیست.
 */
export function validateRdl(text, { hostRules = true } = {}) {
  const info = inspectRdl(text);
  if (!info.ok) {
    return {
      ok: false,
      info,
      findings: [finding("error", "xml", `XML فایل معتبر نیست: ${info.error.message}`,
        "این فایل در Report Builder باز نمی‌شود. خطای نحوی را در همان سطر برطرف کنید؛ رایج‌ترین علت‌ها «&» یا «<» بی‌escape داخل CommandText و «--» داخل کامنت XML است.")],
      stats: {},
    };
  }
  const F = [];
  const add = (...a) => F.push(finding(...a));

  // ── فضای نام ──
  if (!info.version) {
    add("error", "namespace", "فضای نام گزارش (xmlns) شناخته نشد.", "فایل باید با <Report xmlns=\"…/reporting/2016/01/reportdefinition\"> شروع شود.");
  } else if (info.version !== "2016") {
    add("info", "namespace_old", `فایل با قالب RDL ${info.version} است.`, "Report Builder 2016 آن را باز می‌کند و هنگام ذخیره ارتقا می‌دهد؛ فضای نام را دستی عوض نکنید.");
  }

  // ── نام‌های یکتا ──
  const counts = new Map();
  for (const n of info.itemNames) counts.set(n, (counts.get(n) || 0) + 1);
  const dupItems = [...counts].filter(([n, c]) => n && c > 1);
  if (dupItems.length) {
    add("error", "duplicate_item", `نام تکراری در آیتم‌های گزارش: ${dupItems.map(([n, c]) => `${n} (${c} بار)`).join("، ")}`,
      "نام هر Textbox، Rectangle و Tablix باید در کل فایل یکتا باشد (Report Builder: «Textbox 'X' is not unique»).");
  }
  const groupNames = new Map();
  for (const g of findAll(info.root, "Group")) {
    const n = g.attrs.Name || "";
    groupNames.set(n, (groupNames.get(n) || 0) + 1);
  }
  const dupGroups = [...groupNames].filter(([n, c]) => n && c > 1);
  if (dupGroups.length) add("error", "duplicate_group", `نام گروه تکراری: ${dupGroups.map(([n]) => n).join("، ")}`, "نام هر Group در کل گزارش باید یکتا باشد.");

  // نام‌های معتبر: با حرف شروع شود و فقط حرف، رقم و _ داشته باشد
  const badNames = [
    ...info.itemNames.map((n) => ["آیتم", n]),
    ...[...groupNames.keys()].map((n) => ["گروه", n]),
    ...info.dataSets.flatMap((d) => [["دیتاست", d.name], ...d.fields.map((f) => ["فیلد", f.name])]),
    ...info.params.map((p) => ["پارامتر", p.name]),
  ].filter(([, n]) => n && !isValidRdlName(n));
  if (badNames.length) {
    add("error", "invalid_name", `نام نامعتبر: ${badNames.slice(0, 8).map(([k, n]) => `${k} «${n}»`).join("، ")}${badNames.length > 8 ? "، …" : ""}`,
      "Report Builder نامی را که با حرف شروع نشود یا جز حرف، رقم و _ نویسه‌ای داشته باشد نمی‌پذیرد («… is not CLS-compliant»). نام را لاتین کنید؛ عنوان فارسی در سرستون می‌ماند.");
  }

  // ── دیتاست‌ها ──
  const dsByName = new Map(info.dataSets.map((d) => [d.name, d]));
  const dsNames = new Set(info.dataSources.map((d) => d.name));
  const paramNames = new Set(info.params.map((p) => p.name));
  for (const ds of info.dataSets) {
    const where = `DataSet ${ds.name}`;
    const fc = new Map();
    for (const f of ds.fields) fc.set(f.name, (fc.get(f.name) || 0) + 1);
    const dup = [...fc].filter(([, c]) => c > 1).map(([n]) => n);
    if (dup.length) add("error", "duplicate_field", `دیتاست «${ds.name}» فیلد تکراری دارد: ${dup.join("، ")}`, "", where);
    if (ds.dataSource && dsNames.size && !dsNames.has(ds.dataSource)) {
      add("error", "unknown_datasource", `دیتاست «${ds.name}» به منبع دادهٔ ناموجود «${ds.dataSource}» اشاره می‌کند.`, "", where);
    }
    // پارامترهای کوئری
    if (ds.commandType === "Text" && ds.commandText.trim()) {
      const used = queryParameters(ds.commandText);
      const usedLower = new Set(used.map((u) => u.toLowerCase()));
      const qpNames = new Set(ds.queryParams.map((q) => q.name.replace(/^@/, "").toLowerCase()));
      const missing = used.filter((u) => !qpNames.has(u.toLowerCase()));
      if (missing.length) {
        add("error", "missing_query_param", `کوئری دیتاست «${ds.name}» از ${missing.map((m) => "@" + m).join("، ")} استفاده می‌کند ولی QueryParameter ندارد.`,
          "هنگام اجرا SQL Server خطای «Must declare the scalar variable» می‌دهد. برای هر کدام یک QueryParameter با مقدار =Parameters!نام.Value بسازید.", where);
      }
      const declared = declaredNames(ds.commandText);
      const unused = ds.queryParams.filter((q) => {
        const k = q.name.replace(/^@/, "").toLowerCase();
        return !usedLower.has(k) && !declared.has(k);
      });
      if (unused.length) {
        add("info", "unused_query_param", `QueryParameter های بی‌استفاده در «${ds.name}»: ${unused.map((u) => u.name).join("، ")}`, "", where);
      }
      // هم‌خوانی فیلدها با SELECT
      const out = outputColumns(ds.commandText);
      if (!out.star && out.columns.length && out.columns.every((c) => c.name)) {
        const selectNames = new Set(out.columns.map((c) => c.name.toLowerCase()));
        const ghost = ds.fields.filter((f) => f.dataField && !selectNames.has(f.dataField.toLowerCase()));
        if (ghost.length) {
          add(out.method === "parser" ? "error" : "warning", "field_not_in_select",
            `فیلدهای ${ghost.map((g) => g.name).join("، ")} در دیتاست «${ds.name}» هستند ولی کوئری چنین ستونی برنمی‌گرداند.`,
            "گزارش در Report Builder باز می‌شود ولی هنگام اجرا خطا می‌دهد. یا ستون را به SELECT اضافه کنید یا فیلد را حذف کنید.", where);
        }
        const fieldData = new Set(ds.fields.map((f) => (f.dataField || "").toLowerCase()));
        const extra = out.columns.filter((c) => !fieldData.has(c.name.toLowerCase()));
        if (extra.length) {
          add("info", "select_not_in_fields", `ستون‌های ${extra.map((c) => c.name).join("، ")} در SELECT دیتاست «${ds.name}» هست ولی فیلد ندارد.`,
            "این ستون‌ها در گزارش قابل استفاده نیستند (بی‌صدا نادیده گرفته می‌شوند).", where);
        }
      }
      for (const qp of ds.queryParams) {
        for (const p of paramRefs(qp.value)) {
          if (!paramNames.has(p)) add("error", "unknown_param", `QueryParameter ${qp.name} در «${ds.name}» به پارامتر ناموجود «${p}» اشاره می‌کند.`, "", where);
        }
      }
      if (/\bFORMAT\s*\(/i.test(blankNoise(ds.commandText))) {
        add("warning", "sql_format", `کوئری «${ds.name}» عدد یا تاریخ را با FORMAT() به متن تبدیل می‌کند.`,
          "در خروجی Excel عدد متن می‌شود. نوع عددی را در SQL نگه دارید و قالب را با <Format> در RDL بدهید.", where);
      }
    }
  }

  // ── پارامترهای گزارش ──
  const paramIndex = new Map(info.params.map((p, i) => [p.name, i]));
  for (const p of info.params) {
    const where = `ReportParameter ${p.name}`;
    if (p.validValues?.dataSet) {
      const ds = dsByName.get(p.validValues.dataSet);
      if (!ds) add("error", "param_dataset", `پارامتر «${p.name}» فهرستش را از دیتاست ناموجود «${p.validValues.dataSet}» می‌گیرد.`, "", where);
      else {
        const fieldsSet = new Set(ds.fields.map((f) => f.name));
        for (const key of ["value", "label"]) {
          const f = p.validValues[key];
          if (f && !fieldsSet.has(f)) add("error", "param_field", `پارامتر «${p.name}»: فیلد «${f}» در دیتاست «${ds.name}» نیست.`, "", where);
        }
        // آبشاری: پارامتر والد باید زودتر تعریف شده باشد
        for (const qp of ds.queryParams) {
          for (const ref of paramRefs(qp.value)) {
            if (paramIndex.has(ref) && paramIndex.get(ref) > paramIndex.get(p.name)) {
              add("error", "param_order", `پارامتر «${p.name}» به «${ref}» وابسته است ولی پیش از آن تعریف شده.`, "ترتیب تعریف = ترتیب ارزیابی؛ «" + ref + "» را بالاتر ببرید.", where);
            }
          }
        }
      }
    }
    if (p.multiValue && p.nullable) {
      add("error", "param_multi_nullable", `پارامتر «${p.name}» هم چندمقداری است و هم تهی‌پذیر (Nullable).`,
        "SSRS این ترکیب را نمی‌پذیرد («A multi-value parameter cannot include null values»). Nullable را بردارید؛ «همه» را با انتخاب همهٔ گزینه‌ها یا پیش‌فرضِ همهٔ مقادیر بدهید.", where);
    }
    if (p.hidden && !kid(p.el, "DefaultValue") && !/^Sys_/i.test(p.name)) {
      add("error", "param_hidden_no_default", `پارامتر پنهان «${p.name}» مقدار پیش‌فرض ندارد.`,
        "کاربر پارامتر پنهان را نمی‌بیند تا مقدارش را بدهد، پس گزارش با «The parameter is missing a value» اجرا نمی‌شود. پیش‌فرض بدهید یا پنهان را بردارید.", where);
    }
    if (p.dataType === "Integer" && /(Ref|ID)$/.test(p.name)) {
      add("info", "int32_trap", `پارامتر «${p.name}» از نوع Integer (Int32) است.`,
        "شناسه‌ها bigint‌اند؛ تا زیر ۲٬۱۴۷٬۴۸۳٬۶۴۷ مشکلی نیست. اگر جدول خیلی بزرگ است، نوع را String کنید و در SQL CAST(@x AS bigint) بزنید.", where);
    }
  }

  // ── ارجاع به پارامترها در کل گزارش ──
  const missingParams = new Set();
  for (const e of expressions(info.root)) {
    for (const p of paramRefs(e.text)) if (!paramNames.has(p)) missingParams.add(p);
  }
  if (missingParams.size) {
    add("error", "unknown_param_ref", `عبارت‌ها به پارامترهای ناموجود اشاره می‌کنند: ${[...missingParams].join("، ")}`,
      "یا پارامتر را بسازید یا ارجاع را اصلاح کنید.");
  }

  // ── Tablix ها ──
  for (const t of info.tablixes) {
    const where = `Tablix ${t.name}`;
    const nCols = t.columns.length;
    if (t.colLeaves !== nCols) {
      add("error", "tablix_col_members", `Tablix «${t.name}»: ${nCols} ستون (TablixColumn) ولی ${t.colLeaves} عضو برگ در TablixColumnHierarchy.`,
        "قانون سه‌گانه: هر ستون تازه = یک TablixColumn + یک TablixMember + یک TablixCell در هر ردیف.", where);
    }
    if (t.rowLeaves !== t.rows.length) {
      add("error", "tablix_row_members", `Tablix «${t.name}»: ${t.rows.length} ردیف (TablixRow) ولی ${t.rowLeaves} برگ در TablixRowHierarchy.`,
        "تعداد TablixRow باید دقیقاً برابر برگ‌های درخت سلسله‌مراتب سطری باشد.", where);
    }
    // سلول‌ها: یا شکل کامل (سلول جایگزین برای ادغام) یا شکل فشرده
    const covered = new Map(); // سلول‌هایی که با RowSpan ردیف بالا پوشیده‌اند
    t.rows.forEach((r, ri) => {
      const slots = r.cells.length;
      let span = 0;
      let placeholdersOk = true;
      for (let ci = 0; ci < r.cells.length; ci++) {
        const c = r.cells[ci];
        if (c.empty) continue;
        span += c.colSpan;
        if (c.colSpan > 1) {
          for (let k = 1; k < c.colSpan && ci + k < r.cells.length; k++) {
            if (!r.cells[ci + k].empty && slots === nCols) placeholdersOk = false;
          }
        }
        if (c.rowSpan > 1) for (let k = 1; k < c.rowSpan; k++) covered.set(ri + k, (covered.get(ri + k) || 0) + c.colSpan);
      }
      const label = `ردیف ${ri + 1}`;
      if (slots === nCols) {
        if (!placeholdersOk) {
          add("error", "colspan_overlap", `Tablix «${t.name}»، ${label}: سلولی که زیر ادغام (ColSpan) افتاده خودش محتوا دارد.`,
            "پس از سلولی با ColSpan=N، باید N−1 سلول خالی <TablixCell /> بیاید.", where);
        }
      } else if (span + (covered.get(ri) || 0) === nCols && slots < nCols) {
        add("warning", "colspan_compact", `Tablix «${t.name}»، ${label}: ${slots} سلول با جمع ColSpan برابر ${nCols} — شکل فشرده.`,
          "Report Builder معمولاً برای هر ستونِ ادغام‌شده یک <TablixCell /> خالی می‌نویسد؛ اگر فایل باز نشد، سلول‌های خالی را اضافه کنید.", where);
      } else {
        add("error", "tablix_cells", `Tablix «${t.name}»، ${label}: ${slots} سلول (جمع ColSpan ${span}) ولی ${nCols} ستون.`,
          "خطای Report Builder: «The number of cells in row … does not match». در هر ردیف یک TablixCell به‌ازای هر ستون لازم است.", where);
      }
    });
    // RowSpan: خانه‌ای که ردیف بالا پوشانده نباید خودش محتوا داشته باشد
    for (const o of cellGrid(t).overlaps) {
      if (o.origin.r0 === o.r) continue; // ادغام افقی را colspan_overlap گفته است
      add("error", "rowspan_overlap", `Tablix «${t.name}»، ردیف ${o.r + 1}، ستون ${o.c + 1}: سلول محتوا دارد ولی زیر RowSpan سلول ردیف ${o.origin.r0 + 1} افتاده است.`,
        "خطای Report Builder: «overlapping cells». خانه‌های زیر RowSpan=N باید در N−1 ردیف بعد سلول خالی <TablixCell /> باشند.", where);
    }
    // عرض Tablix
    const sum = t.columns.reduce((a, c) => a + (c.cm ?? 0), 0);
    if (t.width != null && nCols && !near(sum, t.width, 0.05) && !t.hasCorner) {
      add("warning", "tablix_width", `Tablix «${t.name}»: عرض ${t.width.toFixed(2)}cm ولی جمع عرض ستون‌ها ${sum.toFixed(2)}cm.`,
        "Report Builder عرض را خودش اصلاح می‌کند، ولی برای چیدمان دقیق این دو را برابر کنید.", where);
    }
    if (kid(t.el, "Direction")) {
      add("warning", "tablix_direction", `Tablix «${t.name}» عنصر <Direction> مستقیم دارد.`,
        "جهت چیدمان ستون‌های Tablix با <LayoutDirection>RTL</LayoutDirection> تعیین می‌شود؛ <Direction> فقط ویژگی Style متن است. اگر Report Builder خطای «invalid child element» داد، علتش همین است.", where);
    }
    // دیتاست و فیلدها
    if (t.dataSet && !dsByName.has(t.dataSet)) {
      add("error", "tablix_dataset", `Tablix «${t.name}» به دیتاست ناموجود «${t.dataSet}» وصل است.`, "", where);
    } else if (t.dataSet) {
      const own = new Set(dsByName.get(t.dataSet).fields.map((f) => f.name));
      const all = new Set(info.dataSets.flatMap((d) => d.fields.map((f) => f.name)));
      const bad = new Set();
      const foreign = new Set();
      for (const e of expressions(t.el)) {
        // عبارتی که داخل Tablix تودرتوی دیگری است، با دیتاست همان سنجیده می‌شود
        if (ancestor(e.el, "Tablix") !== t.el) continue;
        for (const f of fieldRefs(e.text)) {
          if (own.has(f)) continue;
          if (all.has(f) && /,\s*"[^"]+"\s*\)/.test(e.text)) foreign.add(f);
          else bad.add(f);
        }
      }
      if (bad.size) {
        add("error", "unknown_field", `Tablix «${t.name}» به فیلدهای ناموجود در «${t.dataSet}» اشاره می‌کند: ${[...bad].join("، ")}`,
          "نام فیلد باید عیناً در بلوک <Fields> همان دیتاست باشد.", where);
      }
    }
    // سلسله‌مراتب سطری
    if (t.rowMembers) {
      const all = findAll(t.rowMembers, "TablixMember").filter((m) => ancestor(m, "Tablix") === t.el);
      for (const m of all) {
        // عضو درونیِ ثابت (بی‌Group) زیر جزئیات مجاز است؛ فقط گروه درونی ممنوع است
        if (memberIsDetails(m) && findAll(kid(m, "TablixMembers"), "Group").length) {
          add("error", "details_inner", `Tablix «${t.name}»: گروه جزئیات «${kid(m, "Group").attrs.Name}» گروه درونی دارد.`,
            "خطای Report Builder: «The tablix has a detail member with inner members. Detail members can only contain static inner members». گروه دیگری زیر جزئیات نگذارید.", where);
        }
      }
      // تلهٔ KeepWithGroup روی ردیف‌های ثابتِ بالای گروه
      const top = kids(t.rowMembers, "TablixMember");
      const firstGroup = top.findIndex((m) => kid(m, "Group"));
      top.forEach((m, i) => {
        if (kid(m, "Group")) return;
        const repeat = childText(m, "RepeatOnNewPage") === "true";
        const keep = childText(m, "KeepWithGroup");
        const above = firstGroup !== -1 && i < firstGroup;
        if (repeat && above && keep !== "After") {
          add("warning", "keepwithgroup", `Tablix «${t.name}»: ردیف ثابت ${i + 1} RepeatOnNewPage دارد ولی KeepWithGroup آن «${keep || "خالی"}» است.`,
            "برای ردیف بالای گروه باید After باشد؛ وگرنه عنوان در صفحهٔ دوم تکرار نمی‌شود و هیچ خطایی هم نمی‌دهد.", where);
        }
        if (repeat && firstGroup !== -1 && i > firstGroup && keep !== "Before") {
          add("warning", "keepwithgroup", `Tablix «${t.name}»: ردیف ثابت ${i + 1} پایین گروه است ولی KeepWithGroup آن «${keep || "خالی"}» است.`,
            "ردیف جمعِ پایین گروه باید Before بگیرد.", where);
        }
      });
    }
  }

  // ── هندسه ──
  const content = info.page.width != null ? info.page.width - info.page.left - info.page.right : null;
  let rightmost = 0;
  let bottom = 0;
  for (const it of info.bodyItems) {
    if (it.width != null) rightmost = Math.max(rightmost, it.left + it.width);
    if (it.height != null) bottom = Math.max(bottom, it.top + it.height);
    if (it.repeatWith) {
      add("info", "repeatwith", `«${it.name}» با RepeatWith=${it.repeatWith} تکرار می‌شود.`,
        "RepeatWith فقط وقتی کار می‌کند که آن جدول به‌خاطر «ردیف‌های زیاد» چندصفحه شود؛ اگر یک ردیف بلند دارد، ردیف ثابت تکرارشونده داخل Tablix مطمئن‌تر است.");
    }
  }
  if (info.sectionWidth != null && rightmost > info.sectionWidth + 0.02) {
    add("error", "body_overflow", `آیتم‌های بدنه تا ${rightmost.toFixed(2)}cm می‌روند ولی عرض بخش گزارش ${info.sectionWidth.toFixed(2)}cm است.`,
      "ستون‌ها هنگام Export بریده می‌شوند. عرض ReportSection را برابر جمع عرض ستون‌ها کنید.");
  }
  if (content != null && info.sectionWidth != null && info.sectionWidth > content + 0.02) {
    add("warning", "page_overflow", `عرض گزارش ${info.sectionWidth.toFixed(2)}cm از عرض قابل چاپ صفحه (${content.toFixed(2)}cm) بیشتر است.`,
      "در PDF بین صفحه‌ها صفحهٔ خالی اضافه می‌شود. ستون‌ها را باریک‌تر کنید یا صفحه را افقی کنید.");
  }
  if (info.body.height != null && bottom > info.body.height + 0.02) {
    add("info", "body_height", `ارتفاع بدنه ${info.body.height.toFixed(2)}cm کمتر از پایین‌ترین آیتم (${bottom.toFixed(2)}cm) است.`, "Report Builder آن را خودش بزرگ می‌کند.");
  }

  // ── قراردادهای نرم‌افزار میزبان ──
  if (hostRules) {
    if (info.pageHeader) {
      add("error", "page_header", "گزارش PageHeader دارد — نرم‌افزار میزبان گزارش دارای هدر صفحه را بارگذاری نمی‌کند.",
        "محتوای هدر را به بدنه ببرید (ابزار «انتقال هدر صفحه به بدنه») و برای تکرار در صفحه‌ها از ردیف ثابت تکرارشونده در Tablix استفاده کنید.");
    }
    if (info.pageFooter) {
      add("error", "page_footer", "گزارش PageFooter دارد — در نرم‌افزار میزبان مجاز نیست.",
        "فوتر را حذف کنید؛ جمع‌ها و امضاها را در بدنهٔ گزارش بگذارید.");
    }
    const present = new Set(info.params.map((p) => p.name));
    const sysPresent = SYS_PARAMS.filter((s) => present.has(s));
    if (!sysPresent.length) {
      add("warning", "sys_params", "گزارش هیچ‌کدام از پارامترهای سیستمی Sys_* را ندارد.",
        "نرم‌افزار میزبان Sys_CompanyID، Sys_UserID، Sys_CurrentCulture و … را به هر گزارش می‌فرستد؛ برای اجرا در محیط سازمانی آن‌ها را اضافه کنید.");
    } else if (sysPresent.length < SYS_PARAMS.length) {
      add("info", "sys_params_partial", `از پارامترهای سیستمی فقط ${sysPresent.length} مورد هست: ${sysPresent.join("، ")}`);
    }
    for (const s of info.subreports) {
      const passed = new Set(s.params.map((p) => p.name));
      const missing = sysPresent.filter((p) => !passed.has(p));
      if (missing.length) {
        add("warning", "subreport_sys", `زیرگزارش «${s.name}» (${s.reportName}) این پارامترهای سیستمی را نمی‌گیرد: ${missing.join("، ")}`,
          "همهٔ Sys_* ها باید به زیرگزارش pass-through شوند.", `Subreport ${s.name}`);
      }
    }
    const usesUtil = /\bCode\.(Util|NumberUtil)\./.test(text);
    if (usesUtil && !info.codeModules.some((c) => /SG\.ReportingUtilities/i.test(c))) {
      add("error", "code_module", "عبارت‌ها Code.Util یا Code.NumberUtil را صدا می‌زنند ولی CodeModule «SG.ReportingUtilities» تعریف نشده.",
        "بلوک <CodeModules> و <Classes> را از یک گزارش سازمانی دیگر کپی کنید.");
    }
    if (info.sgltCount) {
      add("info", "sglt", `${info.sgltCount} کلید محلی‌سازی «sglt:» در گزارش هست.`, "این کلیدها در زمان اجرا با متن ترجمه جایگزین می‌شوند؛ با متن ثابت عوضشان نکنید.");
    }
  }

  // ── عبارت‌های حساس ──
  const bodyExprs = expressions(info.body.el || info.root);
  if (bodyExprs.some((e) => /Globals!(Total)?PageNumber|Globals!TotalPages/.test(e.text))) {
    add("info", "page_number_body", "شمارهٔ صفحه در بدنهٔ گزارش استفاده شده.", "از SSRS 2008 R2 به بعد پشتیبانی می‌شود؛ اگر نرم‌افزار میزبان خطا داد، آن را بردارید.");
  }
  if (bodyExprs.some((e) => /\bIIf\s*\([^)]*\/[^)]*\)/i.test(e.text) && /=\s*0/.test(e.text))) {
    add("info", "iif_division", "عبارتی با IIf و تقسیم پیدا شد.", "IIf در VB.NET هر دو شاخه را ارزیابی می‌کند؛ برای پرهیز از #Error بنویسید: A / IIf(B = 0, 1, B).");
  }

  const errors = F.filter((f) => f.severity === "error").length;
  return {
    ok: errors === 0,
    info,
    findings: F,
    stats: {
      errors,
      warnings: F.filter((f) => f.severity === "warning").length,
      infos: F.filter((f) => f.severity === "info").length,
      textboxes: info.textboxes.length,
      tablixes: info.tablixes.length,
      dataSets: info.dataSets.length,
      params: info.params.length,
    },
  };
}

export { pathOf };
