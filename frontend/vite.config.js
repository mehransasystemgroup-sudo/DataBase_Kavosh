import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// آدرس بک‌اند در حالت توسعه؛ در بیلد نهایی مسیرها نسبی‌اند و همان سروری که
// فایل‌ها را می‌دهد، API را هم پاسخ می‌دهد.
const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8321";

/**
 * دو بیلد از یک کد:
 *
 *   vite build                 نسخهٔ وب/دسکتاپ — با سرور محلی حرف می‌زند
 *   vite build --mode mobile   نسخهٔ اندروید — ایندکس را در خود دستگاه باز می‌کند
 *
 * تفاوت فقط در لایهٔ انتقال است، پس هیچ کدی دو نسخه نمی‌شود و نسخهٔ وب هم
 * موتور SQLite را بی‌جهت با خود حمل نمی‌کند.
 */
export default defineConfig(({ mode }) => {
  const mobile = mode === "mobile";
  const src = path.resolve(process.cwd(), "src");

  return {
    // مسیرهای نسبی لازم است: در اندروید صفحه از زیرپوشهٔ assets سرو می‌شود
    base: mobile ? "./" : "/",
    plugins: [react()],
    resolve: {
      alias: {
        "@": src,
        "@transport": path.resolve(src, mobile ? "lib/transport.local.js" : "lib/transport.web.js"),
      },
    },
    // ایندکس دانش فقط در نسخهٔ موبایل داخل بسته می‌رود
    publicDir: mobile ? "public-mobile" : "public",
    // این بسته wasm خودش را با import.meta.url پیدا می‌کند؛ پیش‌پردازش Vite آن را می‌شکند
    optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
    server: {
      port: 3000,
      host: true,
      proxy: { "/api": { target: BACKEND, changeOrigin: true } },
    },
    build: {
      outDir: mobile ? "dist-mobile" : "dist",
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            d3: ["d3"],
            vendor: ["react", "react-dom"],
          },
        },
      },
    },
  };
});
