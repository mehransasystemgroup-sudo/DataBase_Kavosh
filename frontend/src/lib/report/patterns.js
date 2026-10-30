/**
 * الگوهای آمادهٔ T-SQL برای دیتاست گزارش — نسخهٔ پارامتری references/sql-patterns.md
 * و قراردادهای db-conventions.md.
 *
 * هر الگو چند ورودی ساده می‌گیرد (نام جدول، ستون، پارامتر) و کد کامل و قابل
 * اجرا می‌دهد؛ نکته‌های «چرا این‌طور» به‌صورت کامنت داخل خود کد می‌آیند تا
 * در فایل .sql کاربر هم بمانند.
 *
 * همچنین `testHarness` — فایل آزمون مستقل SSMS با DECLARE پارامترها، که مهارت
 * آن را در مرحلهٔ تحویل اجباری می‌داند.
 */

import { blankNoise, leadingDeclares, queryParameters, withoutLeadingDeclares } from "./sqlmeta.js";

const q = (name) => `[${String(name || "").replace(/]/g, "]]")}]`;
const ident = (s, fallback) => (/^[A-Za-z_][\w]*$/.test(String(s || "").trim()) ? String(s).trim() : fallback);
const tableRef = (full, fallback = "SCHEMA.Table") => {
  const parts = String(full || "").trim().split(".").filter(Boolean);
  if (parts.length !== 2) return fallback;
  return `${q(parts[0])}.${q(parts[1])}`;
};
const lit = (s) => `N'${String(s ?? "").replace(/'/g, "''")}'`;

// ── فایل آزمون مستقل ──

/** مقدار آزمونی پیش‌فرض یک پارامتر، با توضیح. */
export function testValue(name, sqlType = "") {
  const n = String(name);
  const t = String(sqlType).toLowerCase();
  if (/^FiscalYear(Ref|ID)?$/i.test(n)) return { type: "bigint", value: "(SELECT MAX(FiscalYearID) FROM GNR3.FiscalYear)", note: "بزرگ‌ترین شناسه — معمولاً سال جاری؛ بررسی کنید" };
  if (/^Branch(Ref|ID)?$/i.test(n)) return { type: "bigint", value: "NULL", note: "NULL = همهٔ شعب" };
  if (/^Sys_CurrentCulture$/i.test(n)) return { type: "nvarchar(10)", value: "N'fa-IR'" };
  if (/^Sys_CurrentCalendar$/i.test(n)) return { type: "nvarchar(20)", value: "N'Persian'" };
  if (/^Sys_IsSecondLanguageActive$/i.test(n)) return { type: "nvarchar(5)", value: "N'False'" };
  if (/^Sys_(CompanyID|UserID)$/i.test(n)) return { type: "nvarchar(20)", value: "N'1'" };
  if (/^Sys_/i.test(n)) return { type: "nvarchar(200)", value: "N''" };
  if (/persian|shamsi|jalali/i.test(n)) return { type: "nvarchar(10)", value: /to|end|until/i.test(n) ? "N'1405/12/29'" : "N'1405/01/01'", note: "تاریخ شمسی به‌صورت متن" };
  if (/^(From|Start|Begin)\w*Date$|Date(From|Start)$/i.test(n)) return { type: "datetime", value: "DATEADD(month, -1, CAST(GETDATE() AS date))" };
  if (/^(To|End|Until)\w*Date$|Date(To|End)$/i.test(n)) return { type: "datetime", value: "CAST(GETDATE() AS date)" };
  if (/date|time/.test(t)) return { type: t || "datetime", value: "CAST(GETDATE() AS date)" };
  if (/^bit$/.test(t)) return { type: "bit", value: "NULL" };
  if (/int|numeric|decimal|money|float|real/.test(t)) return { type: t, value: "NULL", note: "مقدار آزمون را بگذارید" };
  if (/Ref$|ID$/.test(n)) return { type: "bigint", value: "NULL", note: "مقدار آزمون را بگذارید" };
  return { type: t || "nvarchar(200)", value: "NULL", note: "مقدار آزمون را بگذارید" };
}

/**
 * فایل .sql مستقل برای SSMS: DECLARE هر پارامتر با مقدار آزمونی، سپس کوئری.
 * `types` نگاشت اختیاری نام پارامتر ← نوع SQL است (از ستون متناظر).
 */
export function testHarness(sql, { title = "", types = {} } = {}) {
  const text = String(sql || "");
  const existing = leadingDeclares(text).flatMap((b) => b.items);
  const body = existing.length ? withoutLeadingDeclares(text) : text;
  const params = queryParameters(text);
  const stamp = new Date().toISOString().slice(0, 10);
  const lines = [
    "/* ── فایل آزمون مستقل (SSMS) ─────────────────────────────────────────",
    title ? `   گزارش: ${String(title).replace(/\*\//g, "* /")}` : null,
    `   ساخته‌شده در: ${stamp} — کاوشگر پایگاه داده`,
    "   پیش از بارگذاری در Report Builder، همین فایل را در SSMS اجرا کنید:",
    "   اگر این‌جا عدد درست نیست، در گزارش هم درست نخواهد بود.",
    "   ──────────────────────────────────────────────────────────────────── */",
    "SET NOCOUNT ON;",
    "",
  ].filter((l) => l !== null);
  for (const d of existing) lines.push(`DECLARE @${d.name} ${d.type}${d.value != null ? ` = ${d.value}` : ""};`);
  const clean = blankNoise(body);
  for (const p of params) {
    if (existing.some((d) => d.name.toLowerCase() === p.toLowerCase())) continue;
    let v = testValue(p, types[p]);
    const name = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // چندمقداری: در SSMS فقط یک مقدار می‌شود داد؛ با NULL، «IN (NULL)» هیچ ردیفی برنمی‌گرداند
    const multi = new RegExp(`\\bIN\\s*\\(\\s*@${name}\\s*\\)`, "i").test(clean);
    const split = new RegExp(`STRING_SPLIT\\s*\\(\\s*@${name}(?![\\w\u0600-\u06FF\u200C])`, "i").test(clean);
    let note = v.note;
    if (split) {
      v = { type: "nvarchar(max)", value: "N'1,2'" };
      note = "چندمقداری (STRING_SPLIT) — فهرست نمونه را با مقدارهای واقعی عوض کنید";
    } else if (multi) {
      if (v.value === "NULL") v = { ...v, value: /int|numeric|decimal|money|float|real|bit/.test(v.type) ? "1" : "N''" };
      note = `چندمقداری در گزارش — مقدار نمونه را عوض کنید؛ برای آزمون چند مقدار، IN (@${p}) را موقتاً IN (1, 2) بنویسید (با NULL هیچ ردیفی نمی‌آید)`;
    }
    lines.push(`DECLARE @${p} ${v.type} = ${v.value};${note ? ` -- ${note}` : ""}`);
  }
  if (params.length || existing.length) lines.push("");
  lines.push(body.trim().replace(/;?\s*$/, ";"));
  return `${lines.join("\n")}\n`;
}

// ── عبارت CASE وضعیت ──

/**
 * CASE کامل برای یک ستون enum با ELSE اجباری — مقادیر از دانش برنامه.
 * اگر مقدار ناشناخته‌ای بیاید، گزارش آن را نشان می‌دهد نه اینکه بی‌صدا خالی بماند.
 */
export function stateCase(alias, column, values = [], outAlias = "StateTitle") {
  const col = `${ident(alias, "t")}.${q(column || "State")}`;
  const known = values.filter((v) => v && v.value != null && String(v.value).trim() !== "");
  const lines = [`CASE ${col}`];
  for (const v of known) {
    const value = /^-?\d+$/.test(String(v.value)) ? String(v.value) : lit(v.value);
    lines.push(`    WHEN ${value} THEN ${lit(v.label_fa || v.value)}${v.confidence && v.confidence !== "high" ? ` -- اطمینان: ${v.confidence}` : ""}`);
  }
  if (!known.length) lines.push("    -- معنای مقادیر هنوز اثبات نشده: اسکریپت تشخیصی (GROUP BY) را اجرا کنید", "    WHEN 1 THEN N'…'");
  lines.push(`    ELSE N'نامشخص (' + CAST(${col} AS nvarchar(20)) + N')'`, `END AS ${ident(outAlias, "StateTitle")}`);
  return lines.join("\n");
}

// ── الگوها ──

export const PATTERNS = [
  {
    id: "mandatory-filters",
    title: "فیلترهای اجباری گزارش مالی",
    when: "جدول مبنا FiscalYearRef یا BranchRef دارد — بی‌این فیلترها گزارش بی‌صدا عدد غلط می‌دهد.",
    inputs: [
      { key: "table", label: "جدول مبنا", placeholder: "FIN3.Voucher" },
      { key: "alias", label: "نام مستعار", placeholder: "v" },
    ],
    build: ({ table, alias }) => {
      const a = ident(alias, "v");
      return `SELECT ${a}.*
FROM ${tableRef(table, "FIN3.Voucher")} AS ${a}
WHERE ${a}.[FiscalYearRef] = @FiscalYearRef                         -- اجباری: بی‌آن چند سال مالی با هم جمع می‌شوند
  AND (@BranchRef IS NULL OR ${a}.[BranchRef] = @BranchRef)        -- اختیاری: NULL = همهٔ شعب
  AND ${a}.[Date] >= @FromDate AND ${a}.[Date] < DATEADD(day, 1, @ToDate);  -- نیم‌باز: datetime ساعت دارد`;
    },
  },
  {
    id: "persian-date-params",
    title: "پارامتر تاریخ شمسی (متن ۱۴۰۵/۰۲/۱۵)",
    when: "کاربر باید تاریخ را شمسی وارد کند؛ پارامتر DateTime در Report Builder تقویم میلادی نشان می‌دهد.",
    inputs: [
      { key: "column", label: "ستون تاریخ", placeholder: "Date" },
      { key: "alias", label: "نام مستعار", placeholder: "v" },
    ],
    build: ({ column, alias }) => {
      const a = ident(alias, "v");
      const c = q(ident(column, "Date"));
      return `-- پارامترهای گزارش: @FromPersian و @ToPersian از نوع Text (مثل 1405/01/01)
DECLARE @FromDate datetime = SYS3.fnGetDateFromPersianDate(
    CAST(LEFT(@FromPersian, 4) AS int), CAST(SUBSTRING(@FromPersian, 6, 2) AS int), CAST(RIGHT(@FromPersian, 2) AS int));
DECLARE @ToDate datetime = SYS3.fnGetDateFromPersianDate(
    CAST(LEFT(@ToPersian, 4) AS int), CAST(SUBSTRING(@ToPersian, 6, 2) AS int), CAST(RIGHT(@ToPersian, 2) AS int));

-- … در WHERE (نیم‌باز، نه BETWEEN):
--   AND ${a}.${c} >= @FromDate AND ${a}.${c} < DATEADD(day, 1, @ToDate)

-- نمایش تاریخ شمسی: در SQL به رشته تبدیل کنید تا در PDF و Excel یکسان بماند
--   FORMAT(${a}.${c}, N'yyyy/MM/dd', N'fa-IR') AS ${ident(column, "Date")}Fa
--   SYS3.fnGetPersianYearMonth(${a}.${c})     AS YearMonth   -- مثل 140502، برای گروه‌بندی ماهانه`;
    },
  },
  {
    id: "optional-param",
    title: "پارامتر اختیاری («همه»)",
    when: "کاربر می‌تواند فیلتر را خالی بگذارد تا همه بیایند.",
    inputs: [
      { key: "column", label: "ستون", placeholder: "CostCenterRef" },
      { key: "alias", label: "نام مستعار", placeholder: "t" },
      { key: "param", label: "پارامتر", placeholder: "CostCenterRef" },
    ],
    build: ({ column, alias, param }) => {
      const c = ident(column, "CostCenterRef");
      const p = ident(param, c);
      return `-- در RDL: پارامتر @${p} با Nullable=true و AllowBlank=true
AND (@${p} IS NULL OR ${ident(alias, "t")}.${q(c)} = @${p})
-- اگر کوئری کند شد (sniffing)، OPTION (RECOMPILE) را به انتهای کوئری بیفزایید`;
    },
  },
  {
    id: "multi-param",
    title: "پارامتر چندمقداری",
    when: "کاربر چند مقدار (مثلاً چند شعبه) را با هم انتخاب می‌کند.",
    inputs: [
      { key: "column", label: "ستون", placeholder: "BranchRef" },
      { key: "alias", label: "نام مستعار", placeholder: "v" },
      { key: "param", label: "پارامتر", placeholder: "Branches" },
    ],
    build: ({ column, alias, param }) => {
      const c = q(ident(column, "BranchRef"));
      const a = ident(alias, "v");
      const p = ident(param, "Branches");
      return `-- روش ۱ (کوئری متنی ساده): Report Builder خودش @${p} را به فهرست بسط می‌دهد
AND ${a}.${c} IN (@${p})

-- روش ۲ (رویهٔ ذخیره‌شده یا SQL پویا): در QueryParameter مقدار را =Join(Parameters!${p}.Value, ",") بدهید
AND ${a}.${c} IN (SELECT TRY_CAST(value AS bigint) FROM STRING_SPLIT(@${p}, N','))`;
    },
  },
  {
    id: "state-case",
    title: "نمایش وضعیت با CASE … ELSE",
    when: "معنای State هنوز اثبات نشده یا گزارش باید وضعیت را نشان دهد. ELSE را هرگز حذف نکنید.",
    inputs: [
      { key: "alias", label: "نام مستعار", placeholder: "v" },
      { key: "column", label: "ستون", placeholder: "State" },
    ],
    build: ({ alias, column }) => stateCase(alias, column),
  },
  {
    id: "dynamic-pivot",
    title: "پیوت پویا (ستون‌ها از جدول تنظیمات)",
    when: "تعداد و نام ستون‌ها از قبل معلوم نیست و از یک جدول تنظیمات می‌آید.",
    inputs: [
      { key: "source", label: "جدول عنوان‌ها", placeholder: "HCM3.CompensationFactor" },
      { key: "title", label: "ستون عنوان", placeholder: "Title" },
    ],
    build: ({ source, title }) => {
      const t = q(ident(title, "Title"));
      return `DECLARE @cols nvarchar(MAX), @query nvarchar(MAX);

SELECT @cols = STRING_AGG(QUOTENAME(${t}), N',')   -- QUOTENAME: نام فارسی/فاصله‌دار امن می‌شود
FROM ${tableRef(source, "dbo.FactorTable")}
WHERE 1 = 1;  -- فیلتر دسته/نوع موردنظر

SET @query = N'
SELECT pvt.*
FROM (
    SELECT EntityKey, FactorTitle, Value
    FROM …                              -- داخل رشتهٔ پویا، کوتیشن تک را دوبل کنید: ''مثال''
    WHERE Period = @Period
) AS src
PIVOT (MAX(Value) FOR FactorTitle IN (' + @cols + N')) AS pvt;';

-- پارامترها همیشه با sp_executesql و فهرست تایپ‌شده — هرگز چسباندن مستقیم به متن
EXEC sp_executesql @query, N'@Period int', @Period;

-- ⚠️ ستون‌های پویا در RDL فیلد ثابت ندارند؛ برای گزارش، Matrix با گروه ستونی روی FactorTitle
--    معمولاً امن‌تر از پیوت پویا در SQL است.`;
    },
  },
  {
    id: "row-number-pairs",
    title: "رکوردهای نامحدود ← تعداد ثابت زوج‌ستون (ROW_NUMBER)",
    when: "چند رویداد در یک روز (مثل تردد) باید در N زوج ستون ثابت بنشیند.",
    inputs: [
      { key: "pairs", label: "تعداد زوج", placeholder: "3" },
      { key: "source", label: "جدول رویداد", placeholder: "HCM3.AttendanceData" },
    ],
    build: ({ pairs, source }) => {
      const n = Math.min(Math.max(parseInt(pairs, 10) || 3, 1), 12);
      const cols = [];
      for (let i = 1; i <= n; i += 1) {
        cols.push(`    MAX(CASE WHEN rn = ${2 * i - 1} THEN FORMAT(EventDateTime, N'HH:mm') END) AS In${i}`);
        cols.push(`    MAX(CASE WHEN rn = ${2 * i} THEN FORMAT(EventDateTime, N'HH:mm') END) AS Out${i}`);
      }
      return `-- گام ۱: شماره‌گذاری رویدادهای هر نفر در هر روز به ترتیب زمان
DROP TABLE IF EXISTS #Numbered, #Pairs;
SELECT EntityKey, CAST(EventDateTime AS date) AS DayKey, EventDateTime,
       ROW_NUMBER() OVER (PARTITION BY EntityKey, CAST(EventDateTime AS date) ORDER BY EventDateTime) AS rn
INTO #Numbered
FROM ${tableRef(source, "dbo.EventTable")}
WHERE EventDateTime >= @FromDate AND EventDateTime < DATEADD(day, 1, @ToDate);

-- گام ۲: پیوت به ${n} زوج ثابت؛ رویداد بیشتر از ${2 * n} عدد بی‌صدا کنار می‌رود — به کاربر بگویید
SELECT EntityKey, DayKey,
${cols.join(",\n")}
INTO #Pairs
FROM #Numbered
GROUP BY EntityKey, DayKey;

-- گام ۳: LEFT JOIN به فهرست روزها/افراد تا روزهای بی‌رویداد هم بمانند
SELECT * FROM #Pairs;

DROP TABLE IF EXISTS #Numbered, #Pairs;`;
    },
  },
  {
    id: "running-balance",
    title: "مانده تجمعی (دفتر/کاردکس)",
    when: "گزارش دفتر حساب یا کاردکس که هر ردیف ماندهٔ تا آن لحظه را نشان می‌دهد.",
    inputs: [{ key: "alias", label: "نام مستعار", placeholder: "x" }],
    build: ({ alias }) => {
      const a = ident(alias, "x");
      return `-- ماندهٔ ابتدای دوره جدا حساب شود (همان فیلترها، Date < @FromDate)، سپس جمع تجمعی:
SELECT ${a}.*,
       SUM(${a}.Debit - ${a}.Credit) OVER (
           PARTITION BY ${a}.AccountKey
           ORDER BY ${a}.[Date], ${a}.Number, ${a}.RowID
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW   -- ROWS نه RANGE: سریع‌تر و با ردیف‌های هم‌تاریخ درست
       ) + ISNULL(ob.OpeningBalance, 0) AS RunningBalance
FROM … AS ${a}
LEFT JOIN #Opening AS ob ON ob.AccountKey = ${a}.AccountKey;
-- ORDER BY باید یکتا باشد (کلید ردیف را آخر بگذارید) وگرنه مانده بین اجراها جابه‌جا می‌شود.`;
    },
  },
  {
    id: "temp-pipeline",
    title: "پایپ‌لاین جدول‌های موقت",
    when: "گزارش چندمرحله‌ای (تردد، حقوق) که هر مرحله روی خروجی قبلی کار می‌کند.",
    inputs: [],
    build: () => `DROP TABLE IF EXISTS #Raw, #Assignment, #Final;   -- اول و آخر: همهٔ جدول‌های موقت

-- ۱) رکوردهای معتبر خام
SELECT … INTO #Raw FROM … WHERE … ;

-- ۲) آخرین تخصیص فعال هر نفر
SELECT * INTO #Assignment
FROM (
    SELECT a.*, ROW_NUMBER() OVER (PARTITION BY a.EmployeeRef ORDER BY a.StartDate DESC) AS rn
    FROM … AS a WHERE a.StartDate < DATEADD(day, 1, @ToDate)
) z WHERE z.rn = 1;

-- ۳) تجمیع نهایی
SELECT … INTO #Final FROM #Raw r LEFT JOIN #Assignment s ON s.EmployeeRef = r.EmployeeRef GROUP BY … ;

SELECT * FROM #Final ORDER BY … ;   -- فقط این SELECT آخر فیلدهای گزارش را می‌سازد

DROP TABLE IF EXISTS #Raw, #Assignment, #Final;`,
  },
  {
    id: "dynamic-columns",
    title: "ستون‌های پویا (مخفی‌شدن ستونی که در کل گزارش داده ندارد)",
    when: "ستونی باید فقط وقتی دیده شود که دست‌کم یک ردیف کل نتیجه برایش مقدار دارد — با الگوی ROW_NUMBER قاطی نکنید.",
    inputs: [],
    build: () => `;WITH TitleCTE AS (
    SELECT RowNumber = ROW_NUMBER() OVER (ORDER BY d.[Order]),
           Title     = f.Title
    FROM dbo.ViewSettingDetail AS d
    LEFT JOIN dbo.FactorDefinition AS f
        ON f.FactorID = d.FactorRef
       AND f.FactorID IN (                      -- شرط «داده دارد» داخل ON، نه WHERE جدا
            SELECT DISTINCT v.FactorRef FROM dbo.FactValue AS v
            WHERE v.Period = @Period AND v.[Value] <> 0)
    WHERE d.ViewSettingRef = @ViewSettingID
      AND f.Title IS NOT NULL                    -- حذف واقعی همین‌جاست
)
SELECT * FROM TitleCTE;
-- ⚠️ همین شرط عضویت باید عیناً در کوئری مقدارها هم تکرار شود.
-- سمت RDL: زنجیرهٔ Hidden روی ستون‌ها (مرجع «کالبدشکافی Tablix» بخش ستون‌های پویا).`,
  },
];

export function buildPattern(id, values = {}) {
  const p = PATTERNS.find((x) => x.id === id);
  if (!p) throw new Error(`الگوی «${id}» شناخته نشد.`);
  const filled = Object.fromEntries(p.inputs.map((i) => [i.key, values[i.key] || i.placeholder]));
  return p.build(filled);
}
