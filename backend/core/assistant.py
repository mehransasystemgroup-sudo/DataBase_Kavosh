"""
دستیار کوئری‌نویسی — از پرسش فارسی تا کوئری تأییدشده.

ایدهٔ مرکزی، که همهٔ طراحی از آن می‌آید:

    مدل زبانی هرگز ساختار پایگاه داده را از خودش نمی‌سازد.
    ساختار را ما می‌دهیم، و هرچه بنویسد را ما می‌سنجیم.

پس کار به پنج مرحله شکسته شده و در هر مرحله نقش مدل تا جای ممکن کوچک است:

    ۱) بازیابی    — جدول‌های نامزد با جست‌وجوی فارسیِ خودِ برنامه پیدا می‌شوند.
                    هیچ مدلی دخالت ندارد؛ این مرحله برای همه یکسان است.
    ۲) انتخاب     — مدل فقط از میان همان نامزدها انتخاب می‌کند. هر نامی که
                    در فهرست نباشد دور ریخته می‌شود، و اگر خروجی‌اش بی‌معنا
                    بود، به نتیجهٔ بازیابی برمی‌گردیم.
    ۳) زمینه‌سازی  — ستون‌ها، کلید اصلی، مقادیر کد و شرحی و — مهم‌تر از همه —
                    شرط‌های JOIN از ایندکس بیرون کشیده می‌شوند. مدل JOIN
                    نمی‌سازد؛ JOIN را به او می‌دهیم.
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

MAX_CANDIDATES = 28
MAX_CHOSEN = 7
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


# ───────────────────────── ۱) بازیابی ─────────────────────────


def retrieve(kb: KnowledgeBase, question: str) -> list[dict]:
    """
    جدول‌های نامزد برای این پرسش.

    از سه راه، چون هیچ‌کدام به‌تنهایی کافی نیست: کاربر ممکن است نام فارسی
    جدول را بگوید، یا نام یک ستون را، یا نام یک نوع کد و شرحی را.
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
- اگر مطمئن نیستی، جدول‌های محتمل‌تر را بنویس."""


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


def _table_block(kb: KnowledgeBase, full: str) -> str:
    info = kb.get_table(full)
    if info is None:
        return ""
    head = f"[{full.replace('.', '].[')}]"
    if info.title_fa:
        head += f" — {info.title_fa}"
    if info.row_count is not None:
        head += f"  ({info.row_count} ردیف)"

    lines = [head]
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

    for i, a in enumerate(tables):
        for b in tables[i + 1:]:
            path = kb.find_join_path(a, b)
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
    return "\n".join(parts), everything, joins


# ───────────────────────── ۴) نگارش ─────────────────────────


DRAFT_SYSTEM = """تو یک کارشناس ارشد T-SQL روی SQL Server هستی و به فارسی پاسخ می‌دهی.

قواعد غیرقابل‌مذاکره:
۱. فقط از جدول‌ها و ستون‌هایی استفاده کن که در «ساختار» آمده‌اند. هیچ نام
   دیگری ننویس — اگر چیزی در ساختار نیست، یعنی وجود ندارد.
۲. شرط‌های JOIN را عیناً از بخش «پیوندهای شناخته‌شده» بردار. پیوند از خودت
   نساز.
۳. فقط SELECT. هیچ INSERT/UPDATE/DELETE/DROP ننویس.
۴. شناسه‌ها را داخل براکت بگذار: [SCHEMA].[Table].[Column]
۵. کوئری را داخل یک بلوک ```sql بگذار و بیرون آن، دو سه جملهٔ فارسی بنویس
   که می‌گوید کوئری چه می‌کند.

اگر پرسش کاربر اصلاً کوئری نمی‌خواهد و فقط راهنمایی می‌خواهد، بلوک ```sql
نگذار و فقط فارسی توضیح بده."""


def draft_prompt(question: str, context: str) -> str:
    return f"""## ساختار

{context}

## پرسش کاربر

{question}"""


def repair_prompt(question: str, context: str, sql: str, result: CheckResult) -> str:
    return f"""## ساختار

{context}

## پرسش کاربر

{question}

## کوئری قبلی تو

```sql
{sql}
```

## ایرادهایی که بازبین گرفت

{result.feedback()}

کوئری را با توجه به همین ایرادها اصلاح کن. فقط از جدول‌ها و ستون‌های بخش
«ساختار» استفاده کن. دوباره کل کوئری اصلاح‌شده را داخل یک بلوک ```sql بده."""


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
) -> Draft:
    """
    `ask(system, user) -> str` تنها راه ارتباط با مدل است؛ هرچه بقیه لازم
    دارند از ایندکس می‌آید. همین باعث می‌شود کل این تابع با یک مدلِ ساختگی
    آزمودنی باشد، بی‌آن‌که کلید API لازم باشد.
    """
    draft = Draft()

    emit("retrieve", "جست‌وجو در ساختار پایگاه داده", {})
    candidates = retrieve(kb, question)
    if not candidates:
        draft.kind = "guidance"
        draft.note = ("برای این پرسش جدول مرتبطی پیدا نشد. کمی مشخص‌تر بپرسید — "
                      "مثلاً نام فارسی جدول، نام یک ستون، یا ماژول موردنظر.")
        return draft
    emit("retrieve", f"{len(candidates)} جدول نامزد پیدا شد", {
        "candidates": [c["full_name"] for c in candidates],
    })

    emit("select", "انتخاب جدول‌های مرتبط", {})
    listing = "\n".join(
        f"{c['full_name']}" + (f" — {c['title_fa']}" if c.get("title_fa") else "")
        for c in candidates
    )
    chosen: list[str] = []
    try:
        reply = ask(
            SELECT_SYSTEM.format(max_chosen=MAX_CHOSEN),
            f"## جدول‌های موجود\n{listing}\n\n## پرسش\n{question}",
        )
        chosen = parse_selection(reply, candidates)
    except Exception:                                        # noqa: BLE001
        chosen = []
    if not chosen:
        # مدل کمکی نکرد — با نتیجهٔ بازیابی ادامه می‌دهیم. بهتر از توقف است.
        chosen = [c["full_name"] for c in candidates[:4]]
        emit("select", "انتخاب مدل روشن نبود؛ با نتیجهٔ جست‌وجو ادامه می‌دهیم", {
            "tables": chosen,
        })
    else:
        emit("select", f"{len(chosen)} جدول انتخاب شد", {"tables": chosen})

    emit("context", "استخراج ستون‌ها و مسیرهای پیوند", {})
    context, tables, joins = build_context(kb, chosen)
    draft.tables, draft.joins = tables, joins
    emit("context", f"{len(tables)} جدول و {len(joins)} پیوند آماده شد", {
        "tables": tables, "joins": joins,
    })

    user_prompt = draft_prompt(question, context)
    last_result: CheckResult | None = None
    last_sql = ""

    for attempt in range(1, max_attempts + 1):
        draft.attempts = attempt
        emit("draft", (f"نگارش کوئری" if attempt == 1
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
        user_prompt = repair_prompt(question, context, sql, result)

    draft.sql = last_sql
    draft.check = last_result
    emit("done", (
        "کوئری تأیید شد" if last_result and last_result.ok
        else "کوئری تأیید نشد — ایرادها در پاسخ آمده"
    ), {})
    return draft
