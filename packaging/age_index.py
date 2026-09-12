# -*- coding: utf-8 -*-
"""
ایندکس را به شکل «ساختهٔ نسخهٔ قبلی برنامه» درمی‌آورد — فقط برای آزمون.

چرا لازم است: مسیر «به‌روزرسانی روی نصب قبلی» تنها جایی بود که آزمون‌ها
نمی‌دیدند، و دقیقاً همان جایی بود که شکست — کاربر ایندکس نسخهٔ قدیمی را نگه
می‌داشت و کدِ تازه از جدول‌هایی می‌پرسید که در آن نبودند. برای بازتولیدِ آن
حالت در CI، باید بشود یک ایندکسِ سالم را عمداً کهنه کرد.

    python packaging/age_index.py <path-to-kb.sqlite>          # کهنه کن
    python packaging/age_index.py <path-to-kb.sqlite> --verify  # کهنه شده؟

چرا فایل جداست و داخل گردش‌کار نیست: نوشتن پایتونِ چندخطی داخل YAML و
PowerShell هم نقل‌قول‌ها را به هم می‌ریزد و هم تورفتگی را — یک بار همین‌جا
امتحان شد و آزمون بی‌سروصدا از کنار شکست رد شد.
"""

from __future__ import annotations

import sqlite3
import sys

# کنسول ویندوز پیش‌فرض cp1252 است و اولین print فارسی با UnicodeEncodeError
# اسکریپت را می‌کُشد — دقیقاً همان چیزی که app/console.py برای خودِ برنامه حل
# می‌کند. این‌جا هم لازم است: بدون آن، «کهنه‌سازی» انجام می‌شود ولی اسکریپت
# سر چاپِ پیامِ موفقیت می‌افتد و آزمون بی‌دلیل قرمز می‌شود.
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main(argv: list[str]) -> int:
    if not argv:
        print("مسیر فایل ایندکس داده نشد.", file=sys.stderr)
        return 2

    path, verify = argv[0], "--verify" in argv[1:]
    db = sqlite3.connect(path)
    try:
        if verify:
            meta = dict(db.execute("SELECT key, value FROM meta").fetchall())
            has_entities = db.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'entities'"
            ).fetchone()[0]
            aged = meta.get("schema_version") == "0" and has_entities == 0
            print("ایندکس کهنه است." if aged else "ایندکس کهنه نشده است.")
            return 0 if aged else 1

        # INSERT OR REPLACE، نه UPDATE: ایندکسِ واقعاً قدیمی اصلاً سطر
        # schema_version ندارد و UPDATE روی آن هیچ سطری را عوض نمی‌کند —
        # یعنی «کهنه‌سازی» بی‌سروصدا کاری نمی‌کرد.
        db.execute("INSERT OR REPLACE INTO meta VALUES ('schema_version', '0')")
        db.execute("DROP TABLE IF EXISTS entities")
        db.commit()
        print("ایندکس به شکل نسخهٔ قدیمی درآمد.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
