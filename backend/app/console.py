"""
آماده‌سازی کنسول برای متن فارسی.

چرا لازم است: کنسول ویندوز پیش‌فرض کدپیج قدیمی دارد (cp1252 روی نصب‌های
انگلیسی، cp1256 روی فارسی). اولین `print` فارسی روی چنین کنسولی برنامه را
با `UnicodeEncodeError` می‌کُشد — یعنی برنامه پیش از آن‌که سرور بالا بیاید
می‌افتد. این ماژول باید پیش از هر خروجی‌ای فراخوانی شود.
"""

from __future__ import annotations

import sys

_UTF8 = 65001


def setup() -> None:
    """کدپیج کنسول و رمزگذاری جریان‌های خروجی را روی UTF-8 می‌گذارد."""
    if sys.platform == "win32":
        try:
            import ctypes

            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleOutputCP(_UTF8)
            kernel32.SetConsoleCP(_UTF8)
        except Exception:
            # بدون کنسول (اجرای windowed) یا API در دسترس نیست — مهم نیست،
            # چون خط بعدی به‌تنهایی از فروپاشی جلوگیری می‌کند.
            pass

    # `errors="replace"` تضمین می‌کند حتی اگر کدپیج عوض نشد، برنامه به‌خاطر
    # یک کاراکتر غیرقابل‌نمایش از کار نیفتد؛ حداکثر «؟» چاپ می‌شود.
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass
