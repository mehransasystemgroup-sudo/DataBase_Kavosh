/**
 * ارائه‌دهنده‌های مدل زبانی — همتای backend/core/providers.py.
 *
 * فهرست و سه «گویش» همان است که سرور دارد. تفاوت فقط در این است که درخواست
 * را چه کسی می‌فرستد: در نسخهٔ موبایل `post` از پوستهٔ اندروید می‌آید (native.js)
 * که کلید را خودش نگه می‌دارد و خودش در سرآیند می‌گذارد. این‌جا کلید هرگز
 * دیده نمی‌شود؛ جای آن فقط یک نشانه (KEY) در سرآیند است.
 */

export const KEY = "\u0000KAVOSH_API_KEY\u0000";

// نام مدل‌ها زود کهنه می‌شوند (gemini-2.0-flash که پیش‌فرض بود بازنشسته شد).
// هرجا سرویس نامِ «همیشه‌تازه» دارد همان پیش‌فرض است، و اگر مدلی نبود فهرست
// زندهٔ مدل‌ها از خودِ سرویس گرفته می‌شود (healModel). همتای providers.py.
export const PROVIDERS = [
  {
    id: "openai", name: "OpenAI", dialect: "openai",
    base_url: "https://api.openai.com/v1",
    default_model: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "o4-mini"],
    key_url: "https://platform.openai.com/api-keys", note: "", editable_base_url: false,
  },
  {
    id: "gemini", name: "Google Gemini", dialect: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta",
    default_model: "gemini-flash-latest",
    models: ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"],
    key_url: "https://aistudio.google.com/apikey", note: "", editable_base_url: false,
  },
  {
    id: "openrouter", name: "OpenRouter", dialect: "openai",
    base_url: "https://openrouter.ai/api/v1",
    default_model: "openrouter/auto",
    models: ["openrouter/auto"],
    key_url: "https://openrouter.ai/keys",
    note: "از یک کلید به ده‌ها مدل دسترسی می‌دهد؛ «openrouter/auto» خودش مدل مناسب را برمی‌گزیند.",
    editable_base_url: false,
  },
  {
    id: "anthropic", name: "Anthropic Claude", dialect: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    default_model: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
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

/** سرویس در دسترس است ولی این نام مدل را نمی‌شناسد — معمولاً مدلِ بازنشسته. */
export class ModelNotFound extends ProviderError {}

const MODEL_MISSING = [
  "model_not_found", "does not exist", "is not found", "not found for api",
  "not a valid model", "no endpoints found", "unknown model", "not supported for generatecontent",
  "no longer available", "has been deprecated", "is deprecated", "not_found_error",
];
const REGION_BLOCK = [
  "unsupported_country", "location is not supported", "not available in your country",
  "unsupported country", "not available in your region", "region is not supported",
  "request not allowed",
];

const BAD_KEY = [
  "invalid api key", "api_key_invalid", "invalid x-api-key", "api key not valid",
  "incorrect api key", "api key expired", "api_key_expired",
];

/**
 * کلید API بی هیچ نویسهٔ اضافه — همتای clean_key. کلیدِ کپی‌شده از متن فارسی
 * اغلب نشانهٔ جهت (U+200F) یا نیم‌فاصله همراه دارد که در سرآیند HTTP جا
 * نمی‌شود؛ همهٔ کلیدهای این سرویس‌ها فقط نویسهٔ چاپیِ ASCII دارند.
 */
export const cleanKey = (value) => String(value ?? "").replace(/[^\x21-\x7e]/g, "");

const isHtml = (body) => {
  const head = String(body || "").trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.includes("<title>");
};

/** پیام خودِ سرویس از بدنهٔ خطا — هر سه گویش آن را در error.message می‌گذارند. */
function detailText(body) {
  if (isHtml(body)) {
    // صفحهٔ خطای HTML (از دروازهٔ Google یا یک پروکسی) — فقط عنوانش به کار می‌آید
    const m = /<title>([\s\S]*?)<\/title>/i.exec(String(body || ""));
    return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
  }
  let doc;
  try {
    doc = JSON.parse(body);
  } catch {
    return String(body || "").trim().slice(0, 300);
  }
  const err = doc && typeof doc === "object" ? doc.error : undefined;
  if (err && typeof err === "object") {
    const raw = err.metadata && typeof err.metadata === "object" ? err.metadata.raw || "" : "";
    return `${err.message || err.code || ""} ${raw}`.trim().slice(0, 300);
  }
  if (typeof err === "string") return err.slice(0, 300);
  if (doc && typeof doc === "object" && doc.message) return String(doc.message).slice(0, 300);
  return doc && typeof doc === "object" ? "" : String(body || "").trim().slice(0, 300);
}

/**
 * خطای HTTP سرویس → پیام فارسیِ دقیق؛ همتای http_error در providers.py.
 *
 * پیش‌تر هر ۴۰۳ «کلید پذیرفته نشد» خوانده می‌شد، در حالی که از ایران رایج‌ترین
 * ۴۰۳ محدودیت جغرافیایی است. حالا پیام خودِ سرویس هم همراه خطا می‌آید.
 */
export function httpError(status, body, model = "") {
  const detail = detailText(body);
  const low = `${detail} ${body || ""}`.toLowerCase();
  const tail = detail ? `\nپیام سرویس: ${detail}` : "";
  const has = (keys) => keys.some((k) => low.includes(k));
  if (has(REGION_BLOCK)) {
    return new ProviderError(
      "این سرویس از منطقهٔ جغرافیایی شما درخواست نمی‌پذیرد (محدودیت کشور)، نه "
      + "ایراد کلید. از ارائه‌دهندهٔ دیگری مثل OpenRouter، یا سرویس محلی "
      + "(Ollama / LM Studio) استفاده کنید." + tail,
    );
  }
  if (status === 403 && isHtml(body)) {
    // پاسخِ JSONِ خودِ سرویس نیست؛ دروازهٔ Google (یا فیلترینگ و پروکسیِ میانه)
    // درخواست را پیش از رسیدن به سرویس بسته است. کلید هنوز سنجیده هم نشده.
    return new ProviderError(
      "درخواست پیش از رسیدن به سرویس بسته شد (۴۰۳). این معمولاً محدودیت کشور یا "
      + "فیلترینگِ شبکه است، نه ایراد کلید. با VPN یا از ارائه‌دهندهٔ دیگری مثل "
      + "OpenRouter امتحان کنید." + tail,
    );
  }
  if (status === 401 || has(BAD_KEY)) {
    return new ProviderError("کلید API پذیرفته نشد. کلید را در تنظیمات بررسی کنید." + tail);
  }
  if (status === 402 || (status !== 429 && has(["insufficient", "credit"]))) {
    return new ProviderError("اعتبار یا سهمیهٔ حساب در این سرویس کافی نیست." + tail);
  }
  if ((status === 400 || status === 404) && has(MODEL_MISSING)) {
    return new ModelNotFound(`مدل «${model}» در این سرویس وجود ندارد یا بازنشسته شده است.` + tail);
  }
  if (status === 404) return new ProviderError("نشانی سرویس یا نام مدل پیدا نشد؛ در تنظیمات بررسی کنید." + tail);
  if (status === 403) return new ProviderError("سرویس دسترسی را رد کرد." + tail);
  if (status === 429) return new ProviderError("سرویس فعلاً محدودیت نرخ گذاشته؛ کمی بعد دوباره تلاش کنید." + tail);
  if (status >= 500 && status < 600) return new ProviderError(`سرویسِ مدل خطای داخلی داد (${status}).` + tail);
  return new ProviderError(`سرویسِ مدل خطای ${status} داد.` + tail);
}

/**
 * `post({url, headers, body, timeoutMs, keyProvider, method})` → `{status, text}` یا
 * پرتاب خطای شبکه با `kind` = "network" | "timeout". payload تهی (null) یعنی GET.
 */
async function call(post, url, payload, headers, timeoutMs, keyProvider, model = "") {
  let res;
  try {
    res = await post({
      url, body: payload === null ? "" : JSON.stringify(payload), timeoutMs, keyProvider,
      method: payload === null ? "GET" : "POST",
      headers: { "content-type": "application/json", ...headers },
    });
  } catch (e) {
    if (e?.kind === "timeout") throw new ProviderError("پاسخ مدل در زمان مقرر نرسید.");
    if (e?.kind === "refused") throw new ProviderError(e.message);
    throw new ProviderError("به سرویس مدل وصل نشدیم. اتصال اینترنت و نشانی سرویس را بررسی کنید.");
  }
  if (res.status < 200 || res.status >= 300) throw httpError(res.status, res.text, model);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new ProviderError("پاسخ سرویس قابل خواندن نبود.");
  }
}

const shapeHint = (data) => {
  try {
    return `\nپاسخ: ${JSON.stringify(data).slice(0, 200)}`;
  } catch {
    return "";
  }
};
const shapeError = (data) => new ProviderError("پاسخ سرویس شکل منتظره را نداشت." + (data === undefined ? "" : shapeHint(data)));

const TRUNCATED = "پاسخ مدل پیش از نوشتن متن قطع شد (سقف توکن). مدل دیگری انتخاب کنید یا دوباره تلاش کنید.";
// جای «فکر کردن» مدل‌های استدلالی، روی سقفی که برای خودِ پاسخ در نظر داریم
export const THINKING_ROOM = 8000;

/** مدل‌های استدلالیِ OpenAI (o1، o3، o4-mini، gpt-5 …) — همتای is_reasoning_model. */
export const isReasoningModel = (model) => /^(o\d|gpt-5)/.test(String(model || "").toLowerCase());

/** متن پاسخ Gemini، با توضیح روشن وقتی متنی در کار نیست — همتای _gemini_text. */
function geminiText(data) {
  if (!data || typeof data !== "object") throw shapeError();
  const cands = data.candidates || [];
  if (!cands.length) {
    const blocked = data.promptFeedback?.blockReason;
    if (blocked) throw new ProviderError(`سرویس پرسش را رد کرد (${blocked}).`);
    throw new ProviderError("سرویس هیچ پاسخی برنگرداند." + shapeHint(data));
  }
  const first = cands[0] && typeof cands[0] === "object" ? cands[0] : {};
  const parts = first.content?.parts || [];
  // بخش‌های «فکر» (thought) جزو پاسخ نیستند
  const text = parts.filter((p) => p && typeof p === "object" && !p.thought).map((p) => p.text || "").join("");
  if (text.trim()) return text;
  const reason = first.finishReason || "";
  if (reason === "MAX_TOKENS") throw new ProviderError(TRUNCATED);
  if (reason && reason !== "STOP") throw new ProviderError(`سرویس پاسخ را نیمه‌کاره گذاشت یا رد کرد (${reason}).`);
  return text;
}

/**
 * نشانی پایهٔ سرویس — همتای _root در providers.py.
 *
 * نشانی دلخواه فقط برای سرویس محلی پذیرفته است؛ برای بقیه نشانی ثابت است تا
 * کلید هیچ‌وقت به سروری جز سرویس اصلی نرود.
 */
export function rootOf(provider, baseUrl) {
  const custom = provider.editable_base_url ? String(baseUrl || "").trim() : "";
  return (custom || provider.base_url).replace(/\/+$/, "");
}

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
  model = String(model || "").trim();
  const root = rootOf(provider, baseUrl);

  if (provider.dialect === "openai") {
    const payload = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    if (provider.id === "openai") {
      // API خودِ OpenAI: max_tokens و temperature جز ۱ برای مدل‌های استدلالی
      // پذیرفته نیست، و سقف باید جای «فکر کردن» را هم داشته باشد.
      if (isReasoningModel(model)) {
        payload.max_completion_tokens = maxTokens + THINKING_ROOM;
      } else {
        payload.max_completion_tokens = maxTokens;
        payload.temperature = temperature;
      }
    } else {
      payload.max_tokens = maxTokens;
      payload.temperature = temperature;
    }
    const data = await call(post, `${root}/chat/completions`, payload,
      hasKey ? { authorization: `Bearer ${KEY}` } : {}, timeoutMs, provider.id, model);
    const choice = data?.choices?.[0];
    if (!choice?.message || typeof choice.message !== "object") throw shapeError(data);
    const text = choice.message.content || "";
    if (!text.trim() && choice.finish_reason === "length") throw new ProviderError(TRUNCATED);
    return text;
  }

  if (provider.dialect === "gemini") {
    // بدون maxOutputTokens: در Gemini 2.5 به بعد «فکر کردن» از همین سقف کم
    // می‌شود و با سقف ۶۴ توکنیِ آزمایش اتصال، پاسخ بی‌متن برمی‌گشت. همتای
    // توضیح providers.py.
    const data = await call(post, `${root}/models/${model.replace(/^models\//, "")}:generateContent`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature },
    }, { "x-goog-api-key": KEY }, timeoutMs, provider.id, model);
    return geminiText(data);
  }

  if (provider.dialect === "anthropic") {
    const data = await call(post, `${root}/messages`, {
      model, max_tokens: maxTokens, temperature, system,
      messages: [{ role: "user", content: user }],
    }, { "x-api-key": KEY, "anthropic-version": "2023-06-01" }, timeoutMs, provider.id, model);
    if (!Array.isArray(data?.content)) throw shapeError();
    return data.content.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  }

  throw new ProviderError(`گویش «${provider.dialect}» پیاده‌سازی نشده است.`);
}

/** فهرست زندهٔ مدل‌های گفت‌وگوی این سرویس، با همین کلید. */
export async function listModels({ post, providerId, hasKey, baseUrl = "", timeoutMs = 30_000 }) {
  const provider = BY_ID[providerId];
  if (!provider) throw new ProviderError(`ارائه‌دهندهٔ «${providerId}» شناخته نشد.`);
  const root = rootOf(provider, baseUrl);

  if (provider.dialect === "gemini") {
    const ids = [];
    let token = "";
    for (let i = 0; i < 10; i += 1) {          // صفحه‌بندی؛ سقف برای ایمنی
      const url = `${root}/models?pageSize=1000${token ? `&pageToken=${token}` : ""}`;
      const data = await call(post, url, null, { "x-goog-api-key": KEY }, timeoutMs, provider.id);
      for (const m of data?.models || []) {
        if ((m.supportedGenerationMethods || []).includes("generateContent")) {
          ids.push(String(m.name || "").replace(/^models\//, ""));
        }
      }
      token = data?.nextPageToken || "";
      if (!token) break;
    }
    return ids.filter(Boolean);
  }
  if (provider.dialect === "anthropic") {
    const data = await call(post, `${root}/models?limit=1000`, null,
      { "x-api-key": KEY, "anthropic-version": "2023-06-01" }, timeoutMs, provider.id);
    return (data?.data || []).map((m) => m?.id).filter(Boolean).map(String);
  }
  const data = await call(post, `${root}/models`, null,
    hasKey ? { authorization: `Bearer ${KEY}` } : {}, timeoutMs, provider.id);
  return (data?.data || []).map((m) => m?.id).filter(Boolean).map(String);
}

// مدل‌هایی که برای نوشتن کوئری به کار نمی‌آیند — صوت، تصویر، جاسازی و …
const NOT_CHAT = [
  "embed", "tts", "audio", "image", "vision-preview", "realtime", "transcribe",
  "whisper", "dall-e", "moderation", "search", "live", "native-audio", "computer-use",
  "aqa", "learnlm", "gemma", "babbage", "davinci", "instruct", "robotics",
];
// ترتیب ترجیح: اول «همیشه‌تازه»، بعد خانوادهٔ سریعِ ارزان.
const PREFER = {
  openai: ["gpt-*-mini", "gpt-*"],
  gemini: ["gemini-flash-latest", "gemini-*-flash", "gemini-pro-latest", "gemini-*-pro"],
  anthropic: ["claude-sonnet-*", "claude-*"],
  openrouter: ["openrouter/auto"],
};

export const isChatModel = (id) => !NOT_CHAT.some((k) => id.toLowerCase().includes(k));

const version = (id) => (id.match(/\d+/g) || []).slice(0, 4).map(Number);

/** همان مقایسهٔ (نسخه، -طول) در pick_model. */
function newer(a, b) {
  const va = version(a);
  const vb = version(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i += 1) {
    if (i >= va.length) return false;
    if (i >= vb.length) return true;
    if (va[i] !== vb[i]) return va[i] > vb[i];
  }
  return a.length < b.length;
}

const glob = (pattern) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\/]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** از فهرست زنده، مناسب‌ترین مدل برای کوئری‌نویسی — همتای pick_model. */
export function pickModel(providerId, ids) {
  const usable = ids.filter(isChatModel);
  const stable = usable.filter(
    (i) => !["preview", "exp", "-lite", "nano"].some((k) => i.toLowerCase().includes(k)));
  for (const pool of [stable, usable]) {
    for (const pattern of PREFER[providerId] || []) {
      const re = glob(pattern);
      const hits = pool.filter((i) => re.test(i));
      if (hits.length) return hits.reduce((best, i) => (newer(i, best) ? i : best));
    }
  }
  return stable[0] || usable[0] || ids[0] || "";
}

/**
 * مدل ذخیره‌شده دیگر نیست → جایگزینی از فهرست زندهٔ همان سرویس. کاربر نباید
 * برای بازنشسته‌شدنِ یک مدل، برنامه را به‌روز کند یا نام تازه را جست‌وجو کند.
 */
export async function healModel({ post, providerId, hasKey, baseUrl = "", failed }) {
  const ids = await listModels({ post, providerId, hasKey, baseUrl });
  const choice = pickModel(providerId, ids.filter((i) => i !== failed));
  if (!choice) {
    throw new ProviderError(`مدل «${failed}» در این سرویس وجود ندارد و سرویس مدل دیگری هم معرفی نکرد.`);
  }
  return choice;
}

/**
 * آزمایش کلید — یک پرسش کوچک که فقط ارتباط و کلید و مدل را می‌سنجد. اگر فقط
 * نام مدل کهنه باشد، جایگزین همین‌جا پیشنهاد می‌شود، و فهرست زندهٔ مدل‌ها هم
 * برای انتخاب برمی‌گردد.
 */
export async function probe({ post, providerId, hasKey, model, baseUrl = "" }) {
  const once = (name) => complete({
    post, providerId, hasKey, model: name, baseUrl,
    system: "پاسخ را دقیقاً در یک کلمه بده.", user: "بگو: سلام",
    maxTokens: 64, timeoutMs: 45_000,
  });
  let replaced = "";
  let reply;
  try {
    reply = await once(model);
  } catch (e) {
    if (!(e instanceof ModelNotFound)) throw e;
    replaced = model;
    model = await healModel({ post, providerId, hasKey, baseUrl, failed: model });
    reply = await once(model);
  }
  let models = [];
  try {
    models = (await listModels({ post, providerId, hasKey, baseUrl })).filter(isChatModel).slice(0, 300);
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
  }
  return { ok: true, reply: (reply || "").trim().slice(0, 120), model, replaced, models };
}
