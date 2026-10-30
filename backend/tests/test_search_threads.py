"""
آزمون هم‌زمانی KnowledgeBase.

FastAPI مسیرهای هم‌زمان را در threadpool اجرا می‌کند؛ با یک اتصال SQLite مشترک،
گزارش‌ساز که برای هر جدول کوئری یک /api/table موازی می‌فرستد گاه‌به‌گاه ۵۰۰
می‌گرفت (sqlite3.InterfaceError / IndexError). هر نخ باید اتصال خودش را داشته باشد.
"""

from __future__ import annotations

import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from core import indexer                    # noqa: E402
from core.search import KnowledgeBase       # noqa: E402


@pytest.fixture(scope="module")
def kb(tmp_path_factory) -> KnowledgeBase:
    out = tmp_path_factory.mktemp("kbt") / "kb.sqlite"
    indexer.build(BACKEND / "kb", out, None)
    return KnowledgeBase(out)


def test_parallel_get_table(kb):
    names = [r["full_name"] for r in kb.db.execute("SELECT full_name FROM tables ORDER BY row_count DESC LIMIT 12")]
    assert names
    expected = {n: len(kb.get_table(n).columns) for n in names}
    with ThreadPoolExecutor(max_workers=16) as pool:
        got = list(pool.map(lambda n: (n, len(kb.get_table(n).columns)), names * 25))
    assert all(expected[n] == c for n, c in got)


def test_closed_between_close_and_reload(kb):
    kb.close()
    with pytest.raises(sqlite3.ProgrammingError):
        kb.db
    kb.reload()
    assert kb.db.execute("SELECT 1").fetchone()[0] == 1
