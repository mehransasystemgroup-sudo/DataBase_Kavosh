"""
آزمون دستیار کوئری‌نویسی — بدون هیچ کلید API.

کل ارزش دستیار در این است که خروجی مدل را با ساختار واقعی می‌سنجد. پس همان
سنجش باید خودش آزموده شود، و آزمونش نباید به سرویس بیرونی وابسته باشد: مدل
این‌جا ساختگی است و دقیقاً همان‌طور اشتباه می‌کند که مدل‌های ضعیف واقعی
اشتباه می‌کنند — جمع‌بستن نام جدول، ساختن ستون، و پیوند از خود درآوردن.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from core import assistant, indexer                              # noqa: E402
from core.search import KnowledgeBase                            # noqa: E402
from core.sqlcheck import SchemaIndex, check_sql, extract_sql    # noqa: E402


@pytest.fixture(scope="session")
def index_path(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("kb") / "kb.sqlite"
    indexer.build(BACKEND / "kb", out, None)
    return out


@pytest.fixture(scope="session")
def index(index_path) -> SchemaIndex:
    return SchemaIndex(index_path)


@pytest.fixture(scope="session")
def kb(index_path) -> KnowledgeBase:
    return KnowledgeBase(index_path)


# ─────────────────────── بازبینی کوئری ───────────────────────


def test_real_table_and_column_pass(index):
    assert check_sql("SELECT EmployeeID FROM HCM3.Employee", index).ok


def test_unknown_table_is_error_and_suggests_the_real_one(index):
    r = check_sql("SELECT * FROM HCM3.Employees", index)
    assert not r.ok
    (finding,) = [f for f in r.errors if f.code == "unknown_table"]
    # پیام باید راه‌حل بدهد نه فقط ایراد بگیرد
    assert "HCM3.Employee" in finding.hint


def test_unknown_column_is_error(index):
    r = check_sql("SELECT e.NoSuchColumn FROM HCM3.Employee e", index)
    assert not r.ok
    assert any(f.code == "unknown_column" for f in r.errors)


def test_unqualified_unknown_column_is_error(index):
    r = check_sql("SELECT NoSuchColumn FROM HCM3.Employee", index)
    assert not r.ok
    assert any(f.code == "unknown_column" for f in r.errors)


@pytest.mark.parametrize("sql", [
    "DELETE FROM HCM3.Employee",
    "UPDATE HCM3.Employee SET Code = 1",
    "DROP TABLE HCM3.Employee",
    "INSERT INTO HCM3.Employee (Code) VALUES (1)",
])
def test_write_statements_are_refused(index, sql):
    r = check_sql(sql, index)
    assert not r.ok
    assert any(f.code == "not_read_only" for f in r.errors)


def test_syntax_error_is_reported(index):
    r = check_sql("SELECT FROM WHERE", index)
    assert not r.ok
    assert any(f.code == "parse_error" for f in r.errors)


def test_cte_columns_do_not_produce_false_errors(index):
    """
    ستون‌های CTE ساختگی‌اند و در ایندکس نیستند. اگر بازبین آن‌ها را
    «ناشناخته» بخواند، هر کوئری حرفه‌ای را رد می‌کند و بی‌فایده می‌شود.
    """
    sql = (
        "WITH latest AS (SELECT EmployeeID AS Eid FROM HCM3.Employee) "
        "SELECT Eid FROM latest"
    )
    assert check_sql(sql, index).ok


def test_invented_join_is_flagged_as_warning(index):
    """
    پیوند ساختگی کوئری را نمی‌شکند — بی‌سروصدا جوابِ غلط می‌دهد. پس باید
    دیده شود، حتی اگر خطای قطعی نباشد.
    """
    sql = ("SELECT e.EmployeeID FROM HCM3.Employee e "
           "JOIN FIN3.Voucher v ON v.VoucherID = e.EmployeeID")
    r = check_sql(sql, index)
    assert r.ok                                   # نحو درست است
    assert any(f.code == "unverified_join" for f in r.warnings)


def test_known_join_is_not_flagged(kb, index):
    """پیوندی که خودِ ایندکس می‌شناسد نباید هشدار بگیرد."""
    info = kb.get_table("HCM3.Employee")
    step = next((s for s in info.outgoing if s.verified), None)
    if step is None:
        pytest.skip("این نصب پیوند تأییدشده‌ای روی HCM3.Employee ندارد")
    sql = (f"SELECT a.{step.from_col} FROM {step.from_table} a "
           f"JOIN {step.to_table} b ON a.{step.from_col} = b.{step.to_col}")
    r = check_sql(sql, index)
    assert not [f for f in r.warnings if f.code == "unverified_join"]


def test_extract_sql_pulls_query_out_of_chatter():
    reply = "حتماً!\n```sql\nSELECT 1\n```\nامیدوارم کمک کند."
    assert extract_sql(reply) == "SELECT 1"


# ─────────────────────── حلقهٔ اصلاح ───────────────────────


class ScriptedModel:
    """مدلی که پاسخ‌هایش از پیش نوشته شده — جای مدل ضعیف واقعی."""

    def __init__(self, selection: str, replies: list[str], intent: str = ""):
        self.selection = selection
        self.replies = list(replies)
        self.intent = intent
        self.asked: list[str] = []

    def __call__(self, system: str, user: str) -> str:
        self.asked.append(user)
        if "هنوز کوئری نمی‌نویسی" in system:
            return self.intent
        if "انتخاب کن" in system:
            return self.selection
        return self.replies.pop(0) if self.replies else self.replies_last

    @property
    def replies_last(self) -> str:
        return "```sql\nSELECT 1\n```"


def run_with(kb, index, model, question="فهرست کارمندان", attempts=4, history=None):
    return assistant.run(question=question, kb=kb, index=index,
                         ask=model, emit=lambda *a: None, max_attempts=attempts,
                         history=history)


def test_weak_model_converges_after_feedback(kb, index):
    """
    مدل اول نام جدول را جمع می‌بندد. بازبین ایراد را می‌گیرد و نام درست را
    در بازخورد می‌گذارد؛ دور بعد درست می‌شود. این همان چیزی است که باید
    برای مدل‌های ضعیف اتفاق بیفتد: کندتر، ولی درست.
    """
    model = ScriptedModel("HCM3.Employee", [
        "```sql\nSELECT e.EmployeeID FROM HCM3.Employees AS e\n```",
        "```sql\nSELECT e.EmployeeID FROM HCM3.Employee AS e\n```",
    ])
    d = run_with(kb, index, model)
    assert d.attempts == 2
    assert d.check.ok
    assert "HCM3.Employee" in d.sql
    # بازخورد باید واقعاً به مدل رسیده باشد، نه اینکه شانسی درست شده باشد
    assert "HCM3.Employee" in model.asked[-1]


def test_hopeless_model_is_reported_not_disguised(kb, index):
    """
    اگر مدل تا آخر اشتباه بماند، کوئری نباید به‌عنوان تأییدشده نشان داده
    شود. گزارشِ صادقانهٔ شکست از جوابِ غلطِ با اعتمادبه‌نفس بهتر است.
    """
    bad = "```sql\nSELECT x.Nope FROM HCM3.Employees AS x\n```"
    model = ScriptedModel("HCM3.Employee", [bad] * 4)
    d = run_with(kb, index, model, attempts=3)
    assert d.attempts == 3
    assert not d.check.ok
    assert d.check.errors


def test_selection_falls_back_when_model_output_is_garbage(kb, index):
    """
    اگر مرحلهٔ انتخاب بی‌نتیجه بماند، کار نباید بخوابد: نتیجهٔ جست‌وجوی
    خودِ برنامه جای انتخاب مدل را می‌گیرد.
    """
    model = ScriptedModel("...!!!", [
        "```sql\nSELECT EmployeeID FROM HCM3.Employee\n```",
    ])
    d = run_with(kb, index, model)
    assert d.tables                                # زمینه خالی نماند
    assert d.check.ok


def test_guidance_answer_when_no_sql(kb, index):
    model = ScriptedModel("HCM3.Employee", ["برای این کار باید اول ماژول را مشخص کنید."])
    d = run_with(kb, index, model)
    assert d.kind == "guidance"
    assert "ماژول" in d.note


def test_parse_selection_only_accepts_offered_tables():
    candidates = [{"full_name": "HCM3.Employee"}, {"full_name": "FIN3.Voucher"}]
    chosen = assistant.parse_selection(
        "HCM3.Employee\nBOGUS.Table\nFIN3.Voucher", candidates
    )
    assert chosen == ["HCM3.Employee", "FIN3.Voucher"]


def test_context_includes_real_columns_and_joins(kb):
    context, tables, _joins = assistant.build_context(kb, ["HCM3.Employee"])
    assert "HCM3.Employee" in tables
    assert "EmployeeID" in context
    # ستون‌ها باید کامل بیایند؛ بریدنشان یعنی دعوت به ساختنِ نام
    info = kb.get_table("HCM3.Employee")
    for column in info.columns:
        assert column["name"] in context


# ─────────────────────── فهم خواسته و گفت‌وگو ───────────────────────


INTENT = """هدف: فهرست کارمندان به همراه شناسه
نوع: کوئری
کلیدواژه‌ها: کارمند، Employee
خروجی: شناسهٔ کارمند
فیلترها: —
فرض‌ها: همهٔ کارمندان، فعال و غیرفعال
ابهام‌ها: فقط کارمندان فعال؟ | مرتب‌سازی بر اساس چه؟"""


def test_parse_intent_reads_labels_loosely():
    intent = assistant.parse_intent(
        "**هدف**: جمع مبلغ اسناد\n- کلیدواژه: سند، Voucher\nبازه زمانی: سال ۱۴۰۲\n"
        "فیلترها: —\nنوع: راهنمایی"
    )
    assert intent["goal"] == "جمع مبلغ اسناد"
    assert intent["keywords"] == ["سند", "Voucher"]
    assert intent["period"] == "سال ۱۴۰۲"
    assert intent["filters"] == ""
    assert intent["mode"] == "guidance"


def test_garbage_intent_is_empty_not_half_filled():
    """بی‌«هدف»، برداشتی در کار نیست — نیمه‌برداشت از هیچ بدتر است."""
    intent = assistant.parse_intent("```sql\nSELECT 1\n```\nخروجی: همه")
    assert intent["goal"] == "" and intent["output"] == ""


def test_intent_reaches_the_draft_and_the_result(kb, index):
    model = ScriptedModel("HCM3.Employee", [
        "```sql\nSELECT EmployeeID FROM HCM3.Employee\n```",
    ], intent=INTENT)
    d = run_with(kb, index, model)
    assert d.check.ok
    assert d.intent["goal"].startswith("فهرست کارمندان")
    assert len(d.intent["questions"]) == 2
    draft_prompt = model.asked[-1]
    assert "## برداشت از خواسته" in draft_prompt
    assert "همهٔ کارمندان، فعال و غیرفعال" in draft_prompt


def test_keywords_widen_retrieval(kb):
    """پرسش محاوره‌ای ممکن است واژهٔ جدول را نداشته باشد؛ کلیدواژه پیدایش می‌کند."""
    bare = {c["full_name"] for c in assistant.retrieve(kb, "چند نفر داریم؟")}
    wide = {c["full_name"] for c in assistant.retrieve(kb, "چند نفر داریم؟", ["Employee"])}
    assert "HCM3.Employee" in wide
    assert wide >= bare


def test_follow_up_keeps_previous_tables_and_query(kb, index):
    """«حالا فقط ...» باید روی کوئری قبلی ساخته شود، نه از صفر."""
    history = [{"question": "فهرست کارمندان",
                "sql": "SELECT EmployeeID FROM HCM3.Employee",
                "tables": ["HCM3.Employee", "NO.SuchTable"]}]
    model = ScriptedModel("HCM3.Employee", [
        "```sql\nSELECT TOP 10 EmployeeID FROM HCM3.Employee\n```",
    ])
    candidates = assistant.retrieve(kb, "حالا فقط ده تا", (), ["HCM3.Employee", "NO.SuchTable"])
    assert candidates[0]["full_name"] == "HCM3.Employee"
    assert all(c["full_name"] != "NO.SuchTable" for c in candidates)

    d = run_with(kb, index, model, question="حالا فقط ده تا", history=history)
    assert d.check.ok
    assert "## گفت‌وگوی قبلی" in model.asked[0]          # به مرحلهٔ فهم رسید
    assert "SELECT EmployeeID FROM HCM3.Employee" in model.asked[-1]


def test_history_is_bounded_and_sanitised():
    many = [{"question": f"q{i}", "sql": "x" * 9000, "tables": ["A.B"] * 20} for i in range(6)]
    many.append({"question": "   "})
    many.append("not a dict")
    out = assistant.clean_history(many)
    assert [h["question"] for h in out] == ["q5"]
    assert len(out[0]["sql"]) == 8000 and len(out[0]["tables"]) == 10


# ─────────────────────── شناخت روابط و جدول‌های سنجاق‌شده ───────────────────────


def test_retrieval_follows_relations_to_detail_and_reference_tables(kb):
    """
    «جمع مبلغ اسناد» سند را پیدا می‌کند؛ مبلغ در اقلام سند است و هیچ واژه‌ای از
    پرسش به آن نمی‌خورد. گسترش از راه روابط باید اقلام سند را نامزد کند.
    """
    names = [c["full_name"] for c in assistant.retrieve(
        kb, "جمع مبلغ اسناد حسابداری", ["سند حسابداری"])]
    assert "FIN3.Voucher" in names
    assert "FIN3.VoucherItem" in names
    assert len(names) <= assistant.MAX_CANDIDATES


def test_pinned_tables_are_candidates_and_always_chosen(kb, index):
    model = ScriptedModel("GNR3.Party", ["```sql\nSELECT p.PartyID FROM [GNR3].[Party] AS p\n```"])
    d = assistant.run(question="فهرست اشخاص", kb=kb, index=index, ask=model,
                      emit=lambda *a: None, pinned=["HCM3.Employee", "NOPE.Missing"])
    assert d.tables[0] == "HCM3.Employee"
    assert "GNR3.Party" in d.tables
    assert "NOPE.Missing" not in d.tables
    select = next(u for u in model.asked if "## جدول‌های موجود" in u)
    assert "HCM3.Employee — " in select and "انتخاب شما" in select
    assert "## جدول‌هایی که کاربر خودش انتخاب کرده\nHCM3.Employee" in select


def test_pinned_tables_survive_a_garbage_selection(kb, index):
    model = ScriptedModel("...!!!", ["```sql\nSELECT EmployeeID FROM HCM3.Employee\n```"])
    d = assistant.run(question="گزارش", kb=kb, index=index, ask=model,
                      emit=lambda *a: None, pinned=["FIN3.Voucher"])
    assert d.tables[0] == "FIN3.Voucher"


def test_select_prompt_shows_direct_links_between_candidates(kb):
    candidates = [{"full_name": t, "title_fa": None, "why": ""}
                  for t in ("FIN3.Voucher", "FIN3.VoucherItem", "GNR3.Party")]
    links = assistant.candidate_links(kb, candidates)
    prompt = assistant.select_prompt("x", candidates, links)
    assert "FIN3.VoucherItem.VoucherRef → FIN3.Voucher" in prompt
    assert "FIN3.VoucherItem.PartyRef → GNR3.Party" in prompt


def test_context_lists_references_and_data_warnings(kb):
    context, _tables, _joins = assistant.build_context(kb, ["FIN3.VoucherItem"])
    assert "ارجاع‌ها:" in context
    assert "VoucherRef→[FIN3].[Voucher]" in context
    assert "PartyRef→[GNR3].[Party]" in context
    # ستون‌های ممیزی چیزی دربارهٔ گزارش نمی‌گویند
    assert "Creator→" not in context
    context, _tables, _joins = assistant.build_context(kb, ["FIN3.Voucher"])
    assert "هشدار: ستون FiscalYearRef دارد" in context


def test_join_goes_through_chosen_tables_before_adding_a_bridge(kb):
    """
    سند و طرف حساب از راه اقلام سند به هم می‌رسند. اگر اقلام سند انتخاب شده،
    همان مسیر باید برگزیده شود، نه جدولِ هم‌طولِ دیگری که کسی نخواسته.
    """
    _context, tables, joins = assistant.build_context(
        kb, ["FIN3.Voucher", "FIN3.VoucherItem", "GNR3.Party"])
    assert tables == ["FIN3.Voucher", "FIN3.VoucherItem", "GNR3.Party"]
    assert all("Offline" not in j for j in joins)


def test_find_join_path_can_be_limited_to_given_tables(kb):
    path = kb.find_join_path("FIN3.Voucher", "GNR3.Party",
                             through=["FIN3.VoucherItem"])
    assert [s.to_table for s in path] == ["FIN3.VoucherItem", "GNR3.Party"]
    assert kb.find_join_path("FIN3.Voucher", "GNR3.Party", through=[]) is None


def test_draft_rules_cover_fiscal_year_parameters_and_fallback():
    for phrase in ("FiscalYearRef", "DECLARE", "CASE", "LEFT JOIN", "راهکار"):
        assert phrase in assistant.DRAFT_SYSTEM


def test_draft_rules_carry_report_builder_skill():
    """قواعد مهارت گزارش‌سازی راهکاران: شعبه، State با ELSE، بازهٔ نیم‌باز، Version، ReferenceType، FORMAT، فرض اثبات‌نشده."""
    for phrase in ("BranchRef", "ELSE", "DATEADD(day, 1, @ToDate)", "BETWEEN", "fnGetPersianYearMonth",
                   "Version", "ReferenceType", "IsDeleted", "FORMAT", "-- عنوان", "فرضی / نیازمند تأیید"):
        assert phrase in assistant.DRAFT_SYSTEM, phrase

# ───────────── همسانی روی ایندکس واقعی (مرجعِ نسخهٔ اندروید) ─────────────


def test_kb_golden(kb):
    """بازیابی، پرامپت انتخاب و زمینه هنوز با مرجعی می‌خوانند که assistant.test.js هم با آن سنجیده می‌شود."""
    import json

    import assistant_golden as golden

    expected = json.loads(golden.KB_GOLDEN.read_text(encoding="utf-8"))
    actual = json.loads(json.dumps(golden.compute_kb(kb), ensure_ascii=False))
    assert actual == expected
