# نقشه‌ی شناخته‌شده‌ی دیتابیس کاربر (HCM3 / GNR3)

این فایل خلاصه‌ی تمام چیزهایی است که تا الان — از طریق کوئری‌های تشخیصی واقعی روی دیتابیس کاربر —
درباره‌ی ساختار جداول او فهمیده‌ایم. **قبل از پرسیدن هر سؤالی از کاربر یا ساختن هر اسکریپت تشخیصی
در مرحله‌ی ۰، اول این فایل را چک کن** — اگر جدول موردنیاز اینجا مستند شده، دوباره نپرس، مستقیم استفاده
کن. فقط برای جدول‌ها/ستون‌هایی که اینجا نیستند وارد فاز کشف شو.

این یک سند زنده است — هر بار که چیز جدیدی درباره‌ی دیتابیس این کاربر کشف شد (چه با کوئری تشخیصی،
چه با نمونه‌ی داده‌ی جدید)، همین فایل را به‌روزرسانی کن تا دفعه‌ی بعد از صفر شروع نشود.

## واژه‌نامه فارسی رسمی (جدید)

کاربر سه فایل رسمی از خودِ نرم‌افزار داد: عنوان فارسی ۱۵۶ جدول HCM3، فهرست کامل ۱۹۶۸ موجودیت
تعریف‌شده در کل نرم‌افزار (همه‌ی ماژول‌ها)، و ۳۳۲۷ مقدار فارسی Lookup/Enum در ۸ schema. این‌ها در
`references/glossary/*.csv` ذخیره شده‌اند — راهنمای کامل استفاده در `references/persian-glossary.md`
است. همیشه قبل از حدس زدن عنوان فارسی یک جدول/enum ناآشنا، اول آن‌جا را بگرد.

## شِمای دیتابیس

دو schema اصلی: `hcm3` (منابع انسانی / تردد) و `gnr3` (عمومی، شامل اطلاعات پرسنلی/Party).

## جدول‌های تردد خام

### `hcm3.AttendanceData` — رکوردهای خام تردد (هر ضربه‌ی دستگاه)
| ستون | نوع | نکته |
|---|---|---|
| AttendanceDataID | bigint identity | PK |
| EmployeeRef | bigint | FK به کارمند |
| AttendanceDateTime | datetime | زمان دقیق تردد |
| **Entrance** | bit, **nullable** | **۱=ورود، ۰=خروج، ولی ممکن است NULL باشد.** اولویت تشخیص نوع تردد: اول از این فلگ استفاده کن، فقط برای ردیف‌های NULL به ترتیب فرد/زوجِ زمانی fallback کن (الگوی کامل در `sql-patterns.md` بخش ۲.۱). (هم‌راستا با enum جدید `HCM3.AttendanceDataEntrance` در `glossary/lookup-values.csv`: «ورود»/«خروج» — این enum جدا برای UI است، فقط جهت را تأیید می‌کند، نه خودِ کد bit را.) |
| **AttendanceStatusRef** | int | ✅ **تأیید شده با `SELECT * FROM hcm3.AttendanceStatus` (جدول Lookup واقعی، ۱۷ ردیف) — این ستون نوع رکورد را دقیق مشخص می‌کند:** `1`=«عدم حضور»، **`2`=«حضور»** (تنها کدی که واقعاً به معنای حضور فیزیکی است)، `3`=«ماموریت ساعتی»، `4`=«ماموریت روزانه»، `5`=«ماموریت روزانه بدون توقف»، `6`=«مرخصی استحقاقی»، `7`=«مرخصی استعلاجی»، `8`=«مرخصی ازدواج»، `9`=«مرخصی فوت بستگان»، `10`=«مرخصی تولد فرزند»، `11`=«مرخصی بیماری»، `12`=«مرخصی بدون حقوق»، `13`=«مرخصی اهدایی»، `14`=«مجوز اضافه‌کاری»، `15`=«ماموریت روزانه خارج از شهر»، `17`=«ماموریت روزانه داخل شهر»، `18`=«ماموریت خارج از کشور» (کدهای ۱۶ نیست، جدول ۱۷ ردیف دارد نه ۱۸). ستون `TypeCode` همین جدول این‌ها را در ۴ گروه دسته می‌کند: `1`=تردد(عدم‌حضور/حضور)، `2`=مرخصی، `3`=ماموریت، `4`=مجوز. **برای گزارش «تردد روزانه» (فقط ساعت‌های حضور واقعی)، فیلتر `AttendanceStatusRef = 2` هم لازم و هم کافی است** — رکوردهای مرخصی/ماموریت هم اگرچه `Enabled=1` دارند (چون خودشان رکورد معتبرند، فقط نوع‌شان حضور نیست)، با این فیلتر به‌درستی کنار گذاشته می‌شوند. |
| **Enabled** | bit | ✅ ستون **جداگانه و مکمل** `AttendanceStatusRef` است، نه جایگزین آن — معیار «این رکورد باطل نشده» است (نه معیار «این رکورد حضور است»). وقتی یک تردد خام از UI اصلاح می‌شود، رکورد خامِ اصلی معمولاً `Enabled = 0` می‌شود (باطل ولی برای حسابرسی حذف نمی‌شود) و رکورد(های) جدید با `Enabled = 1` جایگزین آن می‌شوند. **هر دو شرط با هم لازم‌اند:** `WHERE Enabled = 1 AND AttendanceStatusRef = 2`. |
| RfidSiteCode, RfidGateCode | int | محل/دروازه‌ی دستگاه (رکوردهای دستی‌ست‌شده معمولاً NULL دارند چون از دستگاه نیامده‌اند) |
| سایر (RemoteLogID, IsCalculationResult, Version, Creation/LastModification...) | — | `RemoteLogID` برای رکورد خامِ دستگاه پر است، برای رکورد دستی‌ساخته NULL. `Version` = rowversion، برای انتخاب «آخرین نسخه» در صورت تای زمانی مفید است. |

**⚠️ تاریخچه‌ی رفع باگ گزارش «تردد روزانه کارمند» (سه دور، همه در `report-catalog.md` با جزئیات کامل):**
1. **باگ اول:** کوئری اصلی فیلتر `Enabled` نداشت، پس رکوردهای باطل‌شده (Enabled=0) بعد از اصلاح دستی هنوز وارد شمارش فرد/زوج می‌شدند و آن را به‌هم می‌ریختند. تشخیص ورود/خروج هم فقط با فرد/زوجِ ترتیب زمانی بود، نه ستون `Entrance`.
2. **باگ دوم (اشتباهِ من در دور اول رفع):** برای رفع باگ اول، فیلتر `AttendanceStatusRef = 2` هم کلاً برداشته شد چون تصور می‌شد رکوردهای معتبرِ اصلاح‌شده می‌توانند `status=6` هم داشته باشند — **این فرض غلط بود.** بدون این فیلتر، رکوردهای مرزِ مرخصی (که آن‌ها هم `Enabled=1` دارند چون خودشان معتبرند) به‌عنوان ورود/خروجِ حضور نمایش داده می‌شدند.
3. **باگ سوم / رفع نهایی:** با `SELECT * FROM hcm3.AttendanceStatus` مشخص شد `AttendanceStatusRef` دقیقاً نوع رکورد را می‌گوید (جدول بالا). فیلتر درست و نهایی: **`Enabled = 1 AND AttendanceStatusRef = 2`** — هر دو با هم، نه فقط یکی. جدول‌های واسط `HCM3.LeaveRequestAttendanceData` / `MissionDocumentAttendanceData` / `AttendancePermissionAttendanceData` برای پیدا کردن این باگ مفید بودند (نشان دادند کدام AttendanceDataID مرزِ مرخصی است) ولی در کوئری نهایی لازم نیستند، چون `AttendanceStatusRef = 2` همان نتیجه را ساده‌تر و دقیق‌تر می‌دهد.

**درسِ کلی:** برای هر ستونِ کد/وضعیت مثل این، **همیشه محتوای واقعیِ جدول Lookup را با `SELECT *` بگیر و عنوان فارسی را ببین** — حدس زدن بر اساس این‌که «یک رکورد Enabled=1 است پس باید معتبر/نمایش‌دادنی باشد» کافی نیست، چون Enabled فقط «باطل نشده» را می‌گوید، نه «حضور واقعی» را.

**ریسک باقی‌مانده (هنوز اثبات‌نشده، اگر کاربر گزارش کرد دوباره با نمونه‌ی واقعی بررسی شود، نه با حدس):** اگر یک روز رکوردهای `Enabled=1 AND AttendanceStatusRef=2` هم‌زمان با مقادیر `Entrance` متناقض داشته باشند، یا واقعاً بیش از ۳ ورود/۳ خروج جداگانه در یک روز ثبت شود، نتیجه ممکن است کاملاً شهودی نباشد. همچنین اگر در آینده وضعیت جدیدی هم به‌عنوان «حضور واقعی» تعریف شد (`AttendanceStatusRef` غیر از ۲)، باید دوباره جدول Lookup چک شود، نه فرض.

### شیفت و تقویم کاری (برای تشخیص این‌که یک تردد به کدام «روز شیفت» تعلق دارد)
- `hcm3.WorkingGroupEmployee` — عضویت کارمند در گروه کاری؛ چون می‌تواند چندین رکورد تاریخی داشته باشد، همیشه با `ROW_NUMBER() OVER (PARTITION BY EmployeeRef ORDER BY JoinDate DESC)` آخرین را بگیر.
- `hcm3.WorkingCalendar` → `hcm3.WorkingCalendarDay` → `hcm3.WorkingShiftDay` — زنجیره‌ی تعریف شیفت هر روز تقویم. ستون‌های کلیدی `WorkingShiftDay.StartTime` / `EndTime` / `ExtraMinutesBefore` بر حسب **دقیقه از نیمه‌شب** هستند.
- پنجره‌ی زمانی یک «روز شیفت» برای بستن تردد‌های خام به آن روز:
  ```sql
  از: DATEADD(MINUTE, ws.StartTime - ws.ExtraMinutesBefore, CAST(wcd.[Date] AS DATETIME))
  تا: DATEADD(MINUTE, ws.StartTime - ws.ExtraMinutesBefore + 1440, CAST(wcd.[Date] AS DATETIME))
  ```
- `hcm3.SpecialDay` — عنوان روزهای خاص/تعطیل رسمی (JOIN از طریق `WorkingCalendarDay.SpecialDayRef`).

## جدول‌های محاسبه‌ی عوامل تردد (روزانه و ماهانه)

- `hcm3.AttendanceFactor` — تعریف عامل‌ها. ستون‌های کلیدی: `AttendanceFactorID`, `Title`, `ScaleCode` (**۱ = روزانه، ۲ = ماهانه**), `MeasurementUnitCode` (**۴ = مقدار به دقیقه ذخیره می‌شود و باید به‌صورت `HH:mm` نمایش داده شود**). تأییدشده با enum رسمی `HCM3.AttendanceMeasurementUnit` در `glossary/lookup-values.csv`: ۱=«عدد»، ۲=«روز»، ۳=«روز-ساعت-دقیقه»، ۴=«ساعت-دقیقه» — این‌جا برخلاف بعضی گروه‌های دیگر، `LookupID`ها پیوسته بودند، پس ترتیب قابل‌اتکاتر است، ولی همچنان طبق قانون طلایی با داده‌ی واقعی هم تأیید شده بود.
- `hcm3.AttendanceCalc` — سربرگ محاسبه‌ی هر کارمند برای یک بازه (`EmployeeRef`, `FromDate`, `ToDate`, `AttendanceCalcID`).
- `hcm3.AttendanceCalcDailyItem` — مقدار هر عامل به تفکیک روز (`Date`, `AttendanceCalcRef`, `AttendanceFactorRef`, `Value`).
- `hcm3.AttendanceCalcMonthlyItem` — مقدار هر عامل به تفکیک کل ماه (`AttendanceCalcRef`, `AttendanceFactorRef`, `Value`).
- ⚠️ **باگ فرمت‌دهی که پیدا و رفع شد:** برای مقادیر `MeasurementUnitCode=4` که ساعت آن‌ها می‌تواند ۳ رقمی یا بیشتر شود (مثل ۱۲۴ ساعت اضافه‌کاری ماهانه)، فرمول قدیمی `RIGHT('0'+CAST(hours),2)` رقم اول ساعت را قطع می‌کرد (`124` → `24`). فرمول درست: فقط وقتی ساعت تک‌رقمی است صفر اضافه کن، وگرنه عدد کامل را نشان بده:
  ```sql
  CASE WHEN ABS(hours) < 10 THEN '0' + CAST(ABS(hours) AS VARCHAR(10)) ELSE CAST(ABS(hours) AS VARCHAR(10)) END
  ```
  دقیقه همیشه ۲ رقمی است (۰۰-۵۹)، پس `RIGHT('0'+CAST(minutes),2)` برای دقیقه همچنان درست است.
- عناوین شناخته‌شده‌ی عامل‌های ماهانه که در گزارش فعلی استفاده شده‌اند: «کارکرد ماهانه» (کارکرد عادی)، «اضافه کار روز تعطیل ماهانه نهایی» (تعطیل)، «مرخصی استحقاقی در ماه»، «مرخصی ساعتی در ماه»، «مرخصی استعلاجی».
- ❌➡️✅ **باگ مهم کشف‌ و رفع‌شده:** در گزارش «تردد روزانه»، مانده‌مرخصی قبلاً مستقیم از `HCM3.LeaveRemainder.Value` خوانده می‌شد — این ستون فقط **مانده‌ی همین لحظه (الان)** است، نه مانده‌ی مربوط به بازه‌ی زمانی گزارش! برای گزارش‌های ماه‌های گذشته عدد اشتباه (مانده‌ی امروز) نشان می‌داد.
  - **منبع درستِ «مانده در یک تاریخ مشخص»**: رویه‌ی ذخیره‌شده `HCM3.uspGetLeaveRemainder(@EmployeeID BIGINT, @LeaveTypeID BIGINT, @Date DATETIME, @MonthTransfer BIT=0, @YearTransfer BIT=0, @LeaveRedeem BIT=0, @ConsiderSpecificEntitlement BIT=0, @SpecificEntitlement INT=0, @Entitlement BIT=0)` — مقدار را با `RETURN` برمی‌گرداند، پس باید با `EXEC @Result = HCM3.uspGetLeaveRemainder @EmployeeID, @LeaveTypeID, @Date` صدا زده شود (نه SELECT ساده). برای «مانده‌ی فعلیِ همان لحظه»، همه‌ی پارامترهای اختیاری را با مقدار پیش‌فرض (۰) بگذار.
  - چون Stored Procedure است (نه تابع inline)، **نمی‌شود در یک JOIN مستقیم صدایش زد** — باید برای هر کارمند جداگانه در یک حلقه/cursor صدا زده شود و نتیجه در یک temp table جمع شود (الگوی پیاده‌سازی در `Montly_PointInTime_LeaveBalance.sql`، تحویل‌شده به کاربر).
  - نمونه‌ی تأییدشده‌ی واقعی: برای کارمند ۳۱، مانده‌ی «همین الان» = ۲۶۷۳ دقیقه، ولی مانده‌ی «تا پایان ۱۴۰۵/۰۳/۳۱» (یک تاریخ گذشته) = ۴۵۳۶ دقیقه — عدد کاملاً متفاوت، دقیقاً همان چیزی که باگ را ثابت کرد.
  - **قاعده‌ی کلی: هر گزارشی که «مانده مرخصی در بازه‌ی X» می‌خواهد، باید `uspGetLeaveRemainder` را با تاریخ پایان همان بازه صدا بزند، نه مستقیم به `LeaveRemainder.Value` وصل شود.** `LeaveRemainder.Value` فقط برای «مانده‌ی همین الان، صرف‌نظر از بازه‌ی گزارش» درست است.
- ⏳ **سؤال قبلاً باز، الان حل‌شده:** «کل کارکرد به ساعت» — کاربر خودش تأیید کرد که این دقیقاً همان عامل `حضور موثر ماهانه` است (نه `کارکرد ماهانه`، نه `موظفی ماهانه`). دیگر لازم نیست این را دوباره بپرسی.
- ⚠️ **کشف مهم‌تر و جدیدتر — این را به‌جای فرض ثابت بالا استفاده کن:** خود دیتابیس یک تابع رسمی برای فرمت‌دهی مانده مرخصی دارد: `HCM3.fnFormatLeaveRemainder(@LeaveTypeID BIGINT, @WorkMinutes INT, @LeaveRemainder INT, @IsLetter BIT) RETURNS NVARCHAR(200)`.
  - با `@IsLetter=1` خروجی می‌دهد: `"5 روز و 04 ساعت و 33 دقیقه"` (بسته به `LeaveType.MeasurementUnitCode`: کد۲=روز/ساعت/دقیقه، کد۱=ساعت/دقیقه، کد۳=فقط روز). با `@IsLetter=0` همان را با کولون می‌دهد (`5:04:33`).
  - **`@WorkMinutes` را نباید عدد ثابت (مثل ۴۸۰) فرض کرد** — از `HCM3.EmploymentTypeItem.WorkMinutes` می‌آید، بر اساس نوع استخدام (`EmployeeStatute.EmploymentTypeRef`) و تاریخ (`EffectiveYearMonth`، آخرین رکورد قبل از تاریخ موردنظر). یعنی برای کارمندان پاره‌وقت یا نوع استخدام دیگر می‌تواند غیر از ۸ ساعت باشد.
  - نمونه‌ی نحوه‌ی گرفتن `WorkMinutes` برای یک کارمند مشخص:
    ```sql
    SELECT TOP 1 eti.WorkMinutes
    FROM HCM3.EmploymentTypeItem eti
    WHERE eti.EmploymentTypeRef = (
        SELECT TOP 1 es.EmploymentTypeRef FROM HCM3.EmployeeStatute es
        WHERE es.EmployeeRef = @EmployeeID AND es.Status >= 5
        ORDER BY es.ApplyDate DESC, es.ConfirmDate DESC, es.EmployeeStatuteID DESC
    )
    ORDER BY eti.EffectiveYearMonth DESC;
    ```
  - **قاعده‌ی کلی: هر وقت خواستی مانده‌مرخصی را به روز/ساعت/دقیقه تبدیل کنی، اول این تابع را صدا بزن، فرمول دستی خودت را نساز** — مگر این‌که تابع پاسخ‌گو نبود (مثلاً برای گزارشی که به این تابع دسترسی ندارد).
  - در گزارش «تردد روزانه کارمند» (`Tablix6`, «مانده مرخصی(روز-ساعت-دقیقه)»)، فعلاً از فرمول دستیِ ۴۸۰-دقیقه‌ی ثابت استفاده شده که کاربر آن را برای یک کارمند تست تأیید کرد — ولی برای کارمندان با `WorkMinutes` متفاوت ممکن است نادرست باشد. **اگر کاربر خواست، این بخش را با فراخوانی `fnFormatLeaveRemainder` جایگزین کن.**
  - در گزارش «کاردکس مرخصی» (`LeaveCardex.rdl`)، فیلدهای `RemainderBeforeDesc`/`RemainderAfterDesc` در دیتاست از قبل دقیقاً همین تابع را با `@IsLetter=1` صدا می‌زنند — نیازی به فرمول جدید نیست، فقط باید سلول موردنظر را به فیلد درست (`RemainderAfterDesc` برای «مانده‌ی بعد از تراکنش»، یا `RemainderBeforeDesc` برای «قبل») وصل کرد.

## جدول‌های مرخصی

- `HCM3.LeaveType` — فقط ۲ ردیف در کل سیستم:
  | LeaveTypeID | Title | MeasurementUnitCode |
  |---|---|---|
  | 1 | مرخصی استحقاقی | 2 |
  | 3 | مرخصی استعلاجی | 3 |
- `HCM3.LeaveRemainder` — **مانده‌ی فعلی مرخصی** هر کارمند به تفکیک نوع مرخصی.
  - **این یک جدول snapshot است، نه لجر تراکنشی** — تأییدشده با نمونه‌ی واقعی: هر کارمند برای هر `LeaveTypeRef` فقط **یک ردیف** دارد (نه تاریخچه‌ی انباشتی). پس فقط `JOIN` مستقیم لازم است، نیازی به `ROW_NUMBER`/گرفتن آخرین رکورد نیست.
  - `Value` به **دقیقه** ذخیره می‌شود (نمونه‌ی تأییدشده: `Value=2673` = `44:33`)، با همان فرمول رفع‌شده‌ی بالا فرمت کن.
  - فلگ‌های `TypeCode`, `IsTemporary`, `IsInactive`, `IsDeployedRemaining`: در کل جدول (۳۵ ردیف کل) همه دقیقاً یک ترکیب داشتند (`TypeCode=2, IsTemporary=0, IsInactive=0, IsDeployedRemaining=0`) — یعنی این فلگ‌ها فعلاً در این استقرار چیزی را تفکیک نمی‌کنند؛ نیازی به فیلتر رویشان نیست، فقط `LeaveTypeRef` را فیلتر کن.
  - «مانده مرخصی» که در گزارش نمایش داده می‌شود مشخصاً همان `LeaveTypeRef = 1` (مرخصی استحقاقی) است.
- `HCM3.LeaveRemainderHistory` — نسخه‌ی تاریخچه/لاگ همان جدول؛ ساختار مستند شده ولی هنوز در هیچ گزارشی استفاده نشده.

## جدول‌های پرسنلی

- `hcm3.Employee` (`EmployeeID`, `PartyRef`) → `gnr3.Party` (`PartyID`, `FullName`) برای نام کامل کارمند.

## کدهای کارمند تست شناخته‌شده

- `EmployeeRef = 140208` — استفاده‌شده در تست‌های تردد روزانه/ماهانه (رسول مفرحی، کد نمایشی در گزارش‌های قبلی `140228` هم دیده شده — این دو را با کاربر چک کن، ممکن است اشتباه تایپی در مکالمه بوده باشد نه در دیتابیس).
- `EmployeeRef = 31` — دارای رکورد واقعی در `LeaveRemainder` (زمانی که `140208` رکورد مرخصی نداشت).

## نقشه‌ی کامل ماژول HCM3 (کشف‌شده از اسکن کل دیتابیس)

`HCM3` در کل ۴۶۱ جدول دارد (خیلی بیشتر از چیزی که تا الان در گزارش‌ها لمس کرده‌ایم). با اسکن کامل مشخص شد:

- **جدول مرکزی هویت: `HCM3.Employee`** — مستقیماً توسط **۱۰۲ جدول دیگر** در HCM3 رفرنس می‌شود (از طریق ستون‌هایی مثل `EmployeeRef`, `ConfirmerRef`, `AuditorRef`, ...). هر وقت گزارش جدیدی نیاز به اطلاعات کارمند داشت، اول این جدول و FKهای مستقیمش را بررسی کن، نه این‌که فرض کنی جدول جدید لازم است.
- فقط **۱۳۰ جدول از ۴۶۱ جدول HCM3 واقعاً داده دارند** (بقیه خالی‌اند — یعنی یا استفاده نمی‌شوند یا ماژول‌های فرعی غیرفعال). این ۱۳۰ تا به‌ترتیب گروه کارکردی:

  **تردد (Attendance)** — کاملاً شناخته‌شده و مستند (بخش «جدول‌های تردد خام» بالا): `AttendanceData` (2854 ردیف), `AttendanceCalcDailyItem` (1352), `AttendanceCalcMonthlyItem` (612), `AttendanceFactor` (265), `WorkingCalendarDay` (1825), `RfidTrafficLog` (2049) و چند جدول تنظیمات نمایش (`AttendanceViewConfiguration*`, `FactorViewSetting*`).

  **مرخصی (Leave)** — مستند شده (`LeaveRemainder`, `LeaveType`)، بعلاوه **کشف جدید**: `LeaveRequest` (119 ردیف) + `LeaveRequestItem` (119) + `LeaveRequestAttendanceData` (120) — یعنی یک گردش‌کار درخواست مرخصی با **چند سطح تأیید** وجود دارد (ستون‌های `SubstituteRef`, `FirstConfirmerRef`, `SecondConfirmerRef`, `ThirdConfirmerRef`, `ConfirmerRef` در `LeaveRequest`). این جدول‌ها هنوز در هیچ گزارشی استفاده نشده‌اند — اگر درخواست گزارشی درباره‌ی «وضعیت درخواست مرخصی» یا «تأییدکننده‌ی مرخصی» آمد، این‌جا شروع کن (با اجرای Stage 0 کامل روی `LeaveRequest`/`LeaveRequestItem` چون هنوز ساختار ستونی و نمونه‌ی داده‌شان گرفته نشده).

  **حقوق و دستمزد (Payroll)** — **کاملاً کاوش‌نشده ولی به‌شدت فعال است**: `PayCalcItem` با **۱۰,۰۵۱ ردیف** (پرحجم‌ترین جدول HCM3!)، `PayCalc` (383)، `EmployeeStatuteFactor` (4166)، `StatuteTypeFactor` (1344)، `WGSalaryReceipt`, `PYSalaryReceipt`, `TaxTableItem`, `CompensationTax/Insurance/Factor`. اگر کاربر گزارش فیش حقوقی یا محاسبه‌ی حقوق خواست، این خوشه را با Stage 0 کامل (ساختار ستون + نمونه) کاوش کن — هنوز هیچ‌کدام مستند نشده‌اند.

  **احکام کارگزینی (Statute/HR decrees)**: `EmployeeStatute` (207), `EmployeeStatuteFactor` (4166), `EmployeeStatuteStateHistory` (705), `CorrectiveEmployeeStatute`, `BatchEmployeeStatute` — گردش‌کار صدور/اصلاح حکم کارگزینی با تأییدکننده (`ConfirmerRef`, `PaymentConfirmerRef`). کاوش‌نشده.

  **اطلاعات پایه‌ی کارمند**: `Employee` (143 ردیف — یعنی این شرکت ~۱۴۳ کارمند دارد)، `EmployeeMarriage` (144)، `EmployeeRfidCard` (127)، `EmployeeRelatedOrganization` (60)، `EmployeeRelatedDL` (35)، `EmployeeEducation`, `EmployeeContractInfo`. کاوش‌نشده.

  **بیومتریک/RFID**: `RfidTrafficLog` (2049 — لاگ خام دستگاه‌ها، شاید همان منبع `AttendanceData` یا مکمل آن)، `RfidCard` (126)، `RfidMessage`/`RfidResponse`، `RfidDeviceAccess`. کاوش‌نشده — می‌تواند برای عیب‌یابی مشکلات دستگاه حضور و غیاب مفید باشد.

  **مأموریت (Mission/Business trip)**: `MissionDocument` (40), `MissionDocumentAttendanceData` (128), `BatchMissionDocument` — گردش‌کار مأموریت با `OfficialConfirmerEmployeeRef` و `FinancialConfirmerEmployeeRef` جدا. کاوش‌نشده.

  **ساختار سازمانی**: `Department` (فقط ۱۰ ردیف)، `Post` (49 — پست سازمانی)، `Job` (98)، `Organization` (5)، `OrganizationBranch` (3) — شرکت کوچک/متوسط با ساختار سازمانی ساده. کاوش‌نشده ولی برای هر گزارشی که نیاز به «واحد سازمانی» یا «عنوان شغلی» کارمند دارد، نقطه‌ی شروع اینجاست.

  **وام (Loan)**: `LoanPayment` (13), `LoanInstalment` (57), `LoanType`. کاوش‌نشده.

  **آموزش و ارزیابی عملکرد**: `Course*`, `TrainingFactorData*`, `EmployeeAppraisal`, `PerformanceAgreement`, `TargetGroupExecutive*` — همه در جدول اول (فهرست کامل) دیده شدند ولی در اسکن نمونه‌ی داده (۴۱۳ جدول) نیامدند، یعنی احتمالاً یا خالی‌اند یا کم‌استفاده. کاوش‌نشده.

⚠️ **نکته‌ی مهم:** موارد بالا فقط **فهرست و حدس نقش هر جدول بر مبنای اسم** است، نه ساختار ستونی تأییدشده. قبل از نوشتن هر کوئری روی این جدول‌ها، حتماً Stage 0 کامل (ساختار ستون + نمونه‌ی ۲۰-۵۰ ردیف + توزیع فلگ‌ها) را اجرا کن — دقیقاً همان‌طور که برای `AttendanceData`/`LeaveRemainder` انجام شد. هیچ‌کدام از این‌ها را «شناخته‌شده و آماده‌ی استفاده» حساب نکن.

## سایر ماژول‌های دیتابیس (خارج از HCM3)

دیتابیس در کل ۳۷ schema دارد (مالی `FIN3`، فروش `SLS3`، انبار/لجستیک `LGS3`، تدارکات `PRC3`، دارایی ثابت `FAM3` و غیره) که هیچ‌کدام هنوز کاوش نشده‌اند. فهرست کامل و راهنمای کاوش هرکدام در `references/database-module-map.md` است — قبل از هر کار روی این ماژول‌ها آن‌جا را ببین.

## توابع کمکی دیتابیس (استفاده مجدد کن، از نو نساز)

- `HCM3.fnFormatLeaveRemainder(@LeaveTypeID, @WorkMinutes, @LeaveRemainder, @IsLetter)` — فرمت‌دهی مانده مرخصی (جزئیات کامل در بخش «مرخصی» بالا).
- `SYS3.fnPadLeft(@Value, @Length, @PadChar)` — صفرچین کردن چپ یک عدد (جایگزین امن‌تر از `RIGHT('0'+CAST(...))` که قبلاً باگ داشت — احتمالاً همین تابع، اگر همه‌جا از آن استفاده شود، آن باگ را هم نداشت).
- `SYS3.fnGetPersianYearMonth(@Date)` — تبدیل تاریخ میلادی به عدد سال‌ماه شمسی (مثل ۱۴۰۵۰۲).
- `SYS3.fnGetDateFromPersianDate(@Year, @Month, @Day)` — تبدیل تاریخ شمسی به میلادی.
- `HCM3.fnGetEmploymentNumberConfiguration(@CurrentCulture)` — تنظیمات نمایش شماره پرسنلی (استفاده‌شده در `LeaveCardex.rdl`).

قبل از نوشتن هر منطق تبدیل تاریخ/فرمت‌دهی جدید، اول بگرد ببین تابع آماده‌ای در `SYS3`/`HCM3` برایش هست یا نه (با `sp_helptext` یا `OBJECT_DEFINITION` مثل کاری که برای `fnFormatLeaveRemainder` کردیم) — سیستم این کاربر توابع کمکی زیادی از قبل دارد که استفاده از آن‌ها هم دقیق‌تر است هم کمتر باگ می‌آورد.

## نکات RDL خاص این گزارش

- فایل اصلی: «گزارش تردد روزانه کارمند» — یک `Tablix1` اصلی (لیست روزانه‌ی تردد، RTL، تا ۳ زوج ورود/خروج در روز) + چهار جدول خلاصه‌ی ۲ستونه در پایین (`Tablix3`=کارکرد، `Tablix5`=مرخصی، `Tablix6`=مأموریت+مانده‌مرخصی‌روزساعت‌دقیقه، `Tablix4`=اضافه‌کاری/غیبت/کسرکار/جمعه‌کاری) + یک `Tablix2` بزرگ‌تر (۱۲ ستون) که ساختارش هنوز کامل کاوش نشده.
- **فایل دوم: `LeaveCardex.rdl`** — گزارش کاردکس (ریز تراکنش‌های) مرخصی هر کارمند. سه دیتاست: `DataSet1` (کوئری اصلی، خروجی یک رویه‌ی محاسباتی پیچیده با `#TempLeaveCardex`، شامل `RemainderBefore/After` خام‌فرمت‌شده و نسخه‌ی حرفی‌شان `RemainderBeforeDesc/AfterDesc` که هر دو از تابع `HCM3.fnFormatLeaveRemainder` می‌آیند)، `EmpDataSet` (اطلاعات هدر کارمند: کد، نام، نوع استخدام، واحد سازمانی)، `EmploymentNumber` (تنظیمات نمایش شماره پرسنلی). ستون «مانده» این گزارش به `RemainderAfterDesc` وصل شد (فرض: مانده‌ی *بعد* از هر تراکنش، مثل ستون مانده در صورتحساب بانکی — اگر اشتباه بود، `RemainderBeforeDesc` جایگزینش کن).
- کاربر خودش گزارش را در Report Builder ویرایش می‌کند (مثلاً افزودن ستون جدید به `Tablix1`) — یعنی **همیشه قبل از هر ویرایش، تعداد واقعی ستون/ردیف را از فایل تازه‌آپلودشده بشمار، به شماره‌ی قبلی در این مکالمه یا این فایل اعتماد نکن.**
- بعد از افزودن/حذف ستون در `Tablix1`، `ReportSection/Width` باید دستی با مجموع جدید عرض ستون‌ها هم‌خوان شود (RDL این را خودکار انجام نمی‌دهد).

---

# 🆕 کشف دوم — ماژول حقوق و دستمزد (از دل `SalaryReceiptItemA5.rdl`، تیر ۱۴۰۵)

> منبع: کوئری‌های چهار DataSet گزارش فیش حقوقی A5 (که **کد تولیدیِ خودِ نرم‌افزار** است،
> پس منطق تجاری‌اش قابل‌اعتمادتر از حدس ماست).
> ⚠️ ساختار ستونی خام این جدول‌ها از قبل در `references/schemas/HCM3.md` هست؛
> آنچه این‌جا اضافه می‌شود **معنای تجاری** است، نه ساختار.

## هسته‌ی محاسبه‌ی حقوق

### `HCM3.PayCalc` — سربرگ محاسبه‌ی حقوق (هر کارمند × هر ماه صدور)
- `PayCalcID` (PK) · `EmployeeRef` → `HCM3.Employee` · `IssueYearMonth` (INT، سال‌ماه شمسی مثل `140502`)
- یعنی: «فیش حقوقی صادرشده در ماه X برای کارمند Y».

### `HCM3.PayCalcItem` (~۱۰٬۰۵۱ ردیف) — ریز عوامل هر فیش
- `PayCalcRef` → `PayCalc.PayCalcID` · `CompensationFactorRef` → `CompensationFactor` · `[Value]` (مبلغ)
- **`ApplyYearMonth`** — ماهی که این قلم **به آن تعلق دارد**؛ ممکن است با `PayCalc.IssueYearMonth` فرق کند.
  اختلاف این دو = **معوقه**. کل منطق فیلترهای پیچیده‌ی گزارش روی همین اختلاف بنا شده.

### `HCM3.CompensationFactor` (~۱۸۷ ردیف) — تعریف «عامل حقوقی»
سه ستون طبقه‌بندی که **معنایشان از کوئری خودِ نرم‌افزار استخراج شد**:

| ستون | مقدار | معنی (اثبات‌شده از کد نرم‌افزار) |
|---|---|---|
| `CategoryCode` | `1` | **مزایا / پرداختی** (`PaymentSum`) |
| `CategoryCode` | `2` | **کسورات** (`DeductionSum`) |
| `CategoryCode` | `3` | **تعهدات کارفرما** (نام داخلی در کوئری: `BossCommitment`) — کشف‌شده در `SalaryListItems.rdl`، عنوان فارسی دقیق هنوز از glossary/داده‌ی واقعی تأیید نشده |
| `CategoryCode` | `5` | **سایر** (نام داخلی در کوئری: `Other`) — کشف‌شده در `SalaryListItems.rdl`، عنوان فارسی دقیق هنوز تأیید نشده |
| `FinalResult` | `1` | همان عاملی که **«خالص پرداختی»** است؛ عنوانش در `Title` و مبلغش `NetPay` |
| `CompensationCalcTypeRef` | `1` | نوع محاسبه‌ای که فیش حقوقی روی آن بنا شده — **همه‌ی کوئری‌های فیش این فیلتر را دارند** |

⚠️ `CompensationCalcTypeRef` مقادیر دیگری هم دارد (کاوش‌نشده). اگر عددهایت با نرم‌افزار
نخواند، اولین چیزی که باید چک کنی این است که فیلتر `= 1` را جا نینداخته باشی.

⚠️ `CategoryCode = 4` هنوز دیده نشده در هیچ گزارشی — یا دسته‌ای‌ست که در این پروژه استفاده نمی‌شود یا هنوز کشف نشده.

توابع فرمت‌دهی این دو خانواده عامل (تازه‌کشف‌شده، در `SalaryListItems.rdl`):
- `HCM3.fnFormatCompensationFactorValue(RealValue, MeasurementUnitCode, @Sys_CurrentCulture, NULL)` — برای عوامل حقوقی (`CompensationFactor`).
- `HCM3.fnFormatAttendanceFactorValue(RealValue, MeasurementUnitCode, @Sys_CurrentCulture, NULL)` — برای عوامل تردد (`AttendanceFactor`)، مشابه امضای بالا.

### الگوی «معوقه» — سه پارامتر بولی × مقایسه‌ی `IssueYearMonth` با `ApplyYearMonth`

گزارش سه پارامتر بولی مستقل دارد: `@Current`, `@DeferredToCurrentYear`, `@DeferredToPreviousYear`.
منطقشان (بازنویسیِ خوانای هشت شرط `NOT(...) OR ...` موجود در کوئری):

| Current | DefCurYear | DefPrevYear | شرط اعمال‌شده |
|---|---|---|---|
| ۱ | ۰ | ۰ | `Issue = Apply` (فقط جاری) |
| ۰ | ۱ | ۰ | `Issue > Apply` **و** `Apply/100 = Issue/100` (معوقه‌ی همین سال) |
| ۰ | ۰ | ۱ | `Issue > Apply` **و** `Apply/100 < Issue/100` (معوقه‌ی سال‌های قبل) |
| ۱ | ۱ | ۰ | `Issue >= Apply` **و** `Apply/100 = Issue/100` |
| ۱ | ۰ | ۱ | `(Issue > Apply و Apply/100 < Issue/100)` یا `Issue = Apply` |
| ۰ | ۱ | ۱ | `Issue > Apply` |
| ۱ | ۱ | ۱ | `Issue >= Apply` |

به‌علاوه: **`@DisplayType = 3`** یعنی «نمایش بر اساس ماه اعمال» → شرط اضافی `PCI.ApplyYearMonth = @ApplyYearMonth`
و در دیتاست `Header` هم `@EffYearMonth` به‌جای `@IssueYearMonth` برابر `@ApplyYearMonth` می‌شود.

**اگر گزارش حقوقی جدیدی می‌سازی، این الگو را از نو اختراع نکن — عیناً از این گزارش کپی کن.**

### `HCM3.FactorViewSetting` (~۳۸ ردیف) + `FactorViewSettingCompensation` (~۷۴۹) + `FactorViewSettingAttendance` (~۱۲۶) + `FactorViewSettingType` (~۱۸)
«قالب نمایش عوامل» — همان چیزی که کاربران این نرم‌افزار **«تنظیمات نمایش گزارش» یا «tableview»** می‌نامند؛ تعیین می‌کند در فیش/گزارش کدام عوامل و با چه ترتیبی *ممکن است* دیده شوند (سقف تنظیماتی، نه لزوماً آنچه واقعاً با داده‌ی فعلی نمایش داده می‌شود — به تفاوت این دو لایه در `rdl-tablix-structure.md` بخش ۶.۳ نگاه کن).
گزارش با `@FactorViewSettingID` فیلتر می‌شود و `fws.Definition` را برمی‌گرداند (احتمالاً JSON/XML تنظیمات — کاوش‌نشده).

مسیر Join تأییدشده (از `SalaryList.rdl`/`SalaryListItems.rdl`):
`FactorViewSettingType` (`FactorViewSettingTypeID`) ← `FactorViewSetting.FactorViewSettingTypeRef` ← (`FactorViewSettingCompensation.FactorViewSettingRef` یا `FactorViewSettingAttendance.FactorViewSettingRef`) → به‌ترتیب به `CompensationFactor`/`AttendanceFactor` وصل می‌شود، با ستون `[Order]` برای ترتیب نمایش.
**`FactorViewSettingType.FactorViewSettingTypeID = 5`** = قالب نمایش مخصوص گزارش «لیست حقوق کارمندان» (`SalaryList`) — کد شناخته‌شده و تأییدشده؛ اگر گزارش لیست حقوق مشابهی ساختی و باید فقط تعریف‌های همین نوع قالب را ببیند، همین فیلتر را تکرار کن (مقادیر دیگر `FactorViewSettingTypeID` هنوز کاوش‌نشده).

**الگوی ستون پویا (مخفی کردن ستون بدون داده)** — دقیقاً همین جدول‌ها پایه‌ی آن هستند؛ شرح کامل مکانیزم SQL در `sql-patterns.md` بخش ۳ و نمونه‌ی کامل در `report-catalog.md` بخش ۵.

## وام

- `HCM3.LoanPayment` — پرداخت وام به کارمند (`LoanPaymentID`, `EmployeeRef`)
- `HCM3.LoanInstalment` (~۵۷ ردیف) — اقساط (`LoanPaymentRef`, `Amount`, `PaymentYearMonth`, **`PaymentMethodCode`**)
- **`PaymentMethodCode = 0` → قسطی که از حقوق کسر می‌شود** (تنها حالتی که در فیش می‌آید).
- جمع اقساط ماه فقط وقتی نمایش داده می‌شود که `@Current = 1`.

## اطلاعات هویتی/سازمانی کارمند (همه **مؤثر بر تاریخ** = effective-dated)

الگوی مشترک همه‌ی این‌ها: `LEFT JOIN` + زیرکوئری `TOP 1 … ORDER BY <EffectiveDate|ApplyDate> DESC`
با شرط `sys3.fnGetPersianYearMonth(<date>) <= @IssueYearMonth`.
**هرگز بدون این الگو مستقیم join نزن، وگرنه رکورد قدیمی یا چند ردیف می‌گیری.**

| جدول | نقش | کلید انتخاب نسخه |
|---|---|---|
| `HCM3.EmployeeEmploymentNumber` | شماره‌ی استخدامی (`Number`) | `EffectiveDate` |
| `HCM3.EmployeeStatute` | حکم کارگزینی → `DepartmentRef`, `PostRef`, `JobRef`, `WorkLocationCode`, `EmploymentTypeRef` | `ApplyDate`, سپس `ConfirmDate`, سپس `EmployeeStatuteID` — **با شرط `Status >= 5`** |
| `HCM3.EmployeeBranchInfo` | شعبه (`BranchRef` → `GNR3.Branch`) | `EffectiveDate` |
| `HCM3.EmployeeRelatedDL` (~۳۵) | **مرکز هزینه** (`DLCode` → `FIN3.DL`) | `EffectiveDate` |
| `HCM3.EmployeePaymentLocation` | **شماره حساب بانکی** (`AccountNumber`)، اختیاری per-factor | `EffectiveYearMonth` DESC، سپس `CompensationFactorRef` DESC |

⚠️ **`EmployeeStatute.Status >= 5`** = حکم تأییدشده/جاری. در دو جای مستقل گزارش تکرار شده،
پس قابل‌اعتماد است. (مقادیر دقیق enum هنوز کاوش‌نشده — با `discover_views_sps_enums.sql` قابل اثبات است.)

### پل مرکز هزینه به ماژول مالی (`FIN3`)
مرکز هزینه در `FIN3` به‌صورت **DL (تفصیلی)** نگهداری می‌شود:

```sql
DECLARE @CostCenterEntityCode INT = (
  SELECT TOP 1 Code FROM SYS3.EntityLookup
  WHERE EntityName = 'SystemGroup.General.CostCenterManagement,CostCenter');
-- سپس:
-- HCM3.EmployeeRelatedDL.DLCode → FIN3.DL.Code
-- FIN3.DL.DLTypeRef → FIN3.DLType.DLTypeID  با شرط  DLType.EntityCode = @CostCenterEntityCode
-- نمایش: DL.Title + ' ' + DL.Code
```

**`SYS3.EntityLookup(EntityName, Code)`** = نگاشت نام کلاس دات‌نتِ یک موجودیت به کد عددی‌اش.
هر جا نیاز داشتی یک `DLType` را به یک ماژول وصل کنی، از همین الگو استفاده کن — عدد را hard-code نکن.

## توابع و رویه‌های تازه‌کشف‌شده (مکمل بخش «توابع کمکی» بالاتر)

- `sys3.GetLookupValue(<Type>, <Code>, <Culture>)` — مقدار محلی‌شده‌ی یک Lookup.
  مثال واقعی: `sys3.GetLookupValue('ShamsiMonth', @YearMonth % 100, @Sys_CurrentCulture)` → نام فارسی ماه.
- `SYS3.Lookup` — جدول عمومی Lookup با ستون‌های `Type`, `Code`, `Value`.
  نوع شناخته‌شده: `'WorkLocation'` (محل خدمت)، `'ShamsiMonth'`.
- `SYS3.fnGetPersianDaysInMonth(@Year, @Month)` — تعداد روزهای ماه شمسی.
- `HCM3.uspGetLeaveMinutes @EmployeeID, @LeaveTypeID, 10, NULL, NULL, @From, @To`
  — **مقدار را با `RETURN` برمی‌گرداند** (`EXEC @x = …`)، نه با `SELECT`. آرگومان سوم در گزارش همیشه `10` است (معنایش کاوش‌نشده).
- `HCM3.uspGetLeaveRemainder @EmployeeID, @LeaveTypeID, @AsOfDate, 1, 0, 1`
  — همین‌طور مقدار برگشتی از طریق `RETURN`.
- `HCM3.LeaveType.DefaultInRequest = 1` → **نوع مرخصی پیش‌فرض سیستم** (مرخصی استحقاقی).
  گزارش‌ها به‌جای hard-code کردن ID، همیشه از این فلگ آن را پیدا می‌کنند — تو هم همین کار را بکن.
- `HCM3.EmploymentTypeItem.WorkMinutes` — دقیقه‌ی کاری استاندارد، انتخاب با
  `TOP 1 … WHERE EffectiveYearMonth <= @IssueYearMonth ORDER BY EffectiveYearMonth DESC`.
  ورودی لازم برای `HCM3.fnFormatLeaveRemainder`.

## بازه‌ی دقیق یک ماه شمسی (الگوی تکرارشونده)

```sql
SET @FirstOfMonth = SYS3.fnGetDateFromPersianDate(@Year, @Month, 1);
SET @LastOfMonth  = SYS3.fnGetDateFromPersianDate(@Year, @Month,
                      SYS3.fnGetPersianDaysInMonth(@Year, @Month));
SET @LastOfMonth  = DATEADD(millisecond, 997,
                    DATEADD(second, 59, DATEADD(minute, 59, DATEADD(hour, 23, @LastOfMonth))));
```
`997` میلی‌ثانیه (نه ۹۹۹) به‌خاطر دقت `DATETIME` است — عیناً همین را استفاده کن.

## سؤال‌های هنوز باز این ماژول

- مقادیر کامل enum `CompensationFactor.CompensationCalcTypeRef` و `EmployeeStatute.Status`.
- ساختار `FactorViewSetting.Definition`.
- عنوان فارسی دقیق `CompensationFactor.CategoryCode = 3` (تعهدات کارفرما) و `= 5` (سایر)، و اینکه `CategoryCode = 4` اصلاً وجود دارد یا نه.
- مقادیر دیگر `FactorViewSettingType.FactorViewSettingTypeID` غیر از `5` (لیست حقوق) — کدام قالب‌های نمایش دیگری در این نوع تعریف شده‌اند.
- معنی آرگومان `10` در `uspGetLeaveMinutes` و آرگومان‌های `1,0,1` در `uspGetLeaveRemainder`.
- آیا `PayCalc` ستون `State`/`FiscalYearRef`/`BranchRef` دارد؟ (طبق `db-conventions.md` باید چک شود —
  در کوئری‌های این گزارش هیچ فیلتری روی آن‌ها نبود، که یا یعنی ندارد یا یعنی نرم‌افزار جای دیگری فیلتر می‌کند.)
