import { useCallback, useEffect, useState } from "react";

/*
  مسیریابی سبک بر پایهٔ hash — بدون کتابخانه‌ی روتر.

  چرا لازم است: بدون آن، دکمهٔ «بازگشت» مرورگر کاربر را از اپ بیرون می‌اندازد
  (روی موبایل که جزئیات جدول تمام‌صفحه است، این رفتار واقعاً آزاردهنده است) و
  هیچ نمایی قابل اشتراک‌گذاری نیست. با hash، هر جدول و هر اسکیما نشانی خودش
  را دارد و تاریخچهٔ مرورگر همان‌طور کار می‌کند که کاربر انتظار دارد.

  شکل مسیرها:
    #/                       فهرست جست‌وجو
    #/q/<عبارت>              جست‌وجوی فعال
    #/table/<FIN3.Voucher>   جزئیات جدول
    #/graph/<FIN3>           گراف اسکیما
    #/lookup                 جدول‌های کد و شرحی
    #/assistant              دستیار کوئری‌نویسی
    #/assistant/<FIN3.Voucher>  دستیار، با این جدول سنجاق‌شده
*/

export function parse(hash) {
  const raw = (hash || "").replace(/^#\/?/, "");
  if (!raw) return { view: "explorer" };

  const slash = raw.indexOf("/");
  const kind = slash === -1 ? raw : raw.slice(0, slash);
  const rest = slash === -1 ? "" : decodeURIComponent(raw.slice(slash + 1));

  if (kind === "table" && rest) return { view: "explorer", table: rest };
  if (kind === "graph" && rest) return { view: "graph", schema: rest };
  if (kind === "lookup") return { view: "lookup" };
  if (kind === "assistant") return rest ? { view: "assistant", table: rest } : { view: "assistant" };
  if (kind === "q") return { view: "explorer", query: rest };
  return { view: "explorer" };
}

export function build(route) {
  if (route.view === "graph") return `#/graph/${encodeURIComponent(route.schema || "")}`;
  if (route.view === "lookup") return "#/lookup";
  if (route.view === "assistant") {
    return route.table ? `#/assistant/${encodeURIComponent(route.table)}` : "#/assistant";
  }
  if (route.table) return `#/table/${encodeURIComponent(route.table)}`;
  if (route.query) return `#/q/${encodeURIComponent(route.query)}`;
  return "#/";
}

/**
 * مسیرِ هر زبانه در نوار نماها.
 *
 * پیش‌تر این نگاشت داخل App بود و «assistant» را نمی‌شناخت؛ پس کلیک روی زبانهٔ
 * دستیار به «کاوش جدول‌ها» می‌رفت و دستیار عملاً از زبانهٔ جدول‌ها جدا نبود.
 * حالا یک تابع است با آزمون، تا هر زبانهٔ تازه هم نشانی درست بگیرد.
 */
export function routeForView(view, { graphSchema = "FIN3" } = {}) {
  if (view === "graph") return { view: "graph", schema: graphSchema };
  if (view === "lookup") return { view: "lookup" };
  if (view === "assistant") return { view: "assistant" };
  return { view: "explorer" };
}

/**
 * مسیر جاری و دو راه تغییر آن.
 *
 * `push` یک ورودی تازه در تاریخچه می‌گذارد (پیمایش کاربر) و `replace`
 * جای ورودی فعلی را می‌گیرد (مثلاً تایپ در جست‌وجو، که نباید ده‌ها گام
 * به تاریخچه اضافه کند).
 */
export function useHashRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next, { replace = false } = {}) => {
    const target = build(next);
    if (target === window.location.hash) return;
    if (replace) {
      window.history.replaceState(null, "", target);
      setRoute(parse(target));
    } else {
      window.location.hash = target; // رویداد hashchange خودش state را می‌زند
    }
  }, []);

  return [route, navigate];
}
