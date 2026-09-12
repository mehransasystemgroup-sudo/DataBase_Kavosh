"""
مکان‌یابی داده و منابع — تنها جایی که «کجاست؟» پاسخ داده می‌شود.

چرا جدا: نسخهٔ بسته‌بندی‌شده (PyInstaller) و اجرای معمولی از مخزن، دو دنیای
متفاوت‌اند. در حالت بسته‌بندی، منابع داخل بستهٔ فقط-خواندنی‌اند و در مسیری
موقت باز می‌شوند؛ پس هر چیزی که نوشته می‌شود — ایندکس و دانشی که کاربر ثبت
می‌کند — باید بیرون از بسته و در پوشهٔ دادهٔ کاربر بنشیند، وگرنه با هر
به‌روزرسانی یا هر بار اجرا از بین می‌رود.
"""

from __future__ import annotations

import copy
import hashlib
import os
import shutil
import sys
from pathlib import Path

import yaml

APP_NAME = "KavoshDB"


def is_frozen() -> bool:
    """آیا داخل بستهٔ PyInstaller اجرا می‌شویم؟"""
    return getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")


def bundle_root() -> Path:
    """ریشهٔ منابع فقط-خواندنی: پوشهٔ بسته، یا خودِ backend/ در اجرای از مخزن."""
    if is_frozen():
        return Path(sys._MEIPASS)  # noqa: SLF001 — قرارداد خود PyInstaller
    return Path(__file__).resolve().parent.parent


def data_root() -> Path:
    """
    پوشهٔ دادهٔ قابل نوشتن.

    در ویندوز زیر %LOCALAPPDATA% می‌نشیند تا نصب در Program Files (که برای
    کاربر عادی فقط-خواندنی است) مانع کار برنامه نشود. در اجرای از مخزن،
    همان backend/ می‌ماند تا رفتار توسعه عوض نشود.
    """
    override = os.environ.get("KAVOSH_DATA_DIR")
    if override:
        return Path(override)

    if not is_frozen():
        return bundle_root()

    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / APP_NAME


# دانشی که خودِ کاربر ثبت کرده با همین نشان مشخص می‌شود — در هر سه شکلِ
# نوشتنی (جدول، enum، رابطه) یکسان است، پس یک قاعده برای همه کافی است.
USER_SOURCE = "stated_by_user"

# اثر انگشت دانشِ کارخانه، کنار دادهٔ کاربر. با این، «نسخهٔ تازه نصب شد» از
# «همان نسخه دوباره اجرا شد» قابل تشخیص است.
STAMP = "kb-version.txt"


def kb_fingerprint(kb_dir: Path) -> str:
    """اثر انگشت محتوای دانش کارخانه."""
    h = hashlib.sha256()
    for f in sorted(kb_dir.rglob("*.yaml")):
        h.update(f.relative_to(kb_dir).as_posix().encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def _merge_doc(factory: dict, user: dict) -> dict:
    """
    دانش کارخانهٔ تازه را پایه می‌گیرد و آنچه کاربر ثبت کرده رویش می‌نشاند.

    چرا لازم است: نویسندهٔ دانش در همان فایل‌هایی می‌نویسد که کارخانه پر کرده
    (semantics/HCM3.yaml هم عنوان‌های ما را دارد هم عنوانی که کاربر خودش ثبت
    کرده). پس نه می‌شود فایل را دست‌نخورده گذاشت — که یعنی به‌روزرسانی هیچ
    دانش تازه‌ای نمی‌آورد — و نه می‌شود رویش نوشت، که یعنی کار کاربر از بین
    برود. تنها راه درست، ادغام است.
    """
    out = copy.deepcopy(factory)

    def mine(entry: dict) -> bool:
        return entry.get("source") == USER_SOURCE or entry.get("_manual") is True

    # عنوان و توضیح جدول‌ها — کلید: نام جدول
    if isinstance(user.get("tables"), list):
        out.setdefault("tables", [])
        index = {t.get("name"): t for t in out["tables"] if isinstance(t, dict)}
        for t in user["tables"]:
            if isinstance(t, dict) and mine(t):
                if t.get("name") in index:
                    index[t["name"]].update(t)
                else:
                    out["tables"].append(t)
        out["tables"].sort(key=lambda t: t.get("name", ""))

    # مقادیر enum — کلید: (جدول، ستون) و درونش خودِ مقدار
    if isinstance(user.get("enums"), list):
        out.setdefault("enums", [])
        index = {(e.get("table"), e.get("column")): e
                 for e in out["enums"] if isinstance(e, dict)}
        for e in user["enums"]:
            if not isinstance(e, dict):
                continue
            keep = [v for v in e.get("values") or [] if mine(v)]
            if not keep:
                continue
            target = index.get((e.get("table"), e.get("column")))
            if target is None:
                out["enums"].append({**e, "values": keep})
                continue
            target.setdefault("values", [])
            by_val = {str(v.get("value")): v for v in target["values"]}
            for v in keep:
                if str(v.get("value")) in by_val:
                    by_val[str(v.get("value"))].update(v)
                else:
                    target["values"].append(v)

    # مسیرهای JOIN — کلید: سرِ یال
    if isinstance(user.get("edges"), list):
        out.setdefault("edges", [])
        index = {e.get("from"): e for e in out["edges"] if isinstance(e, dict)}
        for e in user["edges"]:
            if isinstance(e, dict) and mine(e):
                if e.get("from") in index:
                    index[e["from"]].update(e)
                else:
                    out["edges"].append(e)
        out["edges"].sort(key=lambda e: e.get("from", ""))

    return out


def seed_data_dir(data: Path, bundle: Path) -> None:
    """
    دانش پایه را از بسته به پوشهٔ دادهٔ کاربر می‌آورد — بار اول و بعد از هر
    به‌روزرسانی.

    پیش از این فقط وقتی کپی می‌شد که پوشه اصلاً وجود نداشت. نتیجه‌اش این بود
    که کاربرِ نسخهٔ قدیمی پس از نصب نسخهٔ تازه، همچنان دانش قدیمی را داشت و
    فایل‌های تازه (جدول‌های کد و شرحی، موجودیت‌ها) هرگز نمی‌رسیدند.
    """
    data.mkdir(parents=True, exist_ok=True)
    for name in ("kb", "instances"):
        src, dst = bundle / name, data / name
        if src.is_dir() and not dst.exists():
            shutil.copytree(src, dst)

    src_kb, dst_kb = bundle / "kb", data / "kb"
    if not src_kb.is_dir():
        return

    stamp = data / STAMP
    fingerprint = kb_fingerprint(src_kb)
    if stamp.exists() and stamp.read_text(encoding="utf-8").strip() == fingerprint:
        return                       # همین نسخه، قبلاً نشسته

    for f in sorted(src_kb.rglob("*")):
        if not f.is_file():
            continue
        target = dst_kb / f.relative_to(src_kb)
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            shutil.copy2(f, target)
            continue
        if f.suffix != ".yaml":
            shutil.copy2(f, target)
            continue
        try:
            factory = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            current = yaml.safe_load(target.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError:
            continue                 # فایل معیوبِ کاربر را خراب‌تر نمی‌کنیم
        if not isinstance(factory, dict) or not isinstance(current, dict):
            continue
        merged = _merge_doc(factory, current)
        if merged != current:
            target.write_text(
                yaml.safe_dump(merged, allow_unicode=True, sort_keys=False, width=100),
                encoding="utf-8",
            )

    stamp.write_text(fingerprint, encoding="utf-8")
