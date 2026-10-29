"""
شمارهٔ نسخه در پنج جا نوشته می‌شود؛ این‌جا بررسی می‌شود که یکی باشند.

چرا لازم است: نسخه دیگر فقط یک برچسب نیست. نشانی‌ای که مرورگر با آن باز
می‌شود (`?v=...`) از backend/app/version.py می‌آید، و اگر آن از نصب‌کننده جا
بماند، کاربرِ نسخهٔ تازه همان نشانی قبلی را می‌گیرد و رابط کاربریِ کهنه را
از حافظهٔ نهان مرورگرش می‌بیند — همان ایرادی که یک بار به دستش رسید.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def find(path: str, pattern: str) -> tuple[str, str]:
    text = (ROOT / path).read_text(encoding="utf-8")
    m = re.search(pattern, text)
    if not m:
        raise SystemExit(f"شمارهٔ نسخه در {path} پیدا نشد.")
    return path, m.group(1)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    found = [
        find("backend/app/version.py", r'VERSION\s*=\s*"([\d.]+)"'),
        find("packaging/installer.nsi", r'!define APP_VERSION\s+"([\d.]+)"'),
        find("packaging/version_info.txt", r"StringStruct\('FileVersion', '([\d.]+)\.0'\)"),
        find("android/app/build.gradle.kts", r'versionName\s*=\s*"([\d.]+)"'),
        find("frontend/package.json", r'"version":\s*"([\d.]+)"'),
    ]
    for path, version in found:
        print(f"  {version:10s} {path}")

    versions = {v for _, v in found}
    if len(versions) != 1:
        print(f"\n✘ نسخه‌ها یکی نیستند: {', '.join(sorted(versions))}")
        return 1
    print(f"\n✔ هر پنج جا: {versions.pop()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
