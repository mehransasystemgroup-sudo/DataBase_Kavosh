/**
 * اندازه‌های RDL — «2.5cm»، «25mm»، «1in»، «72pt»، «6pc» — همه به سانتی‌متر.
 *
 * هر مقایسهٔ عرض و ارتفاع در اعتبارسنجی به همین تکیه دارد، و گزارش‌های واقعی
 * واحدها را با هم قاطی می‌کنند (عرض ستون به mm و عرض بخش به cm).
 */

const PER_CM = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6 };

/** «2.5cm» ← 2.5 ؛ مقدار نامعتبر ← null. */
export function toCm(value) {
  const m = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(cm|mm|in|pt|pc)\s*$/i.exec(String(value ?? ""));
  if (!m) return null;
  return parseFloat(m[1]) * PER_CM[m[2].toLowerCase()];
}

/** عدد سانتی‌متر ← «2.5cm» با حداکثر پنج رقم اعشار و بی‌صفرِ زائد. */
export function cm(value) {
  const rounded = Math.round(Number(value) * 100000) / 100000;
  return `${Number.isFinite(rounded) ? rounded : 0}cm`;
}

/** برابری با رواداری — اختلاف چندصدم میلی‌متر در Report Builder رایج است. */
export const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;

export const PAGE_SIZES = {
  landscape_a4: { label: "A4 افقی", width: 29.7, height: 21 },
  portrait_a4: { label: "A4 عمودی", width: 21, height: 29.7 },
  landscape_a5: { label: "A5 افقی", width: 21, height: 14.8 },
  portrait_a5: { label: "A5 عمودی", width: 14.8, height: 21 },
  landscape_a3: { label: "A3 افقی", width: 42, height: 29.7 },
};
