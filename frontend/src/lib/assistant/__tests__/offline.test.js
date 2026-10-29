/**
 * دستیار آفلاین روی ایندکس واقعی — همان لایهٔ httpFor که نسخهٔ اندروید دارد.
 *
 * هر پرسش باید بی‌مدل به جدول درست برسد، مسیر پیوند معنادار بسازد و کوئری‌اش
 * از بازبین ساختار بی‌خطا رد شود.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { KnowledgeBase, httpFor } from "../../localdb.js";
import { answerOffline, detectIntent, OFFLINE_SAMPLES } from "../offline.js";
import { openIndex } from "./kbfixture.js";

let api;
beforeAll(async () => {
  const { sqlite3, db } = await openIndex();
  api = httpFor(new KnowledgeBase(sqlite3, db));
}, 180_000);

const ask = (q, opts) => answerOffline(api, q, opts);
const noErrors = (r) => (r.result.check?.findings || []).filter((f) => f.severity === "error");

describe("تشخیص خواسته", () => {
  it.each([
    ["ارتباط سند حسابداری و طرف حساب", "relation", false],
    ["ستون‌های جدول کارمند", "columns", false],
    ["مقادیر وضعیت سند حسابداری", "codes", false],
    ["تعداد کارمندان به تفکیک واحد سازمانی", "count", false],
    ["کدام جدول سوابق تحصیلی را نگه می‌دارد؟", "find", false],
    ["فهرست اسناد حسابداری", "list", false],
    ["جمع بدهکار و بستانکار هر سند در سال مالی جاری", "unknown", true],
  ])("%s", (q, kind, advanced) => {
    expect(detectIntent(q)).toEqual({ kind, advanced });
  });
});

describe("پاسخ آفلاین روی ایندکس", () => {
  it("ارتباط دو جدول از راه جدول واسط معنادار", async () => {
    const r = await ask("ارتباط سند حسابداری و طرف حساب");
    expect(r.handled).toBe(true);
    expect(r.result.offline).toBe(true);
    expect(r.result.tables).toEqual(["FIN3.Voucher", "FIN3.VoucherItem", "GNR3.Party"]);
    expect(r.result.sql).toContain("LEFT JOIN [FIN3].[VoucherItem] AS t1");
    expect(r.result.sql).toContain("@FiscalYearRef");
    expect(r.result.sql).not.toMatch(/\[Creator\]/);
    expect(noErrors(r)).toEqual([]);
  });

  it("جمع و نام لاتین: کارمندان ← HCM3.Employee", async () => {
    const r = await ask("ستون‌های جدول کارمندان");
    expect(r.result.kind).toBe("columns");
    expect(r.result.tables).toEqual(["HCM3.Employee"]);
    expect(r.result.note).toContain("EmployeeID");
  });

  it("مقادیر کددار ستونی که پرسش نام برده", async () => {
    const r = await ask("مقادیر وضعیت سند حسابداری");
    expect(r.result.kind).toBe("codes");
    expect(r.result.tables).toEqual(["FIN3.Voucher"]);
    expect(r.result.sql).toContain("CASE t0.[State]");
    expect(noErrors(r)).toEqual([]);
  });

  it("تعداد به تفکیک: ترتیب پرسش و شمارش یکتا از راه جدول واسط", async () => {
    const r = await ask("تعداد کارمندان به تفکیک واحد سازمانی");
    expect(r.result.tables[0]).toBe("HCM3.Employee");
    expect(r.result.tables).toContain("HCM3.Department");
    expect(r.result.sql).toMatch(/COUNT\(DISTINCT t0\.\[EmployeeID\]\)/);
    expect(r.result.sql).toMatch(/GROUP BY t\d\.\[Title\]/);
    expect(noErrors(r)).toEqual([]);
  });

  it("جمع مکسر: اسناد حسابداری ← FIN3.Voucher", async () => {
    const r = await ask("فهرست اسناد حسابداری");
    expect(r.result.tables[0]).toBe("FIN3.Voucher");
    expect(noErrors(r)).toEqual([]);
  });

  it("جدول مرجع: کد و شرح ردیف‌های خودش است", async () => {
    const r = await ask("کد و شرح نوع سند");
    expect(r.result.kind).toBe("codes");
    expect(r.result.sql).toMatch(/FROM \[\w+\]\.\[VoucherType\]/);
  });

  it("یافتن جدول", async () => {
    const r = await ask("کدام جدول سوابق تحصیلی را نگه می‌دارد؟");
    expect(r.result.kind).toBe("find");
    expect(r.result.tables).toContain("HCM3.EmployeeEducation");
  });

  it("نام لاتین کامل", async () => {
    const r = await ask("روابط جدول FIN3.Voucher");
    expect(r.result.kind).toBe("relations");
    expect(r.result.note).toContain("FIN3.VoucherItem");
  });

  it("پرسش پیشرفته: پایهٔ کوئری با علامت پیشرفته", async () => {
    const r = await ask("جمع بدهکار و بستانکار هر سند حسابداری در سال مالی جاری");
    expect(r.advanced).toBe(true);
    expect(r.handled).toBe(true);
    expect(r.result.tables[0]).toBe("FIN3.Voucher");
    expect(r.result.note).toContain("کلید API");
  });

  it("جدول سنجاق‌شده وقتی پرسش جدولی نمی‌گوید", async () => {
    const r = await ask("ستون‌ها", { pinned: ["GNR3.Party"] });
    expect(r.result.tables).toEqual(["GNR3.Party"]);
  });

  it("پیشنهاد هم‌نام‌ها: همان پرسش با جدول دیگر", async () => {
    const r = await ask("ستون‌های جدول سند حسابداری");
    const alt = r.result.choices.find((c) => c.instead === r.result.tables[0]);
    expect(alt).toBeTruthy();
    expect(alt.question).toContain(alt.label.split(" ")[0]);
    const again = await ask(alt.question);
    expect(again.result.tables[0]).toBe(alt.label.split(" ")[0]);
  });

  it("پرسش بی‌جدول پاسخ ساختگی نمی‌گیرد", async () => {
    const r = await ask("هوا امروز چطور است");
    expect(r.handled).toBe(false);
  });

  it.each(OFFLINE_SAMPLES)("نمونه «%s» پاسخ دارد و کوئری‌اش بی‌خطاست", async (q) => {
    const r = await ask(q);
    expect(r.handled).toBe(true);
    if (r.result.sql) expect(noErrors(r)).toEqual([]);
  });
});
