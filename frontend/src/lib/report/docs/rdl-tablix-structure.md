# کالبدشکافی ساختار Tablix در فایل RDL

فایل `.rdl` یک XML با namespace استاندارد SSRS/Report Builder است. برای هر گزارش واقعی، این فایل معمولاً بین چند صد کیلوبایت تا چند مگابایت است و نباید یک‌جا با ابزار `view` باز شود — همیشه با پایتون و regex بخش موردنظر را استخراج کن.

## ۱. دو دنیای جدا: DataSet در برابر Tablix

هر گزارش حداقل شامل این دو بخش مجزاست که باید هم‌زمان و هماهنگ ویرایش شوند:

```
<DataSets>
  <DataSet Name="DataSet1">
    <Query>
      <CommandText>... متن کامل T-SQL ...</CommandText>
    </Query>
    <Fields>
      <Field Name="ff">
        <DataField>ff</DataField>
        <rd:TypeName>System.String</rd:TypeName>
      </Field>
      ...
    </Fields>
  </DataSet>
</DataSets>
```

نکته‌ی حیاتی: **اگر یک ستون جدید به خروجی `SELECT` کوئری اضافه کنی ولی `<Field Name="...">` متناظرش را در `<Fields>` اضافه نکنی، Report Builder آن ستون را نمی‌شناسد و در `Fields!X.Value` قابل استفاده نیست.** برعکسش هم درست است: اضافه کردن `Field` بدون اینکه کوئری واقعاً آن ستون را برگرداند، باعث خطای Runtime می‌شود (نه خطای طراحی).

## ۲. آناتومی یک Tablix

```
<Tablix Name="Tablix1">
  <TablixBody>
    <TablixColumns>              <!-- تعداد = تعداد ستون‌های فیزیکی جدول -->
      <TablixColumn><Width>25mm</Width></TablixColumn>
      ...
    </TablixColumns>
    <TablixRows>
      <TablixRow>                <!-- هر ردیف: هدر، جزئیات (Detail)، یا Subtotal -->
        <Height>6mm</Height>
        <TablixCells>
          <TablixCell>
            <CellContents>
              <Textbox Name="Textbox5">   <!-- نام باید یکتا در کل فایل باشد -->
                <Paragraphs>...</Paragraphs>
                <Style>...</Style>
              </Textbox>
            </CellContents>
          </TablixCell>
          ...  <!-- تعداد TablixCell در این ردیف باید == تعداد TablixColumn باشد -->
        </TablixCells>
      </TablixRow>
      ...
    </TablixRows>
  </TablixBody>
  <TablixColumnHierarchy>
    <TablixMembers>
      <TablixMember />            <!-- یک عضو خالی به‌ازای هر ستون -->
      ...                          <!-- تعداد باید == تعداد TablixColumn باشد -->
    </TablixMembers>
  </TablixColumnHierarchy>
  <TablixRowHierarchy>...</TablixRowHierarchy>
</Tablix>
```

### قانون طلایی سه‌گانه
هر بار که یک ستون داده‌ای (مثل «ورود دوم») اضافه می‌کنی، باید **دقیقاً سه چیز** هم‌زمان اضافه شود، وگرنه فایل خراب می‌شود:

| # | کجا | چه چیزی |
|---|-----|----------|
| 1 | `TablixColumns` | یک `<TablixColumn><Width>...</Width></TablixColumn>` جدید |
| 2 | `TablixColumnHierarchy` | یک `<TablixMember />` جدید |
| 3 | **هر** `TablixRow` (هدر + جزئیات + هر Subtotal) | یک `<TablixCell>` جدید در همان جایگاه ستونی |

اگر گزارش چند Tablix دارد (مثلاً یک Tablix اصلی برای جدول روزانه و چند Tablix کوچک‌تر برای خلاصه‌ها)، این سه‌گانه فقط برای Tablixـی که واقعاً تغییر می‌کند اعمال می‌شود — بقیه دست‌نخورده می‌مانند.

## ۳. جهت راست‌به‌چپ (RTL) — این را حدس نزن

برخلاف تصور رایج، اکثر فایل‌های RDL فارسی **هیچ فلگ صریح RTL/Language در سطح گزارش ندارند.** جهت راست‌به‌چپ صرفاً از طریق:
- ترتیب فیزیکی تعریف ستون‌ها در `TablixColumns` (که با ترتیب سند XML یکی است)
- و `TextAlign: Center/Right` در استایل هر Textbox

شبیه‌سازی می‌شود. یعنی:

> **ترتیب ستون‌ها در فایل XML (از بالا به پایین لیست `TablixColumns`) == ترتیب فیزیکی چپ‌به‌راست روی صفحه.**
> ستونی که در XML دیرتر آمده (index بزرگ‌تر)، فیزیکی سمت راست‌تر صفحه است.

**روش تأیید (اجباری، حدس نزن):** یک متن ثابت و شناخته‌شده در جدول پیدا کن (مثلاً هدر ستون «تاریخ» که معمولاً چسبیده به لبه‌ی راست است) و ایندکسش را در لیست سلول‌های آن ردیف پیدا کن. اگر آن ایندکس بزرگ‌ترین عدد بین سلول‌هاست، یعنی «آخرین ستون در XML = راست‌ترین ستون فیزیکی» — که در اکثر گزارش‌های فارسی همین‌طور است، اما همیشه با شمردن تأیید کن، فرض نکن.

نتیجه‌ی عملی: وقتی می‌خواهی یک ستون جدید را **سمت راستِ** یک ستون موجود اضافه کنی (نزدیک‌تر به تاریخ)، باید آن را **بعد از** آن ستون در XML درج کنی (ایندکس بزرگ‌تر). برای اضافه کردن **سمت چپِ** یک ستون، باید **قبل از** آن در XML درج شود.

## ۴. الگوی امن برای کپی یک ستون/سلول

هرگز یک `Textbox` را از صفر ننویس؛ همیشه یک سلول مشابه موجود (مثلاً ستون «ورود» یا «خروج» فعلی) را عیناً کپی کن تا Border، Padding، BackgroundColor، فونت و اندازه یکسان بماند. فقط این دو مورد را عوض کن:
1. `Textbox Name="..."` → یک نام یکتای جدید (مثلاً `Out2`, `In2`)
2. `<Value>` یا `<Value>=Fields!X.Value</Value>` → فیلد/متن جدید

نمونه‌ی یک سلول جزئیات (Detail) با استایل کامل که باید عیناً کپی شود:

```xml
<TablixCell>
  <CellContents>
    <Textbox Name="Out2">
      <KeepTogether>true</KeepTogether>
      <Paragraphs>
        <Paragraph>
          <TextRuns>
            <TextRun>
              <Value>=Fields!Out2.Value</Value>
              <Style><FontFamily>SG Kara Light</FontFamily></Style>
            </TextRun>
          </TextRuns>
          <Style><TextAlign>Center</TextAlign></Style>
        </Paragraph>
      </Paragraphs>
      <rd:DefaultName>Out2</rd:DefaultName>
      <Style>
        <Border><Style>Solid</Style></Border>
        <TopBorder><Color>Black</Color><Style>Solid</Style><Width>1pt</Width></TopBorder>
        <BottomBorder><Color>Black</Color><Style>Solid</Style><Width>1pt</Width></BottomBorder>
        <LeftBorder><Color>Black</Color><Style>Solid</Style><Width>1pt</Width></LeftBorder>
        <RightBorder><Color>Black</Color><Style>Solid</Style><Width>1pt</Width></RightBorder>
        <VerticalAlign>Middle</VerticalAlign>
        <PaddingLeft>2pt</PaddingLeft>
        <PaddingRight>2pt</PaddingRight>
        <PaddingTop>2pt</PaddingTop>
        <PaddingBottom>2pt</PaddingBottom>
      </Style>
    </Textbox>
  </CellContents>
</TablixCell>
```

## ۵. روش کار پیشنهادی با پایتون (نه ویرایش دستی رشته‌های عظیم)

1. با `re.search(r'<Tablix Name="X">(.*?)</Tablix>', content, re.S)` بلوک موردنظر را جدا کن (با پیدا کردن Tablix بعدی به‌عنوان مرز پایانی، چون بعضی Tablixها تودرتو نیستند ولی پشت‌سرهم می‌آیند).
2. تعداد `TablixColumn`، اعضای `TablixColumnHierarchy`، و سلول‌های هر `TablixRow` را استخراج و چاپ کن تا مطمئن شوی درک درستی از ساختار داری، **قبل از** هر ویرایش.
3. سلول الگو (مثلاً ستون «خروج» فعلی) را استخراج کن، با `.format()` یا `str.replace()` چند نسخه با نام/فیلد جدید بساز، و همه را یک‌جا با یک عملیات درج کن (نه چند بار str_replace پشت‌سرهم که باعث off-by-one و ترتیب اشتباه می‌شود).
4. بعد از هر تغییر ساختاری، بلافاصله دوباره شمارش کن (ستون‌ها، اعضا، سلول‌های هر ردیف) و مطمئن شو همه برابرند.
5. در پایان، `xml.etree.ElementTree.parse()` را روی کل فایل اجرا کن تا از well-formed بودن مطمئن شوی.

## ۶. ستون‌های پویا در Tablix: زنجیره‌ی `Hidden` بر پایه‌ی شمارش (نه یک شرط ساده)

وقتی دیتاست از قبل تعداد ثابتی «جای ستون» فیزیکی دارد (مثلاً ۷ ستون به نام‌های `Factor_1` تا `Factor_7`، طبق الگوی SQL در `sql-patterns.md` بخش ۳) ولی می‌خواهد فقط به تعداد عامل‌های واقعاً موجود نشان بدهد، RDL این کار را **در سطح Tablix، نه در سطح دیتاست** با یک زنجیره‌ی شرط `Hidden` روی هر `TablixMember` ستون انجام می‌دهد. این ساختار در گزارش واقعی «لیست حقوق کارمندان» (`SalaryListItems.rdl`، تأییدشده) این‌طور است — یک Tablix تودرتوی کوچک (۷ ستون فیزیکی) داخل هر سلول از بخش «عوامل کارکردی/تعهدات/مزایا/کسورات/سایر» گزارش اصلی:

```
TablixColumnHierarchy (به ترتیب سند XML = چپ فیزیکی → راست فیزیکی، طبق قرارداد بخش ۳)
  TablixMember۱ (چپ‌ترین، متناظر با ستون فیزیکی Factor_7)
    Hidden = IIf(Fields!FactorsCount.Value < Parameters!ColumnsCount.Value, True, False)
  TablixMember۲ (Factor_6)
    Hidden = IIf(Parameters!ColumnsCount.Value < 7, True, IIf(Fields!FactorsCount.Value < 6, True, False))
  TablixMember۳ (Factor_5)
    Hidden = IIf(Parameters!ColumnsCount.Value < 6, True, IIf(Fields!FactorsCount.Value < 5, True, False))
  TablixMember۴ (Factor_4)
    Hidden = IIf(Parameters!ColumnsCount.Value < 5, True, IIf(Fields!FactorsCount.Value < 4, True, False))
  TablixMember۵ (Factor_3)
    Hidden = IIf(Parameters!ColumnsCount.Value < 4, True, IIf(Fields!FactorsCount.Value < 3, True, False))
  TablixMember۶ (Factor_2)
    Hidden = IIf(Parameters!ColumnsCount.Value < 3, True, IIf(Fields!FactorsCount.Value < 2, True, False))
  TablixMember۷ (راست‌ترین، Factor_1)
    Hidden = IIf(Parameters!ColumnsCount.Value < 2, True, IIf(Fields!FactorsCount.Value < 1, True, False))
```

منطق هر شرط دو لایه است:
1. **لایه‌ی ساختاری (`ColumnsCount < N`)** — آیا اصلاً این جایگاه با تنظیمات فعلی (پارامتر `ColumnsCount`، معمولاً حداکثر ۷، پاس‌دادشده از گزارش والد) قابل‌دسترسی است؟ اگر ادمین حداکثر ستون‌ها را مثلاً ۵ تنظیم کرده باشد، جایگاه‌های ۶ و ۷ اصلاً در دیتاست معنایی نمی‌گیرند (چون `ColumnIndex = RowNumber % ColumnsCount` هیچ‌وقت ۶ یا ۷ نمی‌شود) و باید صرف‌نظر از داده مخفی بمانند.
2. **لایه‌ی داده‌ای (`FactorsCount < N`)** — حتی اگر ساختاراً قابل‌دسترسی باشد، آیا واقعاً به این تعداد عامل *دارای‌داده* رسیده‌ایم؟ `FactorsCount` فیلدی‌ست که در همان ردیف دیتاست (با `MAX(RowNumber)` روی همان دسته‌بندی) محاسبه شده — به بخش ۳.۱ `sql-patterns.md` نگاه کن.

**⚠️ نکته‌ی حیاتی که با شمردن واقعی این گزارش کشف شد:** ستون فیزیکیِ **آخر در سند XML** (اینجا `Factor_1`، راست‌ترین) همیشه «آخرین جایگاهِ فعلی» را نشان می‌دهد — چه `ColumnsCount` برابر ۷ باشد چه ۵ — چون در دیتاست به `ColumnIndex = 0` (باقی‌مانده‌ی صفر تقسیم بر `ColumnsCount`) نگاشت شده، نه به عدد ثابت ۷. ستون‌های میانی هرکدام به یک باقی‌ماندهٔ ثابت (۱ تا ۶) نگاشت شده‌اند و اگر `ColumnsCount` کوچک‌تر از جایگاهشان باشد، آن باقی‌مانده اصلاً تولید نمی‌شود. **قبل از تغییر یکی از این ستون‌ها، حتماً همین رفتار را با شمارش واقعی TablixCellها و `Value` هرکدام تأیید کن — روی این توضیح صرفاً به‌عنوان نقشه‌ی راه حساب کن، نه جایگزین شمارش.**

### ۶.۱ `rd:DefaultName` را باور نکن — همیشه `<Value>` واقعی را بخوان

در همین گزارش، `Textbox Name="Textbox10"` (نام و `rd:DefaultName` باقی‌مانده از زمان ساخت اولیه‌ی Textbox) در واقع `<Value>=Fields!Functional_7.Value</Value>` را نمایش می‌دهد — یعنی متن نام Textbox **هیچ ربطی به فیلدی که واقعاً نمایش می‌دهد ندارد**. `rd:DefaultName` فقط اسم اولیه‌ای‌ست که Report Builder موقع ساخت Textbox به‌طور خودکار گذاشته و بعداً که کاربر Value را عوض کرده، دوباره‌نویسی نشده. **هر وقت می‌خواهی بفهمی یک سلول چه چیزی نشان می‌دهد، همیشه مستقیم `<Value>` (یا `<TextRun><Value>`) داخل `Paragraphs` را بخوان، هرگز به `Textbox Name` یا `rd:DefaultName` اعتماد نکن** — این‌ها می‌توانند از هم مستقل باشند و گمراه‌کننده‌اند.

### ۶.۲ مخفی کردن کل ردیفِ عنوان وقتی هیچ عاملی نبود (سرریز چندردیفی)

وقتی الگوی «سرریز» بخش ۳.۲ `sql-patterns.md` اجرا می‌شود، ممکن است یک بلوکِ ردیفِ عنوان اضافه ساخته شود که اصلاً هیچ عاملی به آن نرسیده (چون تعداد کل عامل‌ها دقیقاً مضرب `ColumnsCount` نبوده). در سطح `TablixRowHierarchy`، این ردیف اضافه با چک کردن null بودن **همه‌ی** فیلدهای آن دسته مخفی می‌شود:

```
Hidden = NOT( Fields!Type.Value = "ردیف‌عنوان" AND NOT(هر ۷ فیلد Factor_1..Factor_7 همه NULL) )
```

یعنی: این ردیف فقط وقتی دیده می‌شود که هم از نوع «عنوان» باشد و هم حداقل یکی از ۷ جایگاهش مقدار داشته باشد؛ در غیر این‌صورت (چه نوعش چیز دیگری باشد، چه از نوع عنوان باشد ولی کاملاً خالی) مخفی می‌شود.

### ۶.۳ لایه‌ی درشت‌تر: مخفی کردن کل بخش/دسته با یک پارامتر بولی ساده

جدا از مخفی‌سازی ستون‌به‌ستونِ بالا، این گزارش یک لایه‌ی **درشت‌تر و مستقل** هم دارد: کل بلوک «عوامل کارکردی» یا «تعهدات» یا … می‌تواند از اساس مخفی باشد، اگر تنظیمات نمایش (`FactorViewSetting` در دیتابیس — همان چیزی که کاربران این نرم‌افزار «تنظیمات نمایش گزارش / tableview» می‌نامند) اصلاً هیچ عاملی از آن دسته را شامل نشود — **صرف‌نظر از اینکه کارمندها داده دارند یا نه**. این با یک پارامتر بولیِ ساده (نه شمارشی) کنترل می‌شود که گزارش والد آن را از پیش محاسبه کرده و پاس داده:

```
Hidden = IIf(Parameters!BossCommitmentVisibility.Value = True, False, True)
```

**این دو لایه را با هم قاطی نکن:**

| لایه | کجا محاسبه می‌شود | بر چه اساسی |
|---|---|---|
| مخفی‌سازی کل دسته (`XVisibility`) | دیتاست گزارش **والد** (`SELECT ... COUNT(*) > 0 FROM FactorViewSetting...`) | آیا این «قالب نمایش» اصلاً این دسته را تعریف کرده؟ (تنظیماتی، نه داده‌ای) |
| مخفی‌سازی ستون‌به‌ستون (`Factor_N` + `FactorsCount`) | دیتاست همان ساب‌ریپورت که مقدار را هم می‌سازد | آیا برای کارمندهای همین گزارش، این عامل خاص مقدار غیرصفر دارد؟ (داده‌ای) |

اگر کاربر بگوید «این ستون/بخش نباید دیده شود ولی می‌شود» یا برعکس، اول مشخص کن مشکل در کدام لایه است — دیباگ هرکدام کاملاً متفاوت است.

## ۷. مشکلات رایج و علامتشان

| علامت در Report Builder | علت محتمل |
|---|---|
| گزارش هنگام باز شدن خطای فرمت XML می‌دهد | تعداد `TablixCell` در یک ردیف با تعداد `TablixColumn` برابر نیست، یا تگ بسته/باز نشده |
| ستون جدید داده نشان نمی‌دهد ولی هدرش هست | `Field` متناظر در `<Fields>` دیتاست تعریف نشده، یا نام فیلد در Value اشتباه تایپ شده |
| گزارش باز می‌شود ولی Preview خطا می‌دهد | نام `Textbox` تکراری در فایل هست |
| ستون‌ها به ترتیب اشتباه/جای عجیب افتاده‌اند | ترتیب درج در XML با جهت RTL موردنظر هم‌خوانی ندارد (به بخش ۳ برگرد) |
| ستونی که باید بدون داده مخفی شود، دیده می‌شود (یا برعکس) | یا شرط `IS NOT NULL`/زیرکوئری عضویت سمت SQL درست نیست (`sql-patterns.md` بخش ۳.۱)، یا زنجیره‌ی `Hidden` سمت RDL به‌درستی به `FactorsCount`/`ColumnsCount` وصل نیست (بخش ۶ همین فایل) — اول با یک کوئری مستقل در SSMS چک کن کدام لایه مقصر است |
| کل یک بخش/دسته (نه فقط یک ستون) باید مخفی باشد ولی نیست | این لایه‌ی درشت‌تر و جداگانه‌ای‌ست (بخش ۶.۳) — پارامتر بولیِ `XVisibility` را که گزارش والد پاس می‌دهد چک کن، نه شمارش ستون‌ها را |
| Value یک Textbox با اسمش (`Textbox Name`/`rd:DefaultName`) نمی‌خواند | طبیعی است — این دو مستقل‌اند (بخش ۶.۱)؛ همیشه `<Value>` واقعی را بخوان، نه اسم |
