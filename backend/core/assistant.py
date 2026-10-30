"""
دستیار کوئری‌نویسی — از پرسش فارسی تا کوئری تأییدشده.

ایدهٔ مرکزی، که همهٔ طراحی از آن می‌آید:

    مدل زبانی هرگز ساختار پایگاه داده را از خودش نمی‌سازد.
    ساختار را ما می‌دهیم، و هرچه بنویسد را ما می‌سنجیم.

پس کار به شش مرحله شکسته شده و در هر مرحله نقش مدل تا جای ممکن کوچک است:

    ۰) فهم        — مدل هنوز کوئری نمی‌نویسد؛ فقط خواستهٔ کاربر را در قالبی
                    ثابت بازنویسی می‌کند: هدف، خروجی، فیلترها، فرض‌ها و
                    ابهام‌ها. کلیدواژه‌هایش جست‌وجو را دقیق‌تر می‌کند و خودِ
                    برداشت به نگارش داده می‌شود. اگر خروجی‌اش بی‌معنا بود،
                    با خودِ پرسش ادامه می‌دهیم.
    ۱) بازیابی    — جدول‌های نامزد با جست‌وجوی فارسیِ خودِ برنامه پیدا می‌شوند،
                    و بعد از راه روابط گسترش می‌یابند: جدول‌های مرجعِ نامزدهای
                    برتر (شخص، کالا، سال مالی) و جدول‌های جزئیاتشان (سند ←
                    اقلام سند). جدول‌هایی که کاربر خودش سنجاق کرده همیشه هستند.
                    مدل فقط کلیدواژه داده؛ نام جدولی از او پذیرفته نمی‌شود.
    ۲) انتخاب     — مدل فقط از میان همان نامزدها انتخاب می‌کند، و نقشهٔ
                    پیوندهای مستقیمِ میانشان را هم می‌بیند تا جدول واسطه را
                    جا نیندازد. هر نامی که در فهرست نباشد دور ریخته می‌شود، و
                    اگر خروجی‌اش بی‌معنا بود، به نتیجهٔ بازیابی برمی‌گردیم.
    ۳) زمینه‌سازی  — ستون‌ها، کلید اصلی، شرح جدول، مقادیر کد و شرحی، ارجاع‌های
                    هر جدول، هشدارهای داده و سال مالی و — مهم‌تر از همه — شرط‌های
                    JOIN و هشدار مسیرهای بلند از ایندکس بیرون کشیده می‌شوند.
                    مدل JOIN نمی‌سازد؛ JOIN را به او می‌دهیم.
    ۴) نگارش      — مدل با همین زمینه کوئری می‌نویسد.
    ۵) بازبینی    — sqlcheck کوئری را کلمه‌به‌کلمه با ساختار می‌سنجد. اگر
                    ایرادی بود، متن ایراد به مدل پس داده می‌شود و دور بعد.

و این‌جاست که خواستهٔ «مدل ضعیف هم جواب دقیق بدهد» برآورده می‌شود: مدل ضعیف
دورِ بیشتری می‌زند — گاهی سه چهار دور — ولی هر دور با واقعیت سنجیده می‌شود و
چیزی که تأیید نشده باشد هرگز به‌عنوان تأییدشده نشان داده نمی‌شود. کندتر، بله.
مبهم، نه.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Iterable

from core.search import KnowledgeBase
from core.sqlcheck import CheckResult, SchemaIndex, check_sql, extract_sql

MAX_CANDIDATES = 36
MAX_CHOSEN = 7
MAX_PINNED = 5
# گسترش از راه روابط: چند نامزد برتر، و از هرکدام چند مرجع و چند جدول جزئیات
EXPAND_SEEDS = 5
EXPAND_OUT = 4
EXPAND_IN = 3
EXPAND_WEIGHT = 0.6
DEFAULT_ATTEMPTS = 4

Emit = Callable[[str, str, dict], None]


@dataclass
class Draft:
    sql: str = ""
    note: str = ""
    check: CheckResult | None = None
    attempts: int = 0
    tables: list[str] = field(default_factory=list)
    joins: list[str] = field(default_factory=list)
    kind: str = "query"              # query | guidance
    intent: dict = field(default_factory=dict)


# ───────────────────────── ۰) فهم خواسته ─────────────────────────


MAX_HISTORY = 3
MAX_KEYWORDS = 6

UNDERSTAND_SYSTEM = """تو تحلیلگر نیازمندی‌های یک پایگاه دادهٔ سازمانی روی SQL Server هستی.
هنوز کوئری نمی‌نویسی؛ فقط باید دقیق بفهمی کاربر واقعاً چه می‌خواهد.

پرسش کاربر را (و اگر آمده، گفت‌وگوی قبلی را) بخوان و برداشتت را دقیقاً در
همین قالب بنویس، هر مورد در یک سطر. موردی که در پرسش نیامده را با «—» پر کن.

هدف: خواستهٔ کاربر در یک جملهٔ کامل و مستقل؛ اگر پرسش ادامهٔ گفت‌وگوی قبلی است، آنچه از قبل مانده را هم در همین جمله بیاور
نوع: کوئری یا راهنمایی
کلیدواژه‌ها: مفهوم‌های اصلی به فارسی، و اگر می‌دانی معادل انگلیسی‌شان، با «،» جدا
خروجی: ستون‌ها یا مقدارهایی که باید برگردد
فیلترها: شرط‌ها
گروه‌بندی: —
مرتب‌سازی: —
بازهٔ زمانی: —
فرض‌ها: هر فرضی که برای پرکردن جای خالی کردی
ابهام‌ها: پرسش‌هایی که پاسخشان نتیجه را عوض می‌کند، با «|» جدا؛ اگر نیست «—»

هیچ توضیح دیگری ننویس."""

INTENT_FIELDS = (
    ("goal", "هدف"), ("mode", "نوع"), ("keywords", "کلیدواژه‌ها"),
    ("output", "خروجی"), ("filters", "فیلترها"), ("grouping", "گروه‌بندی"),
    ("ordering", "مرتب‌سازی"), ("period", "بازهٔ زمانی"),
    ("assumptions", "فرض‌ها"), ("questions", "ابهام‌ها"),
)

# برچسب‌ها با املای گوناگون می‌آیند (بی‌نیم‌فاصله، «بازه زمانی»، مفرد)؛ پس
# پیش از مقایسه یکدست می‌شوند و مفرد هم پذیرفته است.
_EMPTY = {"", "—", "-", "–", "ندارد", "هیچ", "نامشخص", "ندارد.", "—."}


def _norm_label(text: str) -> str:
    text = text.replace("ي", "ی").replace("ك", "ک")
    text = re.sub(r"[‌ٔ\s*#_`]", "", text)
    return text.replace("ۀ", "ه")


_LABELS: dict[str, str] = {}
for _key, _label in INTENT_FIELDS:
    _LABELS[_norm_label(_label)] = _key
for _label, _key in (("کلیدواژه", "keywords"), ("فیلتر", "filters"),
                     ("فرض", "assumptions"), ("ابهام", "questions"),
                     ("پرسشهایروشنکننده", "questions")):
    _LABELS[_label] = _key


def _empty_intent() -> dict:
    out = {key: "" for key, _ in INTENT_FIELDS}
    out.update(mode="query", keywords=[], questions=[])
    return out


def parse_intent(reply: str) -> dict:
    """
    برداشت مدل را از متن بیرون می‌کشد — هر سطرِ «برچسب: مقدار».

    باز هم JSON نخواستیم، به همان دلیل مرحلهٔ انتخاب. سطری که برچسبش
    شناخته نشود نادیده گرفته می‌شود؛ اگر «هدف» پیدا نشد، کل برداشت تهی است
    و کار با خودِ پرسش ادامه می‌یابد.
    """
    out = _empty_intent()
    for line in (reply or "").splitlines():
        m = re.match(r"^\s*(?:[-*•]\s*)?([^:：]{1,30})[:：]\s*(.*)$", line)
        if not m:
            continue
        key = _LABELS.get(_norm_label(m.group(1)))
        value = m.group(2).strip().strip("*").strip()
        if not key or value in _EMPTY:
            continue
        if key == "keywords":
            out[key] = [w.strip() for w in re.split(r"[،,;؛]", value)
                        if w.strip() and w.strip() not in _EMPTY][:MAX_KEYWORDS]
        elif key == "questions":
            out[key] = [q.strip() for q in value.split("|")
                        if q.strip() and q.strip() not in _EMPTY][:4]
        elif key == "mode":
            out[key] = "guidance" if "راهنما" in value else "query"
        else:
            out[key] = value
    if not out["goal"]:
        return _empty_intent()
    return out


def brief_text(intent: dict) -> str:
    """برداشت به شکلی که به مراحل بعد داده می‌شود؛ فقط موردهای پُر."""
    if not intent or not intent.get("goal"):
        return ""
    lines = []
    for key, label in INTENT_FIELDS:
        if key in ("mode", "keywords", "questions"):
            continue
        if intent.get(key):
            lines.append(f"{label}: {intent[key]}")
    return "\n".join(lines)


def clean_history(history: Iterable[dict] | None) -> list[dict]:
    """گفت‌وگوی قبلی از رابط کاربری می‌آید؛ اندازه و شکلش این‌جا مهار می‌شود."""
    out = []
    for item in list(history or [])[-MAX_HISTORY:]:
        if not isinstance(item, dict):
            continue
        q = str(item.get("question") or "").strip()[:2000]
        if not q:
            continue
        sql = str(item.get("sql") or "").strip()[:8000]
        tables = [str(t)[:128] for t in (item.get("tables") or []) if t][:10]
        out.append({"question": q, "sql": sql, "tables": tables})
    return out


def history_text(history: list[dict]) -> str:
    if not history:
        return ""
    parts = ["## گفت‌وگوی قبلی", ""]
    for i, item in enumerate(history, 1):
        parts.append(f"پرسش {i}: {item['question']}")
        if item.get("sql"):
            parts += [f"کوئری {i}:", "```sql", item["sql"], "```"]
        parts.append("")
    return "\n".join(parts).rstrip()


def understand_prompt(question: str, history: list[dict]) -> str:
    head = history_text(history)
    return (head + "\n\n" if head else "") + f"## پرسش تازه\n\n{question}"


# ───────────────────────── ۱) بازیابی ─────────────────────────


def clean_pinned(kb: KnowledgeBase, pinned: Iterable[str] | None) -> list[str]:
    """جدول‌های سنجاق‌شدهٔ کاربر — فقط آن‌هایی که واقعاً در ایندکس هستند."""
    out: list[str] = []
    for full in list(pinned or [])[:MAX_PINNED * 2]:
        info = kb.get_table(str(full).strip()[:128])
        if info is not None and info.full_name not in out:
            out.append(info.full_name)
    return out[:MAX_PINNED]


def retrieve(
    kb: KnowledgeBase,
    question: str,
    keywords: Iterable[str] = (),
    previous: Iterable[str] = (),
    pinned: Iterable[str] = (),
) -> list[dict]:
    """
    جدول‌های نامزد برای این پرسش.

    از سه راه، چون هیچ‌کدام به‌تنهایی کافی نیست: کاربر ممکن است نام فارسی
    جدول را بگوید، یا نام یک ستون را، یا نام یک نوع کد و شرحی را. کلیدواژه‌های
    مرحلهٔ فهم همان جست‌وجو را با واژه‌های دیگر تکرار می‌کنند — پرسشِ
    محاوره‌ای اغلب واژهٔ جدول را ندارد. جدول‌های پرسش قبلی هم نامزد می‌مانند،
    وگرنه «حالا فقط امسال» ربطش را به گفت‌وگو از دست می‌دهد.

    بعد، گسترش از راه روابط: گزارشِ واقعی تقریباً هیچ‌وقت از یک جدول درنمی‌آید.
    «جمع مبلغ اسناد هر حساب» سند را پیدا می‌کند، ولی مبلغ در اقلام سند است و
    نام حساب در جدول حساب — هیچ‌کدام در متن پرسش نیامده‌اند. پس مرجع‌ها و
    جدول‌های جزئیاتِ نامزدهای برتر (و جدول‌های سنجاق‌شده) هم نامزد می‌شوند،
    با امتیازی کمتر از خودِ آن نامزد.
    """
    seen: dict[str, dict] = {}

    def add(full: str, title: str | None, why: str, score: float) -> None:
        row = seen.get(full)
        if row is None:
            seen[full] = {"full_name": full, "title_fa": title, "why": why,
                          "score": score}
        elif score > row["score"]:
            row["score"], row["why"] = score, why

    for hit in kb.search_tables(query=question, limit=MAX_CANDIDATES):
        add(hit.full_name, hit.title_fa, hit.why or "نام جدول", hit.score)

    for col in kb.search_columns(question, limit=20):
        table = col.get("table") or col.get("table_ref") or ""
        if table:
            add(table, col.get("title_fa"), f"ستون {col.get('name')}", 1.0)

    for word in list(dict.fromkeys(keywords))[:MAX_KEYWORDS]:
        for hit in kb.search_tables(query=word, limit=8):
            add(hit.full_name, hit.title_fa, f"کلیدواژهٔ «{word}»", hit.score)
        for col in kb.search_columns(word, limit=8):
            table = col.get("table") or col.get("table_ref") or ""
            if table:
                add(table, col.get("title_fa"), f"ستون {col.get('name')}", 1.0)

    direct = sorted(seen.values(), key=lambda r: -r["score"])
    top = max((r["score"] for r in direct), default=1.0)
    for full in previous:
        info = kb.get_table(full)
        if info is not None:
            add(info.full_name, info.title_fa, "گفت‌وگوی قبلی", top + 1.0)
    pins = clean_pinned(kb, pinned)
    for full in pins:
        add(full, kb.get_table(full).title_fa, "انتخاب شما", top + 2.0)

    seeds: list[tuple[str, float]] = [(full, seen[full]["score"]) for full in pins]
    for row in direct[:EXPAND_SEEDS]:
        if row["full_name"] not in pins:
            seeds.append((row["full_name"], row["score"]))
    for seed, score in seeds:
        related = kb.related_tables(seed)
        refs = [r for r in related if r["direction"] == "out"][:EXPAND_OUT]
        details = [r for r in related if r["direction"] == "in"][:EXPAND_IN]
        for r in refs + details:
            add(r["full_name"], r["title_fa"], f"مرتبط با {seed}", score * EXPAND_WEIGHT)

    ordered = sorted(seen.values(), key=lambda r: -r["score"])
    return ordered[:MAX_CANDIDATES]


# ───────────────────────── ۲) انتخاب ─────────────────────────


SELECT_SYSTEM = """تو دستیار یک پایگاه دادهٔ سازمانی هستی.
از فهرست جدول‌هایی که داده می‌شود، فقط آن‌هایی را انتخاب کن که برای پاسخ به
پرسش کاربر لازم‌اند.

قواعد:
- فقط نام‌هایی را بنویس که عیناً در فهرست آمده‌اند.
- هر نام در یک سطر جدا، بدون شماره، بدون توضیح، بدون علامت.
- حداکثر {max_chosen} جدول.
- جدولی را انتخاب کن که دادهٔ خواسته‌شده واقعاً در آن است؛ مثلاً مبلغ و
  تعداد معمولاً در جدول اقلام و ردیف‌هاست، نه در جدول سربرگ.
- اگر خروجی باید نام یا شرح نشان دهد (نام شخص، شرح حساب، عنوان کالا)،
  جدول مرجعِ آن را هم انتخاب کن.
- از «پیوندهای مستقیم» ببین جدول‌ها چطور به هم می‌رسند؛ اگر دو جدولِ لازم
  مستقیم به هم وصل نیستند، جدول واسطه را هم بنویس.
- جدول‌هایی که کاربر خودش انتخاب کرده همیشه به کار می‌روند؛ لازم نیست تکرارشان کنی.
- اگر مطمئن نیستی، جدول‌های محتمل‌تر را بنویس."""


MAX_LINKS = 40


def candidate_links(kb: KnowledgeBase, candidates: list[dict]) -> list:
    """
    پیوندهای مستقیم میان نامزدها، آن‌هایی که به نامزدهای برتر می‌رسند اول.

    ترتیب الفبایی کافی نیست: با ۳۶ نامزد صدها پیوند هست و پیوندِ سند به
    اقلام سند ممکن است زیر پیوندهای جدول‌های بی‌ربط گم شود.
    """
    rank = {c["full_name"]: i for i, c in enumerate(candidates)}
    links = kb.links_between(list(rank))
    links.sort(key=lambda s: (min(rank[s.from_table], rank[s.to_table]),
                              max(rank[s.from_table], rank[s.to_table])))
    return links[:MAX_LINKS]


def _link_line(step) -> str:
    return f"{step.from_table}.{step.from_col} → {step.to_table}"


def select_prompt(question: str, candidates: list[dict], links: Iterable = (),
                  goal: str = "", pinned: Iterable[str] = ()) -> str:
    """پرامپت انتخاب: نامزدها، دلیل نامزدی، و نقشهٔ پیوندهای مستقیم میانشان."""
    listing = "\n".join(
        c["full_name"]
        + (f" — {c['title_fa']}" if c.get("title_fa") else "")
        + (f"  · {c['why']}" if c.get("why") else "")
        for c in candidates
    )
    parts = [f"## جدول‌های موجود\n{listing}"]
    lines = [_link_line(step) for step in links]
    if lines:
        parts.append("## پیوندهای مستقیم میان این جدول‌ها\n" + "\n".join(lines))
    pins = list(pinned)
    if pins:
        parts.append("## جدول‌هایی که کاربر خودش انتخاب کرده\n" + "\n".join(pins))
    parts.append(f"## پرسش\n{question}")
    if goal:
        parts.append(f"## هدف\n{goal}")
    return "\n\n".join(parts)


def parse_selection(reply: str, candidates: Iterable[dict]) -> list[str]:
    """
    نام جدول‌ها را از پاسخ مدل بیرون می‌کشد — با سخت‌گیری.

    عمداً JSON نخواستیم: مدل‌های کوچک JSON را نیمه‌کاره می‌بندند و کل مرحله
    هدر می‌رود. در عوض هر نامی که *در متن پاسخ دیده شود* و در فهرست نامزدها
    باشد پذیرفته می‌شود. این هم به پاسخ تمیز جواب می‌دهد و هم به پاسخی که
    وسط دو پاراگراف توضیح گم شده.
    """
    valid = {c["full_name"].lower(): c["full_name"] for c in candidates}
    text = (reply or "").lower()
    found: list[str] = []
    for low, real in valid.items():
        if re.search(rf"(?<![\w.]){re.escape(low)}(?![\w])", text) and real not in found:
            found.append(real)
    return found[:MAX_CHOSEN]


# ───────────────────────── ۳) زمینه‌سازی ─────────────────────────


MAX_DESCRIPTION = 200
MAX_REFS = 12
AUDIT_COLUMNS = ("Creator", "LastModifier")


def _bracketed(full: str) -> str:
    return f"[{full.replace('.', '].[')}]"


def _short(text: str | None, limit: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _table_block(kb: KnowledgeBase, full: str) -> str:
    info = kb.get_table(full)
    if info is None:
        return ""
    head = _bracketed(full)
    if info.title_fa:
        head += f" — {info.title_fa}"
    if info.row_count is not None:
        head += f"  ({info.row_count} ردیف)"

    lines = [head]
    description = _short(info.description_fa, MAX_DESCRIPTION)
    if description and description != info.title_fa:
        lines.append("  شرح: " + description)
    if info.primary_key:
        lines.append("  کلید اصلی: " + ", ".join(info.primary_key))

    cols = []
    for c in info.columns:
        piece = f"{c['name']}:{c.get('type') or '?'}"
        if c.get("label_fa"):
            piece += f"({c['label_fa']})"
        cols.append(piece)
    lines.append("  ستون‌ها: " + ", ".join(cols))

    for col, values in (info.enums or {}).items():
        shown = ", ".join(
            f"{v['value']}={v.get('label_fa') or '?'}" for v in values[:15]
        )
        lines.append(f"  مقادیر {col}: {shown}")

    # ارجاع‌های تأییدشده: مدل می‌بیند هر ستونِ Ref به کدام جدول می‌رسد، حتی
    # وقتی آن جدول در زمینه نیامده — و می‌فهمد برای نام و شرح کجا برود.
    # گروه‌بندی بر پایهٔ جدول مقصد است، وگرنه بیست ستون DLLevel که همه به
    # یک جدول می‌روند جای PartyRef و VoucherRef را می‌گیرند.
    targets: dict[str, list[str]] = {}
    for col, to in sorted({(j.from_col, j.to_table) for j in info.outgoing
                           if j.verified and j.from_col not in AUDIT_COLUMNS}):
        targets.setdefault(to, []).append(col)
    if targets:
        groups = sorted(targets.items(), key=lambda kv: kv[1][0])[:MAX_REFS]
        shown = ", ".join(
            "/".join(cols[:3]) + ("/…" if len(cols) > 3 else "") + "→" + _bracketed(to)
            for to, cols in groups
        )
        lines.append("  ارجاع‌ها: " + shown)
    for warning in info.warnings:
        if "تأییدنشده است" not in warning:
            lines.append("  هشدار: " + warning)
    return "\n".join(lines)


def build_context(kb: KnowledgeBase, chosen: list[str]) -> tuple[str, list[str], list[str]]:
    """
    متن ساختار + فهرست جدول‌های نهایی + شرط‌های JOIN.

    نکتهٔ ظریف: اگر مسیرِ پیوندِ دو جدولِ انتخاب‌شده از جدول سومی رد شود، آن
    جدول سوم هم باید در زمینه بیاید — وگرنه مدل شرط JOIN را می‌بیند ولی
    ستون‌های جدول میانی را نمی‌شناسد و مجبور می‌شود از خودش بسازد.
    """
    tables = list(dict.fromkeys(chosen))
    joins: list[str] = []
    bridges: list[str] = []
    cautions: list[str] = []

    for i, a in enumerate(tables):
        for b in tables[i + 1:]:
            # اول از میان خودِ جدول‌های انتخاب‌شده؛ فقط اگر نشد جدول واسطهٔ تازه.
            path = kb.find_join_path(a, b, through=tables)
            if not path:
                path = kb.find_join_path(a, b)
                caution = kb.path_warning(path) if path else None
                if caution:
                    cautions.append(f"- {a} ↔ {b}: {caution}")
            if not path:
                continue
            for step in path:
                clause = (
                    f"[{step.from_table.replace('.', '].[')}].[{step.from_col}]"
                    f" = [{step.to_table.replace('.', '].[')}].[{step.to_col}]"
                )
                mark = "" if step.verified else "   (تأییدنشده — استنتاج از نام)"
                line = clause + mark
                if line not in joins:
                    joins.append(line)
                for t in (step.from_table, step.to_table):
                    if t not in tables and t not in bridges:
                        bridges.append(t)

    everything = tables + bridges
    blocks = [b for b in (_table_block(kb, t) for t in everything) if b]

    parts = ["### جدول‌ها — فقط از همین‌ها و فقط با همین ستون‌ها استفاده کن", ""]
    parts.extend(blocks)
    if bridges:
        parts += ["", "(جدول‌های " + "، ".join(bridges) +
                  " واسطهٔ پیوندند و برای همین آمده‌اند.)"]
    if joins:
        parts += ["", "### پیوندهای شناخته‌شده — شرط JOIN را عیناً از این‌جا بردار", ""]
        parts.extend(joins)
    else:
        parts += ["", "(بین این جدول‌ها پیوند ثبت‌شده‌ای نیست.)"]
    if cautions:
        parts += ["", "### هشدار مسیرها — پیش از استفاده بسنج", ""]
        parts.extend(cautions)
    return "\n".join(parts), everything, joins


# ───────────────────────── ۴) نگارش ─────────────────────────


DRAFT_SYSTEM = """تو یک کارشناس ارشد T-SQL روی SQL Server هستی و به فارسی، دقیق و قدم‌به‌قدم پاسخ می‌دهی.

قواعد غیرقابل‌مذاکره:
۱. فقط از جدول‌ها و ستون‌هایی استفاده کن که در «ساختار» آمده‌اند. هیچ نام
   دیگری ننویس — اگر چیزی در ساختار نیست، یعنی وجود ندارد. جدولی که فقط در
   سطر «ارجاع‌ها» آمده و بلوک ستون‌هایش نیامده را نمی‌شناسی؛ از آن جز همان
   ستونِ پیوند چیزی ننویس.
۲. شرط‌های JOIN را عیناً از بخش «پیوندهای شناخته‌شده» یا سطر «ارجاع‌ها»
   بردار. پیوند از خودت نساز. پیوندِ «تأییدنشده» را فقط وقتی به کار ببر که
   راه دیگری نیست، و در «نکته‌ها» بگو.
۳. فقط خواندنی: SELECT، و در صورت نیاز WITH و DECLARE. هیچ
   INSERT/UPDATE/DELETE/DROP/EXEC ننویس.
۴. شناسه‌ها را داخل براکت بگذار: [SCHEMA].[Table].[Column] و برای هر جدول
   نام مستعار کوتاه بگذار.
۵. اگر جدولی ستون FiscalYearRef دارد، فیلتر سال مالی را حتماً بگذار؛ وگرنه
   خروجی بی‌خطا ولی غلط می‌شود. اگر BranchRef دارد، فیلتر شعبه را هم بگذار؛
   اگر گزارش برای همهٔ شعب است، اختیاری: (@BranchRef IS NULL OR x.[BranchRef] = @BranchRef).
۶. مقدارهای نمونه (سال مالی، تاریخ، کد، شناسه) را در ابتدای کوئری با DECLARE
   و نامی گویا تعریف کن تا کاربر فقط همان‌جا را عوض کند.
۷. برای ستونی که «مقادیر»ش آمده، در فیلتر فقط از همان مقدارها استفاده کن، و
   اگر خروجی برای خواندن است کنار عدد، شرح فارسی‌اش را با CASE برگردان.
۸. جدول مرجع (نام شخص، شرح حساب، عنوان کالا) را با LEFT JOIN بیاور تا ردیفی
   گم نشود، مگر خواسته صریحاً چیز دیگری باشد. در جمع و شمارش مراقب باش JOIN
   به جدول جزئیات ردیف‌ها را چند برابر نکند.
۹. اگر «گفت‌وگوی قبلی» آمده و پرسش تازه ادامهٔ آن است، کوئری قبلی را مبنا
   بگیر و فقط همان چیزی را عوض کن که خواسته شده.
۱۰. اگر جایی از خواسته مبهم است، معقول‌ترین برداشت را برگزین و آن را در
   «نکته‌ها» صریح بنویس؛ هیچ فرضی را بی‌صدا نکن.
۱۱. اگر دادهٔ لازم در ساختار نیست، کوئری ساختگی ننویس؛ بلوک ```sql نگذار و
   به‌جایش راهکار رسیدن به گزارش را قدم‌به‌قدم بگو: از کدام جدول‌های موجود،
   با چه کمبودی، و چه چیزی باید روشن شود.
۱۲. اگر جدول ستون State دارد، یا رویش فیلتر کن یا آن را با CASE نمایش بده؛
   شاخهٔ ELSE را هرگز حذف نکن تا مقدار ناشناخته دیده شود.
۱۳. همهٔ تاریخ‌های این پایگاه داده میلادی (datetime)‌اند. بازهٔ تاریخ را نیم‌باز
   بنویس: x.[Date] >= @FromDate AND x.[Date] < DATEADD(day, 1, @ToDate) — نه
   BETWEEN، که رکوردهای ساعت‌دار روز آخر را جا می‌اندازد. برای نمایش شمسی
   FORMAT(x.[Date], N'yyyy/MM/dd', N'fa-IR') یا توابع آمادهٔ SYS3
   (fnGetPersianYearMonth، fnGetDateFromPersianDate) را به کار ببر. سند را با
   [Date] فیلتر کن نه با CreationDate.
۱۴. ستون Version از نوع rowversion است: هرگز نمایشش نده و رویش JOIN یا
   مرتب‌سازی نکن. پیوندی که روی ReferenceRef است را بدون شرط ReferenceType ننویس.
۱۵. حذف نرم سراسری نیست؛ فیلتر IsDeleted را فقط وقتی بگذار که آن ستون در همان
   جدول در «ساختار» آمده باشد.
۱۶. عدد را با FORMAT به متن تبدیل نکن (در خروجی Excel گزارش جمع‌پذیر نمی‌ماند).
   به هر ستون خروجی نام مستعار انگلیسی یکتا و بی‌فاصله بده و عنوان فارسی‌اش را
   با کامنت «-- عنوان» کنار همان سطر بنویس؛ این نام‌ها فیلدهای گزارش RDL می‌شوند.
۱۷. هر فرضی دربارهٔ معنای مقدارها (State، Type، فلگ‌ها) که در «مقادیر» ساختار
   نیامده را در «نکته‌ها» با عبارت «فرضی / نیازمند تأیید» علامت بزن و یک کوئری
   تشخیصی کوتاه پیشنهاد کن (SELECT ستون، COUNT(*) … GROUP BY ستون).

قالب پاسخ — دقیقاً با همین عنوان‌ها:

### برداشت
یک یا دو جمله: این کوئری دقیقاً چه چیزی را برمی‌گرداند.

### مراحل
فهرست شماره‌دار و کوتاه از ساختن کوئری: از کدام جدول شروع می‌شود و چرا،
کدام پیوندها، چه فیلترهایی، چه گروه‌بندی و مرتب‌سازی‌ای. در هر مرحله نام
فارسی جدول یا ستون را هم بیاور.

```sql
-- کوئری کامل
```

### نکته‌ها
فرض‌هایی که کردی (اثبات‌نشده‌ها با «فرضی / نیازمند تأیید»)، آنچه کاربر باید
پیش از اجرا بررسی یا جایگزین کند (مثلاً مقدارهای DECLARE)، هشدارهای ساختار که
به این گزارش مربوط‌اند، و اگر لازم است یک نکتهٔ کارایی.

اگر کاربر کوئری نمی‌خواهد و فقط راهنمایی می‌خواهد، بلوک ```sql نگذار؛ به‌جایش
با همین سه عنوان قدم‌به‌قدم راهنمایی کن."""


def _preamble(history: list[dict], intent: dict) -> str:
    parts = []
    head = history_text(history)
    if head:
        parts.append(head)
    brief = brief_text(intent)
    if brief:
        parts.append("## برداشت از خواسته — اگر با پرسش نمی‌خواند، خودِ پرسش ملاک است\n\n"
                     + brief)
    return "\n\n".join(parts)


def draft_prompt(question: str, context: str, history: list[dict] | None = None,
                 intent: dict | None = None) -> str:
    extra = _preamble(history or [], intent or {})
    extra = extra + "\n\n" if extra else ""
    return f"""## ساختار

{context}

{extra}## پرسش کاربر

{question}"""


def repair_prompt(question: str, context: str, sql: str, result: CheckResult,
                  history: list[dict] | None = None, intent: dict | None = None) -> str:
    extra = _preamble(history or [], intent or {})
    extra = extra + "\n\n" if extra else ""
    return f"""## ساختار

{context}

{extra}## پرسش کاربر

{question}

## کوئری قبلی تو

```sql
{sql}
```

## ایرادهایی که بازبین گرفت

{result.feedback()}

کوئری را با توجه به همین ایرادها اصلاح کن. فقط از جدول‌ها و ستون‌های بخش
«ساختار» استفاده کن. دوباره کل کوئری اصلاح‌شده را داخل یک بلوک ```sql بده؛
اگر برداشت یا مراحل هم عوض شد، آن‌ها را با همان قالب بنویس."""


def split_reply(reply: str) -> tuple[str, str]:
    """کوئری و توضیح فارسی را از پاسخ جدا می‌کند."""
    sql = ""
    fenced = re.findall(r"```(?:sql|tsql)?\s*\n(.*?)```", reply or "", re.S | re.I)
    if fenced:
        sql = max(fenced, key=len).strip()
        note = re.sub(r"```(?:sql|tsql)?\s*\n.*?```", "", reply, flags=re.S | re.I)
    else:
        candidate = extract_sql(reply)
        if re.match(r"^\s*(WITH|SELECT)\b", candidate, re.I):
            sql, note = candidate, ""
        else:
            note = reply or ""
    return sql.strip(), note.strip()


# ───────────────────────── اجرای کامل ─────────────────────────


def run(
    *,
    question: str,
    kb: KnowledgeBase,
    index: SchemaIndex,
    ask: Callable[[str, str], str],
    emit: Emit,
    max_attempts: int = DEFAULT_ATTEMPTS,
    history: Iterable[dict] | None = None,
    pinned: Iterable[str] | None = None,
) -> Draft:
    """
    `ask(system, user) -> str` تنها راه ارتباط با مدل است؛ هرچه بقیه لازم
    دارند از ایندکس می‌آید. همین باعث می‌شود کل این تابع با یک مدلِ ساختگی
    آزمودنی باشد، بی‌آن‌که کلید API لازم باشد.
    """
    draft = Draft()
    past = clean_history(history)
    pins = clean_pinned(kb, pinned)

    emit("understand", "فهم خواستهٔ شما", {})
    try:
        intent = parse_intent(ask(UNDERSTAND_SYSTEM, understand_prompt(question, past)))
    except Exception:                                        # noqa: BLE001
        intent = _empty_intent()
    draft.intent = intent
    if intent["goal"]:
        emit("understand", intent["goal"], {"intent": intent})
    else:
        emit("understand", "برداشت روشنی نیامد؛ با خودِ پرسش ادامه می‌دهیم", {})

    emit("retrieve", "جست‌وجو در ساختار پایگاه داده", {})
    previous = [t for item in past for t in item["tables"]]
    candidates = retrieve(kb, question, intent["keywords"], previous, pins)
    if not candidates:
        draft.kind = "guidance"
        draft.note = ("برای این پرسش جدول مرتبطی پیدا نشد. کمی مشخص‌تر بپرسید — "
                      "مثلاً نام فارسی جدول، نام یک ستون، یا ماژول موردنظر.")
        return draft
    emit("retrieve", f"{len(candidates)} جدول نامزد پیدا شد", {
        "candidates": [c["full_name"] for c in candidates],
    })

    emit("select", "انتخاب جدول‌های مرتبط", {})
    links = candidate_links(kb, candidates)
    chosen: list[str] = []
    try:
        reply = ask(
            SELECT_SYSTEM.format(max_chosen=MAX_CHOSEN),
            select_prompt(question, candidates, links, intent["goal"], pins),
        )
        chosen = parse_selection(reply, candidates)
    except Exception:                                        # noqa: BLE001
        chosen = []
    if not chosen:
        # مدل کمکی نکرد — با نتیجهٔ بازیابی ادامه می‌دهیم. بهتر از توقف است.
        rest = [c["full_name"] for c in candidates if c["full_name"] not in pins]
        chosen = pins + rest[:max(0, 4 - len(pins))]
        emit("select", "انتخاب مدل روشن نبود؛ با نتیجهٔ جست‌وجو ادامه می‌دهیم", {
            "tables": chosen,
        })
    else:
        # جدول‌های سنجاق‌شده همیشه می‌مانند، هرچه مدل گفته باشد.
        chosen = (pins + [t for t in chosen if t not in pins])[:MAX_CHOSEN]
        emit("select", f"{len(chosen)} جدول انتخاب شد", {"tables": chosen})

    emit("context", "استخراج ستون‌ها و مسیرهای پیوند", {})
    context, tables, joins = build_context(kb, chosen)
    draft.tables, draft.joins = tables, joins
    emit("context", f"{len(tables)} جدول و {len(joins)} پیوند آماده شد", {
        "tables": tables, "joins": joins,
    })

    user_prompt = draft_prompt(question, context, past, intent)
    last_result: CheckResult | None = None
    last_sql = ""

    for attempt in range(1, max_attempts + 1):
        draft.attempts = attempt
        emit("draft", ("نگارش کوئری" if attempt == 1
                       else f"اصلاح کوئری — تلاش {attempt} از {max_attempts}"),
             {"attempt": attempt})
        reply = ask(DRAFT_SYSTEM, user_prompt)
        sql, note = split_reply(reply)

        if not sql:
            draft.kind = "guidance"
            draft.note = note or reply
            emit("done", "پاسخ راهنمایی آماده شد", {})
            return draft

        last_sql, draft.sql, draft.note = sql, sql, note or draft.note
        emit("verify", "بازبینی کوئری با ساختار واقعی", {"attempt": attempt})
        result = check_sql(sql, index)
        last_result = result
        draft.check = result

        n_err, n_warn = len(result.errors), len(result.warnings)
        emit("verify", (
            "کوئری با ساختار پایگاه داده خواند" if result.ok and not n_warn
            else f"{n_err} خطا و {n_warn} هشدار پیدا شد"
        ), {"attempt": attempt, "ok": result.ok,
            "findings": [f.to_dict() for f in result.findings]})

        if result.ok and not n_warn:
            break
        # هشدارها خطا نیستند؛ یک دور برای برطرف‌کردنشان می‌ارزد، دو دور نه.
        if result.ok and attempt >= 2:
            break
        if attempt == max_attempts:
            break
        user_prompt = repair_prompt(question, context, sql, result, past, intent)

    draft.sql = last_sql
    draft.check = last_result
    emit("done", (
        "کوئری تأیید شد" if last_result and last_result.ok
        else "کوئری تأیید نشد — ایرادها در پاسخ آمده"
    ), {})
    return draft
