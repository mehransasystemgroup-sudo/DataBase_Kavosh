/**
 * انتقال شبکه‌ای — نسخهٔ وب/دسکتاپ که سرور محلی دارد.
 *
 * در توسعه، Vite مسیر /api را به بک‌اند پروکسی می‌کند؛ در بیلد نهایی همان
 * سروری که فایل‌های استاتیک را می‌دهد، API را هم پاسخ می‌دهد.
 */

import axios from "axios";

const BASE = import.meta.env.VITE_BACKEND_URL || "";

export const transport = axios.create({ baseURL: `${BASE}/api`, timeout: 60_000 });

export const offlineHint = "ارتباط با سرور دانش برقرار نشد — سرویس بک‌اند را اجرا کنید.";
