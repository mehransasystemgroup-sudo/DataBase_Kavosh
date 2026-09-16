// انتخاب لایهٔ انتقال هنگام بیلد انجام می‌شود (vite.config.js): نسخهٔ وب با
// axios به سرور می‌زند و نسخهٔ موبایل مستقیم روی ایندکس دستگاه. بقیهٔ برنامه
// تفاوتی نمی‌بیند، چون هر دو همان قرارداد `{ data }` را می‌دهند.
import { apiBase, assistant, offlineHint, transport } from "@transport";

export const http = transport;

/** وقتی لایهٔ داده پاسخ نمی‌دهد، کاربر باید بداند دقیقاً چه چیزی را درست کند. */
export const OFFLINE_HINT = offlineHint;

/** نشانی پایهٔ API — فقط دستیار لازمش دارد، چون جریانی کار می‌کند. */
export const API_BASE = apiBase;

/** آیا این نسخه دستیار کوئری‌نویسی دارد؟ نسخهٔ موبایل ندارد. */
export const HAS_ASSISTANT = assistant;

/** پیام خطای خوانا از پاسخ سرور یا خطای شبکه. */
export function errorMessage(err, fallback = "خطای نامشخص") {
  return err?.response?.data?.detail || err?.message || fallback;
}
