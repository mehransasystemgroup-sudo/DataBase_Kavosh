/**
 * نرمال‌سازی متن جست‌وجو — همتای backend/core/textnorm.py.
 *
 * باید دقیقاً مثل نسخهٔ پایتون رفتار کند: ایندکس با آن ساخته شده و اگر این
 * سمت کمی متفاوت نرمال کند، جست‌وجو بی‌صدا نتیجهٔ کمتری می‌دهد.
 */

// حروف عربی → فارسی: متن دانش تمیز است، ولی کاربر با کیبورد عربی تایپ می‌کند
const ARABIC_TO_PERSIAN = {
  "ي": "ی", // ي → ی
  "ى": "ی", // ى → ی
  "ك": "ک", // ك → ک
  "ة": "ه", // ة → ه
  "أ": "ا", // أ → ا
  "إ": "ا", // إ → ا
  "آ": "ا", // آ → ا
  "ؤ": "و", // ؤ → و
  "ئ": "ی", // ئ → ی
  "‌": " ", // نیم‌فاصله
  "‏": " ",
  "‎": " ",
};

const ARABIC_RE = new RegExp(`[${Object.keys(ARABIC_TO_PERSIAN).join("")}]`, "g");
const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;
const PERSIAN_DIGITS = /[۰-۹٠-٩]/g;
// حرف و رقم با بازه‌های صریح (لاتین، یونانی، سیریلیک، عربی/فارسی)؛ \p{L} در WebView قدیمی اندروید نیست
const PUNCT = /[^A-Za-z0-9_\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0370-\u03FF\u0400-\u04FF\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
const CAMEL = /[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g;
const IDENTIFIER = /^[A-Za-z0-9_.]+$/;

// پسوندهای رایج فارسی — بلندترین اول، وگرنه «های» پیش از «هایی» می‌گیرد
const SUFFIXES = ["هایی", "های", "ها", "ات", "ان", "ی", "ٔ"];

const digitOffset = (ch) => {
  const code = ch.codePointAt(0);
  const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
  return String(code - base);
};

/** نرمال‌سازی برای مقایسه و ایندکس. */
export function normalize(text) {
  if (!text) return "";
  return String(text)
    .normalize("NFKC")
    .replace(ARABIC_RE, (ch) => ARABIC_TO_PERSIAN[ch])
    .replace(DIACRITICS, "")
    .replace(PERSIAN_DIGITS, digitOffset)
    .replace(PUNCT, " ")
    .trim()
    .split(/\s+/)
    .join(" ")
    .toLowerCase();
}

/**
 * ریشه‌یابی سبک فارسی.
 *
 * کاربر «فیش حقوقی» می‌نویسد ولی عنوان جدول «فیش حقوق» است؛ جست‌وجوی پیشوندی
 * FTS هرگز واژهٔ کوتاه‌تر را پیدا نمی‌کند. محافظه‌کارانه: فقط واژه‌های بلندتر
 * از ۴ حرف و فقط اگر دست‌کم ۳ حرف باقی بماند.
 */
export function stemFa(word) {
  if (word.length <= 4 || !/[؀-ۿ]/.test(word)) return word;
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/** VoucherItem → ['VoucherItem', 'Voucher', 'Item'] */
export function splitCamel(name) {
  const parts = name.match(CAMEL) || [];
  return parts.length > 1 ? [name, ...parts] : [name];
}

/** متن قابل ایندکس از نام انگلیسی + عنوان فارسی + توضیح. */
export function buildSearchText(...fragments) {
  const out = [];
  for (const frag of fragments) {
    if (!frag) continue;
    if (IDENTIFIER.test(frag)) {
      for (const token of frag.replace(/\./g, " ").split(/\s+/)) {
        if (token) out.push(...splitCamel(token));
      }
    } else {
      out.push(frag);
    }
  }
  return normalize(out.join(" "));
}
