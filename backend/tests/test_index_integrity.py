"""
سلامت دادهٔ ایندکس: هر رابطه و هر مقدار کددار باید به ستونی واقعی برسد.

پیش از 3.7.0 حدود ۲۰۰ رابطه به جدول یا ستونی اشاره می‌کرد که در ساختار این
نصب نبود (مثلاً FIN3.Voucher.AccountRef)؛ صفحهٔ جدول پیوندی می‌ساخت که به
«جدول پیدا نشد» می‌رسید و دستیار روی آن JOIN پیشنهاد می‌داد.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from core import indexer  # noqa: E402


@pytest.fixture(scope="module")
def db(tmp_path_factory):
    out = tmp_path_factory.mktemp("idx") / "kb.sqlite"
    indexer.build(BACKEND / "kb", out, BACKEND / "instances" / "live")
    conn = sqlite3.connect(out)
    yield conn
    conn.close()


def test_every_join_end_is_a_real_column(db):
    missing = db.execute(
        "SELECT from_table, from_col, to_table, to_col FROM joins j WHERE "
        "NOT EXISTS (SELECT 1 FROM columns c WHERE c.table_ref=j.from_table AND c.name=j.from_col) OR "
        "NOT EXISTS (SELECT 1 FROM columns c WHERE c.table_ref=j.to_table AND c.name=j.to_col) LIMIT 5"
    ).fetchall()
    assert missing == []


def test_every_enum_belongs_to_a_real_column(db):
    missing = db.execute(
        "SELECT table_ref, column FROM enums e WHERE NOT EXISTS "
        "(SELECT 1 FROM columns c WHERE c.table_ref=e.table_ref AND c.name=e.column) LIMIT 5"
    ).fetchall()
    assert missing == []


def test_dropped_edges_are_counted(db):
    meta = dict(db.execute("SELECT key, value FROM meta").fetchall())
    assert int(meta["dangling_joins"]) > 0
    assert "FIN3" in {r[0] for r in db.execute("SELECT schema FROM tables")}
    phantom = db.execute(
        "SELECT 1 FROM joins WHERE from_table='FIN3.Voucher' AND from_col='AccountRef'").fetchone()
    assert phantom is None
