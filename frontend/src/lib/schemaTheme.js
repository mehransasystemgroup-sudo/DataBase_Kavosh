/**
 * پالت اسکیماها.
 *
 * گراف روابط باید ده‌ها اسکیما را از هم تفکیک کند، ولی نباید از تم سبز/مشکی
 * بیرون بزند. پس به‌جای رنگ‌های دلبخواه، یک چرخ رنگ محدود تعریف شده که هر
 * فام آن در هر دو تم روشنایی کنترل‌شده دارد: در تیره روشن و اشباع، در روشن
 * تیره و کم‌اشباع. هر اسکیما به‌طور قطعی (هش نام) به یکی از این فام‌ها می‌رسد،
 * پس رنگ یک اسکیما بین بارگذاری‌ها و بین دو تم ثابت می‌ماند.
 */

// [فام، اشباع]
const HUES = [
  [152, 62], // زمردی — هم‌خانواده‌ی رنگ اصلی
  [173, 58], // فیروزه‌ای
  [190, 62], // آبی‌فیروزه‌ای
  [199, 66], // آسمانی
  [226, 58], // نیلی
  [265, 55], // بنفش
  [292, 50], // ارغوانی
  [340, 60], // سرخابی
  [25, 68], // کهربایی
  [88, 52], // لیمویی
];

// اسکیماهای پرکاربرد رنگ ثابت و عنوان فارسی می‌گیرند
const KNOWN = {
  FIN3: { hue: 0, label: "مالی" },
  ACC: { hue: 1, label: "حسابداری" },
  GNR3: { hue: 3, label: "عمومی" },
  HCM3: { hue: 5, label: "منابع انسانی" },
  RPA3: { hue: 8, label: "دریافت و پرداخت" },
  LGS3: { hue: 4, label: "لجستیک" },
  MMG3: { hue: 9, label: "انبار" },
  SLS3: { hue: 2, label: "فروش" },
  BDG3: { hue: 7, label: "بودجه" },
  PRC3: { hue: 6, label: "تدارکات" },
  SCM3: { hue: 2, label: "زنجیره تأمین" },
  QCM3: { hue: 1, label: "کنترل کیفیت" },
  FAM3: { hue: 5, label: "دارایی ثابت" },
  SYS3: { hue: 4, label: "سیستمی" },
  USR3: { hue: 6, label: "کاربران" },
  WFE3: { hue: 3, label: "گردش کار" },
  ECM: { hue: 7, label: "مدیریت اسناد" },
  FMK: { hue: 1, label: "فریم‌ورک" },
  RMS3: { hue: 8, label: "نگهداری و تعمیرات" },
  PAC3: { hue: 9, label: "بهای تمام‌شده" },
  CAL3: { hue: 0, label: "تقویم" },
  FCC3: { hue: 2, label: "مدیریت مالی پروژه" },
  RLS3: { hue: 6, label: "قوانین و دسترسی" },
  IPR3: { hue: 5, label: "تولید" },
  MRP3: { hue: 4, label: "برنامه‌ریزی مواد" },
  dbo: { hue: 3, label: "پیش‌فرض" },
};

function hashIndex(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h) % HUES.length;
}

const cache = new Map();

/**
 * رنگ‌های یک اسکیما برای تم جاری.
 *
 * @param {string} schema نام اسکیما، مثلاً «FIN3»
 * @param {boolean} isDark تم فعال تیره است یا نه
 */
export function schemaAccent(schema = "", isDark = true) {
  const key = `${schema}|${isDark ? "d" : "l"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const known = KNOWN[schema];
  const [h, s] = HUES[known ? known.hue : hashIndex(schema || "?")];

  const accent = isDark
    ? {
        // روی مشکی: خط پررنگ، تو‌پُری کم‌رمق، متن روشن
        stroke: `hsl(${h} ${s}% 58%)`,
        fill: `hsl(${h} ${Math.round(s * 0.7)}% 12%)`,
        text: `hsl(${h} ${Math.min(s + 15, 85)}% 72%)`,
        soft: `hsl(${h} ${s}% 58% / 0.16)`,
        ring: `hsl(${h} ${s}% 58% / 0.42)`,
      }
    : {
        // روی سفید: خط تیره‌تر برای کنتراست، تو‌پُری بسیار روشن
        stroke: `hsl(${h} ${Math.round(s * 0.9)}% 38%)`,
        fill: `hsl(${h} ${Math.round(s * 0.6)}% 96%)`,
        text: `hsl(${h} ${Math.round(s * 0.95)}% 30%)`,
        soft: `hsl(${h} ${s}% 42% / 0.12)`,
        ring: `hsl(${h} ${s}% 42% / 0.38)`,
      };

  const value = { ...accent, label: known?.label || schema, hue: h };
  cache.set(key, value);
  return value;
}

/** عنوان فارسی اسکیما، اگر شناخته‌شده باشد. */
export function schemaLabel(schema = "") {
  return KNOWN[schema]?.label || "";
}

/** «FIN3 · مالی» برای نمایش در فهرست‌ها. */
export function schemaTitle(schema = "") {
  const label = schemaLabel(schema);
  return label ? `${schema} · ${label}` : schema;
}
