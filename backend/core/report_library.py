"""
کتابخانهٔ گزارش‌ها — گزارش‌هایی که کاربر در «گزارش‌ساز» ساخته و نگه داشته.

هر گزارش یک سند JSON است: عنوان، پوشه/دسته، کوئری، طرح (فیلدها، گروه‌بندی،
پارامترها)، درس‌های آموخته و آمار استفاده. همه در یک فایل کوچک زیر پوشهٔ
دادهٔ کاربر می‌نشیند — همان جایی که دانش ثبت‌شده و تنظیمات‌اند — تا با
به‌روزرسانی برنامه از بین نرود.

چرا سمت سرور و نه localStorage مرورگر: نسخهٔ ویندوز هر بار ممکن است روی
درگاه دیگری بالا بیاید و localStorage به «مبدأ» (میزبان + درگاه) بسته است؛
یعنی کتابخانه با هر اجرا گم می‌شد.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

#: سقف‌ها تا یک درخواست خراب یا بدخواه فایل را بی‌حد بزرگ نکند
MAX_REPORTS = 2000
MAX_TEXT = 400_000        # SQL یا RDL کامل یک گزارش
MAX_FIELD = 4_000         # عنوان، دسته، توضیح
MAX_LIST = 200            # درس‌ها، جدول‌ها، برچسب‌ها

_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_LOCK = threading.Lock()

#: کلیدهایی که از کلاینت پذیرفته می‌شوند — بقیه دور ریخته می‌شوند
_TEXT_KEYS = ("title", "folder", "description", "request", "sql")
_BLOB_KEYS = ("rdl",)
_LIST_KEYS = ("tables", "parameters", "lessons", "tags")
_OBJ_KEYS = ("spec",)


class LibraryError(ValueError):
    """ورودی نامعتبر؛ پیامش مستقیم به کاربر نشان داده می‌شود."""


def _path(data_root: Path) -> Path:
    return data_root / "reports" / "library.json"


def _read(data_root: Path) -> list[dict]:
    path = _path(data_root)
    if not path.is_file():
        return []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # فایل خراب را کنار می‌گذاریم و از نو شروع نمی‌کنیم تا چیزی پاک نشود
        backup = path.with_suffix(f".broken-{int(time.time())}.json")
        try:
            os.replace(path, backup)
        except OSError:
            pass
        return []
    items = doc.get("reports") if isinstance(doc, dict) else None
    return [r for r in items or [] if isinstance(r, dict) and _ID.match(str(r.get("id", "")))]


def _write(data_root: Path, reports: list[dict]) -> None:
    path = _path(data_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": 1, "reports": reports}, ensure_ascii=False, indent=1),
                   encoding="utf-8")
    os.replace(tmp, path)


def _summary(r: dict) -> dict:
    """فهرست سبک: بی‌متن کامل RDL، که می‌تواند صدها کیلوبایت باشد."""
    out = {k: v for k, v in r.items() if k not in ("rdl", "spec")}
    out["has_rdl"] = bool(r.get("rdl"))
    out["has_spec"] = bool(r.get("spec"))
    return out


def _clean(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise LibraryError("بدنهٔ درخواست باید یک شیء JSON باشد.")
    out: dict = {}
    for key in _TEXT_KEYS:
        if key in payload and payload[key] is not None:
            value = str(payload[key])
            limit = MAX_TEXT if key == "sql" else MAX_FIELD
            if len(value) > limit:
                raise LibraryError(f"«{key}» بیش از حد مجاز طولانی است.")
            out[key] = value.strip() if key != "sql" else value
    for key in _BLOB_KEYS:
        if key in payload and payload[key] is not None:
            value = str(payload[key])
            if len(value) > MAX_TEXT * 10:
                raise LibraryError("فایل RDL بیش از حد مجاز (۴ مگابایت) بزرگ است.")
            out[key] = value
    for key in _LIST_KEYS:
        if key in payload and payload[key] is not None:
            value = payload[key]
            if not isinstance(value, list):
                raise LibraryError(f"«{key}» باید فهرست باشد.")
            out[key] = [str(x)[:MAX_FIELD] for x in value[:MAX_LIST] if str(x).strip()]
    for key in _OBJ_KEYS:
        if key in payload and payload[key] is not None:
            value = payload[key]
            if not isinstance(value, dict):
                raise LibraryError(f"«{key}» باید شیء باشد.")
            if len(json.dumps(value, ensure_ascii=False)) > MAX_TEXT:
                raise LibraryError(f"«{key}» بیش از حد مجاز بزرگ است.")
            out[key] = value
    return out


def list_reports(data_root: Path, *, q: str = "", folder: str = "") -> dict:
    with _LOCK:
        reports = _read(data_root)
    needle = q.strip().lower()

    def hit(r: dict) -> bool:
        if folder and (r.get("folder") or "") != folder:
            return False
        if not needle:
            return True
        hay = " ".join([r.get("title", ""), r.get("folder", ""), r.get("description", ""),
                        r.get("request", ""), " ".join(r.get("tables", [])),
                        " ".join(r.get("tags", []))]).lower()
        return needle in hay

    found = sorted((r for r in reports if hit(r)),
                   key=lambda r: r.get("updated_at", ""), reverse=True)
    folders = sorted({r.get("folder") or "" for r in reports} - {""})
    return {"reports": [_summary(r) for r in found], "folders": folders, "total": len(reports)}


def get_report(data_root: Path, report_id: str) -> dict | None:
    with _LOCK:
        return next((r for r in _read(data_root) if r.get("id") == report_id), None)


def save_report(data_root: Path, payload: dict) -> dict:
    """ایجاد یا به‌روزرسانی. شناسهٔ موجود = به‌روزرسانی (ادغام کلید‌به‌کلید)."""
    clean = _clean(payload)
    report_id = str(payload.get("id") or "")
    if report_id and not _ID.match(report_id):
        raise LibraryError("شناسهٔ گزارش نامعتبر است.")
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    with _LOCK:
        reports = _read(data_root)
        current = next((r for r in reports if r.get("id") == report_id), None) if report_id else None
        if current is None:
            if not (clean.get("title") or "").strip():
                raise LibraryError("گزارش بدون عنوان ذخیره نمی‌شود.")
            if len(reports) >= MAX_REPORTS:
                raise LibraryError(f"کتابخانه پر است (حداکثر {MAX_REPORTS} گزارش).")
            current = {"id": report_id or uuid.uuid4().hex[:16], "created_at": now, "used_count": 0}
            reports.append(current)
        if "title" in clean and not clean["title"]:
            raise LibraryError("عنوان گزارش نمی‌تواند خالی باشد.")
        current.update(clean)
        if payload.get("touch"):
            current["used_count"] = int(current.get("used_count") or 0) + 1
        current["updated_at"] = now
        _write(data_root, reports)
        return dict(current)


def delete_report(data_root: Path, report_id: str) -> bool:
    with _LOCK:
        reports = _read(data_root)
        kept = [r for r in reports if r.get("id") != report_id]
        if len(kept) == len(reports):
            return False
        _write(data_root, kept)
        return True
