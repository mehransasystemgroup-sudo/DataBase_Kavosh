/**
 * آزمون‌های برگشتی ممیزی دور ۱ — هر کدام یک یافتهٔ R1-xx را قفل می‌کند.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { analyzeSql, toBuildSpec } from "../analyze.js";
import { buildRdl } from "../build.js";
import { addColumn, addSysParams, EditError, removeColumn, setCommandText } from "../edit.js";
import { localLibrary } from "../libstore.js";
import { lintReportSql } from "../lint.js";
import { testHarness } from "../patterns.js";
import { emptyPlan, planToSql } from "../plan.js";
import { inspectRdl, isValidRdlName, validateRdl } from "../rdl.js";

const MERGED = readFileSync(new URL("./fixtures/merged-header.rdl", import.meta.url), "utf8");
const errors = (rdl) => validateRdl(rdl).findings.filter((f) => f.severity === "error").map((f) => f.code);
const shape = (rdl) => inspectRdl(rdl).tablixes[0].rows.map((r) => r.cells.map((c) => (c.empty ? "_" : `${c.colSpan}x${c.rowSpan}`)).join(" "));

const VOUCHER = {
  full_name: "FIN3.Voucher",
  columns: [
    { name: "VoucherID", type: "bigint" }, { name: "Number", type: "bigint" }, { name: "FiscalYearRef", type: "bigint" },
    { name: "BranchRef", type: "bigint" }, { name: "State", type: "int" }, { name: "Date", type: "datetime" }, { name: "Description", type: "nvarchar" },
  ],
  outgoing: [{ from_col: "BranchRef", to_table: "GNR3.Branch" }],
};
const ITEM = {
  full_name: "FIN3.VoucherItem",
  columns: [{ name: "VoucherItemID", type: "bigint" }, { name: "VoucherRef", type: "bigint" }, { name: "Debit", type: "decimal(18,2)" }],
  outgoing: [{ from_col: "VoucherRef", to_table: "FIN3.Voucher", verified: true }],
};
const FY = { full_name: "GNR3.FiscalYear", columns: [{ name: "FiscalYearID", type: "bigint" }, { name: "Title", type: "nvarchar" }] };
const T = { "fin3.voucher": VOUCHER, "fin3.voucheritem": ITEM, "gnr3.fiscalyear": FY };
const describeStub = async (t) => T[String(t).toLowerCase()] || null;
const details = new Map(Object.entries(T));
const spec = (sql, extra = {}) => {
  const a = analyzeSql(sql, details);
  return toBuildSpec({ title: "آزمون", body: a.body, fields: a.fields, params: a.params, layout: { kind: "table" }, profile: {}, ...extra });
};

describe("ویرایش ستون کنار سلول ادغامی و سلسله‌مراتب تودرتو (R1-01..03)", () => {
  it("حذف هر ستون فایل سالم می‌دهد و ادغام‌ها را کوتاه می‌کند", () => {
    expect(shape(MERGED)).toEqual(["1x2 2x1 _", "_ 1x1 1x1", "1x1 1x1 1x1"]);
    const out = [0, 1, 2].map((i) => removeColumn(MERGED, { tablix: "T1", index: i }).text);
    for (const t of out) expect(errors(t)).toEqual([]);
    expect(shape(out[0])).toEqual(["2x1 _", "1x1 1x1", "1x1 1x1"]);
    expect(shape(out[1])).toEqual(["1x2 1x1", "_ 1x1", "1x1 1x1"]);
  });

  it("افزودن کنار RowSpan سلول هم‌پوشان نمی‌سازد", () => {
    for (let i = 0; i <= 3; i++) {
      const t = addColumn(MERGED, { tablix: "T1", index: i, header: "تازه", field: "NewF" }).text;
      expect(errors(t).filter((c) => c !== "field_not_in_select")).toEqual([]);
      expect(inspectRdl(t).tablixes[0].columns).toHaveLength(4);
    }
    const first = shape(addColumn(MERGED, { tablix: "T1", index: 0, header: "تازه" }).text);
    expect(first).toEqual(["1x2 1x2 2x1 _", "_ _ 1x1 1x1", "1x1 1x1 1x1 1x1"]);
  });

  it("اعتبارسنج سلول زیر RowSpan را خطا می‌داند", () => {
    // دومین سلول خالی همان خانهٔ زیر RowSpan ردیف اول است
    const at = MERGED.indexOf("<TablixCell />", MERGED.indexOf("<TablixCell />") + 1);
    const broken = MERGED.slice(0, at) + MERGED.slice(at).replace(/<TablixCell \/>/, '<TablixCell><CellContents><Textbox Name="zz"><Paragraphs><Paragraph><TextRuns><TextRun><Value>x</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixCell>');
    expect(errors(broken)).toContain("rowspan_overlap");
  });

  it("ویرایشی که فایل را خراب کند EditError می‌دهد، نه TypeError", () => {
    expect(() => removeColumn(MERGED, { tablix: "T1", index: 9 })).toThrow(EditError);
  });
});

describe("پارامتر و نام (R1-04، R1-05، R1-12)", () => {
  it("شعبهٔ چندمقداری تهی‌پذیر نیست و فهرستش ردیف NULL ندارد", () => {
    const { rdl } = buildRdl(spec("SELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef AND v.BranchRef IN (@BranchRef)"));
    const p = rdl.match(/<ReportParameter Name="BranchRef">[\s\S]*?<\/ReportParameter>/)[0];
    expect(p).toContain("<MultiValue>true</MultiValue>");
    expect(p).not.toContain("<Nullable>");
    expect(p).toContain("dsBranchList");
    expect(rdl).not.toMatch(/dsBranchList<\/DataSetName>[\s\S]*CAST\(NULL/);
    expect(errors(rdl)).toEqual([]);
  });

  it("اعتبارسنج چندمقداری+تهی‌پذیر و پنهانِ بی‌پیش‌فرض را خطا می‌داند", () => {
    const { rdl } = buildRdl(spec("SELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef"));
    const multi = rdl.replace('<ReportParameter Name="FiscalYearRef"><DataType>Integer</DataType>', '<ReportParameter Name="FiscalYearRef"><DataType>Integer</DataType><Nullable>true</Nullable><MultiValue>true</MultiValue>');
    expect(errors(multi)).toContain("param_multi_nullable");
    const hidden = rdl.replace("<Prompt>سال مالی</Prompt>", "<Prompt>سال مالی</Prompt><Hidden>true</Hidden>");
    expect(errors(hidden)).toContain("param_hidden_no_default");
  });

  it("نام مستعار فارسی نام فیلد لاتین و معتبر می‌دهد", () => {
    const s = spec("SELECT v.[Number] AS [شماره], v.[Description] AS [شرح سند], v.[Date] AS _x FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef");
    for (const f of s.fields) expect(isValidRdlName(f.name)).toBe(true);
    expect(s.fields.map((f) => f.dataField)).toEqual(["شماره", "شرح سند", "_x"]);
    expect(errors(buildRdl(s).rdl)).toEqual([]);
    expect(isValidRdlName("____")).toBe(false);
    expect(isValidRdlName("شماره_سند")).toBe(true);
  });

  it("Sys_* از تحلیل RDL همان XML سازنده را می‌گیرد (با پیش‌فرض تهی)", () => {
    const out = addSysParams(MERGED).text;
    expect(out).toMatch(/<ReportParameter Name="Sys_CompanyID">[\s\S]*?xsi:nil="true"[\s\S]*?<Hidden>true<\/Hidden>/);
  });
});

describe("بازبینی سال مالی (R1-06) و FORMAT (R1-14)", () => {
  it("JOIN فقط برای عنوان سال، فیلتر سال مالی نیست", async () => {
    const r = await lintReportSql("SELECT v.[Number] AS N, fy.[Title] AS FY FROM FIN3.Voucher v JOIN GNR3.FiscalYear fy ON fy.FiscalYearID = v.FiscalYearRef WHERE v.[State] = 2", describeStub);
    expect(r.findings.map((f) => f.code)).toContain("fiscal_year");
  });
  it("شرط ON با پارامتر فیلتر حساب می‌شود", async () => {
    const r = await lintReportSql("SELECT i.[Debit] AS D FROM FIN3.VoucherItem i JOIN FIN3.Voucher v ON v.VoucherID = i.VoucherRef AND v.FiscalYearRef = @FiscalYearRef WHERE v.State = 2", describeStub);
    expect(r.findings.map((f) => f.code)).not.toContain("fiscal_year");
  });
  it("اقلام بی‌سرآیند هشدار سرآیند سال مالی می‌گیرند", async () => {
    const r = await lintReportSql("SELECT i.[Debit] AS D FROM FIN3.VoucherItem i", describeStub);
    expect(r.findings.map((f) => f.code)).toContain("header_fiscal_year");
  });
  it("FORMAT تاریخ هشدار نمی‌دهد، FORMAT عدد می‌دهد", async () => {
    const base = "FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef AND v.State = 2";
    const d = await lintReportSql(`SELECT FORMAT(v.[Date], N'yyyy/MM/dd', N'fa-IR') AS D ${base}`, describeStub);
    const n = await lintReportSql(`SELECT FORMAT(v.[Number], 'N0') AS D ${base}`, describeStub);
    expect(d.findings.map((f) => f.code)).not.toContain("format_function");
    expect(n.findings.map((f) => f.code)).toContain("format_function");
  });
  it("پارامتر اختیاری و چندمقداری با هم هشدار می‌گیرد", async () => {
    const r = await lintReportSql("SELECT v.Number AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef=@FiscalYearRef AND v.State=2 AND (@BranchRef IS NULL OR v.BranchRef IN (@BranchRef))", describeStub);
    expect(r.findings.map((f) => f.code)).toContain("multi_optional");
  });
});

describe("سازنده و تحلیل (R1-07، R1-10، R1-11، R1-18، R1-19)", () => {
  it("وقتی نخستین ستون جمع‌دار است، جمع آن ستون از دست نمی‌رود", () => {
    const s = spec("SELECT SUM(i.[Debit]) AS Amount, v.[Number] AS N FROM FIN3.VoucherItem i JOIN FIN3.Voucher v ON v.VoucherID = i.VoucherRef WHERE v.FiscalYearRef = @FiscalYearRef GROUP BY v.[Number]");
    const { rdl } = buildRdl({ ...s, layout: { kind: "table", rowNumber: false, grandTotal: true } });
    expect(rdl).toContain("=Sum(Fields!Amount.Value)");
    expect(errors(rdl)).toEqual([]);
  });
  it("عنوانی که با «=» شروع شود عبارت نمی‌شود", () => {
    const { rdl } = buildRdl({ ...spec("SELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef"), title: "=1+1" });
    expect(rdl).toMatch(/<Value>="=1\+1"<\/Value>|<Value>=&quot;=1\+1&quot;<\/Value>/);
  });
  it("DECLARE های فایل آزمون نوع و مقدار پارامتر را می‌دهند", () => {
    const a = analyzeSql("DECLARE @FiscalYearRef bigint = 3;\nDECLARE @Code nvarchar(20) = N'0012';\nSELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef AND v.Description = @Code", details);
    const code = a.params.find((p) => p.name === "Code");
    expect(code.dataType).toBe("String");
    expect(code.defaults).toEqual(["0012"]);
    expect(a.body).not.toMatch(/DECLARE/);
  });
  it("جایگزینی کوئری با DECLARE: CommandText بی‌DECLARE و پارامتر تازه با نوع درست", () => {
    const { rdl } = buildRdl(spec("SELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef"));
    const out = setCommandText(rdl, { dataSet: "dsMain", sql: "DECLARE @FromDate date = '2024-03-20';\nSELECT v.[Number] AS N FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FiscalYearRef AND v.[Date] >= @FromDate" }).text;
    expect(out).not.toMatch(/<CommandText>DECLARE/);
    expect(out).toMatch(/<ReportParameter Name="FromDate"><DataType>DateTime<\/DataType>/);
  });
  it("فایل آزمون برای پارامتر چندمقداری یادداشت می‌گذارد", () => {
    expect(testHarness("SELECT 1 AS A FROM FIN3.Voucher v WHERE v.State IN (@State)")).toMatch(/DECLARE @State[^\n]*چندمقداری/);
  });
});

describe("طراح کوئری (R1-17)", () => {
  it("کد با صفر آغازین رشته می‌ماند و جدول ناموجود SQL خراب نمی‌سازد", () => {
    const plan = { ...emptyPlan("FIN3.Voucher"), columns: [{ table: "FIN3.Voucher", column: "Number" }, { table: "GNR3.Party", column: "Title" }],
      filters: [{ table: "FIN3.Voucher", column: "Description", op: "=", useValue: true, value: "0012" }] };
    const { sql, warnings } = planToSql(plan);
    expect(sql).toContain("= N'0012'");
    expect(sql).not.toMatch(/\bt\.\[Title\]/);
    expect(warnings.join(" ")).toMatch(/GNR3\.Party/);
  });
});

describe("کتابخانهٔ گوشی (R1-21)", () => {
  it("عنوان غیرمتنی رد می‌شود و دادهٔ شکل‌ناشناخته کنار می‌رود", () => {
    const m = new Map();
    const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
    const lib = localLibrary(storage);
    expect(() => lib.save({ title: { a: 1 } })).toThrow();
    m.set("kavosh.reports.v1", JSON.stringify([{ id: "abcdef1" }]));
    expect(lib.list().total).toBe(0);
    expect([...m.keys()].some((k) => k.startsWith("kavosh.reports.v1.broken-"))).toBe(true);
  });
});
