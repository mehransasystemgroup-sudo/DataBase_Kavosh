"""
گرفتن پورت برای سرور — جدا از main تا آزمونش کل برنامه را بالا نیاورد.

ایراد قبلی: _free_port پورت را با SO_REUSEADDR «امتحان» می‌کرد، می‌بست، و
بعد uvicorn دوباره همان را می‌گرفت. روی لینوکس این بی‌خطر است، ولی روی ویندوز
SO_REUSEADDR یعنی «اجازه بده روی پورتی که کسِ دیگری دارد گوش می‌دهد هم
بنشینم». نتیجه: اگر نسخهٔ قبلی هنوز روی ۸۳۲۱ باز بود، نسخهٔ تازه هم روی ۸۳۲۱
می‌نشست، و درخواست‌ها به برنامهٔ قدیمی می‌رسید. از بیرون: «نصب کردم ولی اجرا
نمی‌شود» یا «هیچ چیز عوض نشد».

قاعدهٔ درست دو بخش دارد:
  • روی ویندوز SO_EXCLUSIVEADDRUSE، تا هیچ‌کس پورتِ گرفته‌شده را شریک نشود.
  • همان سوکتی که گرفتیم به uvicorn داده می‌شود؛ بین «امتحان» و «گرفتن»
    فاصله‌ای نیست که فرایند دیگری در آن بنشیند.
"""

from __future__ import annotations

import os
import socket

SPAN = 20


def bind_free_port(host: str, preferred: int) -> socket.socket:
    """اولین پورت واقعاً آزاد از پورت دلخواه به بعد، گرفته‌شده و آمادهٔ گوش‌دادن."""
    for candidate in range(preferred, preferred + SPAN):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if os.name == "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            # روی یونیکس فقط اجازهٔ بازگشت سریع از TIME_WAIT است، نه اشتراک
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, candidate))
            sock.listen(128)
            return sock
        except OSError:
            sock.close()
    raise SystemExit(f"هیچ پورت آزادی بین {preferred} تا {preferred + SPAN - 1} پیدا نشد.")
