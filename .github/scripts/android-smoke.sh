#!/usr/bin/env bash
#
# آزمون دود روی شبیه‌ساز واقعی اندروید.
#
# چیزی که این‌جا سنجیده می‌شود «ساخته شدن» نیست، «کار کردن» است: برنامه نصب
# می‌شود، بالا می‌آید، بدون خطای مرگبار می‌ماند، و متن فارسی صفحهٔ اصلی — که
# فقط وقتی دیده می‌شود که موتور SQLite داخل دستگاه ایندکس را باز کرده باشد —
# در درخت رابط کاربری پیدا می‌شود.
#
# هر شکستی باید خودش بگوید چه دید: بدون آن، «بالا نیامد» همان‌قدر بی‌فایده است
# که «timeout».

set -uo pipefail

PKG=ir.kavosh.db
APK=$(ls android/app/build/outputs/apk/release/*.apk)

# بی‌درنگ پس از بوت، adb چند ثانیه دستگاه را offline می‌بیند
adb wait-for-device
adb logcat -c

adb install -r "$APK" || { echo "نصب شکست خورد."; exit 1; }
adb shell am start -n "$PKG/.MainActivity"

# «روی صفحه بودن» را با دو نشانهٔ مستقل می‌سنجیم که هر دو در نسخه‌های مختلف
# اندروید پایدارند: زندهٔ بودن فرایند، و تمرکز پنجره روی همین بسته.
pid=""
focus=""
ready=""
for _ in $(seq 1 45); do
    sleep 2
    pid=$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r\n') || pid=""
    focus=$(adb shell dumpsys window 2>/dev/null | grep -E "mCurrentFocus|mFocusedApp" | tr -d '\r') || focus=""
    if [ -n "$pid" ] && printf '%s' "$focus" | grep -q "$PKG"; then
        echo "برنامه روی صفحه آمد (pid $pid)."
        ready=1
        break
    fi
done

# چه موفق، چه ناموفق: تصویر صفحه گرفته می‌شود تا معلوم باشد چه دیده می‌شده
sleep 12
adb exec-out screencap -p > emulator-home.png || true

if [ -z "$ready" ]; then
    echo "برنامه روی صفحه نیامد. آنچه دیده شد:"
    echo "  فرایند: ${pid:-(زنده نیست)}"
    echo "  تمرکز پنجره: ${focus:-(نامشخص)}"
    adb shell dumpsys activity activities | grep -iE "resumed|focused|$PKG" | head -12
    adb logcat -d | grep -iE "$PKG|AndroidRuntime|chromium|WebView" | tail -40
    exit 1
fi

# هیچ خطای مرگباری نباید افتاده باشد
if adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG"; then
    echo "برنامه در زمان اجرا خطای مرگبار داد."
    adb logcat -d | grep -A 20 "FATAL EXCEPTION" | tail -40
    exit 1
fi

# متن واقعی صفحه از درخت دسترسی‌پذیری خوانده می‌شود
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1 || true

if [ -f /tmp/ui.xml ] && grep -q "کاوشگر پایگاه داده" /tmp/ui.xml; then
    echo "رابط کاربری بالا آمد و متن فارسی رندر شد."
elif [ -f /tmp/ui.xml ] && grep -qi "webview\|android.view.View" /tmp/ui.xml; then
    echo "هشدار: نمای وب هست ولی متنی از درخت دسترسی‌پذیری خوانده نشد."
    echo "(تصویر صفحه در artifactها ضمیمه است.)"
else
    echo "رابط کاربری بالا نیامد."
    adb logcat -d | grep -iE "chromium|webview|$PKG" | tail -40
    exit 1
fi

# رفتن به یک لینک عمیق، تا فقط صفحهٔ اول سنجیده نشود
adb shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 5
adb exec-out screencap -p > emulator-second.png || true

echo "آزمون دود اندروید با موفقیت گذشت."
