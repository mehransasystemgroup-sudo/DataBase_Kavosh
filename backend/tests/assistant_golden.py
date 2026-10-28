"""
مرجعِ متن پرامپت‌ها و خوانشِ برداشت — برای اینکه مدل در دو نسخه یک چیز بشنود.

همان ایدهٔ sqlcheck_golden.py: نسخهٔ موبایل حلقهٔ دستیار را با جاوااسکریپت
اجرا می‌کند (frontend/src/lib/assistant/assistant.js). اگر یک ویرگول در
پرامپتِ یکی عوض شود و در دیگری نه، مدل در اندروید و ویندوز پاسخ متفاوت
می‌دهد و هیچ آزمونی نمی‌فهمد. این فایل مرجع را از پایتون می‌سازد؛
test_assistant_golden.py و assistant.test.js هر دو با آن سنجیده می‌شوند.

    python3 tests/assistant_golden.py      # پس از تغییر عمدی در assistant.py

مرجع دوم (assistant_kb.golden.json) همان همسانی را روی ایندکس واقعی می‌سنجد:
نامزدهای بازیابی، پرامپت انتخاب با نقشهٔ پیوندها، و متن ساختاری که به مدل
داده می‌شود. این‌ها به جست‌وجو و گراف پیوندها وابسته‌اند، پس جدا نگه داشته
شده‌اند و با test_assistant.py (که ایندکس را یک بار می‌سازد) سنجیده می‌شوند.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import tempfile                                                  # noqa: E402

from core import assistant, indexer                              # noqa: E402
from core.search import KnowledgeBase                            # noqa: E402

HERE = BACKEND.parent / "frontend" / "src" / "lib" / "assistant" / "__tests__"
GOLDEN = HERE / "assistant.golden.json"
KB_GOLDEN = HERE / "assistant_kb.golden.json"

# (پرسش، کلیدواژه‌ها، جدول‌های گفت‌وگوی قبلی، جدول‌های سنجاق‌شده، هدف)
RETRIEVALS = [
    ("جمع مبلغ اسناد حسابداری به تفکیک حساب", ["سند حسابداری", "حساب", "مبلغ"], [], [],
     "جمع مبلغ بدهکار و بستانکار اسناد به تفکیک حساب"),
    ("فهرست کارمندان با نام و کد ملی", ["کارمند", "Employee"], [], ["HCM3.Employee"], ""),
    ("حالا فقط امسال", [], ["FIN3.Voucher"], ["NOPE.Missing", "FIN3.Voucher"], ""),
]

CONTEXTS = [
    ["FIN3.Voucher", "FIN3.VoucherItem", "GNR3.Party"],
    ["HCM3.Employee", "GNR3.Party"],
    ["FIN3.VoucherItem", "HCM3.Employee"],
]

RELATED = ["FIN3.Voucher", "HCM3.Employee"]

INTENT_REPLIES = [
    "هدف: فهرست کارمندان با نام واحد\nنوع: کوئری\nکلیدواژه‌ها: کارمند، واحد سازمانی، Employee\n"
    "خروجی: نام و واحد\nفیلترها: —\nگروه‌بندی: —\nمرتب‌سازی: نام\nبازهٔ زمانی: —\n"
    "فرض‌ها: همهٔ کارمندان\nابهام‌ها: فقط فعال‌ها؟ | واحد اصلی یا فرعی؟",
    "**هدف**: جمع مبلغ اسناد\n- کلیدواژه: سند، Voucher ; ندارد\nبازه زمانی: سال ۱۴۰۲\nنوع: راهنمایی",
    "```sql\nSELECT 1\n```\nخروجی: همه",
    "هدف:   \nخروجی: x",
    "  • هدف ： تعداد سند هر ماه\nابهام‌ها: —\nفیلتر ها: وضعیت = تأییدشده",
    "",
]

HISTORY = [
    {"question": "فهرست کارمندان", "sql": "SELECT EmployeeID FROM HCM3.Employee",
     "tables": ["HCM3.Employee"]},
    {"question": "  ", "sql": "x"},
    {"question": "فقط ده تا", "tables": []},
]


def compute() -> dict:
    intents = [assistant.parse_intent(r) for r in INTENT_REPLIES]
    history = assistant.clean_history(HISTORY)
    context = "### جدول‌ها\n\n[HCM3].[Employee]"
    return {
        "UNDERSTAND_SYSTEM": assistant.UNDERSTAND_SYSTEM,
        "SELECT_SYSTEM": assistant.SELECT_SYSTEM.format(max_chosen=assistant.MAX_CHOSEN),
        "DRAFT_SYSTEM": assistant.DRAFT_SYSTEM,
        "intents": [{"reply": r, "intent": i, "brief": assistant.brief_text(i)}
                    for r, i in zip(INTENT_REPLIES, intents)],
        "history": HISTORY,
        "clean_history": history,
        "understand_prompt": assistant.understand_prompt("حالا امسال", history),
        "understand_prompt_alone": assistant.understand_prompt("فهرست کارمندان", []),
        "draft_prompt": assistant.draft_prompt("حالا امسال", context, history, intents[0]),
        "draft_prompt_plain": assistant.draft_prompt("فهرست کارمندان", context),
    }


def compute_kb(kb: KnowledgeBase) -> dict:
    retrievals = []
    for question, keywords, previous, pinned, goal in RETRIEVALS:
        pins = assistant.clean_pinned(kb, pinned)
        candidates = assistant.retrieve(kb, question, keywords, previous, pins)
        links = assistant.candidate_links(kb, candidates)
        retrievals.append({
            "question": question, "keywords": keywords, "previous": previous,
            "pinned": pinned, "goal": goal, "pins": pins,
            "candidates": candidates,
            "select_prompt": assistant.select_prompt(question, candidates, links, goal, pins),
        })
    contexts = []
    for chosen in CONTEXTS:
        context, tables, joins = assistant.build_context(kb, chosen)
        contexts.append({"chosen": chosen, "context": context, "tables": tables, "joins": joins})
    return {
        "related": {full: kb.related_tables(full) for full in RELATED},
        "retrievals": retrievals,
        "contexts": contexts,
    }


def _write(path: Path, doc: dict) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"مرجع در {path}")


if __name__ == "__main__":
    _write(GOLDEN, compute())
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "kb.sqlite"
        indexer.build(BACKEND / "kb", out, None)
        kb = KnowledgeBase(out)
        try:
            _write(KB_GOLDEN, compute_kb(kb))
        finally:
            kb.close()
