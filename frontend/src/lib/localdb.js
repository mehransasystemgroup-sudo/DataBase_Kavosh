/**
 * موتور کاوش روی دستگاه — همتای backend/core/search.py.
 *
 * در نسخهٔ موبایل سروری در کار نیست: همان ایندکس SQLite داخل بسته می‌آید و
 * با SQLite رسمی (WebAssembly) در خود برنامه باز می‌شود. پرس‌وجوها همان
 * پرس‌وجوهای سرور است، پس نتیجهٔ جست‌وجو و رتبه‌بندی دقیقاً یکی است.
 */

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import {
  askAssistant, checkQuery, getSettings, invalidateSchemaIndex, putSettings, testSettings,
} from "./assistant/mobile.js";
import { buildSearchText, normalize, stemFa } from "./textnorm.js";

// نگاشت دستهٔ نوع فیلد → الگوهای LIKE روی ستون type
const FIELD_TYPE_PATTERNS = {
  int: ["int", "bigint", "smallint", "tinyint"],
  decimal: ["decimal", "numeric", "money", "float", "real"],
  varchar: ["char", "text", "string"],
  datetime: ["date", "time"],
  bit: ["bit", "bool"],
  uniqueidentifier: ["uniqueidentifier", "guid", "uuid"],
  binary: ["binary", "image", "blob"],
};

// دانشی که کاربر روی همین دستگاه ثبت می‌کند؛ با هر بار باز شدن برنامه دوباره
// روی ایندکس نوشته می‌شود، چون ایندکس داخل بسته فقط‌خواندنی است.
const LEARNED_KEY = "kavosh.learned.v1";

const bracket = (fullName) =>
  fullName.split(".").map((part) => `[${part}]`).join(".");

const stepSql = (s) =>
  `LEFT JOIN ${bracket(s.to_table)}\n    ON ${bracket(s.from_table)}.[${s.from_col}] ` +
  `= ${bracket(s.to_table)}.[${s.to_col}]`;

const stepDict = (s) => ({ ...s, sql: stepSql(s) });

/** شرط SQL برای فیلتر نوع ستون — دسته‌های شناخته‌شده یا متن آزاد. */
function typeClause(fieldType) {
  const key = fieldType.trim().toLowerCase();
  const patterns = FIELD_TYPE_PATTERNS[key] || [key];
  const clause = patterns.map(() => "lower(c.type) LIKE ?").join(" OR ");
  return [`(${clause})`, patterns.map((p) => `%${p}%`)];
}

export class KnowledgeBase {
  constructor(sqlite3, db) {
    this.sqlite3 = sqlite3;
    this.db = db;
    this._adj = null;
  }

  all(sql, bind = []) {
    return this.db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
  }

  one(sql, bind = []) {
    return this.all(sql, bind)[0] ?? null;
  }

  run(sql, bind = []) {
    this.db.exec({ sql, bind });
  }

  // ─────────────────────── ثبت دانش ───────────────────────

  applyLearned(kind, payload) {
    if (kind === "table") {
      const full = payload.full_name;
      const sets = [];
      const values = [];
      for (const column of ["title_fa", "description_fa"]) {
        if (payload[column]) {
          sets.push(`${column} = ?`);
          values.push(payload[column]);
        }
      }
      if (!sets.length) return;
      this.run(`UPDATE tables SET ${sets.join(", ")} WHERE full_name = ?`, [...values, full]);
      const row = this.one(
        "SELECT schema, name, title_fa, description_fa FROM tables WHERE full_name = ?",
        [full],
      );
      if (!row) return;
      this.run("DELETE FROM fts WHERE full_name = ?", [full]);
      this.run("INSERT INTO fts (full_name, body) VALUES (?, ?)", [
        full,
        buildSearchText(row.schema, row.name, row.title_fa, row.description_fa),
      ]);
    } else if (kind === "enum") {
      this.run("INSERT OR REPLACE INTO enums VALUES (?,?,?,?,?,?)", [
        payload.full_name, payload.column, String(payload.value),
        payload.label_fa ?? null, "high", null,
      ]);
    } else if (kind === "join") {
      this.run("INSERT OR REPLACE INTO joins VALUES (?,?,?,?,?,?)", [
        payload.from_table, payload.from_col, payload.to_table, payload.to_col, "high", 1,
      ]);
      this._adj = null;
    }
  }

  // ─────────────────────── جست‌وجو ───────────────────────

  searchTables({
    query = "", limit = 40, schema = null, dataStatus = "all", fieldType = null,
    minRows = null, maxRows = null, sortBy = "score", sortOrder = "desc",
  }) {
    const [where, params] = this.filterClause(schema, dataStatus, fieldType, minRows, maxRows);
    const matched = fieldType ? this.matchedColumns(fieldType, where, params) : {};

    const q = normalize(query);
    if (!q) return this.browse(where, params, sortBy, sortOrder, limit, matched);

    const hits = new Map();
    const qcompact = q.replace(/ /g, "");

    const add = (row, base, whyBase) => {
      let score = base;
      const why = [...whyBase];
      const nameL = row.name.toLowerCase();
      if (nameL === qcompact) {
        score += 40;
        why.push("نام دقیق");
      } else if (nameL.includes(qcompact) || qcompact.includes(nameL)) {
        score += 6;
        why.push("نام نزدیک");
      }
      if (row.title_fa && normalize(row.title_fa) === q) {
        score += 35;
        why.push("عنوان فارسی دقیق");
      }
      if (row.has_data) {
        score += 3;
        why.push("داده دارد");
      }
      if (row.in_live_db === 0) {
        score -= 30;
        why.push("در دیتابیس زنده نیست");
      }
      const prev = hits.get(row.full_name);
      if (prev && prev.score >= score) return;
      hits.set(row.full_name, {
        full_name: row.full_name, title_fa: row.title_fa, n_cols: row.n_cols,
        row_count: row.row_count, has_data: Boolean(row.has_data),
        in_live_db: row.in_live_db !== 0, score, why: why.join("، "),
        matched_columns: matched[row.full_name] || [],
      });
    };

    const cols =
      "t.full_name, t.name, t.title_fa, t.n_cols, t.row_count, t.has_data, t.in_live_db";

    // ۱) تطابق دقیق نام — فارغ از رتبهٔ BM25 همیشه باید بیاید
    for (const r of this.all(
      `SELECT ${cols} FROM tables t WHERE lower(t.name) = ? AND ${where}`,
      [qcompact, ...params],
    )) add(r, 10, []);

    // ۲) جست‌وجوی تمام‌متن روی نام انگلیسی + عنوان و توضیح فارسی
    const terms = this.ftsTerms(q);
    if (terms) {
      for (const r of this.all(
        `SELECT ${cols}, bm25(fts) AS rank FROM fts ` +
        `JOIN tables t ON t.full_name = fts.full_name ` +
        `WHERE fts MATCH ? AND ${where} ORDER BY rank LIMIT ?`,
        [terms, ...params, limit * 5],
      )) add(r, -r.rank, []);
    }

    // ۳) تطابق نام ستون — وقتی کاربر نام فیلد را می‌داند نه نام جدول
    if (qcompact.length >= 3) {
      for (const r of this.all(
        `SELECT DISTINCT ${cols} FROM tables t ` +
        `JOIN columns c2 ON c2.table_ref = t.full_name ` +
        `WHERE lower(c2.name) = ? AND ${where} LIMIT ?`,
        [qcompact, ...params, limit],
      )) add(r, 4, ["نام ستون"]);
    }

    const ordered = [...hits.values()].sort((a, b) => b.score - a.score);
    return this.reorder(ordered, sortBy, sortOrder).slice(0, limit);
  }

  /** هر واژه اختیاری (OR) و همراه با ریشه‌اش، تا پرس‌وجوی چندکلمه‌ای خالی نشود. */
  ftsTerms(q) {
    const variants = [];
    for (const token of q.split(" ")) {
      if (token.length <= 1) continue;
      variants.push(`"${token}"*`);
      const root = stemFa(token);
      if (root !== token) variants.push(`"${root}"*`);
    }
    return [...new Set(variants)].join(" OR ");
  }

  filterClause(schema, dataStatus, fieldType, minRows, maxRows) {
    const parts = ["1=1"];
    const params = [];
    if (schema) {
      parts.push("t.schema = ?");
      params.push(schema);
    }
    if (dataStatus === "with_data") parts.push("t.has_data = 1");
    else if (dataStatus === "no_data") parts.push("t.has_data = 0");
    if (minRows !== null && minRows !== undefined) {
      parts.push("COALESCE(t.row_count, 0) >= ?");
      params.push(minRows);
    }
    if (maxRows !== null && maxRows !== undefined) {
      parts.push("COALESCE(t.row_count, 0) <= ?");
      params.push(maxRows);
    }
    if (fieldType) {
      const [clause, typeParams] = typeClause(fieldType);
      parts.push(
        "EXISTS (SELECT 1 FROM columns c WHERE c.table_ref = t.full_name " +
        `AND ${clause})`,
      );
      params.push(...typeParams);
    }
    return [parts.join(" AND "), params];
  }

  /** ستون‌هایی که با فیلتر نوع مطابق‌اند — برای نمایش در کارت نتیجه. */
  matchedColumns(fieldType, where, params) {
    const [clause, typeParams] = typeClause(fieldType);
    const rows = this.all(
      "SELECT c.table_ref, c.name, c.type FROM columns c " +
      "JOIN tables t ON t.full_name = c.table_ref " +
      `WHERE ${clause} AND ${where} ORDER BY c.table_ref, c.ordinal`,
      [...typeParams, ...params],
    );
    const out = {};
    for (const r of rows) {
      const bucket = (out[r.table_ref] ||= []);
      if (bucket.length < 8) bucket.push({ name: r.name, type: r.type });
    }
    return out;
  }

  /** فهرست‌کردن بدون متن جست‌وجو — فقط فیلتر و مرتب‌سازی. */
  browse(where, params, sortBy, sortOrder, limit, matched) {
    const order = {
      name: "t.full_name",
      n_cols: "t.n_cols",
      row_count: "COALESCE(t.row_count, 0)",
    }[sortBy] || "COALESCE(t.row_count, 0)";
    const direction = sortOrder === "asc" ? "ASC" : "DESC";
    return this.all(
      "SELECT t.full_name, t.title_fa, t.n_cols, t.row_count, t.has_data, " +
      `t.in_live_db FROM tables t WHERE ${where} ` +
      `ORDER BY ${order} ${direction}, t.full_name LIMIT ?`,
      [...params, limit],
    ).map((r) => ({
      full_name: r.full_name, title_fa: r.title_fa, n_cols: r.n_cols,
      row_count: r.row_count, has_data: Boolean(r.has_data),
      in_live_db: r.in_live_db !== 0, score: 0,
      why: "مطابق فیلترهای انتخابی",
      matched_columns: matched[r.full_name] || [],
    }));
  }

  reorder(hits, sortBy, sortOrder) {
    if (sortBy === "score") return hits;
    const keys = {
      name: (h) => h.full_name.toLowerCase(),
      n_cols: (h) => h.n_cols || 0,
      row_count: (h) => h.row_count || 0,
    };
    const key = keys[sortBy];
    if (!key) return hits;
    const dir = sortOrder === "asc" ? 1 : -1;
    return [...hits].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) return 0;
      return (ka > kb ? 1 : -1) * dir;
    });
  }

  /** یافتن ستون بر اساس نام — همتای search_columns سرور؛ دستیار لازمش دارد. */
  searchColumns(query, limit = 30) {
    return this.all(
      "SELECT c.table_ref, c.name, c.type, t.title_fa, t.has_data " +
      "FROM columns c JOIN tables t ON t.full_name = c.table_ref " +
      "WHERE c.name LIKE ? ORDER BY t.has_data DESC, length(c.name) LIMIT ?",
      [`%${query}%`, limit],
    );
  }

  // ─────────────────────── جزئیات جدول ───────────────────────

  getTable(fullName) {
    const r = this.one("SELECT * FROM tables WHERE full_name = ?", [fullName]);
    if (!r) return null;

    const columns = [];
    const primaryKey = [];
    // برچسب فارسی ستون از واژه‌نامه می‌آید، نه از خود جدول: یک ورودی روی هر
    // جدولی که آن ستون را دارد اثر می‌گذارد.
    for (const c of this.all(
      "SELECT c.*, l.title_fa AS label_fa FROM columns c " +
      "LEFT JOIN column_labels l ON l.name = c.name " +
      "WHERE c.table_ref=? ORDER BY c.ordinal", [fullName],
    )) {
      columns.push({
        name: c.name, type: c.type, nullable: Boolean(c.nullable),
        is_pk: Boolean(c.is_pk), ordinal: c.ordinal, label_fa: c.label_fa ?? null,
      });
      if (c.is_pk) primaryKey.push(c.name);
    }

    const asStep = (j) => ({
      from_table: j.from_table, from_col: j.from_col,
      to_table: j.to_table, to_col: j.to_col,
      confidence: j.confidence, verified: Boolean(j.verified),
    });
    const outgoing = this.all("SELECT * FROM joins WHERE from_table=?", [fullName]).map(asStep);
    const incoming = this.all("SELECT * FROM joins WHERE to_table=? LIMIT 120", [fullName]).map(asStep);

    const enums = {};
    for (const e of this.all(
      "SELECT * FROM enums WHERE table_ref=? ORDER BY column, value", [fullName],
    )) {
      (enums[e.column] ||= []).push({
        value: e.value, label_fa: e.label_fa,
        confidence: e.confidence, observed: e.observed,
      });
    }

    const indexes = this.all("SELECT * FROM indexes_ WHERE table_ref=?", [fullName]).map((i) => ({
      name: i.name,
      columns: i.columns ? i.columns.split(",") : [],
      unique: Boolean(i.is_unique),
      is_pk: Boolean(i.is_pk),
    }));

    const warnings = [];
    const hasData = Boolean(r.has_data);
    if (!hasData) {
      warnings.push("این جدول در نصب فعلی داده ندارد — احتمالاً ماژولش خریداری نشده.");
    }
    if (r.in_live_db === 0) {
      warnings.push("این جدول در دیتابیس زندهٔ فعلی وجود ندارد — مستندات نسبت به نصب کهنه است.");
    }
    if (columns.some((c) => c.name === "FiscalYearRef")) {
      warnings.push(
        "ستون FiscalYearRef دارد — فیلتر سال مالی الزامی است، وگرنه خروجی بی‌خطا ولی غلط می‌شود.",
      );
    }
    const weak = outgoing.filter((j) => !j.verified);
    if (weak.length) {
      warnings.push(`${weak.length} مسیر JOIN از این جدول تأییدنشده است (استنتاج از نام).`);
    }

    return {
      full_name: r.full_name, title_fa: r.title_fa, description_fa: r.description_fa,
      kind: r.kind, row_count: r.row_count, has_data: hasData,
      in_live_db: r.in_live_db !== 0,
      columns, primary_key: primaryKey, outgoing, incoming, enums, indexes, warnings,
    };
  }

  /** هم‌اسکیماهای پرارتباط — برای پرش سریع بین جدول‌های یک ماژول. */
  schemaNeighbors(fullName, limit = 40) {
    const schema = fullName.split(".")[0];
    return this.all(
      "SELECT t.full_name, t.title_fa, t.row_count, t.has_data, t.n_cols, " +
      "  (SELECT COUNT(*) FROM joins j " +
      "   WHERE j.from_table = t.full_name OR j.to_table = t.full_name) AS degree " +
      "FROM tables t WHERE t.schema = ? AND t.full_name <> ? " +
      "ORDER BY degree DESC, COALESCE(t.row_count, 0) DESC LIMIT ?",
      [schema, fullName, limit],
    ).map((r) => ({ ...r, has_data: Boolean(r.has_data) }));
  }

  // ─────────────────────── گراف ───────────────────────

  schemas() {
    return this.all(
      "SELECT t.schema AS id, COUNT(*) AS table_count, " +
      "  SUM(t.has_data) AS with_data, SUM(t.n_cols) AS column_count, " +
      "  s.title_fa AS title_fa " +
      "FROM tables t LEFT JOIN schema_titles s ON s.id = t.schema " +
      "GROUP BY t.schema ORDER BY table_count DESC",
    ).map((r) => ({
      id: r.id, title_fa: r.title_fa ?? null, table_count: r.table_count,
      with_data: r.with_data || 0, column_count: r.column_count || 0,
    }));
  }

  // ─────────────────── موجودیت نرم‌افزار ───────────────────

  entityFor(fullName) {
    return this.one(
      "SELECT name, title_fa, component FROM entities WHERE table_ref = ? LIMIT 1",
      [fullName],
    ) || null;
  }

  // ─────────────────── کد و شرحی ───────────────────

  lookups({ q = "", module = "", limit = 400 } = {}) {
    const where = [];
    const params = [];
    if (q) {
      const like = `%${q.trim()}%`;
      where.push(
        "(t.type LIKE ? OR t.title_fa LIKE ? OR EXISTS (" +
        "  SELECT 1 FROM lookup_values v WHERE v.type = t.type AND v.value LIKE ?))",
      );
      params.push(like, like, like);
    }
    if (module) {
      where.push("t.module = ?");
      params.push(module);
    }
    // وقتی تطبیق روی خودِ مقدار بوده، همان مقدار هم برمی‌گردد — وگرنه کاربری
    // که «دیپلم» را جسته، فهرستی از نام‌های لاتین می‌بیند بی‌هیچ نشانه‌ای از
    // اینکه چرا این نوع‌ها آمده‌اند.
    const matched = q
      ? "(SELECT v.value FROM lookup_values v WHERE v.type = t.type" +
        "  AND v.value LIKE ? ORDER BY COALESCE(v.ordinal, v.code) LIMIT 1)"
      : "NULL";
    if (q) params.unshift(`%${q.trim()}%`);
    let sql = `SELECT type, title_fa, module, n_values, is_dynamic, ${matched} AS matched_value FROM lookup_types t`;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY (t.title_fa IS NULL), (t.n_values = 0), t.n_values DESC, t.type LIMIT ?";
    params.push(limit);
    return this.all(sql, params);
  }

  lookup(type) {
    const head = this.one(
      "SELECT type, title_fa, module, n_values, is_dynamic FROM lookup_types WHERE type = ?",
      [type],
    );
    if (!head) return null;
    const values = this.all(
      "SELECT code, value, ordinal, extra FROM lookup_values WHERE type = ? " +
      "ORDER BY COALESCE(ordinal, code), code",
      [type],
    );
    const usedBy = this.all(
      "SELECT c.table_ref, c.name FROM columns c " +
      "WHERE c.name = ? OR c.name = ? OR c.name = ? " +
      "ORDER BY c.table_ref LIMIT 50",
      [type, `${type}Ref`, `${type}ID`],
    );
    return { ...head, values, used_by: usedBy };
  }

  lookupModules() {
    return this.all(
      "SELECT module AS id, COUNT(*) AS n FROM lookup_types " +
      "WHERE module IS NOT NULL GROUP BY module ORDER BY n DESC",
    );
  }

  schemaGraph(schema, { includeExternal = true, onlyWithData = false, maxNodes = 75 } = {}) {
    let where = "t.schema = ?";
    if (onlyWithData) where += " AND t.has_data = 1";

    const rows = this.all(
      "SELECT t.full_name, t.name, t.schema, t.title_fa, t.n_cols, " +
      "  t.row_count, t.has_data, " +
      "  (SELECT COUNT(*) FROM joins j " +
      "   WHERE j.from_table = t.full_name OR j.to_table = t.full_name) AS degree " +
      `FROM tables t WHERE ${where} ` +
      "ORDER BY degree DESC, COALESCE(t.row_count, 0) DESC LIMIT ?",
      [schema, maxNodes],
    );

    const nodes = new Map(rows.map((r) => [r.full_name, {
      id: r.full_name, full_name: r.full_name, name: r.name, schema: r.schema,
      title_fa: r.title_fa, n_cols: r.n_cols, row_count: r.row_count,
      has_data: Boolean(r.has_data), degree: r.degree, external: false,
    }]));
    if (!nodes.size) {
      return { schema, nodes: [], links: [], stats: { nodes: 0, links: 0, external: 0, cross: 0 } };
    }

    const names = [...nodes.keys()];
    const placeholders = names.map(() => "?").join(",");
    const edges = this.all(
      "SELECT from_table, from_col, to_table, to_col, confidence, verified " +
      `FROM joins WHERE from_table IN (${placeholders}) ` +
      `   OR to_table IN (${placeholders})`,
      [...names, ...names],
    );

    // گره‌های بیرونی هم سقف دارند: بدون آن، یک اسکیمای بزرگ صدها جدول همسایه
    // می‌آورد و گراف به توده‌ای ناخوانا تبدیل می‌شود.
    const externalDegree = new Map();
    const internalLinks = [];
    const candidateLinks = [];
    for (const e of edges) {
      const src = e.from_table;
      const dst = e.to_table;
      const srcIn = nodes.has(src);
      const dstIn = nodes.has(dst);
      const link = {
        source: src, target: dst, from_col: e.from_col, to_col: e.to_col,
        confidence: e.confidence, verified: Boolean(e.verified),
        cross: src.split(".")[0] !== dst.split(".")[0],
      };
      if (srcIn && dstIn) {
        internalLinks.push(link);
        continue;
      }
      if (!includeExternal) continue;
      const outside = srcIn ? dst : src;
      if (outside.split(".")[0] === schema) continue; // هم‌اسکیما ولی خارج از سقف
      externalDegree.set(outside, (externalDegree.get(outside) || 0) + 1);
      candidateLinks.push([outside, link]);
    }

    const keep = Math.max(8, Math.min(40, Math.floor(maxNodes / 2)));
    const externals = new Set(
      [...externalDegree.entries()].sort((a, b) => b[1] - a[1]).slice(0, keep).map(([n]) => n),
    );
    let links = [
      ...internalLinks,
      ...candidateLinks.filter(([outside]) => externals.has(outside)).map(([, l]) => l),
    ];

    for (const full of externals) {
      const meta = this.one(
        "SELECT full_name, name, schema, title_fa, n_cols, row_count, has_data " +
        "FROM tables WHERE full_name = ?", [full],
      );
      if (!meta) continue;
      nodes.set(full, {
        id: meta.full_name, full_name: meta.full_name, name: meta.name,
        schema: meta.schema, title_fa: meta.title_fa, n_cols: meta.n_cols,
        row_count: meta.row_count, has_data: Boolean(meta.has_data),
        degree: 0, external: true,
      });
    }

    links = links.filter((l) => nodes.has(l.source) && nodes.has(l.target));

    // درجه را بر پایهٔ یال‌های همین نما بازمحاسبه می‌کنیم تا فیلترها اندازهٔ
    // گره‌ها را گمراه‌کننده نکنند.
    for (const node of nodes.values()) node.degree = 0;
    for (const link of links) {
      nodes.get(link.source).degree += 1;
      nodes.get(link.target).degree += 1;
    }

    return {
      schema,
      nodes: [...nodes.values()],
      links,
      stats: {
        nodes: nodes.size, links: links.length, external: externals.size,
        cross: links.filter((l) => l.cross).length,
      },
    };
  }

  // ─────────────────────── مسیر JOIN ───────────────────────

  /** گراف بدون‌جهت — برای JOIN، جهت اهمیتی ندارد. */
  adjacency() {
    if (this._adj) return this._adj;
    const adj = new Map();
    const push = (key, value) => {
      const list = adj.get(key);
      if (list) list.push(value);
      else adj.set(key, [value]);
    };
    for (const j of this.all("SELECT * FROM joins")) {
      push(j.from_table, {
        next: j.to_table, fromCol: j.from_col, toCol: j.to_col,
        confidence: j.confidence, verified: j.verified, forward: true,
      });
      push(j.to_table, {
        next: j.from_table, fromCol: j.to_col, toCol: j.from_col,
        confidence: j.confidence, verified: j.verified, forward: false,
      });
    }
    this._adj = adj;
    return adj;
  }

  /**
   * کوتاه‌ترین مسیر JOIN بین دو جدول (BFS).
   *
   * یال‌های تأییدشده اولویت دارند: در هر سطح اول آن‌ها بررسی می‌شوند، تا اگر
   * دو مسیر هم‌طول باشند، مسیر قطعی برنده شود.
   */
  findJoinPath(source, target, { maxHops = 4, verifiedOnly = false } = {}) {
    if (source === target) return [];
    const adj = this.adjacency();
    if (!adj.has(source)) return null;

    const seen = new Set([source]);
    const queue = [[source, []]];
    let head = 0;
    while (head < queue.length) {
      const [node, path] = queue[head++];
      if (path.length >= maxHops) continue;
      const edges = [...(adj.get(node) || [])].sort(
        (a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0),
      );
      for (const edge of edges) {
        if (verifiedOnly && !edge.verified) continue;
        if (seen.has(edge.next)) continue;
        const step = {
          from_table: node, from_col: edge.fromCol,
          to_table: edge.next, to_col: edge.toCol,
          confidence: edge.confidence, verified: Boolean(edge.verified),
        };
        if (edge.next === target) return [...path, step];
        seen.add(edge.next);
        queue.push([edge.next, [...path, step]]);
      }
    }
    return null;
  }

  /**
   * مسیرِ موجود ≠ مسیرِ درست.
   *
   * BFS کوتاه‌ترین مسیر گراف را می‌دهد، ولی گراف معنا نمی‌فهمد.
   */
  static pathWarning(path) {
    if (!path || !path.length) return null;
    if (path.length > 2) {
      const via = path.slice(0, -1).map((s) => s.to_table).join(" → ");
      return `این مسیر ${path.length} مرحله دارد و از ${via} عبور می‌کند. ` +
        "مسیرهای بلند معمولاً از نظر تجاری بی‌معنا هستند — احتمالاً این دو جدول " +
        "مستقیماً مرتبط نیستند.";
    }
    const weak = path.filter((s) => !s.verified);
    if (weak.length) {
      return `${weak.length} مرحله از این مسیر تأییدنشده است (استنتاج از نام).`;
    }
    return null;
  }

  stats() {
    const out = {};
    for (const r of this.all("SELECT * FROM meta")) out[r.key] = r.value;
    return out;
  }
}

// ─────────────────────── باز کردن ایندکس ───────────────────────

let kbPromise = null;

async function openKnowledgeBase() {
  const sqlite3 = await sqlite3InitModule();
  const response = await fetch(new URL("kb.sqlite", document.baseURI));
  if (!response.ok) throw new Error(`ایندکس دانش خوانده نشد (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  const db = new sqlite3.oo1.DB();
  const capi = sqlite3.capi;
  const pointer = sqlite3.wasm.allocFromTypedArray(bytes);
  // RESIZEABLE لازم است چون دانشی که کاربر ثبت می‌کند روی همین پایگاه می‌نشیند
  const rc = capi.sqlite3_deserialize(
    db.pointer, "main", pointer, bytes.length, bytes.length,
    capi.SQLITE_DESERIALIZE_RESIZEABLE | capi.SQLITE_DESERIALIZE_FREEONCLOSE,
  );
  db.checkRc(rc);

  const kb = new KnowledgeBase(sqlite3, db);
  for (const entry of readLearned()) {
    try {
      kb.applyLearned(entry.kind, entry.payload);
    } catch {
      // یک ورودی خراب نباید کل دانش ثبت‌شده را از کار بیندازد
    }
  }
  return kb;
}

function readLearned() {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLearned(kind, payload) {
  try {
    const all = readLearned();
    all.push({ kind, payload, at: new Date().toISOString() });
    localStorage.setItem(LEARNED_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

const ready = () => (kbPromise ||= openKnowledgeBase());

const notFound = (detail) => {
  const error = new Error(detail);
  error.response = { status: 404, data: { detail } };
  return error;
};

// ─────────────────────── لایهٔ سازگار با axios ───────────────────────

const ROUTES = [
  [/^\/health$/, async (kb) => ({ ok: true, kb: kb.stats(), index: "داخل برنامه", built_at: null })],

  [/^\/search$/, async (kb, _m, params = {}) => {
    const hits = kb.searchTables({
      query: params.q || "", limit: params.limit ?? 80, schema: params.schema ?? null,
      dataStatus: params.dataStatus || "all", fieldType: params.fieldType ?? null,
      minRows: params.minRows ?? null, maxRows: params.maxRows ?? null,
      sortBy: params.sortBy || "score", sortOrder: params.sortOrder || "desc",
    });
    return {
      count: hits.length,
      results: hits.map((h) => ({
        ...h,
        score: Math.round(h.score * 100) / 100,
        matched_columns: h.matched_columns?.length ? h.matched_columns : null,
      })),
    };
  }],

  [/^\/schemas$/, async (kb) => ({ schemas: kb.schemas() })],

  [/^\/settings$/, async () => getSettings()],

  [/^\/lookups$/, async (kb, m, params = {}) => ({
    types: kb.lookups({ q: params.q || "", module: params.module || "", limit: params.limit || 400 }),
    modules: kb.lookupModules(),
  })],

  [/^\/lookup\/(.+)$/, async (kb, m) => {
    const type = decodeURIComponent(m[1]);
    const found = kb.lookup(type);
    if (!found) throw notFound(`نوع کد و شرحی «${type}» پیدا نشد.`);
    return found;
  }],

  [/^\/schema\/([^/]+)\/graph$/, async (kb, m, params = {}) => {
    const schema = decodeURIComponent(m[1]);
    const graph = kb.schemaGraph(schema, {
      includeExternal: params.includeExternal ?? true,
      onlyWithData: params.onlyWithData ?? false,
      maxNodes: params.maxNodes ?? 75,
    });
    if (!graph.nodes.length) throw notFound(`اسکیمای «${schema}» جدولی با این شرایط ندارد.`);
    return graph;
  }],

  [/^\/table\/(.+)$/, async (kb, m) => {
    const fullName = decodeURIComponent(m[1]);
    const t = kb.getTable(fullName);
    if (!t) throw notFound(`جدول «${fullName}» پیدا نشد.`);
    const indexedCols = [...new Set(t.indexes.flatMap((i) => i.columns).filter(Boolean))].sort();
    const [schema, ...rest] = t.full_name.split(".");
    return {
      full_name: t.full_name, schema, table_name: rest.join(".") || t.full_name,
      title_fa: t.title_fa, description_fa: t.description_fa, kind: t.kind,
      row_count: t.row_count, has_data: t.has_data, in_live_db: t.in_live_db,
      primary_key: t.primary_key, columns: t.columns, enums: t.enums,
      indexes: t.indexes, indexed_columns: indexedCols, warnings: t.warnings,
      outgoing: t.outgoing.map(stepDict), incoming: t.incoming.map(stepDict),
      schema_neighbors: kb.schemaNeighbors(t.full_name),
      entity: kb.entityFor(t.full_name),
    };
  }],

  [/^\/joinpath$/, async (kb, _m, params = {}) => {
    const { source, target } = params;
    const steps = kb.findJoinPath(source, target, {
      maxHops: params.maxHops ?? 4, verifiedOnly: params.verifiedOnly ?? false,
    });
    if (steps === null) {
      return {
        found: false, steps: [],
        warning: `مسیری بین «${source}» و «${target}» در گراف دانش پیدا نشد.`,
      };
    }
    return {
      found: true,
      steps: steps.map(stepDict),
      warning: KnowledgeBase.pathWarning(steps) || "",
    };
  }],
];

const MESSAGES = {
  table: "معنی جدول ثبت شد.",
  enum: "معنی مقدار ثبت شد.",
  join: "مسیر JOIN تأیید و ثبت شد.",
};

async function handleKnowledge(kb, body) {
  const { kind, payload } = body || {};
  if (!MESSAGES[kind]) {
    const detail = `نوع دانش «${kind}» شناخته نشد.`;
    const error = new Error(detail);
    error.response = { status: 400, data: { detail } };
    throw error;
  }
  kb.applyLearned(kind, payload);
  invalidateSchemaIndex();
  const stored = saveLearned(kind, payload);
  return {
    ok: true,
    message: MESSAGES[kind],
    applied: true,
    note: stored ? "" : "روی این دستگاه ماندگار نشد؛ با بستن برنامه پاک می‌شود.",
  };
}

/**
 * همان قراردادی که axios دارد (`{ data }`), تا بقیهٔ برنامه نفهمد سرور نیست.
 */
export const localHttp = {
  async get(url, config = {}) {
    const kb = await ready();
    for (const [pattern, handler] of ROUTES) {
      const m = pattern.exec(url);
      if (m) return { data: await handler(kb, m, config.params) };
    }
    throw notFound(`مسیر «${url}» در نسخهٔ موبایل پشتیبانی نمی‌شود.`);
  },

  async post(url, body) {
    const kb = await ready();
    if (url === "/knowledge") return { data: await handleKnowledge(kb, body) };
    if (url === "/settings/test") return { data: await testSettings(body) };
    if (url === "/assistant/check") return { data: checkQuery(kb, body?.sql) };
    throw notFound(`مسیر «${url}» در نسخهٔ موبایل پشتیبانی نمی‌شود.`);
  },

  async put(url, body) {
    if (url === "/settings") return { data: await putSettings(body) };
    throw notFound(`مسیر «${url}» در نسخهٔ موبایل پشتیبانی نمی‌شود.`);
  },
};

/** دستیار روی خودِ دستگاه — همان رویدادهای جریانیِ سرور، بی‌سرور. */
export async function askLocal(question, options) {
  return askAssistant(await ready(), question, options);
}
