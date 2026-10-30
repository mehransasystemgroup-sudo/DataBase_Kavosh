/**
 * مرجع دانش گزارش‌سازی — همان مرجع‌های مهارت «report-builder-sql-expert»
 * که برای راهکاران ساخته شده بود، این‌جا داخل خود برنامه.
 *
 * فایل‌ها تنبل بار می‌شوند (import.meta.glob) تا ~۲۰۰ کیلوبایت متن فقط وقتی
 * کاربر سراغ مرجع می‌رود دانلود شود، نه با باز شدن برنامه.
 */

const LOADERS = import.meta.glob("./docs/*.{md,sql,rdl}", { query: "?raw", import: "default" });

export const DOCS = [
  { id: "db-conventions", file: "db-conventions.md", group: "پایگاه داده", title: "قراردادهای سراسری پایگاه داده",
    summary: "نام‌گذاری XxxID/XxxRef، ستون‌های حسابرسی، فیلتر اجباری سال مالی و شعبه، enumهای State، تاریخ‌ها، تله‌ها." },
  { id: "known-database-schema", file: "known-database-schema.md", group: "پایگاه داده", title: "نقشهٔ شناخته‌شدهٔ پایگاه داده",
    summary: "جدول‌ها، ستون‌ها و روابطی که با داده اثبات شده‌اند؛ باگ‌های کشف‌شده و پرسش‌های باز." },
  { id: "database-module-map", file: "database-module-map.md", group: "پایگاه داده", title: "نقشهٔ ماژول‌ها (۳۷ اسکیما)",
    summary: "هر اسکیما چه ماژولی است، چند جدول و ردیف دارد و تا کجا کاوش شده." },
  { id: "persian-glossary", file: "persian-glossary.md", group: "پایگاه داده", title: "واژه‌نامهٔ فارسی",
    summary: "عنوان فارسی رسمی جدول‌ها و موجودیت‌ها — سرنخ معنایی، نه اثبات." },
  { id: "schema-discovery-queries", file: "schema-discovery-queries.md", group: "SQL", title: "کوئری‌های تشخیصی (مرحلهٔ ۰)",
    summary: "ساختار ستون، نمونهٔ ۲۰ تا ۵۰ ردیفی، توزیع مقادیر فلگ، کلیدهای خارجی — پیش از هر کوئری نهایی." },
  { id: "sql-patterns", file: "sql-patterns.md", group: "SQL", title: "الگوهای T-SQL گزارش",
    summary: "پیوت پویا، ROW_NUMBER برای زوج‌ستون، ستون‌های پویا، پایپ‌لاین جدول موقت، sp_executesql امن." },
  { id: "rdl-authoring", file: "rdl-authoring.md", group: "RDL", title: "ساخت گزارش از صفر (RDL 2016)",
    summary: "ترتیب المان‌ها، DataSource/DataSet، پارامترها، گروه‌بندی، Scope، RTL، Export و ترجمهٔ خطاها." },
  { id: "rdl-tablix-structure", file: "rdl-tablix-structure.md", group: "RDL", title: "کالبدشکافی Tablix",
    summary: "ستون‌ها، سلسله‌مراتب، ردیف‌ها، RTL، کپی سلول و زنجیرهٔ Hidden برای ستون‌های پویا." },
  { id: "rdl-page-repeat", file: "rdl-page-repeat.md", group: "RDL", title: "تکرار در صفحات بعد بدون PageHeader",
    summary: "تلهٔ KeepWithGroup، چرا RepeatWith کار نمی‌کند، الگوی شش‌قدمی سرآیند تکرارشونده." },
  { id: "report-catalog", file: "report-catalog.md", group: "RDL", title: "کاتالوگ گزارش‌ها و قراردادهای میزبان",
    summary: "sglt:، SG.ReportingUtilities، پارامترهای Sys_*، ممنوعیت PageHeader و گزارش‌های کالبدشکافی‌شده." },
];

export const ASSETS = {
  discovery: { file: "discover_views_sps_enums.sql", name: "discover_views_sps_enums.sql", title: "اسکریپت کاوش تکمیلی (Viewها، رویه‌ها، توزیع State/Type)" },
  template: { file: "blank-report-2016.rdl", name: "blank-report-2016.rdl", title: "قالب پایهٔ RDL 2016 (RTL، پارامتردار، گروه‌بندی‌شده)" },
};

const cache = new Map();

async function loadFile(file) {
  if (cache.has(file)) return cache.get(file);
  const loader = LOADERS[`./docs/${file}`];
  if (!loader) throw new Error(`مرجع «${file}» در برنامه نیست.`);
  const text = await loader();
  cache.set(file, text);
  return text;
}

export const loadDoc = (id) => {
  const doc = DOCS.find((d) => d.id === id);
  if (!doc) return Promise.reject(new Error(`مرجع «${id}» شناخته نشد.`));
  return loadFile(doc.file);
};

export const loadAsset = (key) => loadFile(ASSETS[key].file);

/** بخش‌های یک سند به تفکیک سرتیتر — برای جست‌وجو و فهرست مطالب. */
export function sections(md) {
  const out = [];
  let current = { level: 0, title: "", body: [], line: 0 };
  let fence = false;
  String(md).split("\n").forEach((line, i) => {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^(#{1,4})\s+(.+)$/.exec(line);
    if (m) {
      out.push(current);
      current = { level: m[1].length, title: m[2].trim(), body: [], line: i };
    } else {
      current.body.push(line);
    }
  });
  out.push(current);
  return out.filter((s) => s.title || s.body.join("").trim()).map((s) => ({ ...s, body: s.body.join("\n") }));
}

export const slug = (title) => String(title).trim().replace(/[`*_]/g, "").replace(/\s+/g, "-").replace(/[^\w؀-ۿ-]/g, "").toLowerCase();

const norm = (s) => String(s).toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ");

/** جست‌وجو در همهٔ مرجع‌ها؛ نتیجه به ترتیب تعداد واژه‌های یافته‌شده. */
export async function searchDocs(query, { limit = 30 } = {}) {
  const words = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits = [];
  for (const doc of DOCS) {
    const md = await loadFile(doc.file);
    for (const s of sections(md)) {
      const hay = norm(`${s.title}\n${s.body}`);
      const found = words.filter((w) => hay.includes(w));
      if (!found.length) continue;
      const titleHits = words.filter((w) => norm(s.title).includes(w)).length;
      const at = hay.indexOf(found[0]);
      const snippet = `${s.title}\n${s.body}`.slice(Math.max(0, at - 80), at + 180).replace(/\s+/g, " ").trim();
      hits.push({ doc: doc.id, docTitle: doc.title, section: s.title, anchor: slug(s.title), score: found.length * 2 + titleHits * 3, snippet });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── مترجم خطاهای Report Builder ──

export const ERRORS = [
  { match: /definition is not valid|not a valid report definition|invalid.*report definition/i,
    title: "تعریف گزارش معتبر نیست",
    cause: "ترتیب المان‌های XML با xsd:sequence نمی‌خواند، یا namespace با ساختار ناهمخوان است (مثلاً المانی از RDL 2010 در فایل 2016).",
    fix: "فایل را در «تحلیل و اصلاح RDL» بارگذاری کنید؛ اگر XML سالم است، ترتیب المان‌های اطراف آخرین تغییر را با قالب پایه مقایسه کنید." },
  { match: /detail member with inner members|details.*inner/i,
    title: "گروه جزئیات عضو درونی دارد",
    cause: "یک TablixMember با Group Name=\"Details\" زیرگروه (Group) دارد؛ گروه جزئیات باید برگ باشد.",
    fix: "زیرگروه را به بالای گروه جزئیات منتقل کنید." },
  { match: /number of (cells|columns).*(does not match|not match)|cells in row/i,
    title: "تعداد سلول‌ها با ستون‌ها نمی‌خواند",
    cause: "قانون سه‌گانه شکسته: تعداد TablixColumn ≠ اعضای ستون ≠ سلول‌های یک ردیف (اغلب بعد از ColSpan).",
    fix: "اعتبارسنج همین تب دقیقاً می‌گوید کدام ردیف؛ برای هر سلول ادغام‌شده N−1 سلول خالی <TablixCell /> لازم است." },
  { match: /fields cannot be used in page headers|page header|page footer/i,
    title: "فیلد در سرصفحه/پاصفحه",
    cause: "سرصفحه و پاصفحه به داده دسترسی ندارند — و نرم‌افزار میزبان راهکاران گزارشِ دارای PageHeader/PageFooter را اصلاً بار نمی‌کند.",
    fix: "محتوا را به ردیف ثابت تکرارشوندهٔ داخل Tablix منتقل کنید (ابزار «انتقال سرصفحه به بدنه» در تب تحلیل)." },
  { match: /aggregate.*page header|aggregate functions can be used only/i,
    title: "تابع تجمعی در جای نامجاز",
    cause: "Sum/First/Lookup در سرصفحه یا بیرون از دامنهٔ (Scope) دیتاست.",
    fix: "از ReportItems! استفاده کنید یا Scope را صریح بدهید: Sum(Fields!X.Value, \"DataSet1\")." },
  { match: /is not unique|already exists|duplicate/i,
    title: "نام تکراری",
    cause: "نام Textbox، گروه یا فیلد باید در کل فایل یکتا باشد.",
    fix: "اعتبارسنج همین تب نام تکراری را نشان می‌دهد؛ در کپی سلول، Name و rd:DefaultName هر دو باید عوض شوند." },
  { match: /refers to (the )?field|field.*does not exist|undefined field/i,
    title: "ارجاع به فیلد ناموجود",
    cause: "عبارتی Fields!X.Value را صدا می‌زند ولی X در دیتاست نیست، یا کوئری آن ستون را برنمی‌گرداند.",
    fix: "«همگام‌سازی فیلدها با کوئری» در تب تحلیل، فهرست Fields را با خروجی SELECT یکی می‌کند." },
  { match: /parameter.*(missing|not defined|has no value|must be declared)|must declare the scalar variable/i,
    title: "پارامتر تعریف‌نشده",
    cause: "@Param در کوئری هست ولی QueryParameter یا ReportParameter متناظر ندارد (یا برعکس).",
    fix: "اعتبارسنج همین تب پارامترهای جاافتاده را می‌گوید؛ هر @Param = یک QueryParameter + یک ReportParameter." },
  { match: /conversion|convert.*(int|bigint)|arithmetic overflow|Int32/i,
    title: "تبدیل نوع / سرریز عدد",
    cause: "پارامتر Integer در RDL فقط Int32 است؛ شناسه‌های bigint بزرگ‌تر از ۲٬۱۴۷٬۴۸۳٬۶۴۷ سرریز می‌شوند.",
    fix: "برای شناسه‌های بسیار بزرگ نوع پارامتر را Text بگذارید و در SQL با CAST(@X AS bigint) بخوانید." },
  { match: /timeout|timed out/i,
    title: "زمان اجرای کوئری تمام شد",
    cause: "کوئری بدون فیلتر سال مالی/شعبه یا بدون ایندکس، کل جدول را می‌خواند.",
    fix: "فیلترهای اجباری را بگذارید و کوئری را جدا با فایل آزمون (DECLARE) در SSMS اجرا و Execution Plan را بررسی کنید." },
  { match: /blank|empty|no data|خالی/i,
    title: "گزارش خالی است ولی خطا ندارد",
    cause: "فیلتر پارامتر همه‌چیز را حذف کرده — اغلب FiscalYearRef اشتباه، یا BETWEEN روی datetime.",
    fix: "کوئری را با همان مقادیر پارامتر در SSMS اجرا کنید؛ بازهٔ تاریخ را نیم‌باز بنویسید: >= @From AND < DATEADD(day,1,@To)." },
  { match: /excel|merged cells|ادغام/i,
    title: "مشکل خروجی Excel",
    cause: "آیتم‌ها هم‌تراز نیستند، عرض بدنه بیش از مجموع ستون‌هاست، یا عدد به‌صورت متن (FORMAT) آمده.",
    fix: "عرض ReportSection را با «تطبیق عرض بدنه» یکی کنید و قالب عدد را در RDL بدهید نه در SQL." },
];

export function translateError(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  return ERRORS.filter((e) => e.match.test(t));
}

// ── چک‌لیست تحویل ──

export const CHECKLIST = [
  { id: "validate", text: "اعتبارسنج RDL بدون خطا پاس می‌شود (قانون سه‌گانهٔ Tablix، نام‌های یکتا).", auto: "rdl" },
  { id: "fields", text: "هر ستون SELECT یک Field دارد و برعکس؛ نوع rd:TypeName درست است.", auto: "fields" },
  { id: "params", text: "هر @Param یک QueryParameter و یک ReportParameter متناظر دارد.", auto: "params" },
  { id: "width", text: "عرض بدنه (ReportSection/Width) == مجموع عرض ستون‌ها و در عرض صفحه جا می‌شود.", auto: "width" },
  { id: "fiscal", text: "فیلتر FiscalYearRef / BranchRef به‌صورت پارامتر وجود دارد (اگر جدول این ستون‌ها را دارد).", auto: "fiscal" },
  { id: "state", text: "State فیلتر یا با CASE … ELSE نمایش داده شده؛ اگر معنایش اثبات نشده، صریحاً اعلام شده.", auto: "state" },
  { id: "dates", text: "بازهٔ تاریخ نیم‌باز است (>= و <) نه BETWEEN.", auto: "dates" },
  { id: "header", text: "PageHeader / PageFooter ندارد (نرم‌افزار میزبان بارش نمی‌کند).", auto: "header" },
  { id: "sys", text: "پارامترهای Sys_* تعریف شده‌اند و به همهٔ Subreportها pass-through می‌شوند.", auto: "sys" },
  { id: "sglt", text: "کلیدهای sglt: و CodeModules/Classes دست‌نخورده مانده‌اند." },
  { id: "reportid", text: "rd:ReportID یکتاست (اگر از گزارش دیگری کپی شده)." },
  { id: "harness", text: "کوئری به‌صورت فایل .sql مستقل با DECLARE پارامترهای آزمون هم تحویل داده شده." },
  { id: "proof", text: "فرض‌های معنایی (فلگ‌ها، enumها) با اسکریپت تشخیصی و ۲۰ تا ۵۰ ردیف نمونه اثبات شده‌اند." },
];
