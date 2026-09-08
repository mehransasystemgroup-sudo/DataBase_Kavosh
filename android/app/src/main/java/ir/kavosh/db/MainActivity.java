package ir.kavosh.db;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;
import java.util.Set;

/**
 * پوستهٔ اندرویدی کاوشگر پایگاه داده.
 *
 * تمام برنامه — رابط کاربری، پایگاه دانش و موتور جست‌وجو — داخل همین بسته و
 * روی خود دستگاه اجرا می‌شود؛ این کلاس فقط آن را میزبانی می‌کند. هرچه
 * منطق این‌جا کمتر باشد، رفتار برنامه روی اندروید و دسکتاپ یکی‌تر می‌ماند.
 */
public final class MainActivity extends Activity {

    /** دارایی‌ها از یک مبدأ https مجازی سرو می‌شوند، نه file://؛ وگرنه مرورگر
     *  آن‌ها را «مبدأ ناشناس» می‌داند و fetch و حافظهٔ محلی کار نمی‌کنند. */
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/index.html";

    /** موتور SQLite روی WebAssembly به نمایشگر وب نسبتاً تازه نیاز دارد. */
    private static final int MIN_WEBVIEW_MAJOR = 87;

    private static final int INK = 0xFF050806;
    private static final int PAPER = 0xFFF4F8F5;

    private WebView web;
    private boolean darkTheme = true;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        darkTheme = systemIsDark();

        int major = webViewMajorVersion();
        if (major > 0 && major < MIN_WEBVIEW_MAJOR) {
            setContentView(tooOldMessage());
            return;
        }

        web = new WebView(this);
        configure(web);
        applyTheme(darkTheme);
        setContentView(web);

        // نوارهای سیستم شفاف‌اند و صفحه تمام‌قد است؛ پس فاصلهٔ امن را خودمان
        // به نما می‌دهیم. env(safe-area-*) در WebView فقط بریدگی نمایشگر را
        // می‌شناسد، نه نوار وضعیت — پس تکیه بر CSS این‌جا جواب نمی‌دهد.
        ViewCompat.setOnApplyWindowInsetsListener(web, (view, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(START_URL);
        }
    }

    private void configure(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        // بدون این، تم انتخابی و دانشی که کاربر ثبت می‌کند با بستن برنامه می‌پرد
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // اندروید ۱۳ به بعد صفحات روشن را خودش تیره می‌کند؛ این برنامه تم
        // خودش را دارد و آن تیره‌سازی خودکار رنگ‌هایش را خراب می‌کند.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false);
        }

        final WebViewAssetLoader.AssetsPathHandler assets =
                new WebViewAssetLoader.AssetsPathHandler(this);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", path -> {
                    WebResourceResponse response = assets.handle(path);
                    // بدون نوع درست، WebAssembly.instantiateStreaming رد می‌کند و
                    // موتور SQLite به مسیر کندتر می‌افتد
                    if (response != null && path.endsWith(".wasm")) {
                        response.setMimeType("application/wasm");
                    }
                    return response;
                })
                .build();

        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                // برنامه آفلاین است و پیوند بیرونی ندارد؛ هر ناوبری خارج از
                // مبدأ خودمان یعنی اشتباهی رخ داده — بی‌صدا نادیده می‌گیریم.
                return !String.valueOf(request.getUrl()).startsWith(ORIGIN);
            }
        });

        // پل تم: صفحهٔ وب پس از هر تعویض تم، تیره یا روشن بودن را می‌فرستد تا
        // نوار وضعیت و پس‌زمینهٔ پشت آن هم‌رنگ شوند.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Set<String> allowed = Collections.singleton(ORIGIN);
            WebViewCompat.addWebMessageListener(view, "KavoshShell", allowed,
                    (v, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if (!isMainFrame) return;
                        boolean dark = "dark".equals(message.getData());
                        runOnUiThread(() -> applyTheme(dark));
                    });
        }
    }

    /** رنگ پشت نوارهای سیستم و روشنی آیکون‌هایشان را با تم برنامه یکی می‌کند. */
    private void applyTheme(boolean dark) {
        darkTheme = dark;
        if (web != null) web.setBackgroundColor(dark ? INK : PAPER);
        getWindow().getDecorView().setBackgroundColor(dark ? INK : PAPER);

        WindowInsetsControllerCompat bars =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
    }

    private boolean systemIsDark() {
        int mode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode != Configuration.UI_MODE_NIGHT_NO;
    }

    /** نسخهٔ نمایشگر وب دستگاه؛ صفر یعنی قابل تشخیص نبود. */
    private int webViewMajorVersion() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return 0;
        try {
            android.content.pm.PackageInfo info = WebViewCompat.getCurrentWebViewPackage(this);
            if (info == null || info.versionName == null) return 0;
            return Integer.parseInt(info.versionName.split("\\.")[0]);
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /** به‌جای صفحهٔ سفیدِ بی‌توضیح، بگو مشکل چیست و کاربر چه کند. */
    private View tooOldMessage() {
        TextView text = new TextView(this);
        text.setText(getString(R.string.webview_too_old));
        text.setTextColor(Color.WHITE);
        text.setTextSize(16f);
        text.setGravity(Gravity.CENTER);
        text.setLineSpacing(0f, 1.4f);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        text.setPadding(pad, pad, pad, pad);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(INK);
        root.addView(text, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        return root;
    }

    @Override
    public void onBackPressed() {
        // دکمهٔ بازگشت باید در خود برنامه حرکت کند، نه اینکه یک‌باره ببندد
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
