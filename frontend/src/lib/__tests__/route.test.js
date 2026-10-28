/**
 * نشانی هر زبانه — زبانهٔ دستیار پیش‌تر به «کاوش جدول‌ها» می‌رفت.
 */

import { describe, expect, it } from "vitest";

import { build, parse, routeForView } from "../route.js";

describe("مسیریابی", () => {
  it("هر زبانه نشانی خودش را دارد", () => {
    expect(build(routeForView("assistant"))).toBe("#/assistant");
    expect(build(routeForView("lookup"))).toBe("#/lookup");
    expect(build(routeForView("graph", { graphSchema: "HCM3" }))).toBe("#/graph/HCM3");
    expect(build(routeForView("explorer"))).toBe("#/");
  });

  it("نشانی دستیار به خودِ دستیار برمی‌گردد", () => {
    expect(parse("#/assistant")).toEqual({ view: "assistant" });
    expect(parse(build(routeForView("assistant"))).view).toBe("assistant");
  });

  it("دستیار با جدول سنجاق‌شده", () => {
    const hash = build({ view: "assistant", table: "FIN3.Voucher" });
    expect(hash).toBe("#/assistant/FIN3.Voucher");
    expect(parse(hash)).toEqual({ view: "assistant", table: "FIN3.Voucher" });
  });

  it("مسیرهای قبلی دست نخورده‌اند", () => {
    expect(parse("#/table/HCM3.Employee")).toEqual({ view: "explorer", table: "HCM3.Employee" });
    expect(parse("#/q/%D8%B3%D9%86%D8%AF")).toEqual({ view: "explorer", query: "سند" });
    expect(parse("")).toEqual({ view: "explorer" });
  });
});
