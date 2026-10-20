"""
مرجعِ متن پرامپت‌ها و خوانشِ برداشت — برای اینکه مدل در دو نسخه یک چیز بشنود.

همان ایدهٔ sqlcheck_golden.py: نسخهٔ موبایل حلقهٔ دستیار را با جاوااسکریپت
اجرا می‌کند (frontend/src/lib/assistant/assistant.js). اگر یک ویرگول در
پرامپتِ یکی عوض شود و در دیگری نه، مدل در اندروید و ویندوز پاسخ متفاوت
می‌دهد و هیچ آزمونی نمی‌فهمد. این فایل مرجع را از پایتون می‌سازد؛
test_assistant_golden.py و assistant.test.js هر دو با آن سنجیده می‌شوند.

    python3 tests/assistant_golden.py      # پس از تغییر عمدی در assistant.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from core import assistant                                       # noqa: E402

GOLDEN = (BACKEND.parent / "frontend" / "src" / "lib" / "assistant" / "__tests__"
          / "assistant.golden.json")

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


if __name__ == "__main__":
    GOLDEN.write_text(json.dumps(compute(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"مرجع در {GOLDEN}")
