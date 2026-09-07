import axios from "axios";

// در توسعه، Vite مسیر /api را به بک‌اند پروکسی می‌کند؛ در بیلد نهایی
// همان سروری که فایل‌های استاتیک را می‌دهد API را هم پاسخ می‌دهد.
const BASE = import.meta.env.VITE_BACKEND_URL || "";

export const http = axios.create({ baseURL: `${BASE}/api`, timeout: 60_000 });

/** پیام خطای خوانا از پاسخ سرور یا خطای شبکه. */
export function errorMessage(err, fallback = "خطای نامشخص") {
  return err?.response?.data?.detail || err?.message || fallback;
}
