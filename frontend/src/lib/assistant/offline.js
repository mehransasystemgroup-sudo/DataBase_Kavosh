/**
 * دستیار آفلاین — پاسخ بدون مدل زبانی و بدون کلید API.
 *
 * بخش بزرگی از پرسش‌های روزمره دربارهٔ ساختار است، نه دربارهٔ معنا:
 * «سند حسابداری چطور به طرف حساب وصل می‌شود؟»، «ستون‌های جدول کارمند»،
 * «مقادیر وضعیت سند»، «تعداد کارمندان به تفکیک واحد سازمانی». پاسخ همهٔ
 * این‌ها از قبل در دانش پایگاه داده هست: جست‌وجو، گراف JOIN، نام فارسی
 * ستون‌ها، مقادیر کددار و جدول‌های کد و شرح. این ماژول همان‌ها را کنار هم
 * می‌گذارد و کوئری را قاعده‌مند می‌سازد. کوئری ساخته‌شده هم مثل خروجی مدل
 * از بازبین ساختار (/assistant/check) رد می‌شود.
 *
 * فقط از مسیرهای عمومی برنامه استفاده می‌کند (/search، /table، /joinpath،
 * /lookups، /assistant/check)، پس روی دسکتاپ (سرور) و اندروید (ایندکس داخل
 * گوشی) یک کد است و یک رفتار.
 *
 * آنچه از توان قاعده بیرون است — جمع و میانگین، بازهٔ زمانی، شرط‌های
 * ترکیبی، مقایسه — «پیشرفته» علامت می‌خورد تا به مدل برود، یا اگر کلیدی
 * نیست، کاربر بداند پاسخ آفلاین فقط پایهٔ کوئری است.
 */

import { normalize } from "../textnorm.js";

// ───────────────────────── تشخیص خواسته ─────────────────────────

const P = {
  find: /(کدام جدول|چه جدولی|کدوم جدول|کجا ذخیره|کجا نگه|در کدام جدول|کجاست|دنبال جدول|جدول(ی)? (که|برای))/,
  codes: /(کد و شرح|مقادیر|مقدارهای|کدهای|کدها|کدینگ|enum|lookup|معنی کد|معنای کد|معنی عدد|حالت های|وضعیت های|انواع)/,
  columns: /(ستون|فیلد|field|column|ساختار جدول)/,
  relation: /(ارتباط|رابطه|روابط|پیوند|اتصال|وصل|مرتبط|join|جوین|مسیر)/,
  count: /(تعداد|چند تا|چندتا|شمارش|count)/,
  list: /(فهرست|لیست|نمایش|نشان بده|select|همه |کلیه|اطلاعات)/,
  // هرچه این‌ها را بخواهد، از توان قاعده بیرون است
  advanced: /(جمع|مجموع|میانگین|بیشترین|کمترین|حداکثر|حداقل|گردش|مانده|درصد|رتبه|مقایسه|روند|ماهانه|سالانه|به تفکیک ماه|سال جاری|امسال|پارسال|از تاریخ|تا تاریخ|بزرگ تر|کوچک تر|بیشتر از|کمتر از|تایید نشده|تأیید نشده|غیرفعال|sum|avg|having)/,
};

// واژه‌هایی که نام جدول نیستند؛ مثل خودِ پرسش نرمال می‌شوند
const NOISE = [
  "سال مالی جاری", "سال جاری", "ماه جاری", "امسال", "پارسال",
  "ارتباط", "رابطه", "روابط", "پیوند", "اتصال", "وصل", "مرتبط", "جوین", "join", "مسیر",
  "ستون های", "ستون ها", "ستونهای", "ستونها", "ستون", "فیلدهای", "فیلدها", "فیلد", "ساختار",
  "مقادیر", "مقدارهای", "مقدار", "کدهای", "کدها", "کد و شرح", "کدینگ", "معنی", "معنای", "انواع",
  "تعداد", "شمارش", "فهرست", "لیست", "نمایش", "نشان", "بده", "بنویس", "کوئری", "query",
  "جدول های", "جدولهای", "جدول", "کدام", "کدوم", "چه", "چطور", "چگونه", "چیست", "چیه",
  "کجاست", "کجا", "ذخیره", "نگه", "می شود", "میشود", "می شوند", "میشوند", "می کند", "میکند",
  "می دارد", "میدارد", "هست", "است", "هستند", "دارد", "دارند", "را", "رو", "به تفکیک",
  "برحسب", "بر حسب", "براساس", "بر اساس", "همه", "کلیه", "اطلاعات", "پیدا", "کن", "دنبال",
  "لطفا", "میخواهم", "می خواهم", "نیاز", "دارم", "چند تا", "چندتا", "چند", "هر", "تمام",
  "در", "از", "برای", "مربوط", "شده", "نام", "عنوان", "شان", "یشان", "اش", "که", "ای",
].map(normalize);

// جمع‌های مکسر و جمع‌هایی که با برداشتن پسوند درست نمی‌شوند
const SINGULAR = {
  اسناد: "سند", اقلام: "قلم", اشخاص: "شخص", افراد: "فرد", اموال: "مال", اقساط: "قسط",
  حسابها: "حساب", کالاها: "کالا", مراکز: "مرکز", وظایف: "وظیفه", مشتریان: "مشتری",
  کارکنان: "کارمند", کارمندان: "کارمند", پرسنل: "کارمند", دفاتر: "دفتر", شعب: "شعبه",
  انبارها: "انبار", فاکتورها: "فاکتور", قراردادها: "قرارداد", واحدها: "واحد",
};

const SEP_WORDS = ["و", "با", "به", "بین", "تا", "همراه", "به همراه", "به تفکیک", "برحسب",
  "بر حسب", "براساس", "بر اساس", "and", "with", "to", "per"];

const LATIN_TABLE = /\b([A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]{2,})\b/g;

function stripNoise(text) {
  let out = ` ${normalize(text).replace(/[؟?!.،,:؛«»"()]/g, " ")} `.replace(/\s+/g, " ");
  for (const w of [...NOISE].sort((a, b) => b.length - a.length)) {
    while (out.includes(` ${w} `)) out = out.replace(` ${w} `, " ");
  }
  return out.trim();
}

function splitParts(text) {
  let parts = [text];
  for (const sep of [...SEP_WORDS].sort((a, b) => b.length - a.length)) {
    parts = parts.flatMap((p) => ` ${p} `.split(` ${sep} `));
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

function singular(word) {
  if (SINGULAR[word]) return SINGULAR[word];
  for (const suf of ["های", "ها"]) {
    if (word.endsWith(suf) && word.length - suf.length >= 2) return word.slice(0, -suf.length);
  }
  if (word.endsWith("ان") && word.length > 4) return word.slice(0, -2);
  return word;
}

/** خواستهٔ پرسش، بی‌آنکه هنوز بدانیم دربارهٔ کدام جدول است. */
export function detectIntent(question) {
  const q = ` ${normalize(question)} `;
  const advanced = P.advanced.test(q);
  if (P.find.test(q)) return { kind: "find", advanced: false };
  if (P.codes.test(q) && !P.count.test(q)) return { kind: "codes", advanced: false };
  if (P.columns.test(q) && !P.count.test(q)) return { kind: "columns", advanced: false };
  if (P.count.test(q)) return { kind: "count", advanced };
  if (P.relation.test(q) && !P.list.test(q)) return { kind: "relation", advanced };
  if (P.list.test(q)) return { kind: "list", advanced };
  return { kind: "unknown", advanced };
}

// ───────────────────────── یافتن جدول‌ها ─────────────────────────

/** حافظهٔ پاسخ‌ها در طول یک پرسش؛ یک جدول چند بار لازم می‌شود. */
function cached(api) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; }));
    return memo.get(key);
  };
  return {
    search: (q, limit = 8) => once(`s:${q}:${limit}`, async () =>
      (await api.get("/search", { params: { q, limit } })).data.results || []),
    table: (name) => once(`t:${name}`, async () =>
      (await api.get(`/table/${encodeURIComponent(name)}`)).data),
    tableOrNull: (name) => once(`t?:${name}`, async () => {
      try {
        return (await api.get(`/table/${encodeURIComponent(name)}`)).data;
      } catch {
        return null;
      }
    }),
    get: (url, params) => api.get(url, { params }),
    post: (url, body) => api.post(url, body),
  };
}

/** بهترین جدول از میان جدول‌هایی که عنوانشان دقیقاً همین است. */
function pickAmong(hits) {
  return [...hits].sort((a, b) =>
    (b.has_data - a.has_data) || (b.in_live_db - a.in_live_db)
    || ((b.row_count || 0) - (a.row_count || 0)) || (b.score - a.score))[0];
}

function isExact(hit, phrase) {
  const name = hit.full_name.split(".").pop().toLowerCase();
  return normalize(hit.title_fa || "") === phrase || name === phrase.replace(/\s/g, "");
}

/**
 * جدولی که یک عبارت دقیقاً نامش است.
 *
 * عنوان دقیق بر امتیاز جست‌وجو مقدم است: «کارمندان» نباید به «کارمندان مرتبط
 * با سند» برسد وقتی جدولی به نام «کارمند» هست. نام‌های یکسان در چند ماژول
 * (GNR.Party و GNR3.Party) با داده‌دار بودن و شمار ردیف از هم جدا می‌شوند و
 * بقیه «شاید منظورتان…» می‌شوند.
 */
async function exactTable(kb, phrase) {
  const variants = [...new Set([phrase, phrase.split(" ").map(singular).join(" ")])];
  for (const v of variants) {
    if (v.length < 2) continue;
    const hits = await kb.search(v);
    const exact = hits.filter((h) => isExact(h, v));
    if (exact.length) {
      const best = pickAmong(exact);
      return {
        src: phrase, phrase: v, table: best.full_name, title: best.title_fa, exact: true,
        same: exact.map((h) => h.full_name),
        near: hits.map((h) => ({ table: h.full_name, title: h.title_fa })),
        alternatives: hits.filter((h) => h.full_name !== best.full_name).slice(0, 3)
          .map((h) => ({ table: h.full_name, title: h.title_fa })),
      };
    }
  }
  return null;
}

/**
 * جدول یک تکه از پرسش، و واژه‌هایی که از آن ماند.
 *
 * «وضعیت سند حسابداری» عنوان هیچ جدولی نیست؛ «سند حسابداری» هست و «وضعیت»
 * می‌شود سرنخِ ستون. «کارمندان واحد سازمانی» هم دو جدول است بی‌جداکننده.
 */
async function resolvePart(kb, part) {
  const words = part.split(" ").filter(Boolean);
  const whole = await exactTable(kb, words.join(" "));
  if (whole) return { found: [whole], rest: [] };

  // بلندترین زیرعبارتِ پیوسته که عنوان دقیق یک جدول است
  for (let len = words.length - 1; len >= 1; len -= 1) {
    for (let start = 0; start + len <= words.length; start += 1) {
      const hit = await exactTable(kb, words.slice(start, start + len).join(" "));
      if (!hit) continue;
      const before = words.slice(0, start).join(" ");
      const after = words.slice(start + len).join(" ");
      const out = { found: [hit], rest: [] };
      for (const side of [before, after]) {
        if (!side) continue;
        const sub = await resolvePart(kb, side);
        out.found.push(...sub.found);
        out.rest.push(...sub.rest);
      }
      return out;
    }
  }

  // هیچ عنوان دقیقی نبود: بهترین نتیجهٔ جست‌وجو، اگر قوی باشد
  const text = words.map(singular).join(" ");
  const hits = text.length >= 2 ? await kb.search(text) : [];
  const top = hits[0];
  if (top && top.score >= 15) {
    return {
      found: [{
        src: words.join(" "), phrase: text, table: top.full_name, title: top.title_fa, exact: false,
        alternatives: hits.slice(1, 4).map((h) => ({ table: h.full_name, title: h.title_fa })),
      }],
      rest: [],
    };
  }
  return { found: [], rest: words };
}

/** جدول‌های نام‌برده در پرسش به ترتیب آمدن، و واژه‌هایی که جدول نبودند. */
export async function findTables(api, question, pinned = [], kb = cached(api)) {
  const found = [];
  const rest = [];
  const add = (r) => {
    if (r && !found.some((f) => f.table === r.table)) found.push(r);
  };

  // ۱) نام لاتین صریح (FIN3.Voucher یا Voucher)
  for (const m of question.matchAll(LATIN_TABLE)) {
    const name = m[1];
    const t = name.includes(".") ? await kb.tableOrNull(name) : null;
    if (t) add({ phrase: name, table: t.full_name, title: t.title_fa, exact: true, alternatives: [] });
    else add((await resolvePart(kb, name.toLowerCase())).found[0]);
  }

  // ۲) عبارت‌های فارسی، جدا شده با «و / با / به / بین …»
  const persian = question.replace(LATIN_TABLE, " ");
  for (const part of splitParts(stripNoise(persian))) {
    const r = await resolvePart(kb, part);
    r.found.forEach(add);
    rest.push(...r.rest);
  }

  // ترتیب آمدن در پرسش: «تعداد کارمندان به تفکیک واحد» یعنی کارمند اول، واحد دوم
  const q = normalize(question);
  const at = (f) => {
    const i = q.indexOf(normalize(f.src || f.phrase));
    return i < 0 ? Infinity : i;
  };
  found.sort((x, y) => at(x) - at(y));

  // هم‌نام در چند نسل ماژول (GNR.Party و GNR3.Party): همان نسلی که جدول‌های دیگر پرسش از آن‌اند
  const gen = (name) => name.split(".")[0].match(/\d*$/)[0];
  for (const f of found) {
    if (!f.same || f.same.length < 2) continue;
    const others = new Set(found.filter((o) => o !== f).map((o) => gen(o.table)));
    if (!others.size || others.has(gen(f.table))) continue;
    const match = f.same.find((n) => others.has(gen(n)));
    if (match) {
      f.alternatives = [{ table: f.table, title: f.title }, ...f.alternatives.filter((a) => a.table !== match)];
      f.table = match;
    }
  }

  // ۳) جدول‌های سنجاق‌شده، اگر پرسش خودش جدولی نگفته
  for (const name of pinned) {
    if (found.length >= 1) break;
    const t = await kb.tableOrNull(name);
    if (t) add({ phrase: name, table: t.full_name, title: t.title_fa, exact: true, alternatives: [] });
  }
  return { found, rest };
}

// ───────────────────────── مسیر پیوند ─────────────────────────

const edgeOf = (j) => ({
  from_table: j.from_table, from_col: j.from_col, to_table: j.to_table, to_col: j.to_col,
  verified: j.verified,
});

// ستون‌های ثبت سیستمی (چه کسی ساخت/تغییر داد)؛ پیوند معنایی نیستند
const AUDIT_COL = /^(Creator|LastModifier|Modifier|CreatorRef|LastModifierRef)$/i;
// جدول‌های جانبی که واسط خوبی برای پاسخ نیستند
const SIDE_TABLE = /(DataAccess|Access$|Log$|History$|Temp|^Batch|Audit|Offline|Draft|Archive|Backup)/;

/** فقط در جهت ارجاع (فرزند → مرجع): هر ردیف حداکثر یک جفت دارد، پس تکثیر نمی‌شود. */
async function forwardPath(kb, source, target, maxDepth = 3, maxNodes = 160) {
  const prev = new Map([[source, null]]);
  let frontier = [source];
  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const next = [];
    for (const name of frontier) {
      const t = await kb.tableOrNull(name);
      for (const j of t?.outgoing || []) {
        if (prev.has(j.to_table) || AUDIT_COL.test(j.from_col)) continue;
        prev.set(j.to_table, edgeOf(j));
        if (j.to_table === target) {
          const steps = [];
          for (let cur = target; prev.get(cur); cur = prev.get(cur).from_table) steps.unshift(prev.get(cur));
          return steps;
        }
        next.push(j.to_table);
        if (prev.size > maxNodes) return null;
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * جدول واسطی که به هر دو ارجاع می‌دهد (الف ← واسط → ب).
 *
 * «سند و طرف حساب» این‌طور به هم می‌رسند: قلم سند هم به سند ارجاع دارد هم
 * به طرف حساب. واسطی که نامش با نام یکی از دو جدول شروع می‌شود (VoucherItem
 * برای Voucher) تقریباً همیشه همان است که کاربر منظور دارد.
 */
async function hubPath(kb, a, b) {
  const A = await kb.table(a);
  const aName = a.split(".").pop();
  const bName = b.split(".").pop();
  const candidates = [];
  for (const inc of (A.incoming || []).slice(0, 80)) {
    const C = await kb.tableOrNull(inc.from_table);
    const toB = C?.outgoing.find((j) => j.to_table === b);
    if (!toB) continue;
    if (AUDIT_COL.test(inc.from_col)) continue;
    const cName = inc.from_table.split(".").pop();
    // ستون ارجاعی که دقیقاً به نام جدول است (EmployeeRef، نه ConfirmerRef)
    const toBCol = C.outgoing.find((j) => j.to_table === b && j.from_col === `${bName}Ref`) || toB;
    candidates.push({
      steps: [edgeOf(inc), edgeOf(toBCol)],
      rank: [
        cName.startsWith(aName) || cName.startsWith(bName) ? 1 : 0,
        SIDE_TABLE.test(cName) ? 0 : 1,
        (inc.from_col === `${aName}Ref` ? 1 : 0) + (toBCol.from_col === `${bName}Ref` ? 1 : 0),
        C.has_data ? 1 : 0,
        -cName.length, // VoucherItem پیش از VoucherItemReference
        C.row_count || 0,
      ],
    });
  }
  const cmp = (x, y) => {
    for (let i = 0; i < x.rank.length; i += 1) if (y.rank[i] !== x.rank[i]) return y.rank[i] - x.rank[i];
    return 0;
  };
  candidates.sort(cmp);
  const best = candidates[0];
  return best ? { steps: best.steps, strong: best.rank[0] === 1 && best.rank[1] === 1 } : null;
}

/** بهترین مسیر میان دو جدول، و اینکه آیا ردیف‌ها ممکن است تکرار شوند. */
async function bestPath(kb, a, b) {
  const fwd = await forwardPath(kb, a, b);
  // ارجاع مستقیم همیشه بهترین است
  if (fwd?.length === 1) return { steps: fwd, fanout: false, how: "forward" };
  // «سند ← قلم سند → طرف حساب» از «سند → شعبه → شرکت → طرف حساب» معنادارتر است
  const hub = (await hubPath(kb, a, b)) || (await hubPath(kb, b, a));
  if (hub?.strong) return { steps: hub.steps, fanout: true, how: "hub" };
  if (fwd) return { steps: fwd, fanout: false, how: "forward" };
  const back = await forwardPath(kb, b, a);
  if (back) return { steps: back, fanout: true, how: "backward" };
  if (hub) return { steps: hub.steps, fanout: true, how: "hub" };
  const { data } = await kb.get("/joinpath", { source: a, target: b, maxHops: 4 });
  if (data.found) return { steps: data.steps.map(edgeOf), fanout: true, how: "graph", warning: data.warning };
  return null;
}

// ───────────────────────── ساخت SQL ─────────────────────────

const br = (name) => name.split(".").map((p) => `[${p}]`).join(".");

/** ستون‌هایی که یک انسان در فهرست می‌خواهد ببیند: شناسه، کد، عنوان، تاریخ. */
function displayColumns(table, max = 4) {
  const cols = table.columns || [];
  const pk = cols.find((c) => c.is_pk);
  const score = (c) => {
    const n = c.name;
    if (/Ref$|^Creator$|^LastModifier$|Version$|Timestamp|_En$|FileName|Attachment|Password|SecondLanguage/i.test(n)) return -1;
    if (/^(Title|Name|FullName)$/i.test(n)) return 6;
    if (/(Title|Name|Description)$/i.test(n)) return 5;
    if (/^(Code|Number|No|DailyNumber)$/i.test(n) || /Code$/i.test(n)) return 4;
    if (/Date$/i.test(n) && !/Modification|Creation/i.test(n)) return 3;
    if (/^(State|Status|Type)$/i.test(n)) return 2;
    return 0;
  };
  const picked = cols.filter((c) => !c.is_pk && score(c) > 0)
    .sort((a, b) => score(b) - score(a) || a.ordinal - b.ordinal)
    .slice(0, max - (pk ? 1 : 0));
  return [...(pk ? [pk] : []), ...picked];
}

/** ستونی که «نام» یک ردیف را می‌گوید — برای گروه‌بندی و نمایش جدول مرجع. */
function nameColumn(table) {
  const cols = table.columns || [];
  return cols.find((c) => /^(Title|Name|FullName)$/i.test(c.name))
    || cols.find((c) => /(Title|Name)$/i.test(c.name) && !/_En$|FileName|SecondLanguage/i.test(c.name))
    || cols.find((c) => /^(Code|Number)$/i.test(c.name))
    || cols.find((c) => c.is_pk);
}

/**
 * زنجیرهٔ JOIN.
 *
 * هر گام از جدول دارندهٔ ستون ارجاع (from) به جدول مرجع (to) نوشته شده،
 * ولی مسیر ممکن است در هر دو جهت از آن رد شود؛ جهت با جدولی تعیین می‌شود
 * که از قبل در کوئری هست.
 */
function joinChain(source, steps) {
  const alias = new Map([[source, "t0"]]);
  const lines = [];
  for (const s of steps) {
    const known = alias.has(s.from_table) ? s.from_table : s.to_table;
    const next = known === s.from_table ? s.to_table : s.from_table;
    if (alias.has(next)) continue;
    const a = `t${alias.size}`;
    alias.set(next, a);
    lines.push(
      `LEFT JOIN ${br(next)} AS ${a}\n    ON ${alias.get(s.from_table)}.[${s.from_col}] = ${alias.get(s.to_table)}.[${s.to_col}]`,
    );
  }
  return { alias, lines };
}

/** سال مالی روی جدول اصلی، وگرنه روی نخستین جدولی که دارد. */
function fiscalFilter(tables, alias) {
  for (const t of tables) {
    if ((t.columns || []).some((c) => c.name === "FiscalYearRef")) {
      return { where: `${alias.get(t.full_name)}.[FiscalYearRef] = @FiscalYearRef`, table: t.full_name };
    }
  }
  return null;
}

const comment = (c) => (c.label_fa ? ` -- ${c.label_fa}` : "");

/** ستون‌های SELECT با ویرگول درست و توضیح فارسی هر ستون. */
function selectList(items) {
  return items.map(({ expr, col }, i) => `    ${expr}${i < items.length - 1 ? "," : ""}${col ? comment(col) : ""}`);
}

const stepLine = (s, i) => `${i + 1}. \`${s.from_table}.${s.from_col}\` = \`${s.to_table}.${s.to_col}\`${s.verified === false ? " (تأییدنشده)" : ""}`;
const joinText = (s) => `${s.from_table}.${s.from_col} = ${s.to_table}.${s.to_col}`;
const nameOf = (t) => `**${t.full_name}**${t.title_fa ? ` (${t.title_fa})` : ""}`;

// ───────────────────────── پاسخ‌ها ─────────────────────────

async function check(kb, sql) {
  try {
    return (await kb.post("/assistant/check", { sql })).data;
  } catch {
    return null;
  }
}

function result(fields) {
  return {
    type: "result", offline: true, kind: "query", sql: "", note: "", attempts: 0,
    tables: [], joins: [], intent: null, check: null, choices: [], ...fields,
  };
}

/**
 * «شاید منظورتان…»: هر پیشنهاد همان پرسش است با جدول دیگر. برای عبارتی که
 * عنوان دقیق یک جدول بود فقط هم‌نام‌ها (همان عنوان در ماژول دیگر) پیشنهاد
 * می‌شوند؛ پیشنهادِ جدول‌های فقط شبیه، کنار پاسخ درست، شلوغی است.
 */
function choicesFrom(question, found) {
  const q = normalize(question);
  return found.flatMap((f) => {
    const others = f.exact
      ? (f.same || []).filter((t) => t !== f.table).map((t) => ({ table: t, title: f.title }))
      : f.alternatives;
    const src = normalize(f.src || f.phrase);
    return others.map((a) => ({
      label: `${a.table}${a.title ? ` — ${a.title}` : ""}`,
      question: q.includes(src) ? q.replace(src, a.table) : `${q} ${a.table}`,
      instead: f.table,
    }));
  }).slice(0, 4);
}

async function answerRelations(kb, t) {
  const out = t.outgoing.slice(0, 20).map((j) => `- \`${j.from_col}\` ← **${j.to_table}**`);
  const inc = t.incoming.slice(0, 20).map((j) => `- **${j.from_table}** از راه \`${j.from_col}\``);
  const note = [
    `### برداشت\nروابط جدول ${nameOf(t)}.`,
    out.length ? `### جدول‌های مرجع (این جدول به آن‌ها ارجاع می‌دهد)\n${out.join("\n")}` : "",
    inc.length ? `### جدول‌های وابسته (به این جدول ارجاع می‌دهند)\n${inc.join("\n")}${t.incoming.length > 20 ? `\n- و ${t.incoming.length - 20} جدول دیگر` : ""}` : "",
    "### نکته‌ها\n- برای کوئری میان دو جدول، هر دو را نام ببرید؛ مثلاً «ارتباط سند حسابداری و طرف حساب».",
  ].filter(Boolean).join("\n\n");
  return result({ kind: "relations", note, tables: [t.full_name] });
}

/**
 * جدول‌های دیگری که همان عبارت می‌تواند نامشان باشد: هم‌نام‌ها، و عنوان‌هایی
 * که با عبارت شروع می‌شوند («قلم سند» ← «قلم سند حسابداری»).
 */
function readingsOf(f) {
  const starts = (f.near || f.alternatives).filter((x) => normalize(x.title || "").startsWith(f.phrase)).map((x) => x.table);
  return [...new Set([f.table, ...(f.same || []), ...starts])].slice(0, 5);
}

/**
 * برداشتی از دو عبارت که میانشان مسیر معنادار هست. مسیر «گراف» (کوتاه‌ترین
 * راه از هر جدولی) ضعیف است؛ تا وقتی برداشت دیگری مسیر مستقیم، واسط یا
 * ارجاعی بدهد، به آن بسنده نمی‌شود.
 */
async function connectReadings(kb, a, b) {
  const first = await bestPath(kb, a.table, b.table);
  if (first && first.how !== "graph") return { path: first, a: a.table, b: b.table };
  let weak = first ? { path: first, a: a.table, b: b.table } : null;
  let tries = 0;
  for (const x of readingsOf(a)) {
    for (const y of readingsOf(b)) {
      if ((x === a.table && y === b.table) || x === y) continue;
      if (++tries > 12) return weak;
      const path = await bestPath(kb, x, y);
      if (path && path.how !== "graph") return { path, a: x, b: y };
      if (path && !weak) weak = { path, a: x, b: y };
    }
  }
  return weak;
}

async function answerPair(kb, question, found, intent) {
  let [a, b] = found;
  const link = await connectReadings(kb, a, b);
  const path = link?.path;
  const reread = [];
  if (link && link.a !== a.table) {
    reread.push(`«${a.phrase}» به **${link.a}** تعبیر شد، چون **${a.table}** به دیگری راه ندارد.`);
    a = { ...a, table: link.a };
  }
  if (link && link.b !== b.table) {
    reread.push(`«${b.phrase}» به **${link.b}** تعبیر شد، چون **${b.table}** به دیگری راه ندارد.`);
    b = { ...b, table: link.b };
  }
  if (!path) {
    return result({
      kind: "no_path", tables: [a.table, b.table],
      note: `### برداشت\nمسیر پیوند میان **${a.table}** و **${b.table}**.\n\n### راهکار\n- در دانش پایگاه داده تا ۴ گام مسیری میان این دو جدول نیست.\n- شاید منظورتان جدول دیگری بوده؛ یکی از پیشنهادها را بزنید، یا «مسیریاب پیوند» صفحهٔ جدول را با گام بیشتر بیازمایید.`,
      choices: choicesFrom(question, found),
    });
  }

  const { alias, lines } = joinChain(a.table, path.steps);
  const tables = [];
  for (const name of alias.keys()) tables.push(await kb.table(name));
  const first = tables[0];
  const last = tables.find((t) => t.full_name === b.table) || tables[tables.length - 1];
  const la = alias.get(last.full_name);
  const fy = fiscalFilter(tables, alias);
  const where = fy ? [`WHERE ${fy.where}`] : [];

  let sql;
  let what;
  if (intent.kind === "count") {
    const name = nameColumn(last);
    // از راه جدول وابسته هر ردیف چند بار می‌آید؛ شمارش یکتا روی کلید اصلی
    const pk = (first.columns || []).find((c) => c.is_pk);
    const countExpr = path.fanout && pk ? `COUNT(DISTINCT t0.[${pk.name}])` : "COUNT(*)";
    sql = [
      "SELECT",
      ...selectList([{ expr: `${la}.[${name.name}]`, col: name }, { expr: `${countExpr} AS [Count]` }]),
      `FROM ${br(a.table)} AS t0`, ...lines, ...where,
      `GROUP BY ${la}.[${name.name}]`,
      `ORDER BY ${countExpr} DESC`,
    ].join("\n");
    what = `تعداد ${nameOf(first)} به تفکیک ${nameOf(last)}`;
  } else {
    const items = [
      ...displayColumns(first, 3).map((c) => ({ expr: `t0.[${c.name}]`, col: c })),
      ...displayColumns(last, 3).filter((c) => !c.is_pk || intent.kind === "relation")
        .map((c) => ({ expr: `${la}.[${c.name}]`, col: c })),
    ];
    sql = ["SELECT TOP (100)", ...selectList(items), `FROM ${br(a.table)} AS t0`, ...lines, ...where].join("\n");
    what = intent.kind === "relation"
      ? `پیوند ${nameOf(first)} با ${nameOf(last)} در ${path.steps.length} گام`
      : `فهرست ${nameOf(first)} همراه با ${nameOf(last)}`;
  }

  const notes = reread.map((r) => `- ${r}`);
  if (path.how === "hub") {
    const hub = path.steps[0].from_table === a.table || path.steps[0].to_table === a.table
      ? (path.steps[0].from_table === a.table ? path.steps[0].to_table : path.steps[0].from_table) : "";
    notes.push(`- این دو جدول مستقیم به هم ارجاع ندارند؛ از راه **${hub || "جدول واسط"}** که به هر دو ارجاع دارد به هم رسیدند.`);
  }
  if (path.fanout) notes.push("- مسیر از جدول وابسته می‌گذرد؛ هر ردیف ممکن است چند بار تکرار شود. اگر فقط ردیف‌های یکتا لازم است، DISTINCT یا GROUP BY بگذارید.");
  else notes.push("- LEFT JOIN است تا ردیفِ بی‌مرجع هم بماند؛ اگر فقط ردیف‌های دارای مرجع را می‌خواهید، INNER JOIN کنید.");
  if (path.how === "graph") notes.push("- این مسیر کوتاه‌ترین راه در گراف است، نه لزوماً معنادارترینش؛ پیش از اجرا بسنجید.");
  if (fy) notes.push(`- ${fy.table} ستون سال مالی دارد؛ \`@FiscalYearRef\` را مقدار بدهید وگرنه نتیجه همهٔ سال‌ها را قاطی می‌کند.`);
  if (path.warning) notes.push(`- ${path.warning}`);
  if (intent.advanced) notes.push("- پرسش شرط یا محاسبه‌ای دارد که پاسخ آفلاین لحاظش نکرده؛ این کوئری فقط پایه است. برای پاسخ کامل، دستیار هوشمند (با کلید API) را به کار بگیرید.");

  const note = [
    `### برداشت\n${what}.`,
    `### مراحل\n${path.steps.map(stepLine).join("\n")}`,
    `### نکته‌ها\n${notes.join("\n")}`,
  ].join("\n\n");
  return result({
    kind: "query", sql, note, tables: [...alias.keys()], joins: path.steps.map(joinText),
    check: await check(kb, sql), choices: choicesFrom(question, found),
  });
}

async function answerColumns(kb, question, found) {
  const t = await kb.table(found[0].table);
  const fk = new Map(t.outgoing.map((j) => [j.from_col, j.to_table]));
  const lines = t.columns.slice(0, 80).map((c) => {
    const tags = [c.is_pk ? "کلید اصلی" : "", fk.has(c.name) ? `ارجاع به ${fk.get(c.name)}` : "", c.nullable ? "" : "اجباری"]
      .filter(Boolean).join("، ");
    return `- \`${c.name}\` (${c.type})${c.label_fa ? ` — ${c.label_fa}` : ""}${tags ? ` · ${tags}` : ""}`;
  });
  const sql = ["SELECT TOP (100)", ...selectList(t.columns.map((c) => ({ expr: `t0.[${c.name}]`, col: c }))),
    `FROM ${br(t.full_name)} AS t0`].join("\n");
  const note = [
    `### برداشت\nستون‌های جدول ${nameOf(t)} — ${t.columns.length} ستون.`,
    `### ستون‌ها\n${lines.join("\n")}${t.columns.length > 80 ? `\n- و ${t.columns.length - 80} ستون دیگر` : ""}`,
    t.warnings?.length ? `### نکته‌ها\n${t.warnings.map((w) => `- ${w}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return result({ kind: "columns", sql, note, tables: [t.full_name], check: await check(kb, sql), choices: choicesFrom(question, found) });
}

const sqlLiteral = (v) => (/^-?\d+$/.test(String(v)) ? String(v) : `N'${String(v).replace(/'/g, "''")}'`);

async function answerCodes(kb, question, found, rest) {
  const hint = rest.join(" ");
  if (found.length) {
    const t = await kb.table(found[0].table);
    const enums = Object.entries(t.enums || {});
    if (enums.length) {
      // ستونی که پرسش به نامش (فارسی یا لاتین) اشاره کرده، وگرنه همه
      const byCol = new Map(t.columns.map((c) => [c.name, c]));
      const q = normalize(question);
      const named = enums.filter(([col]) => {
        const label = normalize(byCol.get(col)?.label_fa || "");
        return q.includes(col.toLowerCase()) || (label && (q.includes(label) || (hint && label.includes(hint))));
      });
      const chosen = named.length ? named : enums;
      const blocks = chosen.map(([col, values]) => {
        const c = byCol.get(col);
        return `### ${col}${c?.label_fa ? ` — ${c.label_fa}` : ""}\n${values.map((v) => `- \`${v.value}\` = ${v.label_fa || "؟"}`).join("\n")}`;
      });
      const pk = t.columns.find((c) => c.is_pk);
      const items = [
        ...(pk ? [{ expr: `t0.[${pk.name}]`, col: pk }] : []),
        ...chosen.map(([col]) => ({ expr: `t0.[${col}]`, col: byCol.get(col) })),
        ...chosen.map(([col, values]) => ({
          expr: [`CASE t0.[${col}]`,
            ...values.map((v) => `        WHEN ${sqlLiteral(v.value)} THEN N'${String(v.label_fa || v.value).replace(/'/g, "''")}'`),
            `    END AS [${col}Title]`].join("\n"),
        })),
      ];
      const sql = ["SELECT TOP (100)", ...selectList(items), `FROM ${br(t.full_name)} AS t0`].join("\n");
      const note = [
        `### برداشت\nمقادیر کددار جدول ${nameOf(t)}${named.length ? "" : " (همهٔ ستون‌های کددار)"}.`,
        ...blocks,
        "### نکته‌ها\n- کوئری زیر هر کد را با CASE به شرح فارسی‌اش تبدیل می‌کند.",
      ].join("\n\n");
      return result({ kind: "codes", sql, note, tables: [t.full_name], check: await check(kb, sql), choices: choicesFrom(question, found) });
    }
    if (found[0].exact && !hint) {
      // خودِ جدول یک جدول مرجع است (مثل «نوع سند»): ردیف‌هایش همان کد و شرح‌اند
      const items = displayColumns(t, 4).map((c) => ({ expr: `t0.[${c.name}]`, col: c }));
      const sql = ["SELECT", ...selectList(items), `FROM ${br(t.full_name)} AS t0`, `ORDER BY t0.[${items[0].col.name}]`].join("\n");
      const note = `### برداشت\n${nameOf(t)} خودش جدول مرجع است؛ کد و شرح‌ها ردیف‌های همین جدول‌اند و در دانش ثابت ثبت نشده‌اند.\n\n### نکته‌ها\n- کوئری زیر ردیف‌هایش را با شناسه و عنوان برمی‌گرداند.`;
      return result({ kind: "codes", sql, note, tables: [t.full_name], check: await check(kb, sql), choices: choicesFrom(question, found) });
    }
  }

  // جدول‌های کد و شرحی (lookup)
  const phrase = [hint, ...found.map((f) => f.phrase)].filter(Boolean).join(" ") || stripNoise(question);
  if (!phrase) return null;
  const { data } = await kb.get("/lookups", { q: phrase, limit: 6 });
  const types = data.types || [];
  if (!types.length) return null;
  const exact = types.find((t) => normalize(t.title_fa || "") === phrase) || types[0];
  const { data: lk } = await kb.get(`/lookup/${encodeURIComponent(exact.type)}`);
  const values = (lk.values || []).slice(0, 60);
  const others = types.filter((t) => t.type !== exact.type).slice(0, 4);
  const note = [
    `### برداشت\nجدول کد و شرحی **${lk.type}**${lk.title_fa ? ` (${lk.title_fa})` : ""} — ${values.length} مقدار.`,
    `### مقادیر\n${values.map((v) => `- \`${v.code}\` = ${v.value}`).join("\n")}`,
    others.length ? `### نکته‌ها\n- نوع‌های مشابه دیگر: ${others.map((t) => `\`${t.type}\`${t.title_fa ? ` (${t.title_fa})` : ""}`).join("، ")}` : "",
  ].filter(Boolean).join("\n\n");
  return result({ kind: "codes", note });
}

async function answerFind(kb, question) {
  const phrase = stripNoise(question).split(" ").map(singular).join(" ");
  const hits = phrase ? await kb.search(phrase, 8) : [];
  if (!hits.length) return null;
  const note = [
    `### برداشت\nجدول‌هایی که با «${phrase}» جور درمی‌آیند.`,
    `### جدول‌ها\n${hits.map((h, i) => `${i + 1}. **${h.full_name}**${h.title_fa ? ` — ${h.title_fa}` : ""} · ${h.has_data ? `${h.row_count ?? ""} ردیف` : "بی‌داده در این نصب"}`).join("\n")}`,
    "### نکته‌ها\n- روی هر جدول بزنید تا جزئیاتش باز شود؛ یا بپرسید «ستون‌های …» یا «ارتباط … و …».",
  ].join("\n\n");
  return result({ kind: "find", note, tables: hits.map((h) => h.full_name) });
}

async function answerSingle(kb, question, intent, found) {
  const t = await kb.table(found[0].table);
  const alias = new Map([[t.full_name, "t0"]]);
  const fy = fiscalFilter([t], alias);
  const where = fy ? [`WHERE ${fy.where}`] : [];
  let sql;
  let what;
  if (intent.kind === "count") {
    sql = ["SELECT COUNT(*) AS [Count]", `FROM ${br(t.full_name)} AS t0`, ...where].join("\n");
    what = `تعداد ردیف‌های ${nameOf(t)}`;
  } else {
    // ستون‌های ارجاع به جدول‌های مرجعِ عنوان‌دار، با نامشان کنار شناسه
    const items = displayColumns(t, 4).map((c) => ({ expr: `t0.[${c.name}]`, col: c }));
    const lines = [];
    for (const j of t.outgoing.slice(0, 12)) {
      if (lines.length >= 2 || /^(Creator|LastModifier)$/.test(j.from_col)) continue;
      const parent = await kb.tableOrNull(j.to_table);
      const name = parent && nameColumn(parent);
      if (!name || name.is_pk) continue;
      const a = `t${lines.length + 1}`;
      lines.push(`LEFT JOIN ${br(j.to_table)} AS ${a}\n    ON t0.[${j.from_col}] = ${a}.[${j.to_col}]`);
      items.push({ expr: `${a}.[${name.name}] AS [${j.from_col.replace(/Ref$/, "")}${name.name}]`, col: { label_fa: `${parent.title_fa || j.to_table}: ${name.label_fa || name.name}` } });
    }
    sql = ["SELECT TOP (100)", ...selectList(items), `FROM ${br(t.full_name)} AS t0`, ...lines, ...where].join("\n");
    what = `فهرست ${nameOf(t)}${lines.length ? " با نام جدول‌های مرجع اصلی" : ""}`;
  }
  const notes = [];
  if (fy) notes.push("- این جدول ستون سال مالی دارد؛ `@FiscalYearRef` را مقدار بدهید.");
  for (const w of t.warnings || []) if (!/FiscalYearRef/.test(w)) notes.push(`- ${w}`);
  if (!t.has_data) notes.push("- این جدول در نصب فعلی داده ندارد؛ شاید منظورتان جدول دیگری است.");
  if (intent.advanced) notes.push("- پرسش شرط یا محاسبه‌ای دارد که پاسخ آفلاین لحاظش نکرده؛ این کوئری فقط پایه است. برای پاسخ کامل، دستیار هوشمند (با کلید API) را به کار بگیرید.");
  const note = [`### برداشت\n${what}.`, notes.length ? `### نکته‌ها\n${notes.join("\n")}` : ""].filter(Boolean).join("\n\n");
  return result({ kind: "query", sql, note, tables: [t.full_name], check: await check(kb, sql), choices: choicesFrom(question, found) });
}

/**
 * پاسخ آفلاین به یک پرسش.
 *
 * خروجی `{ handled, advanced, result?, reason? }`. `advanced` یعنی پرسش
 * چیزی می‌خواهد که قاعده نمی‌تواند (جمع، بازهٔ زمانی، شرط) — اگر کلید
 * هست، بهتر است به مدل برود؛ اگر نیست، پاسخ آفلاین پایهٔ کوئری را می‌دهد.
 */
export async function answerOffline(api, question, { pinned = [] } = {}) {
  const intent = detectIntent(question);
  return { ...(await route(api, question, pinned, intent)), intent: intent.kind };
}

async function route(api, question, pinned, intent) {
  const kb = cached(api);
  try {
    if (intent.kind === "find") {
      const r = await answerFind(kb, question);
      return r ? { handled: true, advanced: false, result: r } : { handled: false, advanced: false, reason: "no_table" };
    }
    const { found, rest } = await findTables(api, question, pinned, kb);

    if (intent.kind === "codes") {
      const r = await answerCodes(kb, question, found, rest);
      if (r) return { handled: true, advanced: false, result: r };
    }
    if (!found.length) return { handled: false, advanced: intent.advanced, reason: "no_table" };

    let r;
    if (intent.kind === "columns") r = await answerColumns(kb, question, found);
    else if (found.length >= 2) {
      r = await answerPair(kb, question, found, intent);
      // بی‌مسیر در پرسش پیشرفته: دست‌کم پایهٔ کوئری روی جدول اصلی
      if (r.kind === "no_path" && intent.advanced) r = await answerSingle(kb, question, intent, found);
    }
    else if (intent.kind === "relation") r = await answerRelations(kb, await kb.table(found[0].table));
    else r = await answerSingle(kb, question, intent, found);
    return { handled: true, advanced: intent.advanced, result: r };
  } catch (e) {
    return { handled: false, advanced: intent.advanced, reason: "error", error: e?.message || String(e) };
  }
}

/** پرسش‌های نمونه‌ای که بی‌کلید پاسخ دارند. */
export const OFFLINE_SAMPLES = [
  "ارتباط سند حسابداری و طرف حساب",
  "ستون‌های جدول کارمند",
  "مقادیر وضعیت سند حسابداری",
  "تعداد کارمندان به تفکیک واحد سازمانی",
  "کدام جدول سوابق تحصیلی را نگه می‌دارد؟",
];
