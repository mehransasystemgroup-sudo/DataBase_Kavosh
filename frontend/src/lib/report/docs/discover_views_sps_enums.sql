/* ============================================================================
   کاوش تکمیلی دیتابیس — Viewها، رویه‌ها/توابع، و توزیع enumها
   ----------------------------------------------------------------------------
   این اسکریپت مکمل «کاوش ساختاری» قبلی است. آن کاوش فقط جدول‌ها را مستند کرد؛
   این یکی سه شکاف باقی‌مانده را پر می‌کند:
     بخش ۱ — Viewهای موجود (که ممکن است منطق گزارش را از قبل آماده داشته باشند)
     بخش ۲ — رویه‌های ذخیره‌شده و توابع (که نباید دوباره‌نویسی شوند)
     بخش ۳ — توزیع واقعی مقادیر ستون‌های State/Type/Status (تنها راه اثبات معنای enum)
     بخش ۴ — داده‌های پایه‌ی موردنیاز هر گزارش (سال مالی، شعبه، کاربر)

   ویژگی‌ها:
     • کاملاً READ-ONLY — هیچ چیزی را تغییر نمی‌دهد (فقط جدول موقت #EnumDist می‌سازد).
     • با NOLOCK اجرا می‌شود تا روی دیتابیس عملیاتی قفل ایجاد نکند.
     • جدول‌های خالی را رد می‌کند تا سریع بماند.

   نحوه‌ی اجرا:
     1) در SSMS دیتابیس درست را انتخاب کن.
     2) کل اسکریپت را اجرا کن (F5).
     3) هر بخش یک Result Set جدا می‌دهد. روی هر گرید راست‌کلیک →
        "Save Results As..." → CSV، یا Ctrl+A و Ctrl+C و Paste در فایل متنی.
     4) خروجی هر چهار بخش را برای Claude بفرست.

   ⚠️ اگر بخش ۳ خیلی طول کشید: مقدار @MinRows را بالاتر ببر (مثلاً 100) یا
      لیست @Schemas را به فقط ماژول موردنیاز گزارش محدود کن.
============================================================================ */

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

/* ---------------------------------------------------------------------------
   تنظیمات — این‌ها را متناسب با گزارشی که می‌سازی تغییر بده
--------------------------------------------------------------------------- */
DECLARE @MinRows        bigint = 1;     -- جدول‌های با ردیف کمتر از این، در بخش ۳ نادیده گرفته می‌شوند
DECLARE @MaxTablesEnum  int    = 400;   -- سقف تعداد جدول در بخش ۳ (برای جلوگیری از اجرای طولانی)

DECLARE @Schemas TABLE (SchemaName sysname PRIMARY KEY);
INSERT INTO @Schemas (SchemaName) VALUES
    ('FIN3'),   -- مالی
    ('ACC'),    -- حسابداری / کدینگ حساب
    ('SLS3'),   -- فروش
    ('LGS3'),   -- لجستیک / انبار
    ('PRC3'),   -- تدارکات / خرید
    ('FAM3'),   -- دارایی ثابت
    ('GNR3'),   -- عمومی / پایه
    ('CAC3'),   -- بهای تمام‌شده
    ('BDG3'),   -- بودجه
    ('HCM3');   -- منابع انسانی / تردد
-- برای کاوش سریع‌تر، خط‌های غیرلازم بالا را کامنت کن.


/* ===========================================================================
   بخش ۱ — فهرست Viewها
   ---------------------------------------------------------------------------
   چرا مهم است: نرم‌افزارهای این خانواده معمولاً Viewهای گزارشی آماده دارند که
   JOINهای پیچیده و فیلتر وضعیت را از قبل درست انجام داده‌اند. استفاده از یک View
   موجود، هم دقیق‌تر از بازنویسی JOIN از صفر است، هم با منطق خود نرم‌افزار هم‌خوان.
=========================================================================== */
SELECT
    N'بخش ۱ - Viewها' AS Section,
    s.name                                   AS SchemaName,
    v.name                                   AS ViewName,
    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = v.object_id) AS ColumnCount,
    LEN(m.definition)                        AS DefinitionLength,
    (SELECT COUNT(DISTINCT d.referenced_entity_name)
       FROM sys.sql_expression_dependencies d
      WHERE d.referencing_id = v.object_id)  AS ReferencedObjectCount,
    v.create_date,
    v.modify_date
FROM sys.views v
JOIN sys.schemas s        ON s.schema_id = v.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id = v.object_id
ORDER BY ReferencedObjectCount DESC, s.name, v.name;


/* --- بخش ۱-ب: ستون‌های هر View (فقط Viewهایی که بیش از ۳ جدول را ترکیب می‌کنند) --- */
SELECT
    N'بخش ۱-ب - ستون‌های View' AS Section,
    s.name AS SchemaName,
    v.name AS ViewName,
    c.column_id,
    c.name AS ColumnName,
    t.name AS DataType,
    c.max_length,
    c.is_nullable
FROM sys.views v
JOIN sys.schemas s  ON s.schema_id = v.schema_id
JOIN sys.columns c  ON c.object_id = v.object_id
JOIN sys.types   t  ON t.user_type_id = c.user_type_id
WHERE (SELECT COUNT(DISTINCT d.referenced_entity_name)
         FROM sys.sql_expression_dependencies d
        WHERE d.referencing_id = v.object_id) >= 3
ORDER BY s.name, v.name, c.column_id;


/* ===========================================================================
   بخش ۲ — رویه‌های ذخیره‌شده و توابع
   ---------------------------------------------------------------------------
   چرا مهم است: قانون مهارت این است که «قبل از نوشتن منطق جدید، دنبال تابع آماده
   بگرد». این بخش آن فهرست را یک‌جا می‌دهد. توابع SYS3.fn* و HCM3.fn* از قبل
   شناخته‌شده‌اند؛ این کوئری بقیه را هم پیدا می‌کند.
=========================================================================== */
SELECT
    N'بخش ۲ - رویه‌ها و توابع' AS Section,
    s.name AS SchemaName,
    o.name AS ObjectName,
    CASE o.type
        WHEN 'P'  THEN N'رویه ذخیره‌شده'
        WHEN 'FN' THEN N'تابع اسکالر'
        WHEN 'IF' THEN N'تابع جدولی درون‌خطی'
        WHEN 'TF' THEN N'تابع جدولی چندجمله‌ای'
    END AS ObjectType,
    -- امضای پارامترها به‌صورت یک رشته
    STUFF((
        SELECT N', ' + p.name + N' ' + tp.name +
               CASE WHEN tp.name LIKE N'%char%' OR tp.name LIKE N'%binary%'
                    THEN N'(' + CASE WHEN p.max_length = -1 THEN N'MAX'
                                     ELSE CAST(p.max_length AS nvarchar(10)) END + N')'
                    ELSE N'' END
          FROM sys.parameters p
          JOIN sys.types tp ON tp.user_type_id = p.user_type_id
         WHERE p.object_id = o.object_id AND p.parameter_id > 0
         ORDER BY p.parameter_id
         FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') AS Parameters,
    LEN(m.definition) AS DefinitionLength,
    o.modify_date
FROM sys.objects o
JOIN sys.schemas s        ON s.schema_id = o.schema_id
LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
WHERE o.type IN ('P', 'FN', 'IF', 'TF')
  AND o.is_ms_shipped = 0
ORDER BY s.name, ObjectType, o.name;


/* ===========================================================================
   بخش ۳ — توزیع واقعی مقادیر State / Type / Status  ★ مهم‌ترین بخش ★
   ---------------------------------------------------------------------------
   چرا مهم است: این ستون‌ها enum سمت کد نرم‌افزارند و هیچ FK به جدول Lookup
   ندارند. تنها راه اثبات معنایشان، دیدن توزیع واقعی مقادیر و تطبیق آن با
   references/glossary/lookup-values.csv است.

   خروجی: برای هر جدول/ستون، مقادیر موجود و تعداد ردیف هرکدام.
   نحوه‌ی خواندن: اگر جدولی مقادیر {1,2,3,4} دارد و در lookup-values.csv یک
   Type با دقیقاً ۴ مقدار و همان Schema هست، به‌احتمال زیاد همان است — ولی
   قبل از تکیه بر آن، باید در خود نرم‌افزار روی یک رکورد نمونه تأیید شود.
=========================================================================== */
IF OBJECT_ID('tempdb..#EnumDist') IS NOT NULL DROP TABLE #EnumDist;
CREATE TABLE #EnumDist (
    FullTableName sysname,
    ColumnName    sysname,
    TableRows     bigint,
    EnumValue     bigint NULL,
    RowCnt        bigint
);

DECLARE @sql nvarchar(max), @full sysname, @col sysname, @rows bigint;

DECLARE enum_cur CURSOR LOCAL FAST_FORWARD FOR
    SELECT TOP (@MaxTablesEnum)
           QUOTENAME(s.name) + N'.' + QUOTENAME(t.name) AS FullName,
           c.name AS ColName,
           ps.RowCnt
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN @Schemas sc   ON sc.SchemaName = s.name
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
    CROSS APPLY (
        SELECT SUM(p.row_count) AS RowCnt
        FROM sys.dm_db_partition_stats p
        WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)
    ) ps
    WHERE c.name IN (N'State', N'Type', N'Status', N'Kind', N'DocumentState', N'DocumentType')
      AND ty.name IN (N'int', N'tinyint', N'smallint', N'bit')
      AND ps.RowCnt >= @MinRows
    ORDER BY ps.RowCnt DESC;

OPEN enum_cur;
FETCH NEXT FROM enum_cur INTO @full, @col, @rows;

WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'
        INSERT INTO #EnumDist (FullTableName, ColumnName, TableRows, EnumValue, RowCnt)
        SELECT TOP (50) @p_full, @p_col, @p_rows,
               CAST(' + QUOTENAME(@col) + N' AS bigint),
               COUNT_BIG(*)
        FROM ' + @full + N' WITH (NOLOCK)
        GROUP BY ' + QUOTENAME(@col) + N'
        ORDER BY COUNT_BIG(*) DESC;';

    BEGIN TRY
        EXEC sp_executesql @sql,
             N'@p_full sysname, @p_col sysname, @p_rows bigint',
             @p_full = @full, @p_col = @col, @p_rows = @rows;
    END TRY
    BEGIN CATCH
        INSERT INTO #EnumDist (FullTableName, ColumnName, TableRows, EnumValue, RowCnt)
        VALUES (@full, @col, @rows, NULL, -1);   -- RowCnt = -1 یعنی این جدول خطا داد
    END CATCH

    FETCH NEXT FROM enum_cur INTO @full, @col, @rows;
END

CLOSE enum_cur;
DEALLOCATE enum_cur;

SELECT
    N'بخش ۳ - توزیع enum' AS Section,
    FullTableName,
    ColumnName,
    TableRows,
    EnumValue,
    RowCnt,
    CAST(100.0 * RowCnt / NULLIF(TableRows, 0) AS decimal(5,1)) AS PercentOfTable
FROM #EnumDist
ORDER BY TableRows DESC, FullTableName, ColumnName, EnumValue;

/* --- بخش ۳-ب: خلاصه — چند مقدار متمایز هر ستون دارد؟ ---
   این جدول کوچک‌تر است و برای تطبیق سریع با lookup-values.csv بهتر جواب می‌دهد. */
SELECT
    N'بخش ۳-ب - خلاصه enum' AS Section,
    FullTableName,
    ColumnName,
    TableRows,
    COUNT(*) AS DistinctValueCount,
    MIN(EnumValue) AS MinValue,
    MAX(EnumValue) AS MaxValue,
    STUFF((SELECT N', ' + CAST(e2.EnumValue AS nvarchar(20))
             FROM #EnumDist e2
            WHERE e2.FullTableName = e.FullTableName
              AND e2.ColumnName    = e.ColumnName
            ORDER BY e2.EnumValue
            FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') AS ValueList
FROM #EnumDist e
WHERE RowCnt > 0
GROUP BY FullTableName, ColumnName, TableRows
ORDER BY TableRows DESC;


/* ===========================================================================
   بخش ۴ — داده‌های پایه‌ی موردنیاز هر گزارش
   ---------------------------------------------------------------------------
   این‌ها لیست کشویی پارامترهای تقریباً هر گزارش مالی را می‌سازند.
=========================================================================== */
SELECT N'بخش ۴-الف - سال مالی' AS Section, *
FROM GNR3.FiscalYear WITH (NOLOCK)
ORDER BY FiscalYearID;

SELECT N'بخش ۴-ب - شعبه' AS Section, *
FROM GNR3.Branch WITH (NOLOCK)
ORDER BY BranchID;

SELECT TOP (50) N'بخش ۴-ج - کاربران' AS Section,
       u.UserID, u.Name, u.Status, u.Type, u.PartyRef, u.IsAdministrator
FROM SYS3.[User] u WITH (NOLOCK)
ORDER BY u.UserID;


/* ===========================================================================
   ضمیمه — گرفتن متن کامل یک شیء خاص
   ---------------------------------------------------------------------------
   بعد از دیدن خروجی بخش ۱ و ۲، اگر Claude گفت متن کامل یک View یا تابع را
   لازم دارد، فقط این خط را با نام آن شیء اجرا کن:
=========================================================================== */
-- SELECT OBJECT_DEFINITION(OBJECT_ID('SYS3.fnGetPersianYearMonth')) AS Definition;
-- SELECT OBJECT_DEFINITION(OBJECT_ID('FIN3.YourViewNameHere'))      AS Definition;

IF OBJECT_ID('tempdb..#EnumDist') IS NOT NULL DROP TABLE #EnumDist;
