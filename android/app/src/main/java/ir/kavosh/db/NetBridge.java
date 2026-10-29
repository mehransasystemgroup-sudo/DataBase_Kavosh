package ir.kavosh.db;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.webkit.JavaScriptReplyProxy;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * پل شبکه و کلید برای دستیار کوئری‌نویسی.
 *
 * صفحهٔ وب خودش به اینترنت نمی‌رود (MainActivity هر درخواستِ بیرون از مبدأ
 * برنامه را می‌بندد)؛ تنها راهش همین پل است، و همین پل فقط یک کار می‌کند:
 * یک POST با JSON به سرویس مدل زبانی.
 *
 * کلید API این‌جا نگه داشته می‌شود و هرگز به صفحه برنمی‌گردد. صفحه به‌جای
 * کلید یک نشانه (KEY_TOKEN) در سرآیند می‌گذارد و پل پیش از فرستادن، کلید
 * واقعی را جایش می‌نشاند. SharedPreferences این برنامه در قواعد پشتیبان‌گیری
 * نیامده، پس کلید با پشتیبانِ ابری یا انتقال به گوشی دیگر جایی نمی‌رود.
 */
final class NetBridge {

    /** همان نشانه‌ای که frontend/src/lib/assistant/providers.js می‌گذارد. */
    static final String KEY_TOKEN = "\u0000KAVOSH_API_KEY\u0000";

    private static final String PREFS = "kavosh_secrets";
    private static final int MAX_RESPONSE = 4 * 1024 * 1024;
    private static final int MAX_TIMEOUT_MS = 240_000;

    /**
     * کلید هر ارائه‌دهنده فقط به میزبان خودِ همان سرویس می‌رود — همان نشانی‌های
     * ثابت providers.js. «custom» (سرویس محلی کاربر) نشانی دلخواه دارد و در
     * این فهرست نیست. اگر روزی کدی در صفحه کلیدِ OpenAI را به سرور دیگری
     * بفرستد، این‌جا بسته می‌شود.
     */
    private static final Map<String, String> KEY_HOSTS = new HashMap<>();

    static {
        KEY_HOSTS.put("openai", "api.openai.com");
        KEY_HOSTS.put("gemini", "generativelanguage.googleapis.com");
        KEY_HOSTS.put("openrouter", "openrouter.ai");
        KEY_HOSTS.put("anthropic", "api.anthropic.com");
    }

    private final SharedPreferences secrets;
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private final Handler main = new Handler(Looper.getMainLooper());

    NetBridge(Context context) {
        secrets = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void shutdown() {
        pool.shutdownNow();
    }

    /** یک پیام از صفحه. پاسخ همیشه با همان id برمی‌گردد. */
    void handle(String data, JavaScriptReplyProxy reply) {
        JSONObject msg;
        try {
            msg = new JSONObject(data);
        } catch (JSONException e) {
            return;
        }
        final long id = msg.optLong("id");
        switch (msg.optString("op")) {
            case "keys":
                send(reply, hints(id));
                break;
            case "setKey":
                send(reply, setKey(id, msg.optString("provider"), msg.optString("value")));
                break;
            case "http":
                pool.execute(() -> send(reply, http(id, msg)));
                break;
            default:
                send(reply, error(id, "refused", "درخواست ناشناخته."));
        }
    }

    private void send(JavaScriptReplyProxy reply, JSONObject body) {
        // JavaScriptReplyProxy فقط روی رشتهٔ اصلی پذیرفته می‌شود
        main.post(() -> reply.postMessage(body.toString()));
    }

    // ───────────────────────── کلیدها ─────────────────────────

    private static boolean validProvider(String id) {
        return id != null && id.matches("[a-z0-9_-]{1,32}");
    }

    private JSONObject hints(long id) {
        JSONObject out = base(id, true);
        JSONObject hints = new JSONObject();
        for (String provider : secrets.getAll().keySet()) {
            String key = secrets.getString(provider, "");
            if (key == null || key.isEmpty()) continue;
            put(hints, provider, key.length() >= 4 ? "…" + key.substring(key.length() - 4) : "…");
        }
        put(out, "hints", hints);
        return out;
    }

    private JSONObject setKey(long id, String provider, String value) {
        if (!validProvider(provider)) return error(id, "refused", "ارائه‌دهندهٔ نامعتبر.");
        String key = cleanKey(value);
        SharedPreferences.Editor edit = secrets.edit();
        if (key.isEmpty()) edit.remove(provider);
        else edit.putString(provider, key);
        if (!edit.commit()) return error(id, "refused", "کلید ذخیره نشد.");
        return hints(id);
    }

    /**
     * فقط نویسه‌های چاپیِ ASCII — همتای cleanKey در providers.js. نشانهٔ جهت یا
     * نیم‌فاصلهٔ کپی‌شده از متن فارسی در سرآیند HTTP جا نمی‌شود و
     * setRequestProperty با آن خطا می‌دهد.
     */
    static String cleanKey(String value) {
        if (value == null) return "";
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c >= '!' && c <= '~') out.append(c);
        }
        return out.toString();
    }

    // ───────────────────────── شبکه ─────────────────────────

    /**
     * http فقط برای شبکهٔ محلی (Ollama و LM Studio روی رایانهٔ کناری) پذیرفته
     * است؛ کلید روی اینترنتِ بی‌رمز فرستاده نمی‌شود.
     */
    private static String refuseUrl(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        if (host.isEmpty()) return "نشانی سرویس نامعتبر است.";
        if (scheme.equals("https")) return null;
        if (scheme.equals("http") && isLocal(host)) return null;
        return "روی اینترنت فقط نشانیِ https پذیرفته است؛ http فقط برای سرویسی در شبکهٔ محلی.";
    }

    private static boolean isLocal(String host) {
        if (host.equals("localhost") || host.endsWith(".local")) return true;
        if (!host.matches("[0-9.]+")) return false;
        try {
            InetAddress addr = InetAddress.getByName(host);
            return addr.isLoopbackAddress() || addr.isSiteLocalAddress() || addr.isLinkLocalAddress();
        } catch (IOException e) {
            return false;
        }
    }

    private JSONObject http(long id, JSONObject msg) {
        Uri uri = Uri.parse(msg.optString("url"));
        String refused = refuseUrl(uri);
        if (refused != null) return error(id, "refused", refused);

        String transient_ = cleanKey(msg.optString("transientKey", ""));
        String provider = msg.optString("keyProvider", "");
        String key = !transient_.isEmpty() ? transient_
                : validProvider(provider) ? secrets.getString(provider, "") : "";
        String expectedHost = KEY_HOSTS.get(provider);
        if (expectedHost != null && !expectedHost.equalsIgnoreCase(uri.getHost())) {
            return error(id, "refused", "کلید این سرویس فقط به نشانی خودِ آن فرستاده می‌شود.");
        }

        int timeout = Math.max(5_000, Math.min(MAX_TIMEOUT_MS, msg.optInt("timeoutMs", 180_000)));
        HttpURLConnection conn = null;
        try {
            // GET فقط برای فهرست مدل‌ها؛ هر چیز دیگر همان POST است
            boolean get = "GET".equals(msg.optString("method", "POST"));
            conn = (HttpURLConnection) new URL(uri.toString()).openConnection();
            conn.setRequestMethod(get ? "GET" : "POST");
            conn.setDoOutput(!get);
            conn.setInstanceFollowRedirects(false);   // کلید نباید پشت تغییر مسیر به جای دیگر برود
            conn.setConnectTimeout(Math.min(timeout, 20_000));
            conn.setReadTimeout(timeout);

            JSONObject headers = msg.optJSONObject("headers");
            if (headers != null) {
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String name = it.next();
                    String value = headers.optString(name);
                    if (value.contains(KEY_TOKEN)) {
                        if (key == null || key.isEmpty()) {
                            return error(id, "refused", "کلید API ثبت نشده است. از تنظیمات اضافه‌اش کنید.");
                        }
                        value = value.replace(KEY_TOKEN, key);
                    }
                    // نویسهٔ خط تازه در سرآیند یعنی تزریق سرآیند؛ رد می‌شود
                    if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) continue;
                    conn.setRequestProperty(name, value);
                }
            }

            if (!get) {
                byte[] body = msg.optString("body").getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body);
                }
            }

            int status = conn.getResponseCode();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = stream == null ? "" : read(stream);

            JSONObject out = base(id, true);
            put(out, "status", status);
            put(out, "text", text);
            return out;
        } catch (SocketTimeoutException e) {
            return error(id, "timeout", "پاسخ مدل در زمان مقرر نرسید.");
        } catch (IOException | RuntimeException e) {
            return error(id, "network", "به سرویس مدل وصل نشدیم.");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream stream = in; ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[16 * 1024];
            int n;
            while ((n = stream.read(chunk)) > 0) {
                if (buf.size() + n > MAX_RESPONSE) throw new IOException("response too large");
                buf.write(chunk, 0, n);
            }
            return buf.toString("UTF-8");
        }
    }

    // ───────────────────────── JSON ─────────────────────────

    private static JSONObject base(long id, boolean ok) {
        JSONObject o = new JSONObject();
        put(o, "id", id);
        put(o, "ok", ok);
        return o;
    }

    private static JSONObject error(long id, String kind, String message) {
        JSONObject o = base(id, false);
        put(o, "kind", kind);
        put(o, "message", message);
        return o;
    }

    private static void put(JSONObject o, String name, Object value) {
        try {
            o.put(name, value);
        } catch (JSONException ignored) {
            // نام و مقدار همیشه معتبرند
        }
    }
}
