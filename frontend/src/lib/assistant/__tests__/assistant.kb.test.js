/**
 * همسانیِ بازیابی، پرامپت انتخاب و زمینهٔ ساختاری با سرور — روی ایندکس واقعی.
 *
 * مرجع (assistant_kb.golden.json) از assistant.py و search.py ساخته می‌شود. اگر
 * این آزمون بیفتد، دستیار در اندروید جدول‌های دیگری می‌بیند یا ساختار دیگری
 * به مدل می‌دهد تا در ویندوز.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { KnowledgeBase } from "../../localdb.js";
import { buildContext, candidateLinks, cleanPinned, retrieve, selectPrompt } from "../assistant.js";
import { openIndex } from "./kbfixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(here, "assistant_kb.golden.json"), "utf8"));

let kb;
beforeAll(async () => {
  const { sqlite3, db } = await openIndex();
  kb = new KnowledgeBase(sqlite3, db);
}, 180_000);

describe("دستیار روی ایندکس — همسان با assistant.py", () => {
  it("همسایه‌های هر جدول", () => {
    for (const [full, related] of Object.entries(golden.related)) {
      expect(kb.relatedTables(full)).toEqual(related);
    }
  });

  golden.retrievals.forEach((g, i) => {
    it(`نامزدها و پرامپت انتخاب ${i + 1}`, () => {
      const pins = cleanPinned(kb, g.pinned);
      expect(pins).toEqual(g.pins);
      const candidates = retrieve(kb, g.question, g.keywords, g.previous, pins);
      expect(candidates).toEqual(g.candidates);
      const links = candidateLinks(kb, candidates);
      expect(selectPrompt(g.question, candidates, links, g.goal, pins)).toBe(g.select_prompt);
    });
  });

  golden.contexts.forEach((g, i) => {
    it(`زمینهٔ ساختاری ${i + 1}`, () => {
      const { context, tables, joins } = buildContext(kb, g.chosen);
      expect(tables).toEqual(g.tables);
      expect(joins).toEqual(g.joins);
      expect(context).toBe(g.context);
    });
  });
});
