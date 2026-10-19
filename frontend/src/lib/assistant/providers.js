/**
 * ارائه‌دهنده‌های مدل زبانی — همتای backend/core/providers.py.
 *
 * فهرست و سه «گویش» همان است که سرور دارد. تفاوت فقط در این است که درخواست
 * را چه کسی می‌فرستد: در نسخهٔ موبایل `post` از پوستهٔ اندروید می‌آید (native.js)
 * که کلید را خودش نگه می‌دارد و خودش در سرآیند می‌گذارد. این‌جا کلید هرگز
 * دیده نمی‌شود؛ جای آن فقط یک نشانه (KEY) در سرآیند است.
 */

export const KEY = "\u0000KAVOSH_API_KEY\u0000";

export const PROVIDERS = [
  {
    id: "openai", name: "OpenAI", dialect: "openai",
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    key_url: "https://platform.openai.com/api-keys", note: "", editable_base_url: false,
  },
  {
    id: "gemini", name: "Google Gemini", dialect: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    default_model: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    key_url: "https://aistudio.google.com/apikey", note: "", editable_base_url: false,
  },
  {
    id: "openrouter", name: "OpenRouter", dialect: "openai",
    base_url: "https://openrouter.ai/api/v1",
    default_model: "google/gemini-2.0-flash-001",
    models: [
      "google/gemini-2.0-flash-001", "openai/gpt-4o-mini", "anthropic/claude-3.5-haiku",
      "meta-llama/llama-3.3-70b-instruct", "qwen/qwen-2.5-72b-instruct",
    ],
    key_url: "https://openrouter.ai/keys",
    note: "از یک کلید به ده‌ها مدل دسترسی می‌دهد.", editable_base_url: false,
  },
  {
    id: "anthropic", name: "Anthropic Claude", dialect: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    default_model: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
    key_url: "https://console.anthropic.com/settings/keys", note: "", editable_base_url: false,
  },
  {
    id: "custom", name: "سازگار با OpenAI", dialect: "openai",
    // روی گوشی 127.0.0.1 خودِ گوشی است؛ Ollama معمولاً روی رایانهٔ دیگری در
    // همان شبکه است، پس نشانی را کاربر می‌دهد.
    base_url: "http://192.168.1.10:11434/v1",
    default_model: "qwen2.5-coder:7b", models: [], key_url: "",
    note: "برای Ollama، LM Studio یا هر سرویس سازگار با OpenAI در شبکهٔ محلی.",
    editable_base_url: true,
  },
];

export const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

export class ProviderError extends Error {}

/** همان پیام‌های فارسیِ سرور برای هر وضعیت HTTP. */
function httpError(status, detail) {
  if (status === 401 || status === 403) return new ProviderError("کلید API پذیرفته نشد. کلید را در تنظیمات بررسی کنید.");
  if (status === 404) return new ProviderError("نام مدل یا نشانی سرویس پیدا نشد؛ در تنظیمات بررسی کنید.");
  if (status === 429) return new ProviderError("سرویس فعلاً محدودیت نرخ گذاشته؛ کمی بعد دوباره تلاش کنید.");
  if (status >= 500 && status < 600) return new ProviderError(`سرویسِ مدل خطای داخلی داد (${status}).`);
  return new ProviderError(`سرویسِ مدل خطای ${status} داد. ${String(detail || "").slice(0, 400)}`);
}

/**
 * `post({url, headers, body, timeoutMs, keyProvider})` → `{status, text}` یا
 * پرتاب خطای شبکه با `kind` = "network" | "timeout".
 */
async function call(post, url, payload, headers, timeoutMs, keyProvider) {
  let res;
  try {
    res = await post({
      url, body: JSON.stringify(payload), timeoutMs, keyProvider,
      headers: { "content-type": "application/json", ...headers },
    });
  } catch (e) {
    if (e?.kind === "timeout") throw new ProviderError("پاسخ مدل در زمان مقرر نرسید.");
    if (e?.kind === "refused") throw new ProviderError(e.message);
    throw new ProviderError("به سرویس مدل وصل نشدیم. اتصال اینترنت و نشانی سرویس را بررسی کنید.");
  }
  if (res.status < 200 || res.status >= 300) throw httpError(res.status, res.text);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new ProviderError("پاسخ سرویس قابل خواندن نبود.");
  }
}

const shapeError = () => new ProviderError("پاسخ سرویس شکل منتظره را نداشت.");

/** یک پرسش، یک پاسخ متنی. `hasKey` می‌گوید کلیدی برای این ارائه‌دهنده ثبت شده یا نه. */
export async function complete({
  post, providerId, hasKey, model, system, user, baseUrl = "",
  temperature = 0, maxTokens = 2000, timeoutMs = 180_000,
}) {
  const provider = BY_ID[providerId];
  if (!provider) throw new ProviderError(`ارائه‌دهندهٔ «${providerId}» شناخته نشد.`);
  if (!hasKey && provider.id !== "custom") {
    throw new ProviderError("کلید API ثبت نشده است. از تنظیمات اضافه‌اش کنید.");
  }
  const root = (baseUrl || provider.base_url).replace(/\/+$/, "");

  if (provider.dialect === "openai") {
    const data = await call(post, `${root}/chat/completions`, {
      model, temperature, max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }, hasKey ? { authorization: `Bearer ${KEY}` } : {}, timeoutMs, provider.id);
    const text = data?.choices?.[0]?.message?.content;
    if (text === undefined) throw shapeError();
    return text || "";
  }

  if (provider.dialect === "gemini") {
    const data = await call(post, `${root}/models/${model}:generateContent`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }, { "x-goog-api-key": KEY }, timeoutMs, provider.id);
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
      const blocked = data?.promptFeedback?.blockReason;
      if (blocked) throw new ProviderError(`سرویس پاسخ را رد کرد (${blocked}).`);
      throw shapeError();
    }
    return parts.map((p) => p.text || "").join("");
  }

  if (provider.dialect === "anthropic") {
    const data = await call(post, `${root}/messages`, {
      model, max_tokens: maxTokens, temperature, system,
      messages: [{ role: "user", content: user }],
    }, { "x-api-key": KEY, "anthropic-version": "2023-06-01" }, timeoutMs, provider.id);
    if (!Array.isArray(data?.content)) throw shapeError();
    return data.content.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  }

  throw new ProviderError(`گویش «${provider.dialect}» پیاده‌سازی نشده است.`);
}

/** آزمایش کلید — یک پرسش کوچک که فقط ارتباط و کلید و مدل را می‌سنجد. */
export async function probe({ post, providerId, hasKey, model, baseUrl = "" }) {
  const reply = await complete({
    post, providerId, hasKey, model, baseUrl,
    system: "پاسخ را دقیقاً در یک کلمه بده.", user: "بگو: سلام",
    maxTokens: 64, timeoutMs: 45_000,
  });
  return { ok: true, reply: (reply || "").trim().slice(0, 120) };
}
