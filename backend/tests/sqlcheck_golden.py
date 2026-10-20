"""
خروجیِ مرجعِ بازبینی کوئری — برای اینکه نسخهٔ موبایل همان قضاوت سرور را بکند.

نسخهٔ اندروید سرور ندارد و بازبینی را در خودِ برنامه با جاوااسکریپت انجام می‌دهد
(frontend/src/lib/assistant/sqlcheck.js). دو پیاده‌سازی از یک قاعده فقط وقتی
یکی می‌مانند که با یک مرجع سنجیده شوند: این فایل همان مرجع را از خودِ پایتون
می‌سازد، test_sqlcheck_golden.py می‌گوید پایتون هنوز با آن می‌خواند، و
آزمونِ جاوااسکریپتی می‌گوید نسخهٔ موبایل هم.

    python3 tests/sqlcheck_golden.py      # پس از تغییر عمدی در sqlcheck.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from core import indexer                                         # noqa: E402
from core.sqlcheck import SchemaIndex, check_sql                 # noqa: E402

CASES_DIR = BACKEND.parent / "frontend" / "src" / "lib" / "assistant" / "__tests__"
CASES = CASES_DIR / "sqlcheck.cases.txt"
GOLDEN = CASES_DIR / "sqlcheck.golden.json"


def cases() -> list[str]:
    return [line.strip() for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]


def comparable(result: dict) -> dict:
    """متن خطای نحوی از خودِ تجزیه‌گر می‌آید و بین دو زبان فرق دارد؛ فقط کدش حساب است."""
    findings = []
    for f in result["findings"]:
        if f["code"] == "parse_error":
            f = {"severity": f["severity"], "code": f["code"]}
        findings.append(f)
    return {"ok": result["ok"], "tables": result["tables"], "findings": findings}


def compute(index: SchemaIndex) -> list[dict]:
    return [{"sql": sql, **comparable(check_sql(sql, index).to_dict())} for sql in cases()]


def build_index(out: Path) -> SchemaIndex:
    indexer.build(BACKEND / "kb", out, None)
    return SchemaIndex(out)


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        rows = compute(build_index(Path(tmp) / "kb.sqlite"))
    GOLDEN.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(rows)} مورد در {GOLDEN}")
