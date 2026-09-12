"""
ساخت ایندکس جست‌وجو از kb/

ایندکس یک مصنوع مشتق است: همیشه از kb/ ساخته می‌شود، هرگز دستی ویرایش
نمی‌شود و در git نمی‌نشیند.

این ماژول عمداً importable است، نه اسکریپتی که با subprocess صدا زده شود:
در نسخهٔ بسته‌بندی‌شدهٔ ویندوز، `sys.executable` خودِ برنامه است، پس اجرای
زیرفرایندی به‌جای ساخت ایندکس، یک نمونهٔ دیگر از برنامه را بالا می‌آورد.
فراخوانی درون‌فرایندی هم این تله را حذف می‌کند و هم چند ثانیه راه‌اندازی
مفسر را صرفه‌جویی می‌کند.

اجرای دستی:
    python3 -m core.indexer --kb kb --out index/kb.sqlite --instance instances/live
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path

import yaml

from .textnorm import build_search_text


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

-- نام فارسی ماژول‌ها (اسکیماها)
CREATE TABLE schema_titles (
    id          TEXT PRIMARY KEY,
    title_fa    TEXT NOT NULL
);

-- واژه‌نامهٔ نام ستون‌ها: یک ورودی روی هر جدولی که آن ستون را دارد اثر می‌گذارد
CREATE TABLE column_labels (
    name        TEXT PRIMARY KEY,
    title_fa    TEXT NOT NULL
);

/*
  جدول‌های کد و شرحی (SYS3.Lookup / SYS3.LookupInfo) — فیلدهایی که کاربر در
  فرم نرم‌افزار از فهرستی از پیش تعریف‌شده انتخاب می‌کند. جدا از enums نگه
  داشته می‌شوند: enums یک مقدار را به یک ستونِ مشخص می‌بندد، ولی این‌جا خودِ
  فهرست مرجع است و مستقل از اینکه کدام ستون به آن ارجاع می‌دهد وجود دارد.
*/
CREATE TABLE lookup_types (
    type        TEXT PRIMARY KEY,
    title_fa    TEXT,
    module      TEXT,
    n_values    INTEGER NOT NULL,
    -- lookup پویا: مقادیرش را خودِ مشتری در نرم‌افزار تعریف می‌کند، پس
    -- خالی بودنش یعنی «در این نصب تعریف نشده»، نه «داده‌اش را نداریم».
    is_dynamic  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lookup_values (
    type        TEXT NOT NULL,
    code        INTEGER,
    value       TEXT NOT NULL,
    ordinal     INTEGER,
    extra       TEXT,
    PRIMARY KEY (type, code, value)
);

CREATE INDEX ix_lookup_values_type ON lookup_values(type);

/*
  موجودیت‌های نرم‌افزار — عنوان رسمی هر موجودیت و ماژولی که به آن تعلق دارد.
  ماژول این‌جا بخش‌بندیِ نرم‌افزار است (HCM.Staff)، نه اسکیمای پایگاه داده
  (HCM3) — دو محور متفاوت که گاهی یکی نیستند.
*/
CREATE TABLE entities (
    entity_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    title_fa    TEXT NOT NULL,
    component   TEXT,
    table_ref   TEXT
);

CREATE INDEX ix_entities_table ON entities(table_ref);
CREATE INDEX ix_entities_comp  ON entities(component);

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


# نسخهٔ ساختار ایندکس. هر بار که جدول یا ستونی به SCHEMA اضافه یا عوض شد،
# این عدد باید یک واحد بالا برود: برنامه با همین می‌فهمد ایندکسِ روی دیسکِ
# کاربر برای نسخهٔ قدیمی ساخته شده و باید دوباره ساخته شود.
SCHEMA_VERSION = "5"


# مهلت جایگزینی ایندکس. سخاوتمند است و عمداً: روی رایانهٔ سازمانی، ضدویروس
# فایل تازه‌نوشتهٔ ۱۳ مگابایتی را همان لحظه می‌خواند و تا پایان خواندنش کسی
# نمی‌تواند جایش را عوض کند. هفت ثانیهٔ قبلی برای آن کوتاه بود.
_REPLACE_TIMEOUT = 60.0


def _put_in_place(tmp: Path, out: Path) -> None:
    """
    ایندکس تازه را جای ایندکس قبلی می‌نشاند — با صبر.

    چرا اصلاً ممکن است نشود: روی ویندوز فایلی که فرایند دیگری باز نگه داشته
    جایگزین نمی‌شود. معمول‌ترین‌شان پویشگر ضدویروس است که هر فایل تازه را
    می‌خواند؛ روی نصب‌های سازمانی این خواندن می‌تواند ده‌ها ثانیه طول بکشد.
    قفل گذراست، پس صبر جوابش است — ولی اگر کوتاه صبر کنیم، برنامه هنگام بالا
    آمدن می‌میرد و کاربر چیزی جز یک پنجرهٔ بسته‌شده نمی‌بیند.
    """
    start = time.monotonic()
    deadline = start + _REPLACE_TIMEOUT
    pause = 0.2
    last: OSError | None = None
    announced = False

    while True:
        try:
            os.replace(tmp, out)
            return
        except OSError as e:
            last = e
        if time.monotonic() >= deadline:
            break
        if not announced and time.monotonic() - start > 3:
            # سکوت طولانی از «هنگ کرده» قابل تشخیص نیست؛ پس می‌گوییم منتظریم.
            print("  ایندکس در دست برنامهٔ دیگری است (معمولاً ضدویروس) — منتظر می‌مانیم…",
                  flush=True)
            announced = True
        time.sleep(pause)
        pause = min(pause * 1.6, 3.0)

    # راه دوم: وقتی جابه‌جا کردن فایل ممکن نیست، شاید نوشتن *داخلش* ممکن باشد.
    # جای‌گذاری اتمی نیست، ولی از بی‌ایندکس ماندن بهتر است و تنها خوانندهٔ این
    # فایل خودِ ماییم که هنوز بازش نکرده‌ایم.
    try:
        with open(tmp, "rb") as src, open(out, "r+b") as dst:
            shutil.copyfileobj(src, dst)
            dst.truncate()
        tmp.unlink(missing_ok=True)
        print("  ایندکس در جای خودش نوشته شد.", flush=True)
        return
    except OSError:
        pass

    tmp.unlink(missing_ok=True)
    raise RuntimeError(
        f"ایندکس تازه ساخته شد ولی جایگزین ایندکس قبلی نشد: {out}\n"
        f"پس از {int(_REPLACE_TIMEOUT)} ثانیه هنوز در دست فرایند دیگری بود — "
        "معمولاً ضدویروس یا نسخهٔ دیگری از همین برنامه.\n"
        "برنامه‌های باز را ببندید و دوباره اجرا کنید؛ اگر تکرار شد، پوشهٔ "
        f"«{out.parent}» را در فهرست استثناهای ضدویروس بگذارید."
    ) from last


def build(kb: Path, out: Path, instance: Path | None) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    # روی فایل کناری ساخته می‌شود و در پایان جایش می‌نشیند: تا لحظهٔ آخر
    # ایندکس قبلی سالم می‌ماند، پس ساختِ نیمه‌کاره — قطع برق، بسته‌شدن
    # پنجره — کاربر را بی‌ایندکس نمی‌گذارد.
    tmp = out.with_name(out.name + ".building")
    tmp.unlink(missing_ok=True)

    db = sqlite3.connect(tmp)
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

    # ── نام فارسی ماژول‌ها و ستون‌ها ──
    # این دو فایل با «_» شروع می‌شوند تا حلقهٔ بالا (که [A-Z]*.yaml می‌خواند و
    # ساختار schema/tables انتظار دارد) به آن‌ها دست نزند.
    schema_titles = _load(kb / "semantics" / "_schemas.yaml").get("schemas", {}) \
        if (kb / "semantics" / "_schemas.yaml").exists() else {}
    db.executemany("INSERT OR REPLACE INTO schema_titles VALUES (?,?)",
                   [(k, v) for k, v in schema_titles.items() if v])

    column_labels = _load(kb / "semantics" / "_columns.yaml").get("columns", {}) \
        if (kb / "semantics" / "_columns.yaml").exists() else {}
    db.executemany("INSERT OR REPLACE INTO column_labels VALUES (?,?)",
                   [(k, v) for k, v in column_labels.items() if v])

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

    # ── جدول‌های کد و شرحی ──
    lookup_types, lookup_values = [], []
    for f in sorted((kb / "lookups").glob("*.yaml")) if (kb / "lookups").exists() else []:
        for t in _load(f).get("types", []):
            vals = t.get("values") or []
            lookup_types.append((t["type"], t.get("title_fa"), t.get("module"),
                                 len(vals), int(bool(t.get("dynamic")))))
            for v in vals:
                lookup_values.append((t["type"], v.get("code"), str(v["value"]),
                                      v.get("order", v.get("code")), v.get("extra")))
    db.executemany("INSERT OR REPLACE INTO lookup_types VALUES (?,?,?,?,?)", lookup_types)
    db.executemany("INSERT OR REPLACE INTO lookup_values VALUES (?,?,?,?,?)", lookup_values)

    # ── موجودیت‌های نرم‌افزار ──
    entity_rows = []
    for f in sorted((kb / "entities").glob("*.yaml")) if (kb / "entities").exists() else []:
        for e in _load(f).get("entities", []):
            tabs = e.get("tables") or [None]
            for t in tabs:
                # یک موجودیت می‌تواند به چند جدول بخورد؛ کلید اصلی هر دو را
                # با هم می‌گیرد تا ردیف‌ها روی هم نیفتند.
                entity_rows.append((f"{e['entity_id']}|{t or ''}", e["name"],
                                    e["title_fa"], e.get("component"), t))
    db.executemany("INSERT OR REPLACE INTO entities VALUES (?,?,?,?,?)", entity_rows)

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
        ("schema_titles", str(len(schema_titles))),
        ("schema_version", SCHEMA_VERSION),
        ("column_labels", str(len(column_labels))),
        ("lookup_types", str(len(lookup_types))),
        ("lookup_values", str(len(lookup_values))),
        ("entities", str(len({r[0].split("|")[0] for r in entity_rows}))),
        ("schemas", str(db.execute(
            "SELECT COUNT(DISTINCT schema) FROM tables").fetchone()[0])),
    ])
    db.commit()
    db.execute("VACUUM")
    db.close()
    _put_in_place(tmp, out)

    size = out.stat().st_size / 1024 / 1024
    print(f"✔ {out}  ({size:.1f} MB)")
    print(f"  جدول {len(tables)}  ·  ستون {len(columns)}  ·  یال {len(join_rows)}")
    print(f"  عنوان فارسی {n_sem}  ·  enum {len(enum_rows)}  ·  ایندکس {len(index_rows)}")
    print(f"  جدول دارای داده در این نصب: {n_active}")
    print(f"  نام فارسی ماژول {len(schema_titles)}  ·  واژه‌نامهٔ ستون {len(column_labels)}")
    print(f"  کد و شرحی: {len(lookup_types)} نوع  ·  {len(lookup_values)} مقدار")
    print(f"  موجودیت نرم‌افزار: {len({r[0].split('|')[0] for r in entity_rows})}  ·  "
          f"جدول منطبق {len({r[4] for r in entity_rows if r[4]})}")


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
