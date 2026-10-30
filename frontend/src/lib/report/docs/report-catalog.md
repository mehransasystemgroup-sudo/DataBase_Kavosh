# فهرست گزارش‌های شناخته‌شده‌ی این پروژه

> هر بار که روی یک فایل RDL جدید کار کردی، یک بخش این‌جا اضافه کن.
> هدف: دفعه‌ی بعد لازم نباشد ساختار همان گزارش از صفر کشف شود.
>
> ⚠️ کاربر خودش هم گزارش‌ها را در Report Builder ویرایش می‌کند.
> پس این فایل **نقشه‌ی راه** است، نه حقیقت مطلق — همیشه اعداد (تعداد ستون/ردیف/مختصات)
> را از فایلِ تازه‌آپلودشده دوباره بشمار.

---

## قراردادهای مشترک همه‌ی گزارش‌های این نرم‌افزار (SG / SystemGroup)

این‌ها در هر RDL این سیستم تکرار می‌شوند — اگر در فایل جدیدی دیدی، تعجب نکن و خرابشان نکن:

| مورد | توضیح |
|---|---|
| `<Value>sglt:Some_Resource_Key</Value>` | پیشوند `sglt:` = **کلید منبع محلی‌سازی**. متن نهایی را نرم‌افزار میزبان در زمان اجرا جایگزین می‌کند. **هرگز آن را با متن فارسی ثابت عوض نکن** مگر کاربر صریحاً بخواهد. |
| `<CodeModules><CodeModule>SG.ReportingUtilities, Version=777.777.0.64672, …` | اسمبلی کمکی سفارشی |
| `<Classes>`: `SG.Util` → `Util` و `SG.NumberUtil` → `NumberUtil` | فراخوانی: `=Code.Util.Format(<عدد>, Parameters!Sys_CurrentCulture.Value)` برای فرمت اعداد مطابق زبان جاری |
| پارامترهای `Sys_*` | `Sys_CompanyID`, `Sys_CompanyName`, `Sys_UserID`, `Sys_UserName`, `Sys_CurrentCulture`, `Sys_CurrentCalendar`, `Sys_IsSecondLanguageActive` — نرم‌افزار میزبان خودکار پر می‌کند. هنگام افزودن Subreport جدید **همه‌ی این‌ها باید pass-through شوند**. |
| `<DataSourceReference>/DataSources/SgDataSource</DataSourceReference>` | منبع داده‌ی مشترک |
| `<Direction>RTL</Direction>` | روی `<Style>` هر Textbox فارسی |
| **`<PageHeader>` ممنوع** | نرم‌افزار میزبان گزارش دارای هدر صفحه را بارگذاری نمی‌کند → جزئیات در `rdl-page-repeat.md` |

---

## ۱. `SalaryReceiptItemA5.rdl` — فیش حقوقی کارمند (A5 افقی)

**مسیر روی سرور:** `/جبران خدمات/فیش حقوق-A5/`
**اندازه‌ی صفحه:** `PageWidth=21cm`, `PageHeight=14.8cm` (A5 افقی)، حاشیه‌ها `0.5/0.5/0.2/0.2cm`
**`ReportSection/Width` = `20.89416cm` — `Body/Height` = `14.10313cm`**

### ساختار Body (نسخه‌ی اصلاح‌شده، تیر ۱۴۰۵)

```
Textbox32                 Top≈1.4mm    عنوان/نام شرکت
Year / Textbox46 /
YearMonthTitle / Textbox45  Top≈10mm   «فیش حقوقی سال … ماه …»

Tablix2                   Top=17.56833mm  H=29.53026mm  W=206.69172mm   ← قلب گزارش
Rectangle2                Top=48.15692mm  جمع وام / جمع کسورات / جمع مزایا
Rectangle14               Top=54.70105mm  شماره حساب
Rectangle13               Top=54.70105mm  خالص پرداختی (NetPay)
Textbox1                  Top=61.2572mm   خط پایانی
```

آیتم‌های زیر `Tablix2` هنگام رشد Subreportها به‌صورت خودکار به پایین رانده می‌شوند —
پس **لبه‌ی پایینی `Tablix2` (۴۷.۰۹۸۵۹mm) نباید هیچ‌وقت تغییر کند.**

### آناتومی `Tablix2` (پس از اصلاح — ۴ ستون × ۴ ردیف)

ستون‌ها (چپ→راست فیزیکی، بدون فلیپ RTL — با مقایسه با مختصات `Rectangle2` تأیید شد):

| # | عرض | محتوا |
|---|---|---|
| ۱ | `76.25mm` | وام — `SalaryReceiptLoanA5` |
| ۲ | `49.63674mm` | کسورات — `SalaryReceiptDeductionA5` |
| ۳ | `47.80498mm` | مزایا — `SalaryReceiptPaymentA5` |
| ۴ | `33mm` | سایر — `SalaryReceiptAttendanceA5` |

ردیف‌ها:

| # | ارتفاع | عضو Hierarchy | محتوا |
|---|---|---|---|
| ۱ | `6.29969mm` | `After` + **`RepeatOnNewPage=true`** | `Rectangle1` (ColSpan=4): مرکز هزینه، شماره پرسنلی، کد، نام کارمند — پس‌زمینه `LightGrey` |
| ۲ | `7.2306mm` | `After` | `Rectangle3` (ColSpan=4): مانده مرخصی / مرخصی ماه — دارای `Visibility` مشروط به `LeaveExist` |
| ۳ | `5.99999mm` | `After` + `RepeatOnNewPage=true` | عنوان ستون‌ها |
| ۴ | `9.99998mm` | `Group Name="Details4"` | چهار Subreport |

**تاریخچه‌ی تغییر:** در نسخه‌ی اولیه `Rectangle1` و `Rectangle3` آیتم آزاد در Body بودند و
`Rectangle1` یک `<RepeatWith>Tablix2</RepeatWith>` بی‌اثر داشت؛ عضو ردیف عنوان هم
`KeepWithGroup=Before` (غلط) داشت. هر دو اصلاح شد — شرح کامل در `rdl-page-repeat.md`.

### چهار Subreport (فایل‌های جدا، هنوز کاوش‌نشده)

`SalaryReceiptLoanA5` · `SalaryReceiptDeductionA5` · `SalaryReceiptPaymentA5` · `SalaryReceiptAttendanceA5`

- Loan فقط `EmployeeID`, `IssueYearMonth` + `Sys_*` + `Current` می‌گیرد.
- Deduction/Payment علاوه بر آن `ApplyYearMonth`, `FactorViewSettingID`, `DisplayType`,
  `DeferredToCurrentYear`, `DeferredToPreviousYear` هم می‌گیرند.
- **همین‌ها هستند که سرریز می‌کنند** وقتی عوامل حقوقی کارمند زیاد باشد.

### پارامترهای گزارش (۱۵ تا)

`EmployeeID`(String) · `IssueYearMonth`(Int, سال‌ماه شمسی مثل `140502`) ·
`ApplyYearMonth`(Int) · `FactorViewSettingID`(Int) · `DisplayType`(Int) ·
`Current`/`DeferredToCurrentYear`/`DeferredToPreviousYear`(Boolean) · هفت پارامتر `Sys_*`

### چهار DataSet

| DataSet | نقش | نکته |
|---|---|---|
| `Header` | ۲۳ فیلد هویتی کارمند | تک‌ردیف؛ همه‌ی Textboxها با `First(..., "Header")` می‌خوانند |
| `Summary` | `PaymentSum`, `DeductionSum`, `NetPay`, `NetPayFactorTitle`, `AccountNumber`, `LoanInstalmentSum` | تک‌ردیف با چهار زیرکوئری اسکالر |
| `Leave` | `LeaveRemainder`, `LeaveMinutes`, `LeaveExist` | دو `EXEC` روی رویه‌های مرخصی |
| `EmploymentNumber` | `IsEnabled`, `EmploymentNumberTitle` | `SELECT * FROM HCM3.fnGetEmploymentNumberConfiguration(@Sys_CurrentCulture)` |

منطق تجاری کامل این کوئری‌ها (جدول‌ها، enumها، الگوی معوقه) در
`known-database-schema.md` بخش «ماژول حقوق و دستمزد» مستند شده.

---

## ۲. `گزارش تردد روزانه2.rdl` — گزارش تردد روزانه

جزئیات در `known-database-schema.md` بخش «نکات RDL خاص این گزارش».

## ۳. `LeaveCardex.rdl` — کاردکس مرخصی

جزئیات در `known-database-schema.md` بخش «نکات RDL خاص این گزارش».
این فایل مرجع الگویی برای محاسبه‌ی «مانده مرخصی» در سایر گزارش‌هاست.

## ۴. `گزارش_تردد_روزانه_کارمند__نسخه_نهایی_اصلاح_شده_.rdl` — تردد روزانه کارمند (DataSet1)

فیلتر نهاییِ `#DeviceAttendance`: **`WHERE Enabled = 1 AND AttendanceStatusRef = 2`** + حذف تکرار رکورد هم‌زمانِ بدون `Entrance` (وقتی کنار یک رکورد اصلاح‌شده‌ی هم‌زمان مانده) + تشخیص ورود/خروج با اولویت `Entrance` نه فرد/زوجِ تنها (`sql-patterns.md` بخش ۲.۱).
تاریخچه‌ی کامل باگ (سه دور رفع، شامل یک اشتباه میانی که با خواندن جدول Lookup واقعی رفع شد) و جدول کامل مقادیر `AttendanceStatusRef` در `known-database-schema.md` بخش «جدول‌های تردد خام».

## ۵. `SalaryList.rdl` + `SalaryListItems.rdl` — لیست حقوق کارمندان (والد + ساب‌ریپورت، ستون‌های پویا)

**مسیر روی سرور:** `/ReportForJobran/SalaryList` (والد) و `/ReportForJobran/SalaryListItems` (ساب‌ریپورت، فراخوانی‌شده با ۲۴+ پارامتر pass-through). این جفت گزارش تنها جایی‌ست در این پروژه که الگوی **«ستون پویا/مخفی‌سازی ستون بدون داده»** پیاده شده — شرح کامل مکانیزم در `sql-patterns.md` بخش ۳ (SQL) و `rdl-tablix-structure.md` بخش ۶ (RDL). این‌جا فقط ساختار خاصِ همین گزارش ثبت می‌شود.

### تقسیم مسئولیت والد/ساب‌ریپورت

- **والد (`SalaryList.rdl`, ۲ دیتاست، یک `mainTablix` گروه‌بندی‌شده روی `ApplyYearMonth`)**: هیچ عامل/مقداری نمی‌سازد. فقط (۱) لیست ماه‌های واجد شرط را برای گروه‌بندی برمی‌گرداند و (۲) پنج پرچم بولی سطح‌دسته (`AttendanceVisibility`, `BossCommitmentVisibility`, `BenefitVisibility`, `DeductionVisibility`, `OtherVisibility`) را با یک `COUNT(*) > 0` روی `HCM3.FactorViewSetting` (فیلترشده با `FactorViewSettingTypeID = 5` — کد شناخته‌شده‌ی «قالب نمایش گزارش لیست حقوق») محاسبه و به ساب‌ریپورت پاس می‌دهد. این پرچم‌ها **تنظیماتی‌اند، نه داده‌ای** — به بخش ۶.۳ `rdl-tablix-structure.md` نگاه کن.
- **ساب‌ریپورت (`SalaryListItems.rdl`, یک دیتاست بزرگ `Main` با ۲۱ Tablix تودرتو)**: تمام منطق واقعی این‌جاست — هم محاسبه‌ی مقدار هر عامل، هم تصمیم‌گیری این‌که کدام عامل اصلاً ستون بگیرد.

### پنج دسته‌ی عامل و کد هرکدام (`CompensationFactor.CategoryCode` + یک کد مصنوعی برای تردد)

| نام داخلی در کوئری | `CategoryCode` | پیشوند فیلد در `@Result` | تعداد جای فیزیکی ثابت |
|---|---|---|---|
| کارکردی/تردد (Functional/Attendance) | `0` (مصنوعی؛ در `HCM3.AttendanceFactor` تعریف می‌شود، نه `CompensationFactor`) | `Functional_1`..`Functional_7` | `@AttendanceColumnsCount` (پارامتر، معمولاً ۷) |
| تعهدات کارفرما (BossCommitment) | `3` | `BossCommitment_1`..`_7` | `@BossCommitmentColumnsCount` |
| مزایا (Benefits) | `1` (مطابق `known-database-schema.md`) | `Benefits_1`..`_7` | `@BenefitColumnsCount + 2` ⚠️ آفست ثابتِ خاصِ همین گزارش، تعمیم نده |
| کسورات (Deduction) | `2` (مطابق `known-database-schema.md`) | `Deduction_1`..`_7` | `@DeductionColumnsCount` |
| سایر (Other) | `5` | `Other_1`..`_7` | `@OtherColumnsCount` |

⚠️ کدهای `3` (BossCommitment) و `5` (Other) اولین‌بار در همین گزارش کشف شدند و به `known-database-schema.md` اضافه شدند. عنوان فارسی دقیق این دو دسته هنوز از روی داده‌ی واقعی/glossary تأیید نشده — فقط نام داخلی انگلیسیِ به‌کاررفته در کوئری مستند است.

### مکانیزم ستون پویا در این گزارش (خلاصه — جزئیات کامل در دو مرجع بالا)

۱. یک `@TitleCTEResult` تمام «جای‌های ستونِ ممکن» را از `HCM3.FactorViewSetting(Compensation|Attendance)` می‌خواند، ولی با یک `LEFT JOIN ... AND CompensationFactorID IN (SELECT ... FROM HCM3.PayCalcItem WHERE IssueYearMonth = @YearMonth AND Value <> 0 AND EmployeeRef IN (@Employee))` فقط عامل‌هایی را نگه می‌دارد که **حداقل یکی از کارمندهای همین گزارش، همین ماه، مقدار غیرصفر دارد** (برای تردد، همین کار با `HCM3.AttendanceCalcMonthlyItem` تکرار می‌شود).
۲. همان کوئری با `ROW_NUMBER() ... % ColumnsCount` جای‌های باقی‌مانده را به ۷ ستون فیزیکی نگاشت می‌کند؛ اگر عامل‌های دارای‌داده بیش از ۷ تا باشند، `RowIndex` چند «بلوک» عنوان/مقدار اضافه می‌سازد (سرریز).
۳. سمت RDL، هر یک از ۷ ستون فیزیکی یک `Hidden` زنجیره‌ای دارد که هم `ColumnsCount` (ساختاری) و هم `FactorsCount` همان ردیف (داده‌ای) را چک می‌کند.
۴. جدا از این، خودِ ردیف عنوان اگر هر ۷ جایش خالی باشد (بلوک اضافیِ بی‌مصرف) کامل مخفی می‌شود.

### نکات پیاده‌سازی خاص این گزارش (برای هر تغییر آینده)

- توابع قالب‌بندی تازه‌کشف‌شده: `HCM3.fnFormatCompensationFactorValue(RealValue, MeasurementUnitCode, @Sys_CurrentCulture, NULL)` و `HCM3.fnFormatAttendanceFactorValue(...)` — مشابه توابع فرمت شناخته‌شده‌ی قبلی، برای این دو دسته عامل عیناً از این‌ها استفاده کن.
- `[Type]` در `@Result` چهار مقدار می‌گیرد: `'FactorsTitle'` (ردیف عنوان)، `'FactorsValue'` (ردیف کارمند)، `'FactorsValue_GroupSum'` (جمع گروه)، `'FactorsValue_TotalSum'` (جمع کل) — همه از همان ۷ ستون فیزیکی به‌ترتیب عبور می‌کنند؛ یعنی مثلاً `Functional_1` در یک ردیف عنوان است و در ردیف دیگر مقدار.
- سبک نوشتن عبارات RDL در این گزارش یکدست نیست: بعضی بلوک‌ها (`Functional`, `Benefits`, `Deduction`, `Other`) از فرم کوتاه `IIf`/`IsNothing` استفاده می‌کنند و بلوک `BossCommitment` از فرم کامل `Microsoft.VisualBasic.Interaction.IIf`/`Microsoft.VisualBasic.Information.IsNothing` — هر دو معتبرند؛ وقتی سلولی را کپی می‌کنی، **فرم همان سلول منبع را عیناً حفظ کن**، آن را «یکدست» نکن.
- گروه‌بندی کارمندها با `@GroupType` قابل تنظیم است (۰=بدون گروه، ۱=نوع استخدام، ۲=محل خدمت، ۳=مرکز هزینه/DL، ۴=دپارتمان، ۵=شعبه) — هنوز به‌طور کامل کاوش نشده، اگر گزارش مشابهی با گروه‌بندی متفاوت خواستند همین‌جا شروع کن.

