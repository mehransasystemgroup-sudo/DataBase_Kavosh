import { describe, expect, it } from "vitest";

import { analyzeSql, toBuildSpec } from "../analyze.js";
import { buildRdl } from "../build.js";
import { discoveryScript } from "../discovery.js";
import { CHECKLIST, ERRORS, sections, slug, translateError } from "../docs.js";
import { addColumn, removeColumn, setCommandText } from "../edit.js";
import { LibraryError, localLibrary } from "../libstore.js";
import { lintReportSql } from "../lint.js";
import { buildPattern, PATTERNS, stateCase, testHarness } from "../patterns.js";
import { emptyPlan, planToSql, withMandatoryFilters } from "../plan.js";
import { learnProfile } from "../profile.js";
import { inspectRdl, validateRdl } from "../rdl.js";
import { parseXml, XmlError } from "../xml.js";

// ───────────── داده‌های آزمون ─────────────

const VOUCHER = {
  full_name: "FIN3.Voucher",
  columns: [
    { name: "VoucherID", type: "bigint", is_pk: true },
    { name: "FiscalYearRef", type: "bigint" },
    { name: "BranchRef", type: "bigint" },
    { name: "State", type: "int" },
    { name: "Date", type: "datetime" },
    { name: "CreationDate", type: "datetime" },
    { name: "Number", type: "bigint" },
    { name: "Version", type: "timestamp" },
  ],
};
const ITEM = {
  full_name: "FIN3.VoucherItem",
  columns: [
    { name: "VoucherItemID", type: "bigint", is_pk: true },
    { name: "VoucherRef", type: "bigint" },
    { name: "Debit", type: "decimal(18,2)" },
    { name: "Credit", type: "decimal(18,2)" },
    { name: "ReferenceRef", type: "bigint" },
    { name: "ReferenceType", type: "int" },
  ],
};
const TABLES = { "fin3.voucher": VOUCHER, "fin3.voucheritem": ITEM };
const describeStub = async (full) => TABLES[String(full).toLowerCase()] || null;
const codes = (r) => r.findings.map((f) => f.code);

const GOOD_SQL = `SELECT v.[Number] AS VoucherNumber, -- شمارهٔ سند
  SUM(i.[Debit]) AS DebitAmount -- بدهکار
FROM FIN3.Voucher v
JOIN FIN3.VoucherItem i ON i.[VoucherRef] = v.[VoucherID]
WHERE v.[FiscalYearRef] = @FiscalYearRef
  AND (@BranchRef IS NULL OR v.[BranchRef] = @BranchRef)
  AND v.[State] = 2
  AND v.[Date] >= @FromDate AND v.[Date] < DATEADD(day, 1, @ToDate)
GROUP BY v.[Number]`;

function sampleSpec(over = {}) {
  const { body, fields, params } = analyzeSql(GOOD_SQL, new Map([["fin3.voucher", VOUCHER], ["fin3.voucheritem", ITEM]]));
  return toBuildSpec({ title: "گزارش آزمون", body, fields, params, layout: { kind: "table" }, profile: {}, ...over });
}

// ───────────── xml ─────────────

describe("xml", () => {
  it("سند خوش‌ساخت را می‌خواند و خطای نحوی را با جایگاه می‌گوید", () => {
    const doc = parseXml('<a x="1"><b>t&amp;</b></a>');
    expect(doc).toBeTruthy();
    expect(() => parseXml("<a><b></a>")).toThrow(XmlError);
  });
});

// ───────────── lint ─────────────

describe("بازبینی گزارش‌محور", () => {
  it("کوئری درست هیچ خطا یا هشداری ندارد", async () => {
    const r = await lintReportSql(GOOD_SQL, describeStub);
    const serious = r.findings.filter((f) => f.severity !== "info");
    expect(serious).toEqual([]);
  });

  it("نبود فیلتر سال مالی خطاست", async () => {
    const r = await lintReportSql("SELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.[State] = 2", describeStub);
    expect(codes(r)).toContain("fiscal_year");
    expect(r.findings.find((f) => f.code === "fiscal_year").severity).toBe("error");
  });

  it("فیلتر سال مالی روی سرآیند برای اقلام هم کافی است", async () => {
    const r = await lintReportSql(GOOD_SQL, describeStub);
    expect(codes(r)).not.toContain("fiscal_year");
  });

  it("BETWEEN روی تاریخ، Version، SELECT * و ستون بی‌نام را می‌گیرد", async () => {
    const sql = `SELECT *, v.[Version], COUNT(*) FROM FIN3.Voucher v
      WHERE v.[FiscalYearRef] = @FiscalYearRef AND v.[Date] BETWEEN @FromDate AND @ToDate`;
    const c = codes(await lintReportSql(sql, describeStub));
    expect(c).toEqual(expect.arrayContaining(["between_date", "version", "select_star", "unnamed_column"]));
  });

  it("ReferenceRef بدون ReferenceType و FORMAT روی عدد", async () => {
    const sql = `SELECT FORMAT(i.[Debit], 'N0') AS D FROM FIN3.VoucherItem i
      JOIN FIN3.Voucher v ON v.[VoucherID] = i.[ReferenceRef]
      WHERE v.[FiscalYearRef] = @FiscalYearRef AND v.[State] = 2`;
    const c = codes(await lintReportSql(sql, describeStub));
    expect(c).toEqual(expect.arrayContaining(["reference_type", "format_function"]));
  });

  it("نام ستون تکراری خطاست", async () => {
    const sql = "SELECT v.[Number] AS N, v.[State] AS N FROM FIN3.Voucher v WHERE v.[FiscalYearRef] = @FiscalYearRef";
    expect(codes(await lintReportSql(sql, describeStub))).toContain("duplicate_column");
  });

  it("کوئری خالی بی‌یافته است و جدول ناشناخته خطا نمی‌دهد", async () => {
    expect((await lintReportSql("", describeStub)).findings).toEqual([]);
    const r = await lintReportSql("SELECT x.[A] AS A FROM ABC.Unknown x", describeStub);
    expect(codes(r)).not.toContain("fiscal_year");
  });
});

// ───────────── plan ─────────────

describe("طراح کوئری", () => {
  it("طرح ساده به SQL پارامتری با نام مستعار انگلیسی و شرح فارسی", () => {
    const plan = emptyPlan("FIN3.Voucher");
    plan.columns = [{ table: "FIN3.Voucher", column: "Number", aggregate: "", alias: "", label: "شماره" }];
    plan.filters = [{ table: "FIN3.Voucher", column: "FiscalYearRef", op: "=", param: "FiscalYearRef" }];
    const { sql, params } = planToSql(plan);
    expect(sql).toMatch(/FROM \[FIN3\]\.\[Voucher\] AS v/);
    expect(sql).toMatch(/\[FiscalYearRef\]\s*=\s*@FiscalYearRef/);
    expect(sql).toContain("-- شماره");
    expect(params.map((p) => p.name)).toContain("FiscalYearRef");
  });

  it("فیلترهای اجباری سال مالی و شعبهٔ اختیاری را اضافه می‌کند", () => {
    const plan = withMandatoryFilters(emptyPlan("FIN3.Voucher"), VOUCHER.columns);
    const { sql } = planToSql({ ...plan, columns: [{ table: "FIN3.Voucher", column: "Number", alias: "N" }] });
    expect(sql).toMatch(/@FiscalYearRef/);
    expect(sql).toMatch(/@BranchRef IS NULL OR/);
  });
});

// ───────────── analyze + build + validate ─────────────

describe("ساخت RDL", () => {
  it("کوئری را تحلیل می‌کند: فیلدها، پارامترها و جدول‌ها", () => {
    const a = analyzeSql(GOOD_SQL, new Map([["fin3.voucher", VOUCHER]]));
    expect(a.fields.map((f) => f.name)).toEqual(["VoucherNumber", "DebitAmount"]);
    expect(a.params.map((p) => p.name)).toEqual(expect.arrayContaining(["FiscalYearRef", "BranchRef", "FromDate", "ToDate"]));
    expect(a.params.find((p) => p.name === "BranchRef").nullable).toBe(true);
  });

  it("RDL ساخته‌شده از اعتبارسنج بی‌خطا عبور می‌کند و قواعد میزبان را دارد", () => {
    const rdl = buildRdl(sampleSpec()).rdl;
    const v = validateRdl(rdl);
    expect(v.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(v.ok).toBe(true);
    expect(rdl).not.toMatch(/<PageHeader>|<PageFooter>/);
    expect(rdl).toMatch(/<LayoutDirection>RTL<\/LayoutDirection>/);
    expect(rdl).toMatch(/Sys_CompanyID/);
  });

  it("چیدمان گروهی و ماتریسی هم معتبر می‌سازد", () => {
    for (const layout of [
      { kind: "group", groups: [{ field: "VoucherNumber" }] },
      { kind: "matrix", matrix: { row: "VoucherNumber", column: "BranchTitle", value: "DebitAmount", aggregate: "Sum" } },
    ]) {
      const sql = GOOD_SQL.replace("SELECT v.[Number] AS VoucherNumber,", "SELECT v.[Number] AS VoucherNumber, CAST(v.[BranchRef] AS nvarchar(20)) AS BranchTitle,")
        .replace("GROUP BY v.[Number]", "GROUP BY v.[Number], v.[BranchRef]");
      const a = analyzeSql(sql, new Map([["fin3.voucher", VOUCHER], ["fin3.voucheritem", ITEM]]));
      expect(a.fields.map((f) => f.name)).toContain("BranchTitle");
      const spec = toBuildSpec({ title: "ماتریس", body: a.body, fields: a.fields, params: a.params, layout, profile: {} });
      const v = validateRdl(buildRdl({ ...spec, layout }).rdl);
      expect(v.findings.filter((f) => f.severity === "error")).toEqual([]);
    }
  });

  it("پارامتر چندمقداری IN (@P) آرایه می‌گیرد نه Join", () => {
    const spec = sampleSpec();
    spec.params = spec.params.map((p) => (p.name === "BranchRef" ? { ...p, multiValue: true, joinMulti: false } : p));
    const { rdl } = buildRdl(spec);
    const qp = rdl.match(/<QueryParameter Name="@BranchRef">\s*<Value>([^<]*)<\/Value>/);
    expect(qp?.[1]).toBe("=Parameters!BranchRef.Value");
    spec.params = spec.params.map((p) => (p.name === "BranchRef" ? { ...p, joinMulti: true } : p));
    expect(buildRdl(spec).rdl).toMatch(/<QueryParameter Name="@BranchRef">\s*<Value>=Join\(Parameters!BranchRef\.Value, ","\)/);
  });

  it("بی‌ستون خطای روشن می‌دهد", () => {
    expect(() => buildRdl({ ...sampleSpec(), fields: [] })).toThrow();
  });
});

describe("اعتبارسنج و ویرایش جراحی", () => {
  it("XML شکسته را خطای xml می‌گوید", () => {
    const v = validateRdl("<Report><Body></Report>");
    expect(v.ok).toBe(false);
    expect(v.findings[0].code).toBe("xml");
  });

  it("افزودن و حذف ستون سه‌گانهٔ ستون/عضو/سلول را هم‌تعداد نگه می‌دارد", () => {
    const rdl = buildRdl(sampleSpec()).rdl;
    const tablix = inspectRdl(rdl).tablixes[0];
    const n = tablix.columns.length;
    const added = addColumn(rdl, { tablix: tablix.name, index: 0, header: "ستون تازه", field: "VoucherNumber" }).text;
    const after = inspectRdl(added).tablixes[0];
    expect(after.columns.length).toBe(n + 1);
    expect(validateRdl(added).findings.filter((f) => f.severity === "error")).toEqual([]);
    const removed = removeColumn(added, { tablix: tablix.name, index: 0 }).text;
    expect(inspectRdl(removed).tablixes[0].columns.length).toBe(n);
    expect(validateRdl(removed).findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("CommandText را با escape درست جایگزین می‌کند", () => {
    const rdl = buildRdl(sampleSpec()).rdl;
    const out = setCommandText(rdl, { dataSet: "dsMain", sql: "SELECT 1 AS A WHERE 1 < 2" }).text;
    expect(out).toContain("1 &lt; 2");
    expect(inspectRdl(out).ok).toBe(true);
  });

  it("پروفایل سازمانی را از RDL نمونه یاد می‌گیرد", () => {
    const { profile, learned } = learnProfile(buildRdl(sampleSpec()).rdl);
    expect(profile).toBeTruthy();
    expect(learned.length).toBeGreaterThan(0);
  });
});

// ───────────── patterns + discovery ─────────────

describe("الگوها و اسکریپت‌ها", () => {
  it("فایل آزمون SSMS برای هر پارامتر DECLARE دارد و DECLARE تکراری نمی‌سازد", () => {
    const h = testHarness(GOOD_SQL, { title: "t" });
    for (const p of ["FiscalYearRef", "BranchRef", "FromDate", "ToDate"]) expect(h).toMatch(new RegExp(`DECLARE @${p}\\b`, "i"));
    const twice = testHarness(h);
    expect((twice.match(/DECLARE @FiscalYearRef\b/gi) || []).length).toBe(1);
  });

  it("CASE وضعیت همیشه ELSE دارد", () => {
    const s = stateCase("v", "State", [{ value: 1, label: "موقت" }, { value: 2, label: "دائم" }]);
    expect(s).toMatch(/CASE/);
    expect(s).toMatch(/ELSE/);
  });

  it("همهٔ الگوها با مقادیر پیش‌فرض متن می‌سازند", () => {
    for (const p of PATTERNS) {
      const out = buildPattern(p.id);
      expect(typeof out).toBe("string");
      expect(out.trim().length).toBeGreaterThan(20);
    }
  });

  it("اسکریپت تشخیصی فقط‌خواندنی است", () => {
    const s = discoveryScript([VOUCHER]);
    expect(s).toMatch(/READ UNCOMMITTED/i);
    expect(s).toMatch(/INFORMATION_SCHEMA\.COLUMNS/i);
    const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXEC)\b/i);
  });
});

// ───────────── docs ─────────────

describe("مرجع", () => {
  it("مترجم خطا خطای رایج Tablix را می‌شناسد", () => {
    expect(ERRORS.length).toBeGreaterThan(5);
    const hits = translateError("The tablix 'Tablix1' has a detail member with inner members");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("سرفصل‌ها و slug فارسی", () => {
    const s = sections("# الف\nمتن\n## ب ج\nمتن دوم");
    expect(s.map((x) => x.title)).toEqual(["الف", "ب ج"]);
    expect(slug("ب ج")).toBe("ب-ج");
    expect(CHECKLIST.length).toBeGreaterThan(10);
  });
});

// ───────────── libstore ─────────────

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe("کتابخانهٔ محلی", () => {
  it("ذخیره، فهرست، به‌روزرسانی، touch و حذف", async () => {
    const lib = localLibrary(memoryStorage());
    const saved = await lib.save({ title: "گزارش ۱", folder: "مالی", sql: "SELECT 1", rdl: "<Report/>" });
    expect(saved.id).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
    const list = await lib.list({});
    expect(list.total).toBe(1);
    expect(list.reports[0].rdl).toBeUndefined();
    expect(list.reports[0].has_rdl).toBe(true);
    expect(list.folders).toContain("مالی");
    await lib.save({ id: saved.id, touch: true });
    expect((await lib.get(saved.id)).used_count).toBe(1);
    expect((await lib.list({ q: "گزارش" })).reports).toHaveLength(1);
    expect((await lib.list({ q: "ناموجود" })).reports).toHaveLength(0);
    expect((await lib.list({ folder: "مالی" })).reports).toHaveLength(1);
    await lib.remove(saved.id);
    expect((await lib.list({})).total).toBe(0);
  });

  it("ورودی نامعتبر LibraryError می‌دهد", async () => {
    const lib = localLibrary(memoryStorage());
    expect(() => lib.save({ title: "" })).toThrow(LibraryError);
    expect(() => lib.save({ id: "bad id!", title: "x" })).toThrow(LibraryError);
    expect(() => lib.save({ title: "x", tables: "FIN3.Voucher" })).toThrow(LibraryError);
    expect(lib.get("missing-id")).toBeNull();
  });
});
