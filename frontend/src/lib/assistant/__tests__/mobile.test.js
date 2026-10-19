/**
 * دستیار روی موبایل، سر تا ته — بدون گوشی و بدون کلید واقعی.
 *
 * پوستهٔ اندروید (NetBridge.java) این‌جا با یک پلِ ساختگی جایگزین شده که
 * همان قرارداد را دارد: کلید را خودش نگه می‌دارد و جای نشانهٔ KEY می‌نشاند.
 * مدل هم ساختگی است و مثل مدل ضعیف واقعی اشتباه می‌کند — همان سناریوهای
 * backend/tests/test_assistant.py.
 */

import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { KnowledgeBase } from "../../localdb.js";
import { askAssistant, getSettings, putSettings, testSettings } from "../mobile.js";
import { KEY } from "../providers.js";
import { openIndex } from "./kbfixture.js";

// ── محیط مرورگرِ کمینه ──
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.window = globalThis;

/** همتای NetBridge.java برای آزمون. */
function fakeShell(model) {
  const keys = new Map();
  const sent = [];
  const hints = () => Object.fromEntries([...keys].map(([p, k]) => [p, `…${k.slice(-4)}`]));
  const shell = {
    sent,
    onmessage: null,
    postMessage(raw) {
      const msg = JSON.parse(raw);
      let reply;
      if (msg.op === "keys") reply = { id: msg.id, ok: true, hints: hints() };
      else if (msg.op === "setKey") {
        if (msg.value) keys.set(msg.provider, msg.value);
        else keys.delete(msg.provider);
        reply = { id: msg.id, ok: true, hints: hints() };
      } else if (msg.op === "http") {
        const key = msg.transientKey || keys.get(msg.keyProvider) || "";
        const headers = Object.fromEntries(
          Object.entries(msg.headers).map(([n, v]) => [n, v.replace(KEY, key)]));
        sent.push({ ...msg, headers });
        const body = JSON.parse(msg.body);
        const system = body.messages[0].content;
        const user = body.messages[1].content;
        const text = model(system, user, headers);
        reply = typeof text === "object" ? { id: msg.id, ...text }
          : { id: msg.id, ok: true, status: 200, text: JSON.stringify({ choices: [{ message: { content: text } }] }) };
      }
      queueMicrotask(() => shell.onmessage({ data: JSON.stringify(reply) }));
    },
  };
  return shell;
}

function scripted(selection, replies) {
  const asked = [];
  const model = (system, user) => {
    asked.push(user);
    if (system.includes("انتخاب کن")) return selection;
    if (system.includes("یک کلمه")) return "سلام";
    return replies.length ? replies.shift() : "```sql\nSELECT 1\n```";
  };
  model.asked = asked;
  return model;
}

async function ask(question = "فهرست کارمندان") {
  const events = [];
  await askAssistant(kb, question, { onEvent: (e) => events.push(e) });
  return { events, result: events.find((e) => e.type === "result"), error: events.find((e) => e.type === "error") };
}

let kb;
beforeAll(async () => {
  const { sqlite3, db } = await openIndex();
  kb = new KnowledgeBase(sqlite3, db);
}, 180_000);

beforeEach(() => memory.clear());

describe("دستیار موبایل", () => {
  it("بدون کلید، صریح می‌گوید و چیزی نمی‌فرستد", async () => {
    window.KavoshNet = fakeShell(scripted("", []));
    await expect(askAssistant(kb, "فهرست کارمندان", { onEvent: () => {} })).rejects.toThrow(/کلید API/);
    expect(window.KavoshNet.sent).toHaveLength(0);
  });

  it("کلید به صفحه برنمی‌گردد — فقط چهار نویسهٔ آخر", async () => {
    window.KavoshNet = fakeShell(scripted("", []));
    const view = await putSettings({ provider: "openai", api_key: "sk-secret-abcd1234" });
    const openai = view.providers.find((p) => p.id === "openai");
    expect(openai).toMatchObject({ has_key: true, key_hint: "…1234" });
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(localStorage.getItem("kavosh.assistant.v1")).not.toContain("secret");
  });

  it("مدل ضعیف با بازخورد به کوئری درست می‌رسد، و کلید فقط در پوسته جایگذاری می‌شود", async () => {
    const model = scripted("HCM3.Employee", [
      "```sql\nSELECT e.EmployeeID FROM HCM3.Employees AS e\n```",
      "```sql\nSELECT e.EmployeeID FROM HCM3.Employee AS e\n```",
    ]);
    window.KavoshNet = fakeShell(model);
    await putSettings({ provider: "openai", api_key: "sk-test-9876" });

    const { result, events } = await ask();
    expect(result.attempts).toBe(2);
    expect(result.check.ok).toBe(true);
    expect(result.sql).toContain("HCM3.Employee");
    expect(model.asked.at(-1)).toContain("HCM3.Employee");
    expect(events.map((e) => e.type)).toContain("verify");

    const call = window.KavoshNet.sent[0];
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.headers.authorization).toBe("Bearer sk-test-9876");
  });

  it("مدلِ ناامیدکننده به‌عنوان تأییدشده نشان داده نمی‌شود", async () => {
    const bad = "```sql\nSELECT x.Nope FROM HCM3.Employees AS x\n```";
    window.KavoshNet = fakeShell(scripted("HCM3.Employee", [bad, bad, bad, bad]));
    await putSettings({ provider: "openai", api_key: "sk-test-9876", max_attempts: 3 });
    const { result } = await ask();
    expect(result.attempts).toBe(3);
    expect(result.check.ok).toBe(false);
  });

  it("خطای کلید از سرویس، پیام فارسیِ سرور را می‌دهد", async () => {
    window.KavoshNet = fakeShell(() => ({ ok: true, status: 401, text: "{}" }));
    await putSettings({ provider: "openai", api_key: "sk-wrong" });
    const { error } = await ask();
    expect(error.message).toBe("کلید API پذیرفته نشد. کلید را در تنظیمات بررسی کنید.");
  });

  it("آزمایش کلید با کلید موقت، چیزی ذخیره نمی‌کند", async () => {
    window.KavoshNet = fakeShell(scripted("", []));
    const probe = await testSettings({ provider: "openai", api_key: "sk-temp-0000" });
    expect(probe.ok).toBe(true);
    expect(window.KavoshNet.sent[0].headers.authorization).toBe("Bearer sk-temp-0000");
    const view = await getSettings();
    expect(view.providers.find((p) => p.id === "openai").has_key).toBe(false);
  });
});
