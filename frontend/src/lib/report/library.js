/**
 * کلاینت کتابخانهٔ گزارش‌ها — روی هر دو نسخه از `http` می‌رود و نمی‌داند
 * پشتش سرور است (دسکتاپ) یا ذخیره‌گاه دستگاه (گوشی، libstore.js).
 */

import { http } from "@/lib/api";

export async function listReports(params = {}) {
  const { data } = await http.get("/reports", { params });
  return data;
}

export async function getReport(id) {
  const { data } = await http.get(`/reports/${encodeURIComponent(id)}`);
  return data;
}

export async function saveReport(payload) {
  const { data } = await http.post("/reports", payload);
  return data;
}

export async function deleteReport(id) {
  await http.delete(`/reports/${encodeURIComponent(id)}`);
}
