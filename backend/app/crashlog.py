"""
گزارش خطای راه‌اندازی — تا «اجرا نمی‌شود» به یک پیام روشن تبدیل شود.

چرا لازم است: برنامه پنجرهٔ کنسول دارد و اگر هنگام بالا آمدن بیفتد، ویندوز
همان لحظه پنجره را می‌بندد. کاربر یک برق کوتاه می‌بیند و بس — نه پیامی، نه
ردی، نه چیزی که بشود فرستاد. از بیرون این دقیقاً «برنامه اجرا نمی‌شود»
است، و از داخل هیچ اطلاعاتی برای فهمیدنش نمانده.

این ماژول سه کار می‌کند و هر سه برای همان یک هدف‌اند:
    • رد کامل خطا را در پوشهٔ دادهٔ کاربر می‌نویسد، تا بشود خواندش
    • یک پنجرهٔ پیام ویندوزی نشان می‌دهد، چون کنسول ممکن است اصلاً نباشد
    • کنسول را باز نگه می‌دارد تا متن پیش از بسته‌شدن خوانده شود
"""

from __future__ import annotations

import os
import sys
import traceback
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

LOG_NAME = "startup-error.log"
BREADCRUMB = "last-run.log"


def _log_dir(data_root: Path) -> Path:
    d = data_root / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def breadcrumb(data_root: Path, note: str) -> None:
    """
    نشانهٔ «تا این‌جا رسیدم».

    اگر برنامه پیش از رسیدن پایتون به کد ما بمیرد — کتابخانهٔ گمشده، بستهٔ
    نیم‌بند، ضدویروسی که فایلی را قرنطینه کرده — هیچ استثنایی برای گرفتن
    وجود ندارد. آن وقت نبودِ همین فایل خودش جواب است: یعنی حتی شروع نشده.
    """
    try:
        stamp = datetime.now().isoformat(timespec="seconds")
        (_log_dir(data_root) / BREADCRUMB).write_text(
            f"{stamp}  {note}\n", encoding="utf-8"
        )
    except Exception:
        pass                      # گزارش‌گیری هرگز نباید خودش برنامه را بیندازد


def _show_dialog(title: str, body: str) -> None:
    # همان کلیدی که مکث کنسول را خاموش می‌کند، پنجرهٔ پیام را هم خاموش
    # می‌کند: پنجرهٔ پیام منتظر کلیک می‌ماند، و در اجرای خودکار کسی نیست
    # که کلیک کند — آزمون به‌جای شکستِ سریع، تا سقف زمانی‌اش معطل می‌شود.
    if sys.platform != "win32" or os.environ.get("KAVOSH_NO_PAUSE") == "1":
        return
    try:
        import ctypes

        # MB_ICONERROR | MB_SETFOREGROUND | MB_TOPMOST
        ctypes.windll.user32.MessageBoxW(None, body, title, 0x10 | 0x10000 | 0x40000)
    except Exception:
        pass


def _hold_console() -> None:
    """کنسول را باز نگه می‌دارد تا متن خوانده شود."""
    if os.environ.get("KAVOSH_NO_PAUSE") == "1":
        return
    try:
        if sys.stdin is None or not sys.stdin.isatty():
            return            # خروجی به فایل یا لوله می‌رود؛ کسی پشتش نیست
        input("\nبرای بستن این پنجره، Enter بزنید…")
    except Exception:
        pass


def report(data_root: Path, stage: str, error: BaseException) -> Path | None:
    """خطا را ثبت و به کاربر اعلام می‌کند؛ مسیر فایل گزارش را برمی‌گرداند."""
    trace = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    stamp = datetime.now().isoformat(timespec="seconds")
    body = (
        f"کاوشگر پایگاه داده — خطا در مرحلهٔ {stage}\n"
        f"زمان: {stamp}\n"
        f"پوشهٔ داده: {data_root}\n"
        f"پایتون: {sys.version}\n"
        f"بسته‌بندی‌شده: {getattr(sys, 'frozen', False)}\n"
        f"\n{trace}"
    )

    path: Path | None = None
    try:
        path = _log_dir(data_root) / LOG_NAME
        path.write_text(body, encoding="utf-8")
    except Exception:
        path = None

    where = f"\n\nشرح کامل خطا این‌جا ذخیره شد:\n{path}" if path else ""
    short = f"{type(error).__name__}: {error}"
    message = (
        f"برنامه هنگام {stage} با خطا روبه‌رو شد و بالا نیامد.\n\n"
        f"{short}{where}\n\n"
        "اگر مشکل ادامه داشت، همین فایل را بفرستید."
    )

    try:
        print("\n" + "─" * 60, file=sys.stderr)
        print(message, file=sys.stderr)
        print("─" * 60, file=sys.stderr, flush=True)
    except Exception:
        pass

    _show_dialog("کاوشگر پایگاه داده", message)
    return path


@contextmanager
def fatal_guard(data_root: Path, stage: str):
    """
    هر خطای پیش‌بینی‌نشده در این بلوک، گزارش می‌شود و بعد برنامه تمیز بسته
    می‌شود — به‌جای traceback خامی که در یک چشم‌به‌هم‌زدن ناپدید می‌شود.

    فقط Exception گرفته می‌شود نه BaseException: Ctrl+C و خروج عادی باید
    مثل همیشه رد شوند، وگرنه بستن برنامه هم یک «خطا» گزارش می‌شود.
    """
    try:
        yield
    except Exception as e:
        report(data_root, stage, e)
        _hold_console()
        sys.exit(1)
