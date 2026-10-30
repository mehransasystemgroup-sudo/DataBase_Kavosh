# ساخت گزارش از صفر — راهنمای نویسندگی RDL 2016

فایل `rdl-tablix-structure.md` توضیح می‌دهد چگونه یک Tablix **موجود** را ویرایش کنی. این فایل مکمل آن است: چگونه یک گزارش **جدید** بسازی، و چگونه اجزایی را اضافه کنی که در آن فایل پوشش داده نشده‌اند — پارامتر، گروه‌بندی، هدر/فوتر، توابع تجمعی، و Export.

## فهرست
1. [قانون اول: از قالب شروع کن، نه از صفر](#۱-قانون-اول-از-قالب-شروع-کن)
2. [اسکلت گزارش و ترتیب المان‌ها](#۲-اسکلت-گزارش-و-ترتیب-المانها)
3. [DataSource و DataSet](#۳-datasource-و-dataset)
4. [پارامترها](#۴-پارامترها)
5. [گروه‌بندی و سلسله‌مراتب ردیف](#۵-گروهبندی-و-سلسلهمراتب-ردیف)
6. [Expressionها و توابع تجمعی](#۶-expressionها-و-توابع-تجمعی)
7. [هدر و فوتر صفحه](#۷-هدر-و-فوتر-صفحه)
8. [راست‌به‌چپ در گزارش جدید](#۸-راستبهچپ-در-گزارش-جدید)
9. [Export به Excel و PDF](#۹-export-به-excel-و-pdf)
10. [چک‌لیست تحویل گزارش جدید](#۱۰-چکلیست-تحویل-گزارش-جدید)
11. [خطاهای رایج و ترجمه‌شان](#۱۱-خطاهای-رایج-و-ترجمهشان)

---

## ۱. قانون اول: از قالب شروع کن

> **هرگز یک فایل RDL را از صفر تایپ نکن.** همیشه `templates/blank-report-2016.rdl` را کپی کن و تغییرش بده.

دلیل: طرح‌واره‌ی RDL 2016 بیشتر بچه‌ها را با `xsd:choice` تعریف می‌کند، پس جابه‌جا شدن ترتیب المان‌های هم‌والد به‌تنهایی معمولاً خطا نمی‌دهد. خطاهای واقعیِ دست‌نویسی این‌هاست: المان زیر والد اشتباه، المان تکراری، یا کمبود المان اجباری (مثل `TablixBody`، `DataSetName`، `Height`). فایل با این خطاها هم well-formed می‌ماند و Report Builder فقط پیام مبهم می‌دهد. قالب همه را درست دارد و ترتیبش همان ترتیبی است که خود Report Builder ذخیره می‌کند؛ پس با نگه داشتن همین ترتیب، فایل با خروجی Report Builder هم‌خوان و مقایسه‌پذیر می‌ماند.

قالب موجود شامل این‌هاست و همگی با `scripts/validate_rdl.py` تست شده‌اند:
منبع داده، سه دیتاست (اصلی + دو دیتاست پارامتر)، شش پارامتر (سال مالی، شعبه‌ی اختیاری، بازه‌ی تاریخ شمسی + دو پارامتر مخفی تبدیل تاریخ)، هدر و فوتر با شماره‌ی صفحه، و یک Tablix پنج‌ستونه‌ی RTL با ردیف عنوان تکرارشونده، گروه‌بندی، جزئیات و جمع گروه.

مراحل استفاده:
1. کپی به مسیر قابل‌نوشتن.
2. `ConnectString` را عوض کن.
3. `CommandText` دیتاست `dsMain` را با کوئری واقعی جایگزین کن.
4. بلوک `<Fields>` را **دقیقاً** با ستون‌های خروجی `SELECT` هم‌خوان کن.
5. ستون‌های Tablix را کم/زیاد کن (طبق قانون سه‌گانه در `rdl-tablix-structure.md`).
6. `Body/Height`، `ReportSection/Width` و `Tablix/Width` را با ابعاد جدید هم‌خوان کن.
7. `scripts/validate_rdl.py` را اجرا کن.
8. یک GUID جدید در `rd:ReportID` بگذار.

---

## ۲. اسکلت گزارش و ترتیب المان‌ها

```
<Report xmlns="…/2016/01/reportdefinition" xmlns:rd="…/reportdesigner">
  <AutoRefresh>
  <DataSources>
  <DataSets>
  <ReportSections>
      <ReportSection>
        <Body>  <ReportItems> … </ReportItems>  <Height>  <Style>
        <Width>
        <Page>  <PageHeader> <PageFooter> <PageHeight> <PageWidth> <Margins…> <Style>
  <ReportParameters>
  <ReportParametersLayout>
  <Language>
  <ConsumeContainerWhitespace>
  <rd:ReportUnitType>
  <rd:ReportID>
</Report>
```

نکات:
- namespace گزارش ۲۰۱۶ دقیقاً این است: `http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition`. اگر فایلی که کاربر می‌فرستد namespace `2008/01` یا `2010/01` داشت، **آن را عوض نکن** — Report Builder 2016 نسخه‌های قدیمی‌تر را باز می‌کند و موقع ذخیره خودش ارتقا می‌دهد. تغییر دستی namespace بدون تغییر ساختار، فایل را خراب می‌کند.
- `<ReportParameters>` **بعد از** `<ReportSections>` می‌آید (برخلاف RDL 2005 که قبلش بود).
- `<Width>` هر `ReportSection` باید ≥ مجموع عرض آیتم‌های داخل `Body` باشد. اگر کمتر باشد، هنگام Export ستون‌ها بریده می‌شوند؛ اگر خیلی بیشتر باشد، صفحه‌های خالی اضافه تولید می‌شود.
- **`--` در کامنت XML غیرمجاز است.** یک خط جداکننده مثل `<!-- ---------- -->` کل فایل را خراب می‌کند. برای جداکننده از `=` یا `~` استفاده کن.

---

## ۳. DataSource و DataSet

### دو نوع منبع داده
```xml
<!-- الف) تعبیه‌شده در خود گزارش (برای توسعه/تست) -->
<DataSource Name="DataSource1">
  <ConnectionProperties>
    <DataProvider>SQL</DataProvider>
    <ConnectString>Data Source=SRV;Initial Catalog=DB</ConnectString>
    <IntegratedSecurity>true</IntegratedSecurity>
  </ConnectionProperties>
  <rd:SecurityType>Integrated</rd:SecurityType>
  <rd:DataSourceID>GUID</rd:DataSourceID>
</DataSource>

<!-- ب) ارجاع به منبع مشترک روی سرور گزارش (توصیه‌شده برای محیط عملیاتی) -->
<DataSource Name="DataSource1">
  <DataSourceReference>/DataSources/MainDB</DataSourceReference>
  <rd:DataSourceID>GUID</rd:DataSourceID>
</DataSource>
```
اگر گزارش قرار است روی Report Server منتشر شود، حالت (ب) درست است — وگرنه رشته‌ی اتصال هر محیط باید دستی عوض شود.

### قانون هم‌خوانی Fields
> ستون‌های `SELECT` و بلوک `<Fields>` باید **یک‌به‌یک و با نام یکسان** باشند.

- ستونی در `SELECT` که `<Field>` ندارد → در `Fields!X.Value` قابل استفاده نیست (بی‌صدا نادیده گرفته می‌شود).
- `<Field>`ی که ستون متناظرش در `SELECT` نیست → **خطای زمان اجرا**، نه زمان طراحی. یعنی گزارش در Report Builder سالم باز می‌شود و فقط موقع Run می‌ترکد.
- `rd:TypeName` باید با نوع واقعی بخواند، وگرنه `Sum()` روی ستونی که `System.String` اعلام شده کار نمی‌کند. نگاشت رایج: `bigint`→`System.Int64`، `int`→`System.Int32`، `decimal/money`→`System.Decimal`، `nvarchar`→`System.String`، `datetime`→`System.DateTime`، `bit`→`System.Boolean`.

**بعد از هر تغییر در `SELECT`، این هم‌خوانی را حتماً چک کن** — این شایع‌ترین علت «گزارش باز می‌شود ولی خطا می‌دهد» است.

### escape در CommandText
داخل `<CommandText>`:
- `<` باید `&lt;` نوشته شود، `&` باید `&amp;` شود. (`>` اجباری نیست ولی بی‌ضرر است.)
- اگر SQL داخل رشته‌ی پویا (`N'...'`) باشد، کوتیشن‌ها هم `''` می‌شوند. **این دو لایه‌ی escaping را با هم قاطی نکن.**

---

## ۴. پارامترها

### ساختار پایه
```xml
<ReportParameter Name="FiscalYearRef">
  <DataType>Integer</DataType>          <!-- Boolean | DateTime | Integer | Float | String -->
  <Nullable>false</Nullable>
  <AllowBlank>false</AllowBlank>
  <MultiValue>false</MultiValue>
  <Prompt>سال مالی</Prompt>
  <DefaultValue><Values><Value>1</Value></Values></DefaultValue>
  <ValidValues>
    <DataSetReference>
      <DataSetName>dsFiscalYear</DataSetName>
      <ValueField>FiscalYearID</ValueField>
      <LabelField>Title</LabelField>
    </DataSetReference>
  </ValidValues>
</ReportParameter>
```
و اتصالش به کوئری:
```xml
<QueryParameters>
  <QueryParameter Name="@FiscalYearRef">
    <Value>=Parameters!FiscalYearRef.Value</Value>
  </QueryParameter>
</QueryParameters>
```

### ⚠️ تله‌ی bigint
`DataType>Integer` در SSRS به `System.Int32` نگاشت می‌شود. کلیدهای اصلی این دیتابیس همه `bigint` هستند. تا وقتی مقادیر زیر ۲٬۱۴۷٬۴۸۳٬۶۴۷ باشند مشکلی نیست (در حال حاضر همه‌ی IDها خیلی کوچک‌ترند)، ولی اگر روزی جدولی از این عدد رد شود، پارامتر بی‌صدا خطا می‌دهد. برای جدول‌های پرحجم، پارامتر را `String` بگیر و در SQL `CAST(@Param AS bigint)` کن.

### پارامتر اختیاری («همه»)
```xml
<Nullable>true</Nullable>
```
```sql
WHERE (@BranchRef IS NULL OR v.BranchRef = @BranchRef)
```
این الگو از ساختن دو کوئری جدا یا SQL پویا جلوگیری می‌کند.

### پارامتر چندمقداری
```xml
<MultiValue>true</MultiValue>
```
```xml
<QueryParameter Name="@BranchList">
  <Value>=Join(Parameters!BranchRef.Value, ",")</Value>
</QueryParameter>
```
```sql
WHERE v.BranchRef IN (SELECT CAST(value AS bigint) FROM STRING_SPLIT(@BranchList, ','))
```
`STRING_SPLIT` روی SQL Server 2016+ موجود است، پس روی ۲۰۲۲ بی‌مشکل کار می‌کند.
نکته: `Parameters!X.Label` برای پارامتر چندمقداری یک آرایه است — برای نمایش در هدر از `Join(Parameters!X.Label, "، ")` استفاده کن.

### پارامتر آبشاری
اگر دیتاست پارامتر دوم به پارامتر اول ارجاع دهد (`WHERE CompanyRef = @CompanyRef`)، SSRS خودش ترتیب را می‌فهمد، اما **پارامتر والد باید در `<ReportParameters>` زودتر تعریف شده باشد.** ترتیب تعریف = ترتیب ارزیابی.

### پارامتر تاریخ شمسی
دو راه، هر دو در قالب هست:
1. **تبدیل در RDL** (پارامترهای مخفی `FromDate`/`ToDate` با `System.Globalization.PersianCalendar`) — به `Language` و نسخه‌ی .NET سرور وابسته است.
2. **تبدیل در SQL** با `SYS3.fnGetDateFromPersianDate` — **این روش توصیه‌شده است**، چون رفتارش قطعی است و در همه‌ی رندررها یکسان. برای استفاده، دو پارامتر مخفی را حذف کن و تبدیل را داخل `CommandText` انجام بده.

---

## ۵. گروه‌بندی و سلسله‌مراتب ردیف

قانون شمارش (متناظر همان «قانون طلایی سه‌گانه» برای ستون‌ها، ولی برای ردیف):

> **تعداد `<TablixRow>` باید دقیقاً برابر تعداد «برگ»های درخت `TablixRowHierarchy` باشد.**

«برگ» = هر `<TablixMember>` که خودش `<TablixMembers>` فرزند ندارد.

ساختار یک گزارش گروه‌بندی‌شده‌ی معمول (۴ برگ ⇔ ۴ ردیف):
```xml
<TablixRowHierarchy>
  <TablixMembers>
    <TablixMember>                          <!-- برگ ۱: عنوان ستون‌ها -->
      <KeepWithGroup>After</KeepWithGroup>
      <RepeatOnNewPage>true</RepeatOnNewPage>
    </TablixMember>
    <TablixMember>                          <!-- گروه (خودش برگ نیست) -->
      <Group Name="grpBranch">
        <GroupExpressions>
          <GroupExpression>=Fields!BranchTitle.Value</GroupExpression>
        </GroupExpressions>
      </Group>
      <SortExpressions>
        <SortExpression><Value>=Fields!BranchTitle.Value</Value></SortExpression>
      </SortExpressions>
      <TablixMembers>
        <TablixMember><KeepWithGroup>After</KeepWithGroup></TablixMember>   <!-- برگ ۲: سرگروه -->
        <TablixMember><Group Name="Details" /></TablixMember>               <!-- برگ ۳: جزئیات -->
        <TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember>  <!-- برگ ۴: جمع گروه -->
      </TablixMembers>
    </TablixMember>
  </TablixMembers>
</TablixRowHierarchy>
```

ترتیب المان‌ها داخل `<TablixMember>` اجباری است:
`Group` → `SortExpressions` → `TablixHeader` → `TablixMembers` → `FixedData` → `Visibility` → `HideIfNoRows` → `KeepWithGroup` → `RepeatOnNewPage` → `KeepTogether` → `DataElementName` → `DataElementOutput`

| المان | کارکرد |
|---|---|
| `<Group Name="Details" />` | گروه جزئیات؛ **بدون** `GroupExpressions` — یعنی یک ردیف به‌ازای هر رکورد |
| `<RepeatOnNewPage>true` | تکرار ردیف عنوان در صفحات بعد. **بدون `<KeepWithGroup>` کار نمی‌کند** |
| `<KeepWithGroup>After` | این ردیف به گروهِ بعدش می‌چسبد (برای هدر) |
| `<KeepWithGroup>Before` | به گروه قبلش می‌چسبد (برای ردیف جمع) |
| `<FixedData>true` | ثابت ماندن هنگام اسکرول در نمایش HTML (فقط HTML، در PDF بی‌اثر) |
| `<Visibility><Hidden>` + `<ToggleItem>` | گروه بازشو/جمع‌شو (drill-down) |
| `<HideIfNoRows>true` | مخفی کردن کل بخش وقتی داده نیست |

### جمع‌کل نهایی
یک `<TablixMember>` دیگر **بعد از** عضو گروه (هم‌سطح با آن، نه داخلش) اضافه کن و یک `<TablixRow>` هم به `TablixRows` — حالا ۵ برگ و ۵ ردیف داری.

### شکستن صفحه در هر گروه
```xml
<Group Name="grpBranch">
  <GroupExpressions>…</GroupExpressions>
  <PageBreak><BreakLocation>Between</BreakLocation></PageBreak>
</Group>
```

### ⚠️ تله‌ی ColSpan
برای ادغام سلول‌ها:
```xml
<TablixCell>
  <CellContents>
    <Textbox Name="…">…</Textbox>
    <ColSpan>5</ColSpan>
  </CellContents>
</TablixCell>
```
وقتی `ColSpan=5` می‌گذاری، **۴ سلول بعدی حذف نمی‌شوند، خالی می‌شوند:** هرکدام یک `<TablixCell />` بی‌محتوا. یعنی ردیف همچنان ۵ `TablixCell` دارد و «قانون تعداد سلول == تعداد ستون» برقرار می‌ماند — Report Builder خودش هم همین شکل را می‌نویسد. همین برای `RowSpan=N`: در N−1 ردیف بعد، خانه‌های زیر آن سلول `<TablixCell />` خالی‌اند. (یادداشت کاوشگر: متن قبلی این بخش می‌گفت سلول‌ها را حذف کن؛ این شکل فشرده را برخی نسخه‌ها نمی‌خوانند. گزارش‌ساز و اعتبارسنجش شکل کامل بالا را می‌سازند و می‌پذیرند.)

---

## ۶. Expressionها و توابع تجمعی

### دامنه (Scope) — مهم‌ترین مفهوم
```
=Sum(Fields!Debit.Value)                  ' دامنه‌ی ضمنی: نزدیک‌ترین گروه دربرگیرنده
=Sum(Fields!Debit.Value, "grpBranch")     ' جمع همان گروه، از هر جای Tablix
=Sum(Fields!Debit.Value, "dsMain")        ' جمع کل دیتاست (برای جمع‌کل نهایی)
```
اگر عدد جمع «اشتباه ولی نزدیک» است، تقریباً همیشه مشکل از Scope اشتباه است، نه از کوئری.

### توابع پرکاربرد
| Expression | کاربرد |
|---|---|
| `=RunningValue(Fields!Amount.Value, Sum, "grpBranch")` | مانده‌ی تجمعی (مثل ستون مانده در صورتحساب) |
| `=RowNumber("grpBranch")` | شماره‌ردیف درون هر گروه |
| `=Previous(Fields!X.Value)` | مقدار ردیف قبل |
| `=Lookup(Fields!Code.Value, Fields!Code.Value, Fields!Title.Value, "dsLookup")` | گرفتن یک مقدار از دیتاست دیگر |
| `=LookupSet(...)` + `Join(...)` | چند مقدار از دیتاست دیگر |
| `=CountDistinct(Fields!VoucherRef.Value)` | شمارش یکتا |
| `=IIf(Fields!Debit.Value > 0, "بدهکار", "بستانکار")` | شرط |
| `=First(Fields!X.Value, "dsMain")` | اولین مقدار (فقط در Body) |

> `Lookup` جایگزین JOIN نیست — روی دیتاست‌های بزرگ کند است. اگر می‌توانی، JOIN را در SQL بزن.

### فرمت اعداد
```xml
<Style><Format>#,0;(#,0);-</Format></Style>
```
سه بخش: مثبت؛ منفی (داخل پرانتز، مرسوم در گزارش مالی)؛ صفر (خط تیره به‌جای `0`). این الگو جدول‌های مالی را بسیار خواناتر می‌کند.

### تله‌ی تقسیم بر صفر
`=A/B` وقتی `B=0` مقدار `Infinity` یا `#Error` می‌دهد. همیشه:
```
=IIf(Sum(Fields!B.Value) = 0, Nothing, Sum(Fields!A.Value) / Sum(Fields!B.Value))
```
⚠️ `IIf` در VB.NET **هر دو شاخه را ارزیابی می‌کند**، پس این هم `#Error` می‌دهد. راه درست:
```
=Sum(Fields!A.Value) / IIf(Sum(Fields!B.Value) = 0, 1, Sum(Fields!B.Value))
```

### کد سفارشی
```xml
<Code>
  Public Function ToPersianDigits(ByVal s As String) As String
    ...
  End Function
</Code>
```
`<Code>` بلافاصله بعد از `<ReportSections>` و قبل از `<ReportParameters>` قرار می‌گیرد، و با `=Code.ToPersianDigits(Fields!X.Value)` صدا زده می‌شود. **قبل از نوشتن کد سفارشی، اول ببین همان کار در SQL ساده‌تر انجام می‌شود یا نه** — دیباگ کردن `<Code>` در RDL بسیار دشوار است.

---

## ۷. هدر و فوتر صفحه

> ⚠️ **در دیتابیس/نرم‌افزار همین کاربر، `PageHeader`/`PageFooter` کلاً ممنوع است** (نرم‌افزار میزبان گزارش را بارگذاری نمی‌کند — `SKILL.md`). بخش زیر مرجع عمومی SSRS است، برای گزارش این کاربر مستقیم برو سراغ `rdl-page-repeat.md`.

```xml
<PageHeader>
  <Height>2.2cm</Height>
  <PrintOnFirstPage>true</PrintOnFirstPage>
  <PrintOnLastPage>true</PrintOnLastPage>
  <ReportItems> … </ReportItems>
  <Style />
</PageHeader>
```

### ⚠️ محدودیت اصلی
> در `PageHeader`/`PageFooter` **فقط** `Parameters!…`، `Globals!…` و `ReportItems!TextboxName.Value` مجازند.
> `Fields!X.Value` و هر تابع تجمعی (`Sum`, `First`, `RunningValue`, `Lookup`) — حتی با ذکر Scope — **غیرمجاز** است.

راه‌حل استاندارد: مقدار را در یک Textbox داخل `Body` حساب کن (در صورت نیاز مخفی)، بعد در فوتر با `=ReportItems!txtGrandTotal.Value` به آن ارجاع بده.

### مقادیر Globals
`PageNumber`، `TotalPages`، `ExecutionTime`، `ReportName`، `ReportFolder`، `UserID`.

```
="صفحه " & Globals!PageNumber & " از " & Globals!TotalPages
="تاریخ چاپ: " & Format(Globals!ExecutionTime, "yyyy/MM/dd HH:mm")
```
برای تاریخ چاپ شمسی، `Format` را کنار بگذار و یک پارامتر مخفی بساز که تاریخ شمسی امروز را از SQL می‌گیرد (`SELECT SYS3.fnGetPersianYearMonth(GETDATE())` یا معادلش) — دقیق‌تر و قابل‌پیش‌بینی‌تر است.

---

## ۸. راست‌به‌چپ در گزارش جدید

`rdl-tablix-structure.md` توضیح می‌دهد که در فایل‌های موجودِ این کاربر **هیچ فلگ RTL صریحی نیست** و جهت فقط از ترتیب ستون‌ها می‌آید. برای گزارش‌های **جدید** این کار را نکن — از فلگ صریح استفاده کن:

```xml
<Tablix Name="TablixMain">
  …
  <LayoutDirection>RTL</LayoutDirection>     <!-- بعد از TablixRowHierarchy، قبل از DataSetName -->
</Tablix>
```

با `LayoutDirection=RTL`: **ستون اول در XML = راست‌ترین ستون روی صفحه.** این خیلی شهودی‌تر از حالت بدون فلگ است و باعث می‌شود ترتیب ستون‌ها در XML با ترتیب خواندن فارسی یکی باشد.

سایر تنظیمات RTL:
- `<Language>fa-IR</Language>` در سطح `<Report>`.
- `<Style><Direction>RTL</Direction></Style>` روی Textboxهای متن فارسی چندخطی.
- `<TextAlign>Right</TextAlign>` برای متن، `Left` برای ستون‌های عددی (در گزارش فارسی، اعداد چپ‌چین خواناترند).

> ⚠️ `Language=fa-IR` باعث می‌شود در بعضی رندررها ارقام به فارسی (۱۲۳) نمایش داده شوند و تقویم پیش‌فرض `Format("d")` شمسی شود. اگر کاربر ارقام لاتین می‌خواهد یا خروجی Excel به‌هم می‌ریزد، `Language` را به `en-US` تغییر بده و متن‌های فارسی همچنان درست نمایش داده می‌شوند.
>
> **در هر دو حالت، تاریخ‌ها را از SQL به‌صورت رشته‌ی آماده بفرست** (بخش ۵ `db-conventions.md`) تا به رفتار رندرر وابسته نباشی.

---

## ۹. Export به Excel و PDF

گزارش‌های مالی تقریباً همیشه به Excel خروجی گرفته می‌شوند. این تله‌ها را از اول رعایت کن:

| مشکل | علت | راه‌حل |
|---|---|---|
| سلول‌های ادغام‌شده‌ی عجیب در Excel | آیتم‌های گزارش با هم دقیقاً هم‌تراز نیستند (اختلاف چنددهم میلی‌متر) | لبه‌های `Left`/`Width` همه‌ی آیتم‌ها را با هم هم‌تراز کن؛ Tablix را از `Left=0` شروع کن |
| ستون‌های اضافه‌ی خالی در Excel | آیتمی بیرون از عرض `Body` است | `ReportSection/Width` = دقیقاً مجموع عرض ستون‌ها |
| صفحه‌ی خالی بین صفحات در PDF | مجموع عرض > (`PageWidth` − حاشیه‌ها) | عرض را کم کن یا صفحه را افقی کن |
| هدر صفحه در Excel نمی‌آید | رندرر Excel هدر/فوتر را فقط در حالت `SimplePageHeaders` می‌آورد | اطلاعات مهم (عنوان، بازه‌ی تاریخ) را در **Body** بگذار، نه در PageHeader |
| اعداد در Excel متن می‌شوند | مقدار به‌صورت رشته از SQL آمده | نوع عددی را در SQL حفظ کن و فرمت را با `<Format>` در RDL بده، نه با `FORMAT()` در SQL |
| ارتفاع ردیف در PDF بریده می‌شود | `CanGrow` خاموش است | `<CanGrow>true</CanGrow>` روی Textboxهای متنی |

قاعده‌ی کلی: **هرچه اطلاعات بیشتری در Body باشد و کمتر در PageHeader، خروجی Excel سالم‌تر است.**

---

## ۱۰. چک‌لیست تحویل گزارش جدید

علاوه بر چک‌لیست مرحله‌ی ۴ در `SKILL.md`:

- [ ] `validate_rdl.py` بدون خطا پاس می‌شود.
- [ ] هر ستون `SELECT` یک `<Field>` دارد و برعکس؛ `rd:TypeName`ها درست‌اند.
- [ ] هر `@Param` در کوئری یک `<QueryParameter>` و یک `<ReportParameter>` متناظر دارد.
- [ ] تعداد `TablixRow` == تعداد برگ‌های `TablixRowHierarchy`.
- [ ] `ReportSection/Width` == مجموع عرض ستون‌های Tablix.
- [ ] فیلتر `FiscalYearRef` / `BranchRef` وجود دارد (اگر جدول این ستون‌ها را دارد).
- [ ] فیلتر یا نمایش `State` وجود دارد — و اگر معنایش اثبات نشده، صریحاً به کاربر هشدار داده شده.
- [ ] هدر/فوتر فقط `Parameters`/`Globals`/`ReportItems` دارد.
- [ ] `rd:ReportID` یکتاست (اگر از قالب کپی شده).
- [ ] کوئری به‌صورت یک فایل `.sql` مستقل با `DECLARE` پارامترهای تستی هم تحویل داده شده.

---

## ۱۱. خطاهای رایج و ترجمه‌شان

| پیام Report Builder | معنی واقعی |
|---|---|
| «The report definition is not valid» بدون جزئیات | ترتیب المان‌ها اشتباه است، یا namespace با ساختار نمی‌خواند |
| `The tablix has a detail member with inner members` | یک `<TablixMember>` با `Group Name="Details"` فرزند `TablixMembers` دارد — گروه جزئیات باید برگ باشد |
| `The number of cells in row N does not match` | قانون سه‌گانه شکسته: تعداد سلول ≠ تعداد ستون (یا `ColSpan`/`RowSpan` بدون `<TablixCell />` خالی به‌جای خانه‌های ادغام‌شده) |
| `The Value expression for the textbox refers to a field. Fields cannot be used in page headers or footers` | همان محدودیت بخش ۷ |
| `The expression … includes an aggregate … which cannot be used in page headers or footers` | `Sum`/`First`/`Lookup` در هدر — با `ReportItems!` جایگزینش کن |
| `Textbox 'X' is not unique` | نام تکراری Textbox در کل فایل |
| گزارش باز می‌شود ولی موقع Run خطا می‌دهد | `<Field>`ی وجود دارد که کوئری برنمی‌گرداند، یا پارامتری که `QueryParameter` ندارد |
| گزارش خالی است ولی خطا ندارد | فیلتر پارامتر همه‌چیز را حذف کرده (اغلب `FiscalYearRef` اشتباه) — کوئری را جدا در SSMS با همان پارامترها اجرا کن |
