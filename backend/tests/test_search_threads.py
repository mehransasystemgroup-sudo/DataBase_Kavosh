"""
آزمون هم‌زمانی KnowledgeBase.

FastAPI مسیرهای هم‌زمان را در threadpool اجرا می‌کند؛ با یک اتصال SQLite مشترک،
گزارش‌ساز که برای هر جدول کوئری یک /api/table موازی می‌فرستد گاه‌به‌گاه ۵۰۰
می‌گرفت (sqlite3.InterfaceError / IndexError). هر نخ باید اتصال خودش را داشته باشد.
"""

from __future__ import annotations

import sys
import threading
import time
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


def test_waits_while_swapping_instead_of_failing(kb):
    """میان close و reload درخواست منتظر می‌ماند و پس از بازگشایی جواب می‌گیرد."""
    kb.close()
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(lambda: kb.db.execute("SELECT 1").fetchone()[0]) for _ in range(4)]
        time.sleep(0.3)
        assert not any(f.done() for f in futures)
        kb.reload()
        assert [f.result(timeout=10) for f in futures] == [1, 1, 1, 1]


def test_rebuild_while_serving(kb, tmp_path):
    """بازسازی کامل ایندکس زیر بار: هیچ درخواستی نباید خطا بگیرد."""
    names = [r["full_name"] for r in kb.db.execute("SELECT full_name FROM tables LIMIT 20")]
    stop = threading.Event()
    errors: list[str] = []
    served = [0]

    def hammer():
        i = 0
        while not stop.is_set():
            try:
                assert kb.get_table(names[i % len(names)]) is not None
                kb.find_join_path("FIN3.Voucher", "GNR3.Branch")
                served[0] += 1
            except Exception as e:  # noqa: BLE001
                errors.append(repr(e))
            i += 1

    threads = [threading.Thread(target=hammer) for _ in range(8)]
    for t in threads:
        t.start()
    try:
        indexer.build(BACKEND / "kb", Path(kb._db_path), None, swap=kb.swapping)
    finally:
        stop.set()
        for t in threads:
            t.join()
    assert not errors, errors[:3]
    assert served[0] > 0
