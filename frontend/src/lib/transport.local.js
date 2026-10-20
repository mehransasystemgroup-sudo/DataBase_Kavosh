/**
 * انتقال — نسخهٔ موبایل که سروری ندارد.
 *
 * پرس‌وجوها روی همان ایندکس SQLite داخل بسته و در خود دستگاه اجرا می‌شوند،
 * پس کاوش بدون اینترنت و بدون هیچ سروری کار می‌کند. فقط دستیار کوئری‌نویسی
 * به اینترنت می‌رود — آن هم از راه پوستهٔ اندروید که کلید را نگه می‌دارد.
 */

import { hasBridge } from "./assistant/native.js";

export { localHttp as transport, askLocal as askAssistant } from "./localdb.js";

export const offlineHint = "ایندکس دانش باز نشد — برنامه را ببندید و دوباره باز کنید.";

export const apiBase = "";

/*
  دستیار به پل شبکهٔ پوستهٔ اندروید نیاز دارد (WebMessageListener). نمایشگر
  وبِ خیلی قدیمی آن را ندارد؛ آن‌جا به‌جای تبی که با خطا برمی‌گردد، صریح
  می‌گوییم چه باید کرد.
*/
export const assistant = hasBridge();
