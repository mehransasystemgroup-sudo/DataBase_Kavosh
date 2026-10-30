"""کتابخانهٔ گزارش‌ها: ذخیره، ادغام، جست‌وجو، حذف و مرزهای ورودی."""

from __future__ import annotations

import json

import pytest

from core import report_library as lib


def test_save_list_update_delete(tmp_path):
    saved = lib.save_report(tmp_path, {"title": "تراز آزمایشی", "folder": "مالی", "sql": "SELECT 1 AS One",
                                        "tables": ["FIN3.Voucher"], "rdl": "<Report/>", "spec": {"kind": "table"}})
    assert saved["id"] and saved["created_at"] == saved["updated_at"]

    listed = lib.list_reports(tmp_path)
    assert listed["total"] == 1 and listed["folders"] == ["مالی"]
    row = listed["reports"][0]
    # فهرست سبک است: متن RDL و طرح در آن نمی‌آید
    assert "rdl" not in row and row["has_rdl"] and row["has_spec"]

    again = lib.save_report(tmp_path, {"id": saved["id"], "lessons": ["سال مالی فراموش نشود"], "touch": True})
    assert again["title"] == "تراز آزمایشی" and again["lessons"] == ["سال مالی فراموش نشود"]
    assert again["used_count"] == 1

    assert lib.list_reports(tmp_path, q="voucher")["reports"]
    assert not lib.list_reports(tmp_path, q="حقوق")["reports"]
    assert not lib.list_reports(tmp_path, folder="حقوق")["reports"]

    assert lib.get_report(tmp_path, saved["id"])["rdl"] == "<Report/>"
    assert lib.delete_report(tmp_path, saved["id"]) is True
    assert lib.delete_report(tmp_path, saved["id"]) is False
    assert lib.list_reports(tmp_path)["total"] == 0


@pytest.mark.parametrize("payload, message", [
    ({"sql": "SELECT 1"}, "عنوان"),
    ({"title": "x", "tables": "FIN3.Voucher"}, "فهرست"),
    ({"title": "x", "spec": []}, "شیء"),
    ({"id": "../../etc", "title": "x"}, "شناسه"),
    ({"title": "x" * (lib.MAX_FIELD + 1)}, "طولانی"),
])
def test_rejects_bad_input(tmp_path, payload, message):
    with pytest.raises(lib.LibraryError, match=message):
        lib.save_report(tmp_path, payload)


def test_unknown_keys_dropped_and_broken_file_kept(tmp_path):
    saved = lib.save_report(tmp_path, {"title": "a", "evil": "x", "created_at": "1999"})
    assert "evil" not in saved and saved["created_at"] != "1999"

    path = tmp_path / "reports" / "library.json"
    path.write_text("{ not json", encoding="utf-8")
    assert lib.list_reports(tmp_path)["total"] == 0
    # فایل خراب پاک نمی‌شود؛ کنار گذاشته می‌شود تا بشود نجاتش داد
    assert list((tmp_path / "reports").glob("library.broken-*.json"))
    lib.save_report(tmp_path, {"title": "b"})
    assert json.loads(path.read_text(encoding="utf-8"))["reports"][0]["title"] == "b"
