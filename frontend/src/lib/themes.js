/**
 * فهرست تم‌ها — یک منبع حقیقت.
 *
 * رنگ‌های واقعی در index.css زندگی می‌کنند؛ این‌جا فقط شناسنامهٔ هر تم است:
 * نامی که به کاربر نشان داده می‌شود، روشن یا تیره بودنش، خانواده‌ای که به آن
 * تعلق دارد، و چند رنگ نمونه برای دکمهٔ انتخاب.
 *
 * چرا خانواده: کلید روشن/تیره باید کاربر را به جفتِ همان تم ببرد، نه به یک
 * تم بی‌ربط. با «خانواده» این کار یک جست‌وجوی ساده می‌شود و افزودن تم تازه
 * هیچ تغییری در منطق نمی‌خواهد — فقط یک سطر به این فهرست.
 *
 * `bg` این‌جا تکرار رنگ زمینهٔ همان تم در CSS است و دو مصرف دارد که هر دو
 * بیرون از CSS‌اند: رنگ نوار مرورگر (meta theme-color) و رنگ نوار وضعیت در
 * پوستهٔ اندروید. هر تغییری در --bg باید این‌جا هم بیاید.
 */

export const THEMES = [
  {
    id: "midnight",
    name: "نیمه‌شبِ نیلی",
    hint: "پیش‌فرض · خاکستری و نیلی",
    mode: "dark",
    family: "indigo",
    bg: "#0A0E17",
    swatch: ["#0A0E17", "#4668F0", "#9DB4FF"],
  },
  {
    id: "daylight",
    name: "روزِ نیلی",
    hint: "پالت نیلی، برای روز",
    mode: "light",
    family: "indigo",
    bg: "#F4F6FB",
    swatch: ["#F4F6FB", "#2E51D8", "#0E1729"],
  },
  {
    id: "emerald-night",
    name: "شبِ زمرد",
    hint: "تم پیشین برنامه",
    mode: "dark",
    family: "emerald",
    bg: "#050806",
    swatch: ["#050806", "#22C55E", "#4ADE80"],
  },
  {
    id: "emerald-day",
    name: "روزِ زمرد",
    hint: "تم پیشین، روشن",
    mode: "light",
    family: "emerald",
    bg: "#F4F8F5",
    swatch: ["#F4F8F5", "#15803D", "#0B1A12"],
  },
];

export const DEFAULT_THEME = "midnight";

export const THEME_STORAGE_KEY = "dbk_theme";

/**
 * تبدیل هر مقدار ذخیره‌شده به یک شناسهٔ معتبر.
 *
 * نسخه‌های پیشین فقط «dark» یا «light» می‌نوشتند. این دو مقدار انتخابِ
 * آگاهانهٔ کاربر نبودند — همان پیش‌فرض بودند که در اولین رندر ذخیره می‌شد —
 * پس به تم تازه نگاشته می‌شوند و فقط ترجیحِ روشن/تیرهٔ کاربر حفظ می‌شود.
 * کسی که واقعاً تم سبز را می‌خواهد، شناسهٔ صریحش را دارد و انتخابش می‌ماند.
 */
export function normalizeTheme(value) {
  if (THEMES.some((t) => t.id === value)) return value;
  if (value === "light") return "daylight";
  return DEFAULT_THEME;
}

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** جفتِ روشن/تیرهٔ همین تم، یا خودش اگر جفتی نداشت. */
export function counterpart(id) {
  const now = themeById(id);
  const other = THEMES.find((t) => t.family === now.family && t.mode !== now.mode);
  return other ? other.id : id;
}
