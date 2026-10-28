/**
 * گویش‌های ارائه‌دهنده‌ها — همتای آزمون‌های backend/tests/test_providers.py.
 * `post` ساختگی است و فقط درخواست را ضبط می‌کند و پاسخ آماده را برمی‌گرداند.
 */

import { describe, expect, it } from "vitest";

import { KEY, cleanKey, complete, httpError } from "../providers.js";

function fakePost(reply) {
  const sent = {};
  const post = async (req) => {
    Object.assign(sent, req, { payload: req.body ? JSON.parse(req.body) : null });
    return { status: 200, text: JSON.stringify(reply) };
  };
  return { post, sent };
}

const ask = (post, providerId, model, extra = {}) =>
  complete({ post, providerId, hasKey: true, model, system: "s", user: "u", ...extra });

describe("Gemini", () => {
  it("سقف خروجی نمی‌فرستد تا «فکر کردن» پاسخ را نخورد", async () => {
    const { post, sent } = fakePost({ candidates: [{ content: { parts: [
      { text: "…", thought: true }, { text: "سلام" }] }, finishReason: "STOP" }] });
    expect(await ask(post, "gemini", "models/gemini-flash-latest", { maxTokens: 64 })).toBe("سلام");
    expect(sent.payload.generationConfig.maxOutputTokens).toBeUndefined();
    expect(sent.url.endsWith("/models/gemini-flash-latest:generateContent")).toBe(true);
    expect(sent.headers["x-goog-api-key"]).toBe(KEY);
  });

  it("پاسخ بی‌متن را روشن توضیح می‌دهد", async () => {
    const { post } = fakePost({ candidates: [{ content: { role: "model" }, finishReason: "MAX_TOKENS" }] });
    await expect(ask(post, "gemini", "m")).rejects.toThrow("سقف توکن");
  });
});

describe("OpenAI", () => {
  it("مدل استدلالی پارامترهای خودش را می‌گیرد", async () => {
    const { post, sent } = fakePost({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    await ask(post, "openai", "gpt-5.2-mini", { maxTokens: 64 });
    expect(sent.payload.temperature).toBeUndefined();
    expect(sent.payload.max_tokens).toBeUndefined();
    expect(sent.payload.max_completion_tokens).toBeGreaterThan(64);
    await ask(post, "openai", "gpt-4.1-mini");
    expect(sent.payload.temperature).toBe(0);
    expect(sent.payload.max_tokens).toBeUndefined();
    await ask(post, "openrouter", "openrouter/auto");
    expect(sent.payload.max_tokens).toBe(2000);
  });
});

describe("کلید و خطا", () => {
  it("نویسه‌های ناپیدای کلیدِ چسبانده‌شده حذف می‌شوند", () => {
    expect(cleanKey("‏ AIza-abc_123‌\n")).toBe("AIza-abc_123");
  });

  it("۴۰۳ با صفحهٔ HTML بستنِ شبکه است و کلید نامعتبر Gemini شناخته می‌شود", () => {
    const e = httpError(403, "<html><title>Error 403 (Forbidden)!!1</title><p>Your client does not have permission</p></html>");
    expect(e.message).toContain("فیلترینگ");
    expect(e.message).not.toContain("<p>");
    const bad = httpError(400, JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }));
    expect(bad.message).toContain("کلید API پذیرفته نشد");
  });
});
