"""
ساختن نام فارسی ستون از روی اجزای نام انگلیسی آن.

برای ستون‌هایی که در هیچ مستندی نام فارسی ندارند، نام ستون به اجزایش شکسته
می‌شود (ConfirmDate → Confirm + Date)، هر جزء از واژه‌نامهٔ اجزا
(kb/semantics/_vocabulary.yaml)، عنوان رسمی کد و شرحی‌ها و واژه‌نامهٔ نام
ستون‌ها معنا می‌گیرد و اجزا به ترتیب فارسی چیده می‌شوند («تاریخ تأیید»).

قاعدهٔ اصلی: اگر حتی یک جزء ناشناخته باشد، هیچ نامی ساخته نمی‌شود.
"""
from __future__ import annotations

import re

_TOKEN = re.compile(r"[A-Z]+(?=[A-Z][a-z]|\d|$|_)|[A-Z]?[a-z]+|\d+")

# حرف اضافه → (معادل، آیا بخش راست پس از معادل می‌آید)
_PREPOSITIONS = {
    "from": "از", "to": "به", "to_start": "تا", "is": None, "for": "برای", "by": "توسط", "with": "با",
    "without": "بدون", "in": "در", "on": "روی", "and": "و", "or": "یا",
    "per": "به ازای", "by_mid": "بر حسب", "by_agent": "توسط", "out_of": "خارج از", "of": None, "at": "در", "after": "پس از",
    "before": "پیش از", "between": "بین", "than": "از", "via": "از طریق",
    "as": "به عنوان", "into": "به", "over": "بیش از", "under": "زیر",
}
_ID = {"id", "ids"}
# واحدی که آخر نام می‌آید داخل پرانتز می‌رود: DurationHours → «مدت (ساعت)»
_UNITS = {"hours": "ساعت", "minutes": "دقیقه", "seconds": "ثانیه", "days": "روز",
          "months": "ماه", "years": "سال"}
_ORDERING = {"column", "field", "display", "sort", "row", "level", "step", "priority",
             "item", "tab", "group", "section"}
_VERBAL = {"نیاز به ", "امکان ", "اجازهٔ ", "نادیده گرفتن "}
_VERBS_FIRST = {"show", "display", "hide"}
_PREFIXES = [  # (اجزای آغاز نام، معادل)
    (("does", "need", "to"), "نیاز به "), (("need", "to"), "نیاز به "),
    (("should", "be"), "نیاز به "), (("need",), "نیاز به "), (("needs",), "نیاز به "),
    (("has",), "دارای "), (("can",), "امکان "), (("allow",), "اجازهٔ "),
    (("ignore",), "نادیده گرفتن "), (("is",), ""), (("no",), "بدون "),
]
_REF = {"ref", "refs"}


def tokens(name: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(name)]


class Composer:
    def __init__(self, vocabulary: dict, phrases: dict[str, str]):
        self.words: dict[str, tuple[str, bool, bool]] = {}
        for word, v in (vocabulary.get("words") or {}).items():
            if isinstance(v, dict):
                self.words[str(word).lower()] = (v["fa"], bool(v.get("pre")), bool(v.get("pred")))
            elif v is not None:
                self.words[str(word).lower()] = (str(v), False, False)
        # عبارت‌های چندجزئی: از فایل واژه‌نامه، کد و شرحی‌ها و واژه‌نامهٔ ستون‌ها
        self.phrases: dict[tuple[str, ...], str] = {}
        for text, fa in (vocabulary.get("phrases") or {}).items():
            self.phrases[tuple(str(text).lower().split())] = fa or ""
        for name, fa in phrases.items():
            key = tuple(tokens(name))
            if len(key) > 1 and fa:
                self.phrases.setdefault(key, fa)
        self.adjectives = {str(a).lower() for a in vocabulary.get("adjectives") or []}
        self.longest = max((len(k) for k in self.phrases), default=1)

    # ── شکستن به بخش‌ها ──
    def _segments(self, toks: list[str]) -> list[tuple[str, str, bool, bool]] | None:
        """هر بخش: (نوع، معادل، pre، pred) — نوع یکی از word/prep/digit"""
        out, i = [], 0
        while i < len(toks):
            for n in range(min(self.longest, len(toks) - i), 1, -1):
                fa = self.phrases.get(tuple(toks[i:i + n]))
                if fa is not None:
                    if fa:
                        out.append(("word", fa, False, False))
                    elif not out and i + n == len(toks):
                        return None
                    i += n
                    break
            else:
                t = toks[i]
                if t.isdigit():
                    if not out:
                        return None
                    out.append(("digit", t, False, False))
                elif t == "out" and toks[i + 1:i + 2] == ["of"]:    # OutOfTour
                    out.append(("prep", "out_of", False, False))
                    i += 1
                elif t == "by" and i > 0 and toks[i - 1].endswith(("ed", "able", "ible")):
                    out.append(("prep", "by_agent", False, False))  # EditableByUser
                elif t in _PREPOSITIONS and 0 < i or t in ("from", "to") and i == 0:
                    out.append(("prep", t, False, False))
                elif t in self.words:
                    fa, pre, pred = self.words[t]
                    # صفتِ آخرِ نام پس از اسم می‌آید: SalesPriceEnabled → «قیمت فروش فعال»
                    if i == len(toks) - 1 and i > 0 and (t in self.adjectives or (
                            t.endswith(("able", "ible", "ed")) and not t.endswith("eed"))):
                        pred = True
                    if fa:
                        out.append(("word", fa, pre, pred))
                else:
                    return None
                i += 1
        return out

    # ── چیدن به ترتیب فارسی ──
    @staticmethod
    def _noun(segs: list) -> str:
        if not segs:
            return ""
        # رقم به بخش پیش از خود می‌چسبد: Address2 → «نشانی 2»
        merged = []
        for kind, fa, pre, pred in segs:
            if kind == "digit" and merged:
                k, f, p, d = merged[-1]
                merged[-1] = (k, f"{f} {fa}", p, d)
            else:
                merged.append((kind, fa, pre, pred))
        segs = merged
        if len(segs) > 1 and segs[-1][3]:        # DateCreated → «تاریخ ایجاد شده»
            return f"{Composer._noun(segs[:-1])} {segs[-1][1]}"
        for i, s in enumerate(segs):
            if s[2] and i == 0 and s[1] in ("آخرین", "اولین") and len(segs) > 2:
                # LastModificationDate → «تاریخ آخرین تغییر»
                return f"{segs[-1][1]} {s[1]} {Composer._noun(segs[1:-1])}"
            if s[2]:                            # حداکثر، اولین، …
                head = f"{s[1]} {Composer._noun(segs[i + 1:])}".strip()
                rest = " ".join(x[1] for x in reversed(segs[:i]))
                return f"{head} {rest}".strip()
        # اسم مرکب انگلیسی از راست به چپ خوانده می‌شود: PartUnitPrice → «قیمت واحد کالا»
        return " ".join(s[1] for s in reversed(segs))

    def _phrase(self, segs: list) -> str | None:
        for i, s in enumerate(segs):
            if s[0] == "prep":
                left, right = segs[:i], segs[i + 1:]
                if not right and s[1] == "by" and left:    # CreatedBy → «… توسط»
                    return f"{self._noun(left)} توسط"
                if not right:
                    return None
                r = self._phrase(right)
                if r is None:
                    return None
                word = _PREPOSITIONS["by_mid" if s[1] == "by" else s[1]]
                if s[1] == "out_of" and not left:
                    return f"{word} {r}"
                if s[1] == "to" and not left:            # ToDate → «تا تاریخ»
                    word = _PREPOSITIONS["to_start"]
                l = self._noun(left)
                if word is None:                # NumberOfDays → «تعداد روز»
                    return f"{l} {r}".strip() if l else None
                return f"{l} {word} {r}".strip()
        return self._noun(segs) or None

    def compose(self, name: str, is_pk: bool = False) -> str | None:
        toks = tokens(name)
        if not toks or "".join(toks) != name.lower().replace("_", ""):
            return None
        prefix, suffix, number, unit = "", "", "", ""
        for head, fa in _PREFIXES:                      # IsActive → «فعال»
            if tuple(toks[:len(head)]) == head and len(toks) > len(head):
                prefix, toks = fa, toks[len(head):]
                break
        if len(toks) > 1 and toks[-1].isdigit():         # Amount2 → «… 2»
            number, toks = toks[-1], toks[:-1]
        if len(toks) > 1 and toks[-1] in _REF:            # ConfirmerRef → «تأییدکننده»
            toks = toks[:-1]
        elif len(toks) > 1 and toks[-1] in _ID and not is_pk:
            suffix, toks = "شناسهٔ ", toks[:-1]
        if not number and len(toks) > 1 and toks[-1].isdigit():   # DLRef1
            number, toks = toks[-1], toks[:-1]
        if len(toks) > 1 and toks[-1] in _UNITS:
            unit, toks = f" ({_UNITS[toks[-1]]})", toks[:-1]
        if toks[-1] == "order" and _ORDERING & set(toks):    # DisplayOrder → ترتیب
            toks, suffix = toks[:-1], f"{suffix}ترتیب "
        verbal = prefix in _VERBAL or toks[0] in _VERBS_FIRST
        segs = self._segments(toks)
        if not segs:
            return None
        if verbal and len(segs) > 1 and segs[0][0] == "word" \
                and all(x[0] != "prep" for x in segs):
            # فعل پیش از مفعول می‌آید: CanEditPrice → «امکان ویرایش قیمت»
            body = f"{segs[0][1]} {self._noun(segs[1:])}"
        else:
            body = self._phrase(segs)
        if not body:
            return None
        text = f"{suffix}{prefix}{body}{unit} {number}"
        return re.sub(r"\s+", " ", text).strip()
