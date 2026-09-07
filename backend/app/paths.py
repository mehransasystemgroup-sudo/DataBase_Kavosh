"""
مکان‌یابی داده و منابع — تنها جایی که «کجاست؟» پاسخ داده می‌شود.

چرا جدا: نسخهٔ بسته‌بندی‌شده (PyInstaller) و اجرای معمولی از مخزن، دو دنیای
متفاوت‌اند. در حالت بسته‌بندی، منابع داخل بستهٔ فقط-خواندنی‌اند و در مسیری
موقت باز می‌شوند؛ پس هر چیزی که نوشته می‌شود — ایندکس و دانشی که کاربر ثبت
می‌کند — باید بیرون از بسته و در پوشهٔ دادهٔ کاربر بنشیند، وگرنه با هر
به‌روزرسانی یا هر بار اجرا از بین می‌رود.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

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


def seed_data_dir(data: Path, bundle: Path) -> None:
    """
    در اولین اجرا، دانش پایه را از بسته به پوشهٔ دادهٔ کاربر کپی می‌کند.

    فقط آنچه غایب است کپی می‌شود: اگر کاربر دانشی ثبت کرده باشد، نباید با
    نسخهٔ کارخانه بازنویسی شود.
    """
    data.mkdir(parents=True, exist_ok=True)
    for name in ("kb", "instances"):
        src, dst = bundle / name, data / name
        if src.is_dir() and not dst.exists():
            shutil.copytree(src, dst)
