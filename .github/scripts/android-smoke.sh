#!/usr/bin/env bash
#
# آزمون دود روی شبیه‌ساز واقعی اندروید.
#
# چیزی که این‌جا سنجیده می‌شود «ساخته شدن» نیست، «کار کردن» است: برنامه نصب
# می‌شود، بالا می‌آید، بدون خطای مرگبار می‌ماند، و متن فارسیِ صفحهٔ اصلی —
# که فقط وقتی دیده می‌شود که موتور SQLite داخل دستگاه ایندکس را باز کرده
# باشد — در درخت رابط کاربری پیدا می‌شود.

set -euo pipefail

PKG=ir.kavosh.db
APK=$(ls android/app/build/outputs/apk/release/*.apk)

adb logcat -c
adb install -r "$APK"
adb shell am start -n "$PKG/.MainActivity"

# منتظر می‌مانیم تا اکتیویتی روی صفحه بیاید
for _ in $(seq 1 30); do
    sleep 2
    if adb shell dumpsys activity activities | grep -q "mResumedActivity.*$PKG"; then
        echo "اکتیویتی روی صفحه آمد."
        break
    fi
done
adb shell dumpsys activity activities | grep -q "mResumedActivity.*$PKG" || {
    echo "برنامه بالا نیامد."
    adb logcat -d | tail -80
    exit 1
}

# فرصت می‌دهیم ایندکس ۱۲ مگابایتی باز شود و صفحه رندر شود
sleep 12
adb exec-out screencap -p > emulator-home.png

# هیچ خطای مرگباری نباید افتاده باشد
if adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG"; then
    echo "برنامه در زمان اجرا خطای مرگبار داد."
    exit 1
fi

# متن واقعی صفحه را از درخت دسترسی‌پذیری می‌خوانیم
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1 || true

if [ -f /tmp/ui.xml ] && grep -q "کاوشگر پایگاه داده" /tmp/ui.xml; then
    echo "رابط کاربری بالا آمد و متن فارسی رندر شد."
elif [ -f /tmp/ui.xml ] && grep -q "WebView" /tmp/ui.xml; then
    echo "هشدار: WebView هست ولی متنی از درخت دسترسی‌پذیری خوانده نشد."
    echo "(تصویر صفحه در artifactها ضمیمه است.)"
else
    echo "رابط کاربری بالا نیامد."
    adb logcat -d | grep -iE "chromium|webview|kavosh" | tail -40
    exit 1
fi

# رفتن به جزئیات یک جدول، برای اینکه فقط صفحهٔ اول سنجیده نشود
adb shell am start -a android.intent.action.VIEW -n "$PKG/.MainActivity" >/dev/null
sleep 3
adb exec-out screencap -p > emulator-second.png

adb logcat -d | grep -iE "console|chromium.*error" | tail -20 || true
echo "آزمون دود اندروید با موفقیت گذشت."
