/**
 * همسانیِ بازبینیِ موبایل با سرور.
 *
 * مرجع (sqlcheck.golden.json) از خودِ sqlcheck.py ساخته می‌شود. اگر این آزمون
 * بیفتد، یعنی نسخهٔ اندروید دربارهٔ همان کوئری چیز دیگری از نسخهٔ ویندوز
 * می‌گوید — و مدل در دو نسخه بازخورد متفاوت می‌گیرد.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { SchemaIndex, checkSql, extractSql } from "../sqlcheck.js";
import { openIndex } from "./kbfixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(path.join(here, "sqlcheck.golden.json"), "utf8"));

// MERGE را تجزیه‌گرِ موبایل نمی‌خواند و از روی فعلش رد می‌کند؛ رأی یکی است
// ولی نام جدول‌ها را ندارد. برای کوئریِ ردشده، فهرست جدول‌ها اهمیتی ندارد.
const refusedOnly = (r) => r.findings.length > 0 && r.findings.every((f) => f.code === "not_read_only");

const comparable = (r) => ({
  ok: r.ok,
  tables: refusedOnly(r) ? [] : r.tables,
  findings: r.findings.map((f) => (f.code === "parse_error" ? { severity: f.severity, code: f.code } : f)),
});

let index;
beforeAll(async () => {
  index = new SchemaIndex((await openIndex()).all);
}, 180_000);

describe("بازبینی کوئری — همسان با sqlcheck.py", () => {
  for (const { sql, ...want } of golden) {
    it(sql, () => {
      expect(comparable(checkSql(sql, index))).toEqual(comparable(want));
    });
  }
});

describe("بیرون کشیدن کوئری از پاسخ مدل", () => {
  it("بلوک کد را برمی‌دارد", () => {
    expect(extractSql("حتماً!\n```sql\nSELECT 1\n```\nامیدوارم کمک کند.")).toBe("SELECT 1");
  });
  it("بدون بلوک، از SELECT به بعد", () => {
    expect(extractSql("این کوئری: SELECT 1")).toBe("SELECT 1");
  });
});
