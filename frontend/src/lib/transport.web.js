/**
 * انتقال شبکه‌ای — نسخهٔ وب/دسکتاپ که سرور محلی دارد.
 *
 * در توسعه، Vite مسیر /api را به بک‌اند پروکسی می‌کند؛ در بیلد نهایی همان
 * سروری که فایل‌های استاتیک را می‌دهد، API را هم پاسخ می‌دهد.
 */

import axios from "axios";

const BASE = import.meta.env.VITE_BACKEND_URL || "";

export const transport = axios.create({ baseURL: `${BASE}/api`, timeout: 60_000 });

export const apiBase = `${BASE}/api`;
export const assistant = true;

export const offlineHint = "ارتباط با سرور دانش برقرار نشد — سرویس بک‌اند را اجرا کنید.";

/**
 * پرسش به دستیار؛ هر رویدادِ جریانیِ سرور به `onEvent` می‌رسد.
 *
 * SSE را دستی می‌خوانیم: axios برای جریان ساخته نشده و EventSource فقط GET
 * می‌فرستد، ولی پرسش باید در بدنه برود.
 */
export async function askAssistant(question, { onEvent, signal, history = [] } = {}) {
  const res = await fetch(`${apiBase}/assistant/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (!res.ok) {
    let detail = `سرور پاسخ ${res.status} داد.`;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* بدنه JSON نبود — همان پیام پیش‌فرض */
    }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (line) onEvent(JSON.parse(line.slice(5)));
    }
  }
}
