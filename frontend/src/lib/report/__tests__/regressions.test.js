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

describe("ستون پویا (hideEmpty)", () => {
  it("ستون علامت‌خورده Visibility با Scope دیتاست می‌گیرد و ساختار سالم می‌ماند", () => {
    const s = spec("DECLARE @FY bigint = 1;\nSELECT v.Number, v.Description, SUM(i.Debit) AS Debit FROM FIN3.Voucher v JOIN FIN3.VoucherItem i ON i.VoucherRef = v.VoucherID WHERE v.FiscalYearRef = @FY GROUP BY v.Number, v.Description");
    s.fields = s.fields.map((f) => (f.name === "Description" || f.name === "Debit" ? { ...f, hideEmpty: true } : f));
    const { rdl } = buildRdl(s);
    expect(errors(rdl)).toEqual([]);
    const hier = rdl.match(/<TablixColumnHierarchy>([\s\S]*?)<\/TablixColumnHierarchy>/)[1];
    const members = hier.match(/<TablixMember\s*\/>|<TablixMember>[\s\S]*?<\/TablixMember>/g);
    const cols = (rdl.match(/<TablixColumn>/g) || []).length;
    expect(members.length).toBe(cols);
    expect(hier).toContain('=Sum(IIf(Len(Trim(Fields!Description.Value &amp; "")) = 0, 0, 1), "dsMain") = 0');
    expect(hier).toMatch(/Sum\(Abs\(CDec\(IIf\(IsNothing\(Fields!Debit\.Value\), 0, Fields!Debit\.Value\)\)\), "dsMain"\) = 0/);
    expect(hier).not.toContain("Fields!Number.Value");
  });
});

describe("پارامتر فارسی (R2-18)", () => {
  it("@ با نام فارسی و نیم‌فاصله پارامتر گزارش می‌شود و نام RDL معتبر می‌ماند", () => {
    const s = spec("SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef = @سال AND (@شماره‌سند IS NULL OR v.Number = @شماره‌سند)");
    expect(s.queryParams).toEqual(["سال", "شماره‌سند"]);
    const { rdl } = buildRdl(s);
    expect(errors(rdl)).toEqual([]);
    expect(rdl).toContain('<QueryParameter Name="@شماره‌سند"><Value>=Parameters!شماره_سند.Value</Value>');
    expect(rdl).toContain('<ReportParameter Name="سال">');
    expect(rdl).toMatch(/<ReportParameter Name="شماره_سند"><DataType>Integer<\/DataType><Nullable>true<\/Nullable>/);
  });
});

describe("نوع عبارت حسابی (R2-10)", () => {
  it("تفاضل و جمع ستون‌های عددی عددی است؛ الحاق رشته متنی می‌ماند", () => {
    const a = analyzeSql("SELECT v.Number, i.Debit - i.Debit * 2 AS Net, i.Debit + i.Debit AS Twice, v.Description + N' *' AS D FROM FIN3.Voucher v JOIN FIN3.VoucherItem i ON i.VoucherRef = v.VoucherID WHERE v.FiscalYearRef = @FY", details);
    const f = Object.fromEntries(a.fields.map((x) => [x.name, x]));
    expect(f.Net.sqlType).toBe("decimal");
    expect(f.Net.total).toBe(true);
    expect(f.Twice.sqlType).toBe("decimal");
    expect(f.D.sqlType).toBe("nvarchar");
  });
});

describe("فیلتر سال مالی در هر SELECT (R2-03، R2-04)", () => {
  const fyCodes = async (sql) => (await lintReportSql(sql, describeStub)).findings.filter((x) => x.code === "fiscal_year");
  it("شاخهٔ UNION بی‌فیلتر خطا دارد", async () => {
    expect(await fyCodes("SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FY AND v.State = 2 AND v.BranchRef = @B UNION ALL SELECT v2.Number FROM FIN3.Voucher v2 WHERE v2.State = 2 AND v2.BranchRef = @B")).toHaveLength(1);
  });
  it("فیلتر از راه برابری با FiscalYear منتقل می‌شود؛ پیوند خالی ON نه", async () => {
    expect(await fyCodes("SELECT v.Number FROM FIN3.Voucher v JOIN GNR3.FiscalYear fy ON fy.FiscalYearID = v.FiscalYearRef AND fy.FiscalYearID = @FY WHERE v.BranchRef = @B AND v.State = 2")).toHaveLength(0);
    expect(await fyCodes("SELECT v.Number FROM FIN3.Voucher v JOIN GNR3.FiscalYear fy ON fy.FiscalYearID = v.FiscalYearRef WHERE fy.Title = @Year AND v.BranchRef = @B AND v.State = 2")).toHaveLength(0);
    expect(await fyCodes("SELECT v.Number, fy.Title FROM FIN3.Voucher v JOIN GNR3.FiscalYear fy ON fy.FiscalYearID = v.FiscalYearRef WHERE v.BranchRef = @B AND v.State = 2")).toHaveLength(1);
  });
  it("زیرکوئری IN ردیف نمی‌افزاید؛ زیرکوئری ستونی بی‌فیلتر خطاست", async () => {
    expect(await fyCodes("SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FY AND v.BranchRef = @B AND v.State = 2 AND v.VoucherID IN (SELECT v3.VoucherID FROM FIN3.Voucher v3 WHERE v3.State = 2)")).toHaveLength(0);
    expect(await fyCodes("SELECT v.Number, (SELECT COUNT(*) FROM FIN3.Voucher v4 WHERE v4.State = 2) AS C FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FY AND v.BranchRef = @B AND v.State = 2")).toHaveLength(1);
  });
});

describe("فایل آزمون و پارامتر چندمقداری (R1-19)", () => {
  it("IN (@P) مقدار نمونهٔ غیر NULL و STRING_SPLIT فهرست نمونه می‌گیرد", () => {
    const h = testHarness("SELECT v.Number FROM FIN3.Voucher v WHERE v.State IN (@State) AND v.BranchRef IN (SELECT value FROM STRING_SPLIT(@Branches, N',')) AND v.FiscalYearRef = @FiscalYearRef", { types: { State: "int" } });
    expect(h).toMatch(/DECLARE @State int = 1; -- چندمقداری/);
    expect(h).toContain("DECLARE @Branches nvarchar(max) = N'1,2';");
  });
});

describe("ممیزی دور ۳", () => {
  it("قالب پایهٔ دانلودی از اعتبارسنج خود برنامه بی‌خطا می‌گذرد و PageHeader ندارد (R3-01)", () => {
    const tpl = readFileSync(new URL("../docs/blank-report-2016.rdl", import.meta.url), "utf8");
    expect(errors(tpl)).toEqual([]);
    expect(tpl).not.toMatch(/<PageHeader>|<PageFooter>|<Direction>RTL<\/Direction>/);
    expect(validateRdl(tpl).findings.map((f) => f.code)).not.toContain("tablix_direction");
  });

  it("افزودن ستون کنار سرعنوان دو ردیفه عنوان را نگه می‌دارد (R3-02)", () => {
    for (const index of [0, 1, 2, 3]) {
      const r = addColumn(MERGED, { index, header: "عنوان تازه", field: "Debit" });
      expect((r.rdl || r.text).split("عنوان تازه").length - 1).toBe(1);
    }
  });

  it("ستون باینری (timestamp) عبارت IsNothing و نوع Byte[] می‌گیرد و هشدار دارد (R3-03)", () => {
    const s = spec("SELECT v.Number, CAST(v.Number AS timestamp) AS Ver FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FY");
    s.fields = s.fields.map((f) => (f.name === "Ver" ? { ...f, hideEmpty: true } : f));
    const { rdl, warnings } = buildRdl(s);
    expect(rdl).toContain("<rd:TypeName>System.Byte[]</rd:TypeName>");
    expect(rdl).toContain('=Sum(IIf(IsNothing(Fields!Ver.Value), 0, 1), "dsMain") = 0');
    expect(warnings.join(" ")).toMatch(/System\.Byte\[\]/);
  });

  it("دو متغیر هم‌نام پس از تبدیل نیم‌فاصله دو پارامتر یکتا می‌شوند؛ نام تکراری خطاست (R3-04)", () => {
    const s = spec("SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FY AND v.Description = @شرح‌سند AND v.Number = @شرح_سند");
    const { rdl } = buildRdl(s);
    expect(errors(rdl)).toEqual([]);
    expect(rdl).toContain('<QueryParameter Name="@شرح_سند"><Value>=Parameters!شرح_سند.Value</Value>');
    expect(rdl).toContain('<QueryParameter Name="@شرح‌سند"><Value>=Parameters!شرح_سند_2.Value</Value>');
    const dup = rdl.replace('<ReportParameter Name="شرح_سند_2">', '<ReportParameter Name="شرح_سند">');
    expect(errors(dup)).toContain("duplicate_param");
  });

  it("IN (@P) درون توضیح، هشدار چندمقداری را خاموش نمی‌کند (R3-06)", () => {
    const s = spec("SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef = @FY -- IN (@FY)");
    s.params = s.params.map((p) => ({ ...p, multiValue: true }));
    expect(buildRdl(s).warnings.join(" ")).toMatch(/چندمقداری است ولی کوئری/);
  });

  it("منفی یک ستون عددی است (R3-07)", () => {
    const a = analyzeSql("SELECT -i.Debit AS Neg FROM FIN3.VoucherItem i JOIN FIN3.Voucher v ON v.VoucherID = i.VoucherRef WHERE v.FiscalYearRef = @FY", details);
    expect(a.fields[0].sqlType).toBe("decimal");
  });

  it("سال مالی: فقط = / IN / BETWEEN محدود می‌کند؛ ON در LEFT JOIN و پیوند با Number کافی نیست؛ جدول مشتق مثل CTE (R3-08، R3-09)", async () => {
    const fy = async (sql) => (await lintReportSql(sql, describeStub)).findings.filter((x) => x.code === "fiscal_year").length;
    const W = " AND v.BranchRef = @B AND v.State = 2";
    expect(await fy(`SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef IS NOT NULL${W}`)).toBe(1);
    expect(await fy(`SELECT v.Number FROM FIN3.Voucher v WHERE v.FiscalYearRef > 0${W}`)).toBe(1);
    expect(await fy(`SELECT v.Number FROM FIN3.Voucher v WHERE (v.FiscalYearRef = @FY OR 1 = 1)${W}`)).toBe(1);
    expect(await fy(`SELECT v.Number FROM FIN3.Voucher v WHERE (@FY IS NULL OR v.FiscalYearRef = @FY)${W}`)).toBe(0);
    expect(await fy(`SELECT i.Debit FROM FIN3.VoucherItem i LEFT JOIN FIN3.Voucher v ON v.VoucherID = i.VoucherRef AND v.FiscalYearRef = @FY WHERE i.Debit > 0`)).toBe(1);
    expect(await fy(`SELECT v2.Number FROM FIN3.Voucher v JOIN FIN3.Voucher v2 ON v2.Number = v.Number WHERE v.FiscalYearRef = @FY${W}`)).toBe(1);
    expect(await fy(`SELECT v2.Number FROM FIN3.Voucher v JOIN FIN3.Voucher v2 ON v2.VoucherID = v.VoucherID WHERE v.FiscalYearRef = @FY${W}`)).toBe(0);
    expect(await fy("SELECT x.N FROM (SELECT v.Number AS N, v.FiscalYearRef AS F FROM FIN3.Voucher v WHERE v.BranchRef = @B AND v.State = 2) x WHERE x.F = @FY")).toBe(0);
  });

  it("متن درون رشتهٔ عبارت ارجاع فیلد نیست (R3-10)", () => {
    const r = addColumn(MERGED, { index: 3, header: "=Fields!Zzz.Value" });
    expect(r.rdl || r.text).toContain('<Value>="=Fields!Zzz.Value"</Value>');
  });
});
