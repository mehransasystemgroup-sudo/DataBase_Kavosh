/**
 * کتابخانهٔ گزارش‌ها روی دستگاه — برای نسخهٔ گوشی که سرور ندارد.
 *
 * همان قواعد backend/core/report_library.py: سقف‌ها، ادغام کلید‌به‌کلید،
 * فهرست سبک بی‌متن RDL. هیچ import ندارد تا localdb.js بی‌حلقه بارش کند.
 */

const STORE = "kavosh.reports.v1";
const MAX_REPORTS = 2000;
const MAX_TEXT = 400_000;
const MAX_FIELD = 4_000;
const MAX_LIST = 200;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const TEXT_KEYS = ["title", "folder", "description", "request", "sql"];
const LIST_KEYS = ["tables", "parameters", "lessons", "tags"];

export class LibraryError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.response = { status: 400, data: { detail: message } };
  }
}

function read(storage) {
  try {
    const doc = JSON.parse(storage.getItem(STORE) || "{}");
    return (doc.reports || []).filter((r) => r && ID.test(String(r.id || "")));
  } catch {
    return [];
  }
}

function write(storage, reports) {
  try {
    storage.setItem(STORE, JSON.stringify({ version: 1, reports }));
  } catch {
    throw new LibraryError("فضای ذخیرهٔ دستگاه پر است؛ چند گزارش قدیمی را حذف کنید.");
  }
}

const summary = ({ rdl, spec, ...rest }) => ({ ...rest, has_rdl: Boolean(rdl), has_spec: Boolean(spec) });
const now = () => new Date().toISOString().slice(0, 19);
const newId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

function clean(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new LibraryError("بدنهٔ درخواست باید یک شیء باشد.");
  const out = {};
  for (const key of TEXT_KEYS) {
    if (payload[key] == null) continue;
    const value = String(payload[key]);
    if (value.length > (key === "sql" ? MAX_TEXT : MAX_FIELD)) throw new LibraryError(`«${key}» بیش از حد مجاز طولانی است.`);
    out[key] = key === "sql" ? value : value.trim();
  }
  if (payload.rdl != null) {
    const value = String(payload.rdl);
    if (value.length > MAX_TEXT * 10) throw new LibraryError("فایل RDL بیش از حد مجاز (۴ مگابایت) بزرگ است.");
    out.rdl = value;
  }
  for (const key of LIST_KEYS) {
    if (payload[key] == null) continue;
    if (!Array.isArray(payload[key])) throw new LibraryError(`«${key}» باید فهرست باشد.`);
    out[key] = payload[key].slice(0, MAX_LIST).map((x) => String(x).slice(0, MAX_FIELD)).filter((x) => x.trim());
  }
  if (payload.spec != null) {
    if (typeof payload.spec !== "object" || Array.isArray(payload.spec)) throw new LibraryError("«spec» باید شیء باشد.");
    if (JSON.stringify(payload.spec).length > MAX_TEXT) throw new LibraryError("«spec» بیش از حد مجاز بزرگ است.");
    out.spec = payload.spec;
  }
  return out;
}

/** کتابخانه روی یک ذخیره‌گاه کلید-مقدار (localStorage یا بدل آزمون). */
export function localLibrary(storage = globalThis.localStorage) {
  return {
    list({ q = "", folder = "" } = {}) {
      const reports = read(storage);
      const needle = String(q).trim().toLowerCase();
      const hit = (r) => {
        if (folder && (r.folder || "") !== folder) return false;
        if (!needle) return true;
        return [r.title, r.folder, r.description, r.request, ...(r.tables || []), ...(r.tags || [])].join(" ").toLowerCase().includes(needle);
      };
      const found = reports.filter(hit).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
      const folders = [...new Set(reports.map((r) => r.folder || "").filter(Boolean))].sort();
      return { reports: found.map(summary), folders, total: reports.length };
    },
    get(id) {
      return read(storage).find((r) => r.id === id) || null;
    },
    save(payload) {
      const data = clean(payload);
      const id = String(payload?.id || "");
      if (id && !ID.test(id)) throw new LibraryError("شناسهٔ گزارش نامعتبر است.");
      const reports = read(storage);
      let current = id ? reports.find((r) => r.id === id) : null;
      if (!current) {
        if (!String(data.title || "").trim()) throw new LibraryError("گزارش بدون عنوان ذخیره نمی‌شود.");
        if (reports.length >= MAX_REPORTS) throw new LibraryError(`کتابخانه پر است (حداکثر ${MAX_REPORTS} گزارش).`);
        current = { id: id || newId(), created_at: now(), used_count: 0 };
        reports.push(current);
      }
      if ("title" in data && !data.title) throw new LibraryError("عنوان گزارش نمی‌تواند خالی باشد.");
      Object.assign(current, data);
      if (payload.touch) current.used_count = Number(current.used_count || 0) + 1;
      current.updated_at = now();
      write(storage, reports);
      return { ...current };
    },
    remove(id) {
      const reports = read(storage);
      const kept = reports.filter((r) => r.id !== id);
      if (kept.length === reports.length) return false;
      write(storage, kept);
      return true;
    },
  };
}
