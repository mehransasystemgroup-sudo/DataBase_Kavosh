"""
بازبینی کوئری در برابر ساختار واقعی پایگاه داده.

این ماژول قلبِ «دستیار کوئری‌نویسی» است و دلیل وجودش یک جمله است: مدل زبانی
حق ندارد ساختار پایگاه داده را از خودش بسازد. هرچه مدل بنویسد این‌جا کلمه‌به‌
کلمه با دانشی که در ایندکس داریم سنجیده می‌شود — نام جدول، نام ستون، مسیر
JOIN، و مقدارهای مجاز یک ستون کد و شرحی.

چرا این مهم‌تر از «پرامپت خوب» است: پرامپت خوب احتمال اشتباه را کم می‌کند،
ولی هیچ تضمینی نمی‌دهد. مدل ضعیف‌تر «FIN3.Vouchers» می‌نویسد در حالی که جدول
«FIN3.Voucher» است، یا دو جدول را روی ستونی به هم وصل می‌کند که رابطه‌ای
ندارند — و کوئری بی‌هیچ خطایی اجرا می‌شود و جوابِ غلط می‌دهد. آن اشتباه
دوم از اولی خطرناک‌تر است، چون دیده نمی‌شود.

با این بازبینی، خروجیِ نادرست شناسایی می‌شود و متن خطا آن‌قدر مشخص است که
بشود همان را به مدل پس داد تا تصحیح کند. این‌جاست که مدل ضعیف هم بالاخره به
جواب درست می‌رسد: دورِ بیشتر می‌زند، ولی هر دور با واقعیت سنجیده می‌شود.

این ماژول هیچ وابستگی‌ای به مدل زبانی ندارد و مستقل آزمودنی است.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import asdict, dataclass, field
from pathlib import Path

import sqlglot
from sqlglot import exp

DIALECT = "tsql"

# نوشتن، حذف و تغییر ساختار. دستیار فقط کوئریِ خواندنی می‌سازد: کاربر باید
# بتواند خروجی را بی‌واهمه روی پایگاه دادهٔ واقعی اجرا کند. اگر مدل چیزی جز
# SELECT بنویسد، اشکال از خودِ مدل است و باید صریح رد شود.
WRITE_NODES = (
    exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter,
    exp.Merge, exp.TruncateTable,
)


@dataclass
class Finding:
    """یک ایراد مشخص، با متنی که هم به کاربر و هم به مدل پس داده می‌شود."""

    severity: str        # error | warning
    code: str
    message: str
    hint: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CheckResult:
    ok: bool
    findings: list[Finding] = field(default_factory=list)
    tables: list[str] = field(default_factory=list)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "tables": self.tables,
            "findings": [f.to_dict() for f in self.findings],
        }

    def feedback(self) -> str:
        """متن بازخورد برای مدل — همان چیزی که دور بعد اصلاحش می‌کند."""
        lines = []
        for f in self.findings:
            mark = "خطا" if f.severity == "error" else "هشدار"
            lines.append(f"- [{mark}] {f.message}" + (f"\n  {f.hint}" if f.hint else ""))
        return "\n".join(lines)


def _strip_brackets(name: str) -> str:
    return name.strip().strip("[]").strip('"').strip("`")


class SchemaIndex:
    """
    نمای فقط-خواندنیِ ساختار پایگاه داده، از همان ایندکسی که بقیهٔ برنامه
    استفاده می‌کند. فقط چیزهایی را می‌خواند که برای بازبینی لازم است و همه
    را یک بار در حافظه می‌گیرد: بازبینی در حلقهٔ اصلاح چند بار اجرا می‌شود و
    نباید هر بار به دیسک بزند.
    """

    def __init__(self, db_path: str | Path):
        self.path = str(db_path)
        db = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        try:
            # نام جدول‌ها با کلید بی‌حساسیت به بزرگی/کوچکی نگه داشته می‌شود:
            # T-SQL در نصب‌های معمول حساس نیست، و مدل‌ها مدام حروف را عوض
            # می‌کنند. آنچه برمی‌گردانیم همیشه املای درستِ ایندکس است.
            self.tables: dict[str, str] = {}
            self.by_bare: dict[str, list[str]] = {}
            for (full,) in db.execute("SELECT full_name FROM tables"):
                self.tables[full.lower()] = full
                bare = full.split(".", 1)[-1].lower()
                self.by_bare.setdefault(bare, []).append(full)

            self.columns: dict[str, dict[str, str]] = {}
            for table, col in db.execute("SELECT table_ref, name FROM columns"):
                self.columns.setdefault(table.lower(), {})[col.lower()] = col

            # یال‌های JOIN در هر دو جهت، تا ترتیبِ نوشتنِ شرط مهم نباشد
            self.edges: set[tuple[str, str, str, str]] = set()
            for a, ac, b, bc in db.execute(
                "SELECT from_table, from_col, to_table, to_col FROM joins"
            ):
                self.edges.add((a.lower(), ac.lower(), b.lower(), bc.lower()))
                self.edges.add((b.lower(), bc.lower(), a.lower(), ac.lower()))

            self.enums: dict[tuple[str, str], set[str]] = {}
            for table, col, value in db.execute(
                "SELECT table_ref, column, value FROM enums"
            ):
                self.enums.setdefault((table.lower(), col.lower()), set()).add(str(value))
        finally:
            db.close()

    # ── جست‌وجوهای کوچک ──

    def resolve_table(self, name: str) -> str | None:
        """املای درست جدول، یا None اگر چنین جدولی نداریم."""
        key = name.lower()
        if key in self.tables:
            return self.tables[key]
        # بدون نام اسکیما نوشته شده؛ فقط وقتی می‌پذیریم که یکتا باشد
        matches = self.by_bare.get(key, [])
        return matches[0] if len(matches) == 1 else None

    def candidates_for(self, name: str) -> list[str]:
        """جدول‌هایی با نامِ نزدیک — برای این‌که پیام خطا راه‌حل هم بدهد."""
        bare = _strip_brackets(name).split(".")[-1].lower()
        exact = self.by_bare.get(bare, [])
        if exact:
            return exact[:5]
        # جمع/مفرد و پسوندهای رایجی که مدل‌ها اضافه می‌کنند
        trimmed = bare.rstrip("s")
        near = [
            full for b, names in self.by_bare.items()
            for full in names
            if b.startswith(trimmed[:6]) and len(trimmed) >= 4
        ]
        return sorted(set(near))[:5]

    def column_names(self, table: str) -> dict[str, str]:
        return self.columns.get(table.lower(), {})

    def has_column(self, table: str, column: str) -> bool:
        return column.lower() in self.columns.get(table.lower(), {})

    def near_columns(self, table: str, column: str) -> list[str]:
        cols = self.columns.get(table.lower(), {})
        stem = column.lower()[:4]
        near = [real for low, real in cols.items() if stem and low.startswith(stem)]
        return sorted(near)[:6]

    def edge_exists(self, a: str, ac: str, b: str, bc: str) -> bool:
        return (a.lower(), ac.lower(), b.lower(), bc.lower()) in self.edges

    def known_edges_between(self, a: str, b: str) -> list[tuple[str, str, str, str]]:
        al, bl = a.lower(), b.lower()
        return [
            (x, xc, y, yc) for (x, xc, y, yc) in sorted(self.edges)
            if x == al and y == bl
        ]

    def enum_values(self, table: str, column: str) -> set[str]:
        return self.enums.get((table.lower(), column.lower()), set())


# ───────────────────────── بازبینی ─────────────────────────


def _collect_sources(tree: exp.Expression) -> tuple[dict[str, str], set[str], set[str]]:
    """
    نگاشت نام‌مستعار→جدول، مجموعهٔ جدول‌های واقعی، و نام‌هایی که جدول نیستند.

    نام‌های غیرجدول یعنی CTE و زیرپرس‌وجوی نام‌دار: ستون‌هایشان ساختگی‌اند و
    در ایندکس وجود ندارند، پس نباید به‌عنوان «ستون ناشناخته» گزارش شوند.
    """
    derived: set[str] = set()
    for cte in tree.find_all(exp.CTE):
        if cte.alias:
            derived.add(cte.alias.lower())
    for sub in tree.find_all(exp.Subquery):
        if sub.alias:
            derived.add(sub.alias.lower())
    # OUTER/CROSS APPLY (…) x — نام مستعار روی Lateral می‌نشیند نه روی Subquery
    for lat in tree.find_all(exp.Lateral):
        if lat.alias:
            derived.add(lat.alias.lower())

    alias_to_table: dict[str, str] = {}
    referenced: set[str] = set()
    for node in tree.find_all(exp.Table):
        name = _strip_brackets(node.name)
        if not name or name.lower() in derived:
            continue
        schema = _strip_brackets(node.db) if node.db else ""
        full = f"{schema}.{name}" if schema else name
        referenced.add(full)
        alias = node.alias_or_name
        if alias:
            alias_to_table[_strip_brackets(alias).lower()] = full
    return alias_to_table, referenced, derived


def _literal_values(node: exp.Expression) -> list[str]:
    if isinstance(node, exp.Literal):
        return [str(node.this)]
    if isinstance(node, (exp.Tuple, exp.Array)):
        return [v for e in node.expressions for v in _literal_values(e)]
    return []


def check_sql(sql: str, index: SchemaIndex) -> CheckResult:
    """
    کوئری را با ساختار واقعی می‌سنجد.

    خطا = کوئری قطعاً کار نمی‌کند یا جدول/ستونی می‌خواهد که وجود ندارد.
    هشدار = اجرا می‌شود ولی احتمالاً جوابِ غلط می‌دهد — مثل JOIN روی رابطه‌ای
    که در دانش ما نیست. هشدار عمداً خطا نیست، چون ممکن است رابطه واقعی باشد
    و ما هنوز یادش نگرفته باشیم؛ ولی به چشم کاربر می‌آید و مدل هم می‌کوشد
    برطرفش کند.
    """
    findings: list[Finding] = []
    sql = (sql or "").strip()
    if not sql:
        return CheckResult(False, [Finding("error", "empty", "کوئری خالی است.")])

    try:
        statements = [s for s in sqlglot.parse(sql, dialect=DIALECT) if s]
    except Exception as e:                       # noqa: BLE001 — هر ایراد نحوی
        return CheckResult(False, [Finding(
            "error", "parse_error",
            f"کوئری از نظر نحوی معتبر نیست: {e}",
            "کوئری باید T-SQL معتبر باشد.",
        )])
    if not statements:
        return CheckResult(False, [Finding("error", "empty", "کوئری خالی است.")])

    all_tables: set[str] = set()

    for tree in statements:
        for node_type in WRITE_NODES:
            if isinstance(tree, node_type) or tree.find(node_type):
                findings.append(Finding(
                    "error", "not_read_only",
                    "این کوئری داده را تغییر می‌دهد؛ دستیار فقط کوئری خواندنی می‌سازد.",
                    "فقط SELECT بنویسید.",
                ))
                break

        alias_to_table, referenced, derived = _collect_sources(tree)

        # ── جدول‌ها ──
        resolved: dict[str, str] = {}
        for name in sorted(referenced):
            real = index.resolve_table(name)
            if real is None:
                near = index.candidates_for(name)
                findings.append(Finding(
                    "error", "unknown_table",
                    f"جدول «{name}» در این پایگاه داده وجود ندارد.",
                    ("نزدیک‌ترین‌ها: " + "، ".join(near)) if near
                    else "نام جدول را از فهرست جدول‌های داده‌شده بردارید.",
                ))
            else:
                resolved[name.lower()] = real
                all_tables.add(real)

        alias_real = {
            alias: resolved.get(table.lower())
            for alias, table in alias_to_table.items()
        }
        in_scope = [t for t in resolved.values()]

        # ── ستون‌ها ──
        for col in tree.find_all(exp.Column):
            cname = _strip_brackets(col.name)
            if not cname or cname == "*":
                continue
            qualifier = _strip_brackets(col.table).lower() if col.table else ""

            if qualifier:
                if qualifier in derived:
                    continue                      # ستونِ CTE — ساختگی است
                table = alias_real.get(qualifier)
                if table is None:
                    if qualifier not in alias_real:
                        findings.append(Finding(
                            "error", "unknown_alias",
                            f"نام مستعار «{qualifier}» به هیچ جدولی در FROM وصل نیست.",
                        ))
                    continue                      # جدولش قبلاً گزارش شده
                if not index.has_column(table, cname):
                    near = index.near_columns(table, cname)
                    findings.append(Finding(
                        "error", "unknown_column",
                        f"ستون «{cname}» در جدول {table} وجود ندارد.",
                        ("ستون‌های نزدیک: " + "، ".join(near)) if near
                        else f"ستون‌های {table} را از متن ساختار بردارید.",
                    ))
                continue

            # بدون نام جدول — باید دقیقاً در یکی از جدول‌های حاضر باشد
            if derived:
                continue                          # با CTE، دامنه مبهم می‌شود
            owners = [t for t in in_scope if index.has_column(t, cname)]
            if not owners and in_scope:
                findings.append(Finding(
                    "error", "unknown_column",
                    f"ستون «{cname}» در هیچ‌کدام از جدول‌های این کوئری نیست.",
                    "جدول‌های کوئری: " + "، ".join(sorted(in_scope)),
                ))
            elif len(owners) > 1:
                findings.append(Finding(
                    "warning", "ambiguous_column",
                    f"ستون «{cname}» در چند جدول هست و بدون نام جدول مبهم است.",
                    "نام جدول یا مستعارش را جلوی ستون بگذارید: " + "، ".join(sorted(owners)),
                ))

        # ── مسیرهای JOIN ──
        for join in tree.find_all(exp.Join):
            on = join.args.get("on")
            if on is None:
                continue
            for eq in on.find_all(exp.EQ):
                left, right = eq.left, eq.right
                if not (isinstance(left, exp.Column) and isinstance(right, exp.Column)):
                    continue
                lt = alias_real.get(_strip_brackets(left.table).lower())
                rt = alias_real.get(_strip_brackets(right.table).lower())
                if not lt or not rt or lt == rt:
                    continue
                lc, rc = _strip_brackets(left.name), _strip_brackets(right.name)
                if index.edge_exists(lt, lc, rt, rc):
                    continue
                known = index.known_edges_between(lt, rt)
                hint = ""
                if known:
                    pairs = {
                        f"{index.tables.get(x, x)}.{xc} = {index.tables.get(y, y)}.{yc}"
                        for x, xc, y, yc in known
                    }
                    hint = "رابطهٔ شناخته‌شده: " + "؛ ".join(sorted(pairs))
                else:
                    hint = "بین این دو جدول رابطهٔ مستقیمی در دانش ما نیست."
                findings.append(Finding(
                    "warning", "unverified_join",
                    f"پیوند {lt}.{lc} = {rt}.{rc} در دانش پایگاه داده ثبت نشده است.",
                    hint,
                ))

        # ── مقدارهای کد و شرحی ──
        for eq in tree.find_all(exp.EQ, exp.In):
            target = eq.this
            if not isinstance(target, exp.Column):
                continue
            table = alias_real.get(_strip_brackets(target.table).lower()) if target.table else None
            if table is None and len(in_scope) == 1:
                table = in_scope[0]
            if table is None:
                continue
            cname = _strip_brackets(target.name)
            allowed = index.enum_values(table, cname)
            if not allowed:
                continue
            values = _literal_values(eq.expression) if isinstance(eq, exp.EQ) else [
                v for e in eq.expressions for v in _literal_values(e)
            ]
            bad = [v for v in values if v not in allowed]
            if bad:
                findings.append(Finding(
                    "warning", "unknown_enum_value",
                    f"مقدار {'، '.join(bad)} برای {table}.{cname} در فهرست مقادیر شناخته‌شده نیست.",
                    "مقادیر مجاز: " + "، ".join(sorted(allowed)[:12]),
                ))

    ok = not any(f.severity == "error" for f in findings)
    return CheckResult(ok, findings, sorted(all_tables))


def extract_sql(text: str) -> str:
    """
    کوئری را از پاسخ مدل بیرون می‌کشد.

    مدل‌های ضعیف‌تر تقریباً همیشه دور کوئری توضیح می‌نویسند، حتی وقتی صریح
    گفته باشیم ننویس. به‌جای جنگیدن با این عادت، از خروجی‌شان بلوک کد را
    برمی‌داریم.
    """
    if not text:
        return ""
    fenced = re.findall(r"```(?:sql|tsql)?\s*\n(.*?)```", text, re.S | re.I)
    if fenced:
        return max(fenced, key=len).strip()
    m = re.search(r"\b(WITH|SELECT)\b", text, re.I)
    return text[m.start():].strip() if m else text.strip()
