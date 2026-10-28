"""
موتور کاوش پایگاه دانش.

تمام منطق جست‌وجو، جزئیات جدول، گراف روابط و مسیریابی JOIN این‌جاست.
لایه‌ی وب (app/main.py) فقط پوسته‌ای نازک روی این ماژول است.
"""

from __future__ import annotations

import sqlite3
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from .textnorm import build_search_text, normalize, stem_fa

# نگاشت دسته‌ی نوع فیلد → الگوهای LIKE روی ستون type
FIELD_TYPE_PATTERNS: dict[str, tuple[str, ...]] = {
    "int": ("int", "bigint", "smallint", "tinyint"),
    "decimal": ("decimal", "numeric", "money", "float", "real"),
    "varchar": ("char", "text", "string"),
    "datetime": ("date", "time"),
    "bit": ("bit", "bool"),
    "uniqueidentifier": ("uniqueidentifier", "guid", "uuid"),
    "binary": ("binary", "image", "blob"),
}


def _bracket(full_name: str) -> str:
    """`FIN3.Voucher` → `[FIN3].[Voucher]` — نقطه داخل براکت T-SQL معتبر نیست."""
    return ".".join(f"[{part}]" for part in full_name.split("."))


@dataclass
class TableHit:
    full_name: str
    title_fa: str | None
    n_cols: int
    row_count: int | None
    has_data: bool
    in_live_db: bool
    score: float
    why: str = ""
    matched_columns: list[dict] = field(default_factory=list)


@dataclass
class JoinStep:
    from_table: str
    from_col: str
    to_table: str
    to_col: str
    confidence: str
    verified: bool

    def sql(self) -> str:
        return (f"LEFT JOIN {_bracket(self.to_table)}\n"
                f"    ON {_bracket(self.from_table)}.[{self.from_col}] "
                f"= {_bracket(self.to_table)}.[{self.to_col}]")

    def to_dict(self) -> dict:
        return {
            "from_table": self.from_table, "from_col": self.from_col,
            "to_table": self.to_table, "to_col": self.to_col,
            "confidence": self.confidence, "verified": self.verified,
            "sql": self.sql(),
        }


@dataclass
class TableInfo:
    full_name: str
    title_fa: str | None
    description_fa: str | None
    kind: str | None
    row_count: int | None
    has_data: bool
    in_live_db: bool
    columns: list[dict] = field(default_factory=list)
    primary_key: list[str] = field(default_factory=list)
    outgoing: list[JoinStep] = field(default_factory=list)
    incoming: list[JoinStep] = field(default_factory=list)
    enums: dict[str, list[dict]] = field(default_factory=dict)
    indexes: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _type_clause(field_type: str) -> tuple[str, list[str]]:
    """شرط SQL برای فیلتر نوع ستون — دسته‌های شناخته‌شده یا متن آزاد."""
    patterns = FIELD_TYPE_PATTERNS.get(field_type.strip().lower())
    if patterns is None:
        patterns = (field_type.strip().lower(),)
    clause = " OR ".join(["lower(c.type) LIKE ?"] * len(patterns))
    return f"({clause})", [f"%{p}%" for p in patterns]


class KnowledgeBase:
    """دسترسی فقط-خواندنی به ایندکس SQLite ساخته‌شده از kb/."""

    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)
        self.db = self._connect()
        self._adj: dict[str, list[tuple]] | None = None

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True,
                             check_same_thread=False)
        db.row_factory = sqlite3.Row
        return db

    def close(self) -> None:
        """
        بستن اتصال.

        روی ویندوز لازم است: تا وقتی فایل ایندکس باز باشد، جایگزینی‌اش هنگام
        بازسازی با خطای «فایل در حال استفاده است» شکست می‌خورد.
        """
        try:
            self.db.close()
        except Exception:
            pass

    def reload(self) -> None:
        """اتصال را به ایندکس تازه‌بازسازی‌شده بازمی‌کند — بدون ری‌استارت سرور."""
        self.close()
        self.db = self._connect()
        self._adj = None

    def apply_learned(self, kind: str, payload: dict) -> None:
        """
        دانش تازه را بی‌درنگ در ایندکس زنده می‌نشاند.

        منبع حقیقت همچنان YAML است، ولی بدون این، کاربر باید پس از هر ثبت
        دستی «بازسازی ایندکس» بزند و چند ثانیه صبر کند تا چیزی که خودش نوشته
        در جست‌وجو دیده شود. همان تغییر کوچک این‌جا روی SQLite هم اعمال
        می‌شود تا بازخورد فوری باشد.
        """
        write = sqlite3.connect(self._db_path)
        try:
            if kind == "table":
                full = payload["full_name"]
                sets, values = [], []
                for column in ("title_fa", "description_fa"):
                    if payload.get(column):
                        sets.append(f"{column} = ?")
                        values.append(payload[column])
                if sets:
                    write.execute(
                        f"UPDATE tables SET {', '.join(sets)} WHERE full_name = ?",
                        [*values, full])
                    row = write.execute(
                        "SELECT schema, name, title_fa, description_fa FROM tables "
                        "WHERE full_name = ?", (full,)).fetchone()
                    if row:
                        write.execute("DELETE FROM fts WHERE full_name = ?", (full,))
                        write.execute(
                            "INSERT INTO fts (full_name, body) VALUES (?, ?)",
                            (full, build_search_text(*row)))
            elif kind == "enum":
                write.execute(
                    "INSERT OR REPLACE INTO enums VALUES (?,?,?,?,?,?)",
                    (payload["full_name"], payload["column"], str(payload["value"]),
                     payload.get("label_fa"), "high", None))
            elif kind == "join":
                write.execute(
                    "INSERT OR REPLACE INTO joins VALUES (?,?,?,?,?,?)",
                    (payload["from_table"], payload["from_col"],
                     payload["to_table"], payload["to_col"], "high", 1))
                self._adj = None
            write.commit()
        finally:
            write.close()

    # ─────────────────────── جست‌وجو ───────────────────────

    def search_tables(
        self,
        query: str = "",
        limit: int = 40,
        schema: str | None = None,
        data_status: str = "all",          # all | with_data | no_data
        field_type: str | None = None,
        min_rows: int | None = None,
        max_rows: int | None = None,
        sort_by: str = "score",            # score | row_count | name | n_cols
        sort_order: str = "desc",
    ) -> list[TableHit]:
        """
        جست‌وجوی ترکیبی: متن آزاد + فیلترهای ساختاری.

        بدون متن جست‌وجو هم کار می‌کند؛ آن‌گاه فقط فیلترها اعمال می‌شوند
        و مرتب‌سازی پیش‌فرض بر اساس حجم داده است.
        """
        where, params = self._filter_clause(
            schema, data_status, field_type, min_rows, max_rows)

        matched: dict[str, list[dict]] = {}
        if field_type:
            matched = self._matched_columns(field_type, where, params)

        q = normalize(query)
        if not q:
            return self._browse(where, params, sort_by, sort_order, limit, matched)

        hits: dict[str, TableHit] = {}
        qcompact = q.replace(" ", "")

        def add(row: sqlite3.Row, base: float, why: list[str]) -> None:
            score, why = base, list(why)
            name_l = row["name"].lower()
            if name_l == qcompact:
                score += 40
                why.append("نام دقیق")
            elif qcompact in name_l or name_l in qcompact:
                score += 6
                why.append("نام نزدیک")
            if row["title_fa"] and normalize(row["title_fa"]) == q:
                score += 35
                why.append("عنوان فارسی دقیق")
            if row["has_data"]:
                score += 3
                why.append("داده دارد")
            if row["in_live_db"] == 0:
                score -= 30
                why.append("در دیتابیس زنده نیست")
            prev = hits.get(row["full_name"])
            if prev is not None and prev.score >= score:
                return
            hits[row["full_name"]] = TableHit(
                full_name=row["full_name"], title_fa=row["title_fa"],
                n_cols=row["n_cols"], row_count=row["row_count"],
                has_data=bool(row["has_data"]),
                in_live_db=row["in_live_db"] != 0,
                score=score, why="، ".join(why),
                matched_columns=matched.get(row["full_name"], []),
            )

        cols = ("t.full_name, t.name, t.title_fa, t.n_cols, t.row_count, "
                "t.has_data, t.in_live_db")

        # ۱) تطابق دقیق نام — فارغ از رتبه‌ی BM25 همیشه باید بیاید
        for r in self.db.execute(
            f"SELECT {cols} FROM tables t WHERE lower(t.name) = ? AND {where}",
            [qcompact, *params],
        ):
            add(r, 10.0, [])

        # ۲) جست‌وجوی تمام‌متن روی نام انگلیسی + عنوان و توضیح فارسی
        terms = self._fts_terms(q)
        if terms:
            for r in self.db.execute(
                f"SELECT {cols}, bm25(fts) AS rank FROM fts "
                f"JOIN tables t ON t.full_name = fts.full_name "
                f"WHERE fts MATCH ? AND {where} ORDER BY rank LIMIT ?",
                [terms, *params, limit * 5],
            ):
                add(r, -r["rank"], [])

        # ۳) تطابق نام ستون — وقتی کاربر نام فیلد را می‌داند نه نام جدول
        if len(qcompact) >= 3:
            for r in self.db.execute(
                f"SELECT DISTINCT {cols} FROM tables t "
                f"JOIN columns c2 ON c2.table_ref = t.full_name "
                f"WHERE lower(c2.name) = ? AND {where} LIMIT ?",
                [qcompact, *params, limit],
            ):
                add(r, 4.0, ["نام ستون"])

        ordered = sorted(hits.values(), key=lambda h: -h.score)
        return self._reorder(ordered, sort_by, sort_order)[:limit]

    def _fts_terms(self, q: str) -> str:
        """هر واژه اختیاری (OR) و همراه با ریشه‌اش، تا پرس‌وجوی چندکلمه‌ای خالی نشود."""
        variants: list[str] = []
        for token in q.split():
            if len(token) <= 1:
                continue
            variants.append(f'"{token}"*')
            root = stem_fa(token)
            if root != token:
                variants.append(f'"{root}"*')
        return " OR ".join(dict.fromkeys(variants))

    def _filter_clause(
        self, schema: str | None, data_status: str, field_type: str | None,
        min_rows: int | None, max_rows: int | None,
    ) -> tuple[str, list]:
        parts, params = ["1=1"], []
        if schema:
            parts.append("t.schema = ?")
            params.append(schema)
        if data_status == "with_data":
            parts.append("t.has_data = 1")
        elif data_status == "no_data":
            parts.append("t.has_data = 0")
        if min_rows is not None:
            parts.append("COALESCE(t.row_count, 0) >= ?")
            params.append(min_rows)
        if max_rows is not None:
            parts.append("COALESCE(t.row_count, 0) <= ?")
            params.append(max_rows)
        if field_type:
            clause, type_params = _type_clause(field_type)
            parts.append(
                "EXISTS (SELECT 1 FROM columns c WHERE c.table_ref = t.full_name "
                f"AND {clause})")
            params.extend(type_params)
        return " AND ".join(parts), params

    def _matched_columns(
        self, field_type: str, where: str, params: list,
    ) -> dict[str, list[dict]]:
        """ستون‌هایی که با فیلتر نوع مطابق‌اند — برای نمایش در کارت نتیجه."""
        clause, type_params = _type_clause(field_type)
        rows = self.db.execute(
            f"SELECT c.table_ref, c.name, c.type FROM columns c "
            f"JOIN tables t ON t.full_name = c.table_ref "
            f"WHERE {clause} AND {where} ORDER BY c.table_ref, c.ordinal",
            [*type_params, *params],
        ).fetchall()
        out: dict[str, list[dict]] = {}
        for r in rows:
            bucket = out.setdefault(r["table_ref"], [])
            if len(bucket) < 8:
                bucket.append({"name": r["name"], "type": r["type"]})
        return out

    def _browse(
        self, where: str, params: list, sort_by: str, sort_order: str,
        limit: int, matched: dict[str, list[dict]],
    ) -> list[TableHit]:
        """فهرست‌کردن بدون متن جست‌وجو — فقط فیلتر و مرتب‌سازی."""
        order = {
            "name": "t.full_name",
            "n_cols": "t.n_cols",
            "row_count": "COALESCE(t.row_count, 0)",
        }.get(sort_by, "COALESCE(t.row_count, 0)")
        direction = "ASC" if sort_order == "asc" else "DESC"
        rows = self.db.execute(
            "SELECT t.full_name, t.title_fa, t.n_cols, t.row_count, t.has_data, "
            f"t.in_live_db FROM tables t WHERE {where} "
            f"ORDER BY {order} {direction}, t.full_name LIMIT ?",
            [*params, limit],
        ).fetchall()
        return [TableHit(
            full_name=r["full_name"], title_fa=r["title_fa"], n_cols=r["n_cols"],
            row_count=r["row_count"], has_data=bool(r["has_data"]),
            in_live_db=r["in_live_db"] != 0, score=0.0,
            why="مطابق فیلترهای انتخابی",
            matched_columns=matched.get(r["full_name"], []),
        ) for r in rows]

    @staticmethod
    def _reorder(hits: list[TableHit], sort_by: str, sort_order: str) -> list[TableHit]:
        if sort_by == "score":
            return hits
        keys = {
            "name": lambda h: h.full_name.lower(),
            "n_cols": lambda h: h.n_cols or 0,
            "row_count": lambda h: h.row_count or 0,
        }
        key = keys.get(sort_by)
        if key is None:
            return hits
        return sorted(hits, key=key, reverse=sort_order != "asc")

    def search_columns(self, query: str, limit: int = 30) -> list[dict]:
        """یافتن ستون بر اساس نام — برای وقتی نام جدول را نمی‌دانید."""
        rows = self.db.execute(
            "SELECT c.table_ref, c.name, c.type, t.title_fa, t.has_data "
            "FROM columns c JOIN tables t ON t.full_name = c.table_ref "
            "WHERE c.name LIKE ? ORDER BY t.has_data DESC, length(c.name) LIMIT ?",
            (f"%{query}%", limit),
        ).fetchall()
        return [dict(r) for r in rows]

    # ─────────────────────── جزئیات جدول ───────────────────────

    def get_table(self, full_name: str) -> TableInfo | None:
        r = self.db.execute(
            "SELECT * FROM tables WHERE full_name = ?", (full_name,)
        ).fetchone()
        if r is None:
            return None

        info = TableInfo(
            full_name=r["full_name"], title_fa=r["title_fa"],
            description_fa=r["description_fa"], kind=r["kind"],
            row_count=r["row_count"], has_data=bool(r["has_data"]),
            in_live_db=r["in_live_db"] != 0,
        )

        # نام فارسی ستون در ایندکس یک‌جا حل شده (column_titles): ثبت دستی
        # برای همین جدول، واژه‌نامهٔ نام ستون، یا عنوان جدولی که ستون *Ref به
        # آن اشاره می‌کند. label_source می‌گوید کدام.
        for c in self.db.execute(
            "SELECT c.*, t.title_fa AS label_fa, t.source AS label_source "
            "FROM columns c LEFT JOIN column_titles t "
            "ON t.table_ref = c.table_ref AND t.name = c.name "
            "WHERE c.table_ref=? ORDER BY c.ordinal", (full_name,)
        ):
            info.columns.append({
                "name": c["name"], "type": c["type"],
                "nullable": bool(c["nullable"]), "is_pk": bool(c["is_pk"]),
                "ordinal": c["ordinal"], "label_fa": c["label_fa"],
                "label_source": c["label_source"],
            })
            if c["is_pk"]:
                info.primary_key.append(c["name"])

        for j in self.db.execute("SELECT * FROM joins WHERE from_table=?", (full_name,)):
            info.outgoing.append(JoinStep(
                j["from_table"], j["from_col"], j["to_table"], j["to_col"],
                j["confidence"], bool(j["verified"])))

        for j in self.db.execute(
            "SELECT * FROM joins WHERE to_table=? LIMIT 120", (full_name,)
        ):
            info.incoming.append(JoinStep(
                j["from_table"], j["from_col"], j["to_table"], j["to_col"],
                j["confidence"], bool(j["verified"])))

        for e in self.db.execute(
            "SELECT * FROM enums WHERE table_ref=? ORDER BY column, value", (full_name,)
        ):
            info.enums.setdefault(e["column"], []).append({
                "value": e["value"], "label_fa": e["label_fa"],
                "confidence": e["confidence"], "observed": e["observed"],
            })

        for i in self.db.execute("SELECT * FROM indexes_ WHERE table_ref=?", (full_name,)):
            info.indexes.append({
                "name": i["name"],
                "columns": i["columns"].split(",") if i["columns"] else [],
                "unique": bool(i["is_unique"]), "is_pk": bool(i["is_pk"]),
            })

        if not info.has_data:
            info.warnings.append(
                "این جدول در نصب فعلی داده ندارد — احتمالاً ماژولش خریداری نشده.")
        if not info.in_live_db:
            info.warnings.append(
                "این جدول در دیتابیس زندهٔ فعلی وجود ندارد — مستندات نسبت به نصب کهنه است.")
        if any(c["name"] == "FiscalYearRef" for c in info.columns):
            info.warnings.append(
                "ستون FiscalYearRef دارد — فیلتر سال مالی الزامی است، "
                "وگرنه خروجی بی‌خطا ولی غلط می‌شود.")
        weak = [j for j in info.outgoing if not j.verified]
        if weak:
            info.warnings.append(
                f"{len(weak)} مسیر JOIN از این جدول تأییدنشده است (استنتاج از نام).")
        return info

    def schema_neighbors(self, full_name: str, limit: int = 40) -> list[dict]:
        """هم‌اسکیماهای پرارتباط — برای پرش سریع بین جدول‌های یک ماژول."""
        schema = full_name.split(".")[0]
        rows = self.db.execute(
            "SELECT t.full_name, t.title_fa, t.row_count, t.has_data, t.n_cols, "
            "  (SELECT COUNT(*) FROM joins j "
            "   WHERE j.from_table = t.full_name OR j.to_table = t.full_name) AS degree "
            "FROM tables t WHERE t.schema = ? AND t.full_name <> ? "
            "ORDER BY degree DESC, COALESCE(t.row_count, 0) DESC LIMIT ?",
            (schema, full_name, limit),
        ).fetchall()
        return [dict(r) | {"has_data": bool(r["has_data"])} for r in rows]

    # ─────────────────────── گراف ───────────────────────

    def schemas(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT t.schema AS id, COUNT(*) AS table_count, "
            "  SUM(t.has_data) AS with_data, SUM(t.n_cols) AS column_count, "
            "  s.title_fa AS title_fa "
            "FROM tables t LEFT JOIN schema_titles s ON s.id = t.schema "
            "GROUP BY t.schema ORDER BY table_count DESC"
        ).fetchall()
        return [{
            "id": r["id"], "title_fa": r["title_fa"], "table_count": r["table_count"],
            "with_data": r["with_data"] or 0, "column_count": r["column_count"] or 0,
        } for r in rows]

    def entity_for(self, full_name: str) -> dict | None:
        """موجودیت نرم‌افزاری که این جدول پیاده‌سازی‌اش می‌کند."""
        row = self.db.execute(
            "SELECT name, title_fa, component FROM entities WHERE table_ref = ? LIMIT 1",
            (full_name,),
        ).fetchone()
        return dict(row) if row else None

    def component_entities(self, component: str, limit: int = 200) -> list[dict]:
        rows = self.db.execute(
            "SELECT name, title_fa, table_ref FROM entities "
            "WHERE component = ? AND table_ref IS NOT NULL ORDER BY name LIMIT ?",
            (component, limit),
        ).fetchall()
        return [dict(r) for r in rows]

    # ─────────────────── کد و شرحی ───────────────────

    def lookups(self, q: str = "", module: str = "", limit: int = 400) -> list[dict]:
        """
        فهرست نوع‌های کد و شرحی.

        جست‌وجو هم روی نام لاتین نوع و عنوان فارسی‌اش انجام می‌شود و هم روی
        خودِ مقادیر: کاربری که «دیپلم» را می‌جوید نام نوع (EducationDegree)
        را نمی‌داند، فقط مقداری را که در فرم دیده به یاد دارد.
        """
        where, params = [], []
        if q:
            like = f"%{q.strip()}%"
            where.append(
                "(t.type LIKE ? OR t.title_fa LIKE ? OR EXISTS ("
                "  SELECT 1 FROM lookup_values v WHERE v.type = t.type AND v.value LIKE ?))"
            )
            params += [like, like, like]
        if module:
            where.append("t.module = ?")
            params.append(module)
        # وقتی تطبیق روی خودِ مقدار بوده، همان مقدار هم برمی‌گردد: بدون آن،
        # کاربری که «دیپلم» را جسته فهرستی از نام‌های لاتین می‌بیند و هیچ
        # نشانه‌ای ندارد که چرا این نوع‌ها آمده‌اند.
        matched = (
            "(SELECT v.value FROM lookup_values v WHERE v.type = t.type "
            " AND v.value LIKE ? ORDER BY COALESCE(v.ordinal, v.code) LIMIT 1)"
            if q else "NULL"
        )
        sql = f"SELECT type, title_fa, module, n_values, is_dynamic, {matched} AS matched_value FROM lookup_types t"
        if q:
            params.insert(0, f"%{q.strip()}%")
        if where:
            sql += " WHERE " + " AND ".join(where)
        # نوع‌های عنوان‌دار اول: بدون عنوان فارسی، سطر برای کاربر فارسی‌زبان
        # تقریباً بی‌معناست و نباید بالای فهرست بنشیند.
        sql += " ORDER BY (t.title_fa IS NULL), (t.n_values = 0), t.n_values DESC, t.type LIMIT ?"
        params.append(limit)
        return [dict(r) for r in self.db.execute(sql, params).fetchall()]

    def lookup(self, lookup_type: str) -> dict | None:
        head = self.db.execute(
            "SELECT type, title_fa, module, n_values, is_dynamic FROM lookup_types WHERE type = ?",
            (lookup_type,),
        ).fetchone()
        if head is None:
            return None
        values = self.db.execute(
            "SELECT code, value, ordinal, extra FROM lookup_values WHERE type = ? "
            "ORDER BY COALESCE(ordinal, code), code",
            (lookup_type,),
        ).fetchall()
        # ستون‌هایی که نامشان به این نوع می‌خورد — پلی از فهرست مرجع به
        # جایی که واقعاً در پایگاه داده استفاده می‌شود.
        used_by = self.db.execute(
            "SELECT c.table_ref, c.name FROM columns c "
            "WHERE c.name = ? OR c.name = ? OR c.name = ? "
            "ORDER BY c.table_ref LIMIT 50",
            (lookup_type, lookup_type + "Ref", lookup_type + "ID"),
        ).fetchall()
        return {
            **dict(head),
            "values": [dict(v) for v in values],
            "used_by": [dict(u) for u in used_by],
        }

    def lookup_modules(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT module AS id, COUNT(*) AS n FROM lookup_types "
            "WHERE module IS NOT NULL GROUP BY module ORDER BY n DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def schema_graph(
        self, schema: str, include_external: bool = True,
        only_with_data: bool = False, max_nodes: int = 75,
    ) -> dict:
        """
        گراف روابط یک اسکیما.

        گره‌ها بر اساس درجه‌ی اتصال انتخاب می‌شوند تا با سقف `max_nodes`
        پرارتباط‌ترین (و در نتیجه معنادارترین) بخش اسکیما نمایش داده شود.
        """
        where = "t.schema = ?"
        params: list = [schema]
        if only_with_data:
            where += " AND t.has_data = 1"

        rows = self.db.execute(
            "SELECT t.full_name, t.name, t.schema, t.title_fa, t.n_cols, "
            "  t.row_count, t.has_data, "
            "  (SELECT COUNT(*) FROM joins j "
            "   WHERE j.from_table = t.full_name OR j.to_table = t.full_name) AS degree "
            f"FROM tables t WHERE {where} "
            "ORDER BY degree DESC, COALESCE(t.row_count, 0) DESC LIMIT ?",
            [*params, max_nodes],
        ).fetchall()

        nodes = {r["full_name"]: {
            "id": r["full_name"], "full_name": r["full_name"], "name": r["name"],
            "schema": r["schema"], "title_fa": r["title_fa"], "n_cols": r["n_cols"],
            "row_count": r["row_count"], "has_data": bool(r["has_data"]),
            "degree": r["degree"], "external": False,
        } for r in rows}
        if not nodes:
            return {"schema": schema, "nodes": [], "links": [],
                    "stats": {"nodes": 0, "links": 0, "external": 0, "cross": 0}}

        placeholders = ",".join("?" * len(nodes))
        edges = self.db.execute(
            "SELECT from_table, from_col, to_table, to_col, confidence, verified "
            f"FROM joins WHERE from_table IN ({placeholders}) "
            f"   OR to_table IN ({placeholders})",
            [*nodes, *nodes],
        ).fetchall()

        # گره‌های بیرونی هم سقف دارند: بدون آن، یک اسکیمای بزرگ صدها جدول
        # همسایه می‌آورد و گراف به توده‌ای ناخوانا تبدیل می‌شود. پرارتباط‌ترین‌ها
        # با هستهٔ اسکیما می‌مانند، بقیه کنار گذاشته می‌شوند.
        external_degree: dict[str, int] = {}
        internal_links, candidate_links = [], []
        for e in edges:
            src, dst = e["from_table"], e["to_table"]
            src_in, dst_in = src in nodes, dst in nodes
            link = {
                "source": src, "target": dst,
                "from_col": e["from_col"], "to_col": e["to_col"],
                "confidence": e["confidence"], "verified": bool(e["verified"]),
                "cross": src.split(".")[0] != dst.split(".")[0],
            }
            if src_in and dst_in:
                internal_links.append(link)
                continue
            if not include_external:
                continue
            outside = dst if src_in else src
            if outside.split(".")[0] == schema:
                continue              # هم‌اسکیما ولی خارج از سقف گره — نادیده
            external_degree[outside] = external_degree.get(outside, 0) + 1
            candidate_links.append((outside, link))

        keep = max(8, min(40, max_nodes // 2))
        externals = {
            name for name, _ in sorted(
                external_degree.items(), key=lambda kv: -kv[1])[:keep]
        }
        links = internal_links + [l for outside, l in candidate_links if outside in externals]

        for full in externals:
            meta = self.db.execute(
                "SELECT full_name, name, schema, title_fa, n_cols, row_count, has_data "
                "FROM tables WHERE full_name = ?", (full,)
            ).fetchone()
            if meta is None:
                continue
            nodes[full] = {
                "id": meta["full_name"], "full_name": meta["full_name"],
                "name": meta["name"], "schema": meta["schema"],
                "title_fa": meta["title_fa"], "n_cols": meta["n_cols"],
                "row_count": meta["row_count"], "has_data": bool(meta["has_data"]),
                "degree": 0, "external": True,
            }

        links = [l for l in links if l["source"] in nodes and l["target"] in nodes]

        # درجه را بر پایه‌ی یال‌های همین نما بازمحاسبه می‌کنیم تا فیلترِ
        # «فقط دارای داده» یا حذف گره‌های خارجی، اندازه‌ی گره‌ها را گمراه‌کننده نکند.
        for node in nodes.values():
            node["degree"] = 0
        for link in links:
            nodes[link["source"]]["degree"] += 1
            nodes[link["target"]]["degree"] += 1

        return {
            "schema": schema,
            "nodes": list(nodes.values()),
            "links": links,
            "stats": {
                "nodes": len(nodes), "links": len(links),
                "external": len(externals),
                "cross": sum(1 for l in links if l["cross"]),
            },
        }

    def _adjacency(self) -> dict[str, list[tuple]]:
        """گراف بدون‌جهت — برای JOIN، جهت اهمیتی ندارد."""
        if self._adj is None:
            adj: dict[str, list[tuple]] = {}
            for j in self.db.execute("SELECT * FROM joins"):
                a, b = j["from_table"], j["to_table"]
                adj.setdefault(a, []).append(
                    (b, j["from_col"], j["to_col"], j["confidence"], j["verified"], True))
                adj.setdefault(b, []).append(
                    (a, j["to_col"], j["from_col"], j["confidence"], j["verified"], False))
            self._adj = adj
        return self._adj

    def find_join_path(
        self, source: str, target: str, max_hops: int = 4,
        verified_only: bool = False, through: Iterable[str] | None = None,
    ) -> list[JoinStep] | None:
        """
        کوتاه‌ترین مسیر JOIN بین دو جدول (BFS).

        یال‌های تأییدشده اولویت دارند: در هر سطح اول آن‌ها بررسی می‌شوند،
        تا اگر دو مسیر هم‌طول باشند، مسیر قطعی برنده شود. با `through` فقط از
        همان جدول‌ها عبور می‌کند — دستیار اول مسیری از میان جدول‌های انتخاب‌شده
        می‌خواهد و فقط اگر نبود، جدول واسطهٔ تازه می‌آورد.
        """
        allowed = set(through) if through is not None else None
        if source == target:
            return []
        adj = self._adjacency()
        if source not in adj:
            return None

        seen = {source}
        queue = deque([(source, [])])
        while queue:
            node, path = queue.popleft()
            if len(path) >= max_hops:
                continue
            for nxt, from_col, to_col, conf, verified, _fwd in sorted(
                adj.get(node, []), key=lambda n: -n[4]
            ):
                if verified_only and not verified:
                    continue
                if nxt in seen:
                    continue
                if allowed is not None and nxt != target and nxt not in allowed:
                    continue
                step = JoinStep(node, from_col, nxt, to_col, conf, bool(verified))
                if nxt == target:
                    return path + [step]
                seen.add(nxt)
                queue.append((nxt, path + [step]))
        return None

    @staticmethod
    def path_warning(path: list[JoinStep]) -> str | None:
        """
        مسیرِ موجود ≠ مسیرِ درست.

        BFS کوتاه‌ترین مسیر گراف را می‌دهد، ولی گراف معنا نمی‌فهمد.
        مسیرهای بلند معمولاً از نظر تجاری بی‌معنا هستند.
        """
        if not path:
            return None
        if len(path) > 2:
            return (f"این مسیر {len(path)} مرحله دارد و از "
                    f"{' → '.join(s.to_table for s in path[:-1])} عبور می‌کند. "
                    f"مسیرهای بلند معمولاً از نظر تجاری بی‌معنا هستند — "
                    f"احتمالاً این دو جدول مستقیماً مرتبط نیستند.")
        weak = [s for s in path if not s.verified]
        if weak:
            return f"{len(weak)} مرحله از این مسیر تأییدنشده است (استنتاج از نام)."
        return None

    def related_tables(self, full_name: str) -> list[dict]:
        """
        همسایه‌های تأییدشدهٔ یک جدول، با عنوان و وضعیت داده — برای دستیار.

        «out» جدول‌هایی است که این جدول به آن‌ها ارجاع می‌دهد (مرجع‌ها: شخص،
        کالا، سال مالی) و «in» جدول‌هایی که به این جدول ارجاع می‌دهند (ردیف‌ها و
        جزئیات). داده‌دار، جدولِ جزئیاتِ هم‌نام (Voucher ← VoucherItem) و
        هم‌اسکیما اول می‌آیند؛ ستون‌های ممیزی (Creator و
        LastModifier) کنار می‌روند چون هر جدولی آن‌ها را دارد و چیزی نمی‌گویند.
        ترتیب صریح است تا نسخهٔ اندروید (localdb.js) عیناً همین را ببیند.
        """
        schema, _, name = full_name.partition(".")
        rows = self.db.execute(
            "SELECT 'out' AS direction, j.from_col AS col, t.full_name, t.title_fa, t.has_data, "
            "t.schema = ? AS near, 0 AS child "
            "FROM joins j JOIN tables t ON t.full_name = j.to_table "
            "WHERE j.from_table = ? AND j.verified = 1 AND j.to_table <> ? "
            "AND j.from_col NOT IN ('Creator', 'LastModifier') "
            "UNION ALL "
            "SELECT 'in', j.from_col, t.full_name, t.title_fa, t.has_data, t.schema = ?, "
            "substr(t.name, 1, length(?)) = ? "
            "FROM joins j JOIN tables t ON t.full_name = j.from_table "
            "WHERE j.to_table = ? AND j.verified = 1 AND j.from_table <> ? "
            "ORDER BY 1 DESC, 5 DESC, 7 DESC, 6 DESC, 3, 2",
            (schema, full_name, full_name, schema, name, name, full_name, full_name),
        )
        return [{"direction": r["direction"], "col": r["col"], "full_name": r["full_name"],
                 "title_fa": r["title_fa"], "has_data": bool(r["has_data"])} for r in rows]

    def links_between(self, names: Iterable[str], limit: int = 400) -> list[JoinStep]:
        """پیوندهای تأییدشدهٔ مستقیم میان چند جدول — نقشهٔ کوچکِ روابط برای انتخاب."""
        names = list(dict.fromkeys(names))
        if not names:
            return []
        marks = ",".join("?" * len(names))
        rows = self.db.execute(
            f"SELECT * FROM joins WHERE verified = 1 AND from_table IN ({marks}) "
            f"AND to_table IN ({marks}) AND from_table <> to_table "
            "ORDER BY from_table, from_col, to_table, to_col LIMIT ?",
            (*names, *names, limit),
        )
        return [JoinStep(j["from_table"], j["from_col"], j["to_table"], j["to_col"],
                         j["confidence"], bool(j["verified"])) for j in rows]

    def neighbours(self, table: str, limit: int = 40) -> list[dict]:
        return [{
            "table": nxt, "via": f"{fc} → {tc}", "confidence": conf,
            "verified": bool(ver), "direction": "outgoing" if fwd else "incoming",
        } for nxt, fc, tc, conf, ver, fwd in self._adjacency().get(table, [])[:limit]]

    def stats(self) -> dict:
        return {r["key"]: r["value"] for r in self.db.execute("SELECT * FROM meta")}
