// انتخاب لایهٔ انتقال هنگام بیلد انجام می‌شود (vite.config.js): نسخهٔ وب با
// axios به سرور می‌زند و نسخهٔ موبایل مستقیم روی ایندکس دستگاه. بقیهٔ برنامه
// تفاوتی نمی‌بیند، چون هر دو همان قرارداد `{ data }` را می‌دهند.
import { apiBase, askAssistant, assistant, offlineHint, transport } from "@transport";

export const http = transport;

/** وقتی لایهٔ داده پاسخ نمی‌دهد، کاربر باید بداند دقیقاً چه چیزی را درست کند. */
export const OFFLINE_HINT = offlineHint;

/** نشانی پایهٔ API. */
export const API_BASE = apiBase;

/** آیا این نسخه دستیار کوئری‌نویسی دارد؟ موبایل فقط وقتی پل شبکهٔ پوسته هست. */
export const HAS_ASSISTANT = assistant;

/** پرسش به دستیار — روی دسکتاپ از سرور، روی موبایل در خودِ برنامه. */
export const ASK_ASSISTANT = askAssistant;

/** دانلود فایل از مرورگر؛ نمایشگر وبِ اندروید بدون کد بومی فایل را ذخیره نمی‌کند. */
export const CAN_DOWNLOAD = import.meta.env.MODE !== "mobile";

/** پیام خطای خوانا از پاسخ سرور یا خطای شبکه. */
export function errorMessage(err, fallback = "خطای نامشخص") {
  return err?.response?.data?.detail || err?.message || fallback;
}
