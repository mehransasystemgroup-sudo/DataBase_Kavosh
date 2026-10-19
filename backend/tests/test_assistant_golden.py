"""
پرامپت‌ها و خوانشِ برداشتِ پایتون هنوز با مرجعی می‌خوانند که نسخهٔ موبایل با آن
سنجیده می‌شود. اگر تغییر عمدی بود: python3 tests/assistant_golden.py
"""

from __future__ import annotations

import json

import assistant_golden as golden


def test_python_matches_golden():
    expected = json.loads(golden.GOLDEN.read_text(encoding="utf-8"))
    actual = json.loads(json.dumps(golden.compute(), ensure_ascii=False))
    for key in expected:
        assert actual[key] == expected[key], key
    assert actual.keys() == expected.keys()
