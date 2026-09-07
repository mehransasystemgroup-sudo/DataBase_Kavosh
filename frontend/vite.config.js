import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// آدرس بک‌اند در حالت توسعه؛ در بیلد نهایی مسیرها نسبی‌اند و
// همان سروری که فایل‌ها را می‌دهد، API را هم پاسخ می‌دهد.
const BACKEND = process.env.BACKEND_URL || "http://127.0.0.1:8321";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  server: {
    port: 3000,
    host: true,
    proxy: { "/api": { target: BACKEND, changeOrigin: true } },
  },
  build: {
    outDir: "dist",
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
});
