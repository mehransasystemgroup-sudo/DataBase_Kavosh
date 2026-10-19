"""
بازبینیِ پایتون هنوز با مرجعی می‌خواند که نسخهٔ موبایل با آن سنجیده می‌شود.

اگر این آزمون افتاد و تغییر sqlcheck.py عمدی بود، مرجع را از نو بسازید
(python3 tests/sqlcheck_golden.py) تا آزمونِ جاوااسکریپتی هم همان را بخواهد.
"""

from __future__ import annotations

import json

import sqlcheck_golden as golden


def test_python_matches_golden(tmp_path):
    expected = json.loads(golden.GOLDEN.read_text(encoding="utf-8"))
    actual = golden.compute(golden.build_index(tmp_path / "kb.sqlite"))
    assert [r["sql"] for r in actual] == [r["sql"] for r in expected], "فهرست موردها عوض شده؛ مرجع را بسازید"
    for got, want in zip(actual, expected):
        assert got == want, got["sql"]
