#!/usr/bin/env python3
"""
ساخت ایندکس جست‌وجو از kb/

ایندکس یک مصنوع مشتق است: همیشه باید با یک دستور از kb/ بازساخته شود.
هرگز در git نگذارید و هرگز مستقیم ویرایش نکنید.

استفاده:
    python3 scripts/build_index.py --kb kb --out index/kb.sqlite \
                                   [--instance instances/live]
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

try:
    import yaml
except ImportError:                                     # pragma: no cover
    sys.exit("نیاز به PyYAML:  pip install pyyaml")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from core.textnorm import build_search_text             # noqa: E402


SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous  = OFF;

CREATE TABLE tables (
    full_name   TEXT PRIMARY KEY,
    schema      TEXT NOT NULL,
    name        TEXT NOT NULL,
    title_fa    TEXT,
    description_fa TEXT,
    kind        TEXT,
    n_cols      INTEGER NOT NULL DEFAULT 0,
    row_count   INTEGER,          -- از instance؛ NULL یعنی نامعلوم
    has_data    INTEGER NOT NULL DEFAULT 0,
    in_live_db  INTEGER           -- NULL = بررسی نشده، 0 = در دیتابیس نیست
);
CREATE INDEX ix_tables_schema ON tables(schema);
CREATE INDEX ix_tables_name   ON tables(name);
CREATE INDEX ix_tables_rows   ON tables(row_count);

CREATE TABLE columns (
    table_ref   TEXT NOT NULL REFERENCES tables(full_name),
    name        TEXT NOT NULL,
    type        TEXT,
    nullable    INTEGER NOT NULL DEFAULT 1,
    is_pk       INTEGER NOT NULL DEFAULT 0,
    ordinal     INTEGER,
    PRIMARY KEY (table_ref, name)
);
CREATE INDEX ix_columns_name ON columns(name);
CREATE INDEX ix_columns_type ON columns(type);

CREATE TABLE joins (
    from_table  TEXT NOT NULL,
    from_col    TEXT NOT NULL,
    to_table    TEXT NOT NULL,
    to_col      TEXT NOT NULL,
    confidence  TEXT NOT NULL,
    verified    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (from_table, from_col, to_table, to_col)
);
CREATE INDEX ix_joins_from ON joins(from_table);
CREATE INDEX ix_joins_to   ON joins(to_table);

CREATE TABLE enums (
    table_ref   TEXT NOT NULL,
    column      TEXT NOT NULL,
    value       TEXT NOT NULL,
    label_fa    TEXT,
    confidence  TEXT,
    observed    INTEGER,
    PRIMARY KEY (table_ref, column, value)
);

CREATE TABLE indexes_ (
    table_ref   TEXT NOT NULL,
    name        TEXT NOT NULL,
    columns     TEXT,
    is_unique   INTEGER DEFAULT 0,
    is_pk       INTEGER DEFAULT 0,
    PRIMARY KEY (table_ref, name)
);

-- جست‌وجوی تمام‌متن روی نام انگلیسی + عنوان فارسی + توضیح
CREATE VIRTUAL TABLE fts USING fts5(
    full_name UNINDEXED,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _split_ref(ref: str) -> tuple[str, str] | None:
    """`FIN3.Voucher.AccountRef` → («FIN3.Voucher», «AccountRef»)"""
    parts = ref.split(".")
    if len(parts) != 3:
        return None
    return f"{parts[0]}.{parts[1]}", parts[2]


def _collect_joins(kb: Path) -> list[tuple]:
    """
    ادغام سه منبع یال، به ترتیب اولویت صعودی:

        inferred      استنتاج از نام ستون‌ها (پایه)
        corrections   حدس‌های غلطی که مقصد درستشان ثبت شده
        user-verified آنچه کاربر با چشم خودش تأیید کرده (قطعی)

    منبع مطمئن‌تر، همان کلید (جدول+ستون مبدأ) را بازنویسی می‌کند؛ وگرنه
    دانشی که کاربر ثبت می‌کند هرگز به جست‌وجو نمی‌رسد.
    """
    edges: dict[str, tuple] = {}

    inferred = kb / "joins" / "inferred.yaml"
    if inferred.exists():
        for e in _load(inferred).get("edges", []):
            src, dst = _split_ref(e.get("from", "")), _split_ref(e.get("to", ""))
            if not (src and dst):
                continue
            edges[e["from"]] = (src[0], src[1], dst[0], dst[1],
                                e.get("confidence", "medium"),
                                int(bool(e.get("verified"))))

    corrections = kb / "joins" / "corrections.yaml"
    if corrections.exists():
        for item in _load(corrections).get("items", []):
            src, dst = _split_ref(item.get("from", "")), _split_ref(item.get("actual", ""))
            if not (src and dst):
                continue
            edges[item["from"]] = (src[0], src[1], dst[0], dst[1], "high", 1)

    verified = kb / "joins" / "user-verified.yaml"
    if verified.exists():
        for e in _load(verified).get("edges", []):
            src, dst = _split_ref(e.get("from", "")), _split_ref(e.get("to", ""))
            if not (src and dst):
                continue
            edges[e["from"]] = (src[0], src[1], dst[0], dst[1], "high", 1)

    return list(edges.values())


def build(kb: Path, out: Path, instance: Path | None) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    db = sqlite3.connect(out)
    db.executescript(SCHEMA)

    # ── ساختار ──
    tables, columns = [], []
    for f in sorted((kb / "structure").glob("*.yaml")):
        doc = _load(f)
        schema = doc["schema"]
        for t in doc.get("tables", []):
            full = f"{schema}.{t['name']}"
            tables.append((full, schema, t["name"], None, None, None,
                           len(t.get("columns", [])), None, 0, None))
            for c in t.get("columns", []):
                columns.append((full, c["name"], c.get("type"),
                                int(c.get("nullable", True)),
                                int(c.get("is_pk", False)), c.get("ordinal")))
    db.executemany("INSERT OR IGNORE INTO tables VALUES (?,?,?,?,?,?,?,?,?,?)", tables)
    db.executemany("INSERT OR IGNORE INTO columns VALUES (?,?,?,?,?,?)", columns)

    # ── معنا (عنوان و توضیح فارسی) ──
    n_sem = 0
    for f in sorted((kb / "semantics").glob("[A-Z]*.yaml")):
        doc = _load(f)
        for t in doc.get("tables", []):
            db.execute(
                "UPDATE tables SET title_fa=?, description_fa=?, kind=? "
                "WHERE full_name=?",
                (t.get("title_fa"), t.get("description_fa"), t.get("kind"),
                 f"{doc['schema']}.{t['name']}"),
            )
            n_sem += 1

    # ── گراف JOIN ──
    join_rows = _collect_joins(kb)
    db.executemany("INSERT OR REPLACE INTO joins VALUES (?,?,?,?,?,?)", join_rows)

    # ── enum ──
    enum_rows = []
    for f in sorted((kb / "enums").glob("[A-Z]*.yaml")):
        doc = _load(f)
        for e in doc.get("enums", []):
            full = f"{doc['schema']}.{e['table']}"
            for v in e.get("values", []):
                enum_rows.append((full, e["column"], str(v["value"]),
                                  v.get("label_fa"), v.get("confidence"),
                                  v.get("observed_count")))
    db.executemany("INSERT OR REPLACE INTO enums VALUES (?,?,?,?,?,?)", enum_rows)

    # ── ایندکس‌های واقعی دیتابیس ──
    index_rows = []
    for f in sorted((kb / "indexes").glob("*.yaml")):
        doc = _load(f)
        index_rows += [
            (f"{doc['schema']}.{i['table']}", i["name"],
             ",".join(i.get("columns") or []),
             int(i.get("unique", False)), int(i.get("is_pk", False)))
            for i in doc.get("indexes", [])
        ]
    db.executemany("INSERT OR IGNORE INTO indexes_ VALUES (?,?,?,?,?)", index_rows)

    # ── آمار نصب ──
    n_active = 0
    if instance and (instance / "table-stats.yaml").exists():
        stats = _load(instance / "table-stats.yaml").get("tables", {})
        db.executemany(
            "UPDATE tables SET row_count=?, has_data=? WHERE full_name=?",
            [(v, 1 if v else 0, k) for k, v in stats.items()],
        )
        n_active = sum(1 for v in stats.values() if v)
        # rowcount از sys.tables می‌آید و همه‌ی جدول‌های موجود را دارد؛ پس
        # هرچه در آن نیست، در دیتابیس زنده وجود ندارد → مستندات کهنه است.
        db.execute("UPDATE tables SET in_live_db = 0")
        db.executemany("UPDATE tables SET in_live_db = 1 WHERE full_name = ?",
                       [(k,) for k in stats])
        stale = db.execute(
            "SELECT COUNT(*) FROM tables WHERE in_live_db = 0").fetchone()[0]
        if stale:
            print(f"  ⚠️  {stale} جدول در KB هست ولی در دیتابیس زنده نیست")

    # ── FTS ──
    rows = db.execute(
        "SELECT full_name, schema, name, title_fa, description_fa FROM tables"
    ).fetchall()
    db.executemany(
        "INSERT INTO fts (full_name, body) VALUES (?, ?)",
        [(r[0], build_search_text(r[1], r[2], r[3], r[4])) for r in rows],
    )

    db.executemany("INSERT INTO meta VALUES (?,?)", [
        ("tables", str(len(tables))), ("columns", str(len(columns))),
        ("joins", str(len(join_rows))), ("enums", str(len(enum_rows))),
        ("indexes", str(len(index_rows))), ("with_title_fa", str(n_sem)),
        ("active_tables", str(n_active)),
        ("schemas", str(db.execute(
            "SELECT COUNT(DISTINCT schema) FROM tables").fetchone()[0])),
    ])
    db.commit()
    db.execute("VACUUM")
    db.close()

    size = out.stat().st_size / 1024 / 1024
    print(f"✔ {out}  ({size:.1f} MB)")
    print(f"  جدول {len(tables)}  ·  ستون {len(columns)}  ·  یال {len(join_rows)}")
    print(f"  عنوان فارسی {n_sem}  ·  enum {len(enum_rows)}  ·  ایندکس {len(index_rows)}")
    print(f"  جدول دارای داده در این نصب: {n_active}")


def main() -> int:
    ap = argparse.ArgumentParser(description="ساخت ایندکس کاوشگر پایگاه داده")
    ap.add_argument("--kb", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--instance", type=Path)
    a = ap.parse_args()
    build(a.kb, a.out, a.instance)
    return 0


if __name__ == "__main__":
    sys.exit(main())
