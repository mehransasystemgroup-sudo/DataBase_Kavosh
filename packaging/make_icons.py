"""
ساخت همهٔ نشان‌های برنامه از یک طرح.

چرا اسکریپت و نه فایل‌های دستی: نشان برنامه در شش جا تکرار می‌شود — زبانهٔ
مرورگر، نصب‌کنندهٔ ویندوز، و چهار اندازهٔ اندروید. اگر هرکدام جدا ساخته و
ویرایش شوند، اولین تغییر رنگ یکی‌شان را جا می‌گذارد و برنامه با دو نشان
متفاوت روی یک دستگاه ظاهر می‌شود. این‌جا یک طرح هست و بقیه از رویش ساخته
می‌شوند.

اجرا:
    pip install pillow cairosvg
    python packaging/make_icons.py
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent

# رنگ‌های تم پیش‌فرض «نیمه‌شبِ نیلی». زمینهٔ نشان عمداً خودِ رنگ هویت است نه
# زمینهٔ تیرهٔ برنامه: نشان در نوار وظیفه و صفحهٔ گوشی روی پس‌زمینه‌ای دیده
# می‌شود که رنگش را نمی‌دانیم، و کاشیِ تیره با خطوط باریک آن‌جا گم می‌شود.
# کاشیِ رنگی با نقشِ روشن، در ۱۶ پیکسل هم خوانا می‌ماند.
BRAND_LIGHT = "#5B7CF7"
BRAND_DARK = "#3549C9"
GLYPH = "#FFFFFF"
BAND = "#2C3EA8"


def svg(size: int = 32, radius: float = 7.2, bleed: bool = False) -> str:
    """
    طرح نشان: استوانهٔ پایگاه داده روی کاشی نیلی.

    شکل استوانه عمداً همان شکل قبلی است و فقط پالتش عوض شده — نشان، هویت
    برنامه است و کاربر با شکلش آن را روی میزکار پیدا می‌کند؛ عوض‌کردن شکل
    یعنی ناشناس‌شدن، نه به‌روزشدن.

    bleed: برای آیکون تطبیقی اندروید، کاشی تا لبه پر می‌شود چون خودِ سیستم
    شکل نهایی را می‌بُرد.
    """
    r = 0 if bleed else radius
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="{size}" height="{size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{BRAND_LIGHT}"/>
      <stop offset="1" stop-color="{BRAND_DARK}"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="{r}" fill="url(#g)"/>
  <g fill="{GLYPH}">
    <ellipse cx="16" cy="22.3" rx="8.6" ry="3.4"/>
    <rect x="7.4" y="9.6" width="17.2" height="12.7"/>
    <ellipse cx="16" cy="9.6" rx="8.6" ry="3.4"/>
  </g>
  <!-- بندها شکلِ پُر‌اند نه خط.

       با خط، هر ضخامتی نصفش بیرونِ مسیر می‌افتد و دو سرِ بند از بدنهٔ
       استوانه بیرون می‌زند — دو زائدهٔ کوچک که در اندازه‌های بزرگ دیده
       می‌شود. شکلِ بسته بین دو کمان، دو سرش دقیقاً روی لبهٔ بدنه تمام
       می‌شود و هیچ ضخامتی بیرون نمی‌زند. -->
  <g fill="{BAND}" opacity="0.45">
    <path d="M7.4 14.6a8.6 3.4 0 0 0 17.2 0v1.25a8.6 3.4 0 0 1-17.2 0z"/>
    <path d="M7.4 18.3a8.6 3.4 0 0 0 17.2 0v1.25a8.6 3.4 0 0 1-17.2 0z"/>
  </g>
</svg>"""


def render(size: int, bleed: bool = False) -> Image.Image:
    png = cairosvg.svg2png(
        bytestring=svg(bleed=bleed).encode(), output_width=size, output_height=size
    )
    return Image.open(io.BytesIO(png)).convert("RGBA")


def circular(size: int) -> Image.Image:
    """گونهٔ گرد، برای لانچرهایی که نشان را داخل دایره می‌نشانند."""
    base = render(size, bleed=True)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    base.putalpha(mask.resize((size, size), Image.LANCZOS))
    return base


def write(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)}  {image.width}×{image.height}")


def main() -> int:
    print("نشان مرورگر و رابط کاربری")
    favicon = ROOT / "frontend" / "public" / "favicon.svg"
    favicon.write_text(svg(), encoding="utf-8")
    print(f"  {favicon.relative_to(ROOT)}")

    print("نشان ویندوز")
    ico = ROOT / "packaging" / "kavosh.ico"
    # ۲۵۶ برای پنجرهٔ «درباره» و نمای بزرگ، ۱۶ برای نوار وظیفه؛ ویندوز
    # نزدیک‌ترین اندازه را برمی‌دارد و اگر نباشد خودش بد کوچک می‌کند.
    sizes = [16, 24, 32, 48, 64, 128, 256]
    render(256).save(ico, "ICO", sizes=[(s, s) for s in sizes])
    print(f"  {ico.relative_to(ROOT)}  {', '.join(str(s) for s in sizes)}")

    print("نشان اندروید")
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for bucket, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96),
                         ("xxhdpi", 144), ("xxxhdpi", 192)):
        write(res / f"mipmap-{bucket}" / "ic_launcher.png", render(size))
        write(res / f"mipmap-{bucket}" / "ic_launcher_round.png", circular(size))

    print("انجام شد.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
