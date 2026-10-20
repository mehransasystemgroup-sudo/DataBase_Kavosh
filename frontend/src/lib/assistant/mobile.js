/**
 * دستیار و تنظیماتش در نسخهٔ موبایل — همتای مسیرهای /settings و /assistant
 * در backend/app/main.py و منطق backend/app/settings.py.
 *
 * شکل ورودی و خروجی عیناً همان سرور است تا رابط کاربری فرقی نبیند. تنظیمات
 * بی‌خطر (ارائه‌دهنده، مدل، نشانی) در localStorage می‌نشیند؛ کلید هرگز —
 * آن را پوستهٔ اندروید نگه می‌دارد (native.js).
 */

import { DEFAULT_ATTEMPTS, run } from "./assistant.js";
import { keyHints, post, postWithTransientKey, setKey } from "./native.js";
import { BY_ID, PROVIDERS, ProviderError, complete, probe } from "./providers.js";
import { SchemaIndex, checkSql } from "./sqlcheck.js";

const STORE = "kavosh.assistant.v1";
const DEFAULTS = { provider: "openrouter", model: "", base_url: "", max_attempts: DEFAULT_ATTEMPTS };

function load() {
  let doc = {};
  try {
    doc = JSON.parse(localStorage.getItem(STORE) || "{}") || {};
  } catch {
    doc = {};
  }
  const conf = { ...DEFAULTS, ...doc };
  if (!BY_ID[conf.provider]) conf.provider = DEFAULTS.provider;
  if (!conf.model) conf.model = BY_ID[conf.provider].default_model;
  conf.max_attempts = Math.max(1, Math.min(8, Number(conf.max_attempts) || DEFAULT_ATTEMPTS));
  return conf;
}

function store(conf) {
  const { provider, model, base_url: baseUrl, max_attempts: maxAttempts } = conf;
  localStorage.setItem(STORE, JSON.stringify({ provider, model, base_url: baseUrl, max_attempts: maxAttempts }));
}

const badRequest = (detail) =>
  Object.assign(new Error(detail), { response: { status: 400, data: { detail } } });

async function publicView() {
  const conf = load();
  const hints = await keyHints().catch(() => ({}));
  return {
    provider: conf.provider,
    model: conf.model,
    base_url: conf.base_url || "",
    max_attempts: conf.max_attempts,
    providers: PROVIDERS.map((p) => ({ ...p, has_key: Boolean(hints[p.id]), key_hint: hints[p.id] || "" })),
  };
}

export async function getSettings() {
  return publicView();
}

/** همان قاعدهٔ save() سرور: نبودنِ api_key یعنی دست نزن، تهی بودنش یعنی پاک کن. */
export async function putSettings(patch = {}) {
  const conf = load();
  if ("provider" in patch && patch.provider != null) {
    const pid = String(patch.provider);
    if (!BY_ID[pid]) throw badRequest(`ارائه‌دهندهٔ «${pid}» شناخته نشد.`);
    conf.provider = pid;
    if (!("model" in patch)) conf.model = BY_ID[pid].default_model;
  }
  for (const field of ["model", "base_url"]) {
    if (field in patch) conf[field] = String(patch[field] ?? "").trim();
  }
  if ("max_attempts" in patch && patch.max_attempts != null) {
    conf.max_attempts = Math.max(1, Math.min(8, parseInt(patch.max_attempts, 10) || DEFAULT_ATTEMPTS));
  }
  if (!conf.model) conf.model = BY_ID[conf.provider].default_model;
  store(conf);

  if ("api_key" in patch) {
    await setKey(String(patch.key_provider || conf.provider), String(patch.api_key ?? "").trim());
  }
  return publicView();
}

/** آزمایش کلید پیش از ذخیره — کلیدِ تازه نگه داشته نمی‌شود. */
export async function testSettings(patch = {}) {
  const conf = load();
  const providerId = patch.provider || conf.provider;
  let model = patch.model || conf.model;
  if (providerId !== conf.provider && !patch.model) model = BY_ID[providerId]?.default_model || model;
  const baseUrl = "base_url" in patch ? patch.base_url : conf.base_url;

  const transient = (patch.api_key || "").trim();
  const hints = await keyHints().catch(() => ({}));
  const hasKey = Boolean(transient || hints[providerId]);
  const send = transient ? (req) => postWithTransientKey(req, transient) : post;

  try {
    const result = await probe({ post: send, providerId, hasKey, model, baseUrl: baseUrl || "" });
    return { ...result, provider: providerId, model };
  } catch (e) {
    if (e instanceof ProviderError) return { ok: false, error: e.message, provider: providerId, model };
    throw e;
  }
}

let schemaIndex = null;
const indexFor = (kb) => (schemaIndex ||= new SchemaIndex((sql) => kb.all(sql)));

/** ایندکسِ بازبینی باید با دانشی که کاربر ثبت می‌کند تازه شود. */
export function invalidateSchemaIndex() {
  schemaIndex = null;
}

export function checkQuery(kb, sql) {
  return checkSql(sql || "", indexFor(kb));
}

/**
 * پرسش به دستیار. رویدادها همان رویدادهای SSE سرورند و به `onEvent` می‌رسند؛
 * آخرینشان `result` یا `error` است.
 */
export async function askAssistant(kb, question, { onEvent, signal, history } = {}) {
  const q = (question || "").trim();
  if (!q) throw new Error("پرسش خالی است.");

  const conf = load();
  const hints = await keyHints().catch(() => ({}));
  const hasKey = Boolean(hints[conf.provider]);
  if (!hasKey && conf.provider !== "custom") {
    throw new Error("هنوز کلید API ثبت نشده — از تنظیمات اضافه‌اش کنید.");
  }

  const ask = (system, user) => complete({
    post, providerId: conf.provider, hasKey, model: conf.model, baseUrl: conf.base_url,
    system, user,
  });

  try {
    const draft = await run({
      question: q, kb, index: indexFor(kb), ask, emit: onEvent, signal, history,
      maxAttempts: conf.max_attempts,
    });
    onEvent({
      type: "result", kind: draft.kind, sql: draft.sql, note: draft.note,
      attempts: draft.attempts, tables: draft.tables, joins: draft.joins, intent: draft.intent,
      check: draft.check, model: conf.model, provider: conf.provider,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    const message = e instanceof ProviderError ? e.message : `خطای غیرمنتظره: ${e?.message || e}`;
    onEvent({ type: "error", message });
  }
}
