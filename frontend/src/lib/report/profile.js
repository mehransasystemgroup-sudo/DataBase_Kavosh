/**
 * پروفایل سازمانی گزارش — آموخته از یک RDL واقعی سازمان.
 *
 * همان «یادگیری از RDL» اپ گزارش‌ساز قبلی (report-profile.json و
 * report-style.json): نام و مرجع منبع داده، قلم، قالب عدد، اندازهٔ صفحه،
 * رنگ سرآیند/گروه/جمع و اینکه گزارش‌های سازمان Sys_* و Code.Util دارند یا نه.
 * گزارش تازه با همین پروفایل ساخته می‌شود تا شبیه بقیهٔ گزارش‌های سازمان باشد.
 */

import { DEFAULT_PROFILE } from "./build.js";
import { inspectRdl, SYS_PARAMS } from "./rdl.js";
import { findAll, kid, textOf } from "./xml.js";
import { PAGE_SIZES, near } from "./units.js";

const top = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
const count = (list) => list.reduce((acc, v) => (v ? ((acc[v] = (acc[v] || 0) + 1), acc) : acc), {});

function cellBackgrounds(tablix) {
  // ردیف اول ≈ سرآیند؛ ردیف‌هایی با «جمع» ≈ جمع؛ بقیه که BackgroundColor ثابت دارند ≈ گروه
  const out = { header: [], total: [], group: [] };
  tablix.rows.forEach((r, i) => {
    for (const c of r.cells) {
      if (!c.el || c.empty) continue;
      const bg = textOf(findAll(c.el, "BackgroundColor")[0]).trim();
      if (!bg || bg.startsWith("=") || /^(Transparent|White|#ffffff)$/i.test(bg)) continue;
      const value = c.item.value || "";
      if (i === 0) out.header.push(bg);
      else if (/جمع|Sum\(/i.test(value)) out.total.push(bg);
      else out.group.push(bg);
    }
  });
  return out;
}

/** RDL ← { profile, learned: [توضیح هر مورد] } */
export function learnProfile(text) {
  const info = inspectRdl(text);
  if (!info.ok) throw new Error(`فایل RDL خوانده نشد: ${info.error.message}`);
  const p = {};
  const learned = [];

  const shared = info.dataSources.find((d) => d.reference);
  const ds = shared || info.dataSources[0];
  if (ds) {
    p.dataSourceName = ds.name;
    if (shared) {
      p.dataSource = "shared";
      p.dataSourceRef = shared.reference;
      learned.push(`منبع داده: ${shared.name} ← ${shared.reference}`);
    } else if (ds.connectString) {
      p.dataSource = "embedded";
      p.connectString = ds.connectString;
      learned.push(`منبع داده: ${ds.name} (رشتهٔ اتصال جاسازی‌شده)`);
    }
  }

  const font = top(info.fonts);
  if (font) {
    p.fontFamily = font;
    learned.push(`قلم: ${font}`);
  }
  const sizes = count(findAll(info.root, "FontSize").map((e) => textOf(e).trim()).filter((v) => /^\d+(\.\d+)?pt$/.test(v)));
  const size = top(sizes);
  if (size) {
    p.fontSize = parseFloat(size);
    learned.push(`اندازهٔ قلم رایج: ${size}`);
  }
  const formats = count(findAll(info.root, "Format").map((e) => textOf(e).trim()).filter((v) => v && !v.startsWith("=") && /[#0]/.test(v)));
  const fmt = top(formats);
  if (fmt) {
    p.numberFormat = fmt;
    learned.push(`قالب عدد: ${fmt}`);
  }

  if (info.page.width && info.page.height) {
    const hit = Object.entries(PAGE_SIZES).find(([, s]) => near(s.width, info.page.width, 0.3) && near(s.height, info.page.height, 0.3));
    if (hit) {
      p.page = hit[0];
      learned.push(`صفحه: ${hit[1].label}`);
    }
    if (info.page.left != null) p.margin = Math.round(Math.min(info.page.left, info.page.right || info.page.left) * 10) / 10;
  }

  const bgs = { header: [], total: [], group: [] };
  for (const t of info.tablixes) {
    const b = cellBackgrounds(t);
    bgs.header.push(...b.header);
    bgs.total.push(...b.total);
    bgs.group.push(...b.group);
  }
  const hb = top(count(bgs.header));
  const tb = top(count(bgs.total));
  const gb = top(count(bgs.group));
  if (hb) { p.headerBg = hb; learned.push(`رنگ سرآیند: ${hb}`); }
  if (tb) { p.totalBg = tb; learned.push(`رنگ جمع: ${tb}`); }
  if (gb && gb !== hb && gb !== tb) { p.groupBg = gb; learned.push(`رنگ گروه: ${gb}`); }

  const borders = count(findAll(info.root, "Border").map((b) => textOf(kid(b, "Color")).trim()).filter((c) => c && !c.startsWith("=")));
  const border = top(borders);
  if (border) p.borderColor = border;

  const sys = SYS_PARAMS.filter((s) => info.params.some((x) => x.name === s));
  p.sysParams = sys.length > 0;
  learned.push(sys.length ? `پارامترهای سیستمی: ${sys.length} از ${SYS_PARAMS.length}` : "پارامتر سیستمی Sys_* ندارد");
  p.utilFormat = info.codeModules.some((c) => /SG\.ReportingUtilities/i.test(c)) && /Code\.Util\.Format\s*\(/.test(text);
  if (p.utilFormat) learned.push("قالب‌بندی سازمانی Code.Util.Format به‌کار رفته");
  if (info.language) {
    p.language = info.language;
  }

  return { profile: { ...DEFAULT_PROFILE, ...p }, learned };
}
