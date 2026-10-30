/**
 * تحویل کوئری از جای دیگر برنامه (دستیار، طراح کوئری، کتابخانه) به زبانهٔ
 * «ساخت گزارش». یک‌بارمصرف است: گزارش‌ساز هنگام باز شدن برش می‌دارد و پاکش
 * می‌کند، تا با بازگشت بعدی کار فعلی کاربر بازنویسی نشود.
 */

const KEY = "kavosh.rb.handoff";

export function sendToBuilder({ sql, title = "", tables = [], source = "", libraryId = "", spec = null }) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ sql, title, tables, source, libraryId, spec, at: Date.now() }));
  } catch {
    /* بی‌ذخیره‌گاه: گزارش‌ساز با همان حالت قبلی باز می‌شود */
  }
}

export function takeHandoff() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const doc = JSON.parse(raw);
    // تحویلِ کهنه (مثلاً از نشست دیروز) نادیده گرفته می‌شود
    return doc && Date.now() - (doc.at || 0) < 10 * 60 * 1000 ? doc : null;
  } catch {
    return null;
  }
}
