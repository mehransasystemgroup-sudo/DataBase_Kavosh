/**
 * همسانیِ پرامپت‌ها و خوانشِ برداشت با سرور.
 *
 * مرجع (assistant.golden.json) از خودِ assistant.py ساخته می‌شود. اگر این آزمون
 * بیفتد، مدل در اندروید متنی می‌شنود که در ویندوز نمی‌شنود.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DRAFT_SYSTEM, SELECT_SYSTEM, UNDERSTAND_SYSTEM,
  briefText, cleanHistory, draftPrompt, parseIntent, understandPrompt,
} from "../assistant.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(here, "assistant.golden.json"), "utf8"));

describe("دستیار — همسان با assistant.py", () => {
  it("متن پرامپت‌های سیستمی", () => {
    expect(UNDERSTAND_SYSTEM).toBe(golden.UNDERSTAND_SYSTEM);
    expect(SELECT_SYSTEM).toBe(golden.SELECT_SYSTEM);
    expect(DRAFT_SYSTEM).toBe(golden.DRAFT_SYSTEM);
  });

  golden.intents.forEach(({ reply, intent, brief }, i) => {
    it(`خوانش برداشت ${i + 1}`, () => {
      const got = parseIntent(reply);
      expect(got).toEqual(intent);
      expect(briefText(got)).toBe(brief);
    });
  });

  it("گفت‌وگوی قبلی و پرامپت‌های ساخته‌شده", () => {
    const history = cleanHistory(golden.history);
    expect(history).toEqual(golden.clean_history);
    expect(understandPrompt("حالا امسال", history)).toBe(golden.understand_prompt);
    expect(understandPrompt("فهرست کارمندان", [])).toBe(golden.understand_prompt_alone);
    const context = "### جدول‌ها\n\n[HCM3].[Employee]";
    expect(draftPrompt("حالا امسال", context, history, parseIntent(golden.intents[0].reply)))
      .toBe(golden.draft_prompt);
    expect(draftPrompt("فهرست کارمندان", context)).toBe(golden.draft_prompt_plain);
  });
});
