/**
 * پل به پوستهٔ اندروید — شبکه و نگه‌داری کلید API.
 *
 * چرا درخواست از خودِ صفحه (fetch) نمی‌رود:
 *   • CORS: صفحه از مبدأ appassets.androidplatform.net است و بسیاری از
 *     سرویس‌ها (و Ollama روی شبکهٔ محلی) چنین مبدأیی را نمی‌پذیرند.
 *   • کلید: اگر صفحه کلید را بخواند، هر جایی که صفحه لو برود کلید هم لو
 *     می‌رود. این‌جا کلید فقط در پوستهٔ اندروید است (SharedPreferences، بیرون
 *     از پشتیبان‌گیری)؛ صفحه فقط نشانهٔ KEY را در سرآیند می‌گذارد و پوسته پیش از
 *     فرستادن، کلید واقعی را جایش می‌نشاند. همان قاعدهٔ نسخهٔ ویندوز: کلید هرگز
 *     به رابط کاربری برنمی‌گردد، فقط «ثبت شده یا نه» و چهار نویسهٔ آخر.
 *
 * پیام‌ها از WebMessageListener می‌گذرند، نه addJavascriptInterface: آن یکی
 * فقط به مبدأ خودِ برنامه باز است.
 */

const pending = new Map();
let seq = 0;

const bridge = () => (typeof window !== "undefined" ? window.KavoshNet : undefined);

export const hasBridge = () => Boolean(bridge()?.postMessage);

let listening = null;
function listen() {
  const b = bridge();
  if (!b || listening === b) return;
  b.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    waiter(msg);
  };
  listening = b;
}

function send(op, fields = {}) {
  const b = bridge();
  if (!b) {
    return Promise.reject(Object.assign(new Error(
      "نمایشگر وب این دستگاه پل شبکهٔ برنامه را پشتیبانی نمی‌کند؛ Android System WebView را به‌روز کنید.",
    ), { kind: "refused" }));
  }
  listen();
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    b.postMessage(JSON.stringify({ op, id, ...fields }));
  });
}

/** درخواست HTTP از راه پوسته. خطای شبکه با `kind` پرتاب می‌شود. */
export async function post({ url, headers, body, timeoutMs, keyProvider }) {
  const reply = await send("http", { url, headers, body, timeoutMs, keyProvider });
  if (!reply.ok) {
    throw Object.assign(new Error(reply.message || "network"), { kind: reply.kind || "network" });
  }
  return { status: reply.status, text: reply.text };
}

/** نشانهٔ کلیدهای ثبت‌شده: { providerId: "…abcd" } — خودِ کلید هرگز. */
export async function keyHints() {
  if (!hasBridge()) return {};
  const reply = await send("keys");
  return reply.hints || {};
}

/** کلید را ثبت می‌کند؛ مقدار تهی یعنی پاک کن. */
export async function setKey(provider, value) {
  const reply = await send("setKey", { provider, value: value || "" });
  if (!reply.ok) throw new Error(reply.message || "کلید ذخیره نشد.");
  return reply.hints || {};
}

/**
 * کلیدی موقت برای «آزمایش» پیش از ذخیره. پوسته آن را فقط برای همین یک
 * درخواست به کار می‌برد و نگه نمی‌دارد.
 */
export async function postWithTransientKey(request, key) {
  const reply = await send("http", { ...request, transientKey: key });
  if (!reply.ok) {
    throw Object.assign(new Error(reply.message || "network"), { kind: reply.kind || "network" });
  }
  return { status: reply.status, text: reply.text };
}
