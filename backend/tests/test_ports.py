"""
آزمون گرفتن پورت — همان ایرادی که روی ویندوز نسخهٔ تازه را پشت نسخهٔ قدیمی پنهان می‌کرد.

اگر برنامهٔ دیگری روی پورت دلخواه گوش می‌دهد، باید پورت بعدی را بگیریم، نه
اینکه کنارش بنشینیم. روی ویندوز همین آزمون است که SO_EXCLUSIVEADDRUSE را
می‌سنجد؛ روی لینوکس رفتار سیستم‌عامل از قبل درست است.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.ports import bind_free_port                             # noqa: E402

HOST = "127.0.0.1"


def _listener() -> socket.socket:
    """یک «نسخهٔ قدیمیِ باز» — با همان گزینه‌ای که uvicorn خودش می‌گذارد."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, 0))
    sock.listen(1)
    return sock


def test_skips_port_someone_is_listening_on():
    old = _listener()
    taken = old.getsockname()[1]
    try:
        new = bind_free_port(HOST, taken)
        try:
            assert new.getsockname()[1] != taken
        finally:
            new.close()
    finally:
        old.close()


def test_second_instance_cannot_share_our_port():
    ours = bind_free_port(HOST, _ephemeral())
    port = ours.getsockname()[1]
    try:
        other = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        other.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            other.bind((HOST, port))
            other.listen(1)
            shared = True
        except OSError:
            shared = False
        finally:
            other.close()
        assert not shared, "فرایند دیگری توانست روی پورت ما بنشیند"
    finally:
        ours.close()


def test_returned_socket_accepts_connections():
    sock = bind_free_port(HOST, _ephemeral())
    try:
        with socket.create_connection(sock.getsockname(), timeout=2):
            pass
    finally:
        sock.close()


def _ephemeral() -> int:
    """یک پورت که همین الان آزاد است، تا آزمون‌ها با هم یا با ۸۳۲۱ برخورد نکنند."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1]
