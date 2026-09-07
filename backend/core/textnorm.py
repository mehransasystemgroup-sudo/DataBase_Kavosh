"""
نرمال‌سازی متن برای جست‌وجو.

باید روی هر دو سمت اعمال شود: متن ایندکس‌شده و پرس‌وجوی کاربر.
اگر فقط یک طرف نرمال شود، جست‌وجو بی‌صدا شکست می‌خورد.
"""

from __future__ import annotations

import re
import unicodedata

# نگاشت حروف عربی → فارسی
# متن KB تمیز است، ولی کاربر معمولاً با کیبورد عربی/ویندوز تایپ می‌کند
_ARABIC_TO_PERSIAN = str.maketrans({
    "\u064A": "\u06CC",   # ي → ی
    "\u0649": "\u06CC",   # ى → ی
    "\u0643": "\u06A9",   # ك → ک
    "\u0629": "\u0647",   # ة → ه
    "\u0623": "\u0627",   # أ → ا
    "\u0625": "\u0627",   # إ → ا
    "\u0622": "\u0627",   # آ → ا
    "\u0624": "\u0648",   # ؤ → و
    "\u0626": "\u06CC",   # ئ → ی
    "\u200C": " ",        # نیم‌فاصله → فاصله
    "\u200F": " ",
    "\u200E": " ",
})

# اعراب و تشدید — در جست‌وجو نویز است
_DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")

# ارقام فارسی/عربی → لاتین
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_PUNCT = re.compile(r"[^\w\u0600-\u06FF]+")
_CAMEL = re.compile(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+")

# پسوندهای رایج فارسی — به ترتیب طول، بلندترین اول
_SUFFIXES = ("هایی", "های", "ها", "ات", "ان", "ی", "ٔ")


def stem_fa(word: str) -> str:
    """
    ریشه‌یابی سبک فارسی.

    چرا لازم است: کاربر «فیش حقوقی» می‌نویسد ولی عنوان جدول
    «فیش حقوق نفت» است. FTS با پیشوند کار می‌کند، پس «حقوقی*»
    هرگز «حقوق» را پیدا نمی‌کند — پرس‌وجو بلندتر از واژه‌ی ایندکس است.

    محافظه‌کارانه: فقط واژه‌های بلندتر از ۴ حرف، و فقط اگر
    ریشه‌ی حاصل حداقل ۳ حرف بماند.
    """
    if len(word) <= 4 or not any("\u0600" <= c <= "\u06FF" for c in word):
        return word
    for suffix in _SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)]
    return word


def normalize(text: str | None) -> str:
    """نرمال‌سازی برای مقایسه و ایندکس."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_ARABIC_TO_PERSIAN)
    text = _DIACRITICS.sub("", text)
    text = text.translate(_DIGITS)
    text = _PUNCT.sub(" ", text)
    return " ".join(text.split()).lower()


def split_camel(name: str) -> list[str]:
    """VoucherItem → ['VoucherItem', 'Voucher', 'Item']

    بدون این، جست‌وجوی «voucher» جدول VoucherItem را پیدا نمی‌کند.
    """
    parts = _CAMEL.findall(name)
    return [name] + parts if len(parts) > 1 else [name]


def build_search_text(*fragments: str | None) -> str:
    """ساخت متن قابل ایندکس از نام انگلیسی + عنوان فارسی + توضیح."""
    out: list[str] = []
    for frag in fragments:
        if not frag:
            continue
        # اگر شناسه‌ی انگلیسی است، اجزایش را هم اضافه کن
        if re.fullmatch(r"[A-Za-z0-9_.]+", frag):
            for token in frag.replace(".", " ").split():
                out.extend(split_camel(token))
        else:
            out.append(frag)
    return normalize(" ".join(out))
