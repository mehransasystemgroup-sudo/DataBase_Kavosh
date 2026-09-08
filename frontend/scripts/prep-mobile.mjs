/**
 * آماده‌سازی پوشهٔ دارایی‌های نسخهٔ موبایل.
 *
 * نسخهٔ موبایل publicDir جداگانه دارد (تا ایندکس ۱۲ مگابایتی وارد بیلد وب
 * نشود)، پس فایل‌های مشترک باید کپی شوند — وگرنه چیزهایی مثل آیکون بی‌صدا
 * ۴۰۴ می‌دهند.
 */

import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const shared = path.join(root, "public");
const target = path.join(root, "public-mobile");
const index = path.join(target, "kb.sqlite");

await mkdir(target, { recursive: true });
await cp(shared, target, { recursive: true });

try {
  const { size } = await stat(index);
  console.log(`ایندکس دانش: ${(size / 1024 / 1024).toFixed(1)} مگابایت`);
} catch {
  console.error(
    "ایندکس دانش پیدا نشد: frontend/public-mobile/kb.sqlite\n" +
    "برای ساختنش، از پوشهٔ backend اجرا کنید:\n" +
    "  python3 -m core.indexer --kb kb --out ../frontend/public-mobile/kb.sqlite --instance instances/live",
  );
  process.exit(1);
}
