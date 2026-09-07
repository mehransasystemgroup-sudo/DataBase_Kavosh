# -*- mode: python ; coding: utf-8 -*-
"""
نسخهٔ ویندوزی کاوشگر پایگاه داده.

ساخت:
    pyinstaller packaging/kavosh.spec --noconfirm

خروجی: dist/KavoshDB/KavoshDB.exe به‌همراه پوشهٔ کتابخانه‌ها (حالت onedir).

چرا onedir و نه onefile: نسخهٔ تک‌فایلی هر بار اجرا ~۶۰ مگابایت را در پوشهٔ
موقت باز می‌کند (چند ثانیه تأخیر در هر اجرا) و ضدویروس‌های ویندوز به همان
الگو حساس‌اند. onedir بی‌درنگ بالا می‌آید و نصب‌کننده هم آن را در یک پوشه
می‌نشاند، پس کاربر تفاوتی حس نمی‌کند.
"""

from pathlib import Path

ROOT = Path(SPECPATH).parent
BACKEND = ROOT / "backend"

# دانش پایه و رابط کاربری داخل بسته می‌روند؛ ایندکس نمی‌رود چون مصنوعی
# مشتق و قابل نوشتن است و در اولین اجرا کنار دادهٔ کاربر ساخته می‌شود.
datas = [
    (str(BACKEND / "kb"), "kb"),
    (str(BACKEND / "instances"), "instances"),
    (str(ROOT / "frontend" / "dist"), "static"),
]

# uvicorn پیاده‌سازی‌هایش را در زمان اجرا import می‌کند، پس تحلیل ایستا
# آن‌ها را نمی‌بیند و بدون این فهرست، برنامه هنگام بالاآمدن می‌افتد.
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
]

# آنچه به این برنامه ربطی ندارد و فقط حجم و زمان راه‌اندازی اضافه می‌کند
excludes = [
    "tkinter", "unittest", "pydoc", "doctest", "test", "lib2to3",
    "numpy", "pandas", "matplotlib", "PIL", "setuptools", "pip",
]

a = Analysis(
    [str(BACKEND / "app" / "main.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="KavoshDB",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,          # پنجرهٔ کنسول نشانی برنامه را نشان می‌دهد و راه بستن است
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "packaging" / "kavosh.ico"),
    version=str(ROOT / "packaging" / "version_info.txt"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="KavoshDB",
)
