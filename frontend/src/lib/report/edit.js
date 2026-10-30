/**
 * ویرایش جراحیِ RDL موجود — بی‌آنکه بقیهٔ فایل یک نویسه هم عوض شود.
 *
 * هر عمل متن RDL می‌گیرد و { text, changes } برمی‌گرداند. تغییرها روی بازه‌های
 * دقیقِ متن اصلی اعمال می‌شوند (موقعیت‌ها از تجزیه‌گر xml.js)، پس فاصله‌ها،
 * کامنت‌ها، ترتیب صفت‌ها و کلیدهای sglt: دست‌نخورده می‌مانند و کاربر فایل را
 * در Report Builder همان‌طور که بود باز می‌کند. هر عمل در پایان فایل را دوباره
 * تجزیه می‌کند؛ اگر نتیجه XML معتبر نباشد، خطا می‌دهد و چیزی تحویل نمی‌شود.
 *
 * عمل‌ها همان کارهای پرتکرار مهارت گزارش‌سازی‌اند:
 *   • افزودن/حذف ستون Tablix با «قانون سه‌گانه» (ستون + عضو + سلول در هر ردیف)
 *   • همگام‌سازی فیلدهای دیتاست با SELECT، و پارامترها با @های کوئری
 *   • جایگزینی CommandText (با escape درست)
 *   • اصلاح تلهٔ KeepWithGroup روی ردیف‌های عنوان تکرارشونده
 *   • انتقال PageHeader به بدنه و حذف PageFooter (ممنوع در نرم‌افزار میزبان)
 *   • افزودن پارامترهای Sys_* و رساندنشان به زیرگزارش‌ها
 */

import { ancestor, childText, elements, escapeAttr, escapeText, findAll, indentOf, kid, kids, local, parseXml, textOf } from "./xml.js";
import { cm, toCm } from "./units.js";
import { inspectRdl, SYS_PARAMS } from "./rdl.js";
import { outputColumns, queryParameters, rdlType } from "./sqlmeta.js";

export class EditError extends Error {}

/** اعمال چند جایگزینی روی بازه‌های متن — از آخر به اول تا موقعیت‌ها جابه‌جا نشوند. */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let guard = Infinity;
  for (const e of sorted) {
    if (e.end > guard) throw new EditError("دو تغییر روی یک بازه افتادند؛ عمل لغو شد.");
    out = out.slice(0, e.start) + e.insert + out.slice(e.end);
    guard = e.start;
  }
  return out;
}

function finish(text, edits, changes) {
  if (!edits.length) return { text, changes: changes.length ? changes : ["تغییری لازم نبود."], changed: false };
  const out = applyEdits(text, edits);
  try {
    parseXml(out);
  } catch (e) {
    throw new EditError(`نتیجهٔ ویرایش XML معتبر نشد (${e.message})؛ هیچ تغییری اعمال نشد.`);
  }
  return { text: out, changes, changed: true };
}

function load(text) {
  const info = inspectRdl(text);
  if (!info.ok) throw new EditError(`فایل RDL خوانده نشد: ${info.error.message}`);
  return info;
}

/** درج پیش از عنصر، هم‌تراز با تورفتگی همان عنصر. */
function before(text, el, xml) {
  const ind = indentOf(text, el.start);
  return { start: el.start, end: el.start, insert: `${xml}\n${ind}` };
}

/** درج پس از عنصر، هم‌تراز با آن. */
function after(text, el, xml) {
  const ind = indentOf(text, el.start);
  return { start: el.end, end: el.end, insert: `\n${ind}${xml}` };
}

/** درج به‌عنوان آخرین فرزند (برای والدی که خودبسته نیست). */
function appendChild(text, parent, xml) {
  const kidsOf = elements(parent);
  const last = kidsOf[kidsOf.length - 1];
  if (last) return after(text, last, xml);
  if (parent.selfClosing) {
    // <Fields /> ← <Fields>…</Fields>
    const open = text.slice(parent.start, parent.openEnd).replace(/\s*\/>$/, ">");
    return { start: parent.start, end: parent.end, insert: `${open}${xml}</${parent.name}>` };
  }
  const ind = indentOf(text, parent.start);
  return { start: parent.closeStart, end: parent.closeStart, insert: `  ${xml}\n${ind}` };
}

const replaceEl = (el, xml) => ({ start: el.start, end: el.end, insert: xml });
const removeEl = (text, el) => {
  // سطرِ خالیِ باقی‌مانده را هم بردار
  let start = el.start;
  let end = el.end;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
    const nl = text.indexOf("\n", end);
    if (nl !== -1 && /^[ \t]*$/.test(text.slice(end, nl))) {
      start = lineStart;
      end = nl + 1;
    }
  }
  return { start, end, insert: "" };
};

/** متن داخلی یک عنصر برگ را عوض کن (مثلاً <Width>). */
function setInner(el, value) {
  if (el.selfClosing) return { start: el.start, end: el.end, insert: `<${el.name}>${escapeText(value)}</${el.name}>` };
  return { start: el.openEnd, end: el.closeStart, insert: escapeText(value) };
}

function findTablix(info, name) {
  const t = info.tablixes.find((x) => x.name === name) || (name ? null : info.tablixes[0]);
  if (!t) throw new EditError(`Tablix «${name}» در فایل نیست.`);
  return t;
}

/** نام‌ساز یکتا در سطح کل فایل. */
function uniqueNamer(info) {
  const used = new Set(info.itemNames.map((n) => n.toLowerCase()));
  for (const g of findAll(info.root, "Group")) used.add((g.attrs.Name || "").toLowerCase());
  return (base) => {
    const clean = String(base).replace(/[^\w]/g, "") || "Textbox";
    let name = clean;
    let k = 1;
    while (used.has(name.toLowerCase())) name = `${clean}_${++k}`;
    used.add(name.toLowerCase());
    return name;
  };
}

// ───────────────────────── نقش ردیف‌ها ─────────────────────────

/**
 * نقش هر ردیف از روی برگ متناظرش در سلسله‌مراتب سطری:
 *   header   ردیف ثابت پیش از هر گروه (عنوان ستون‌ها)
 *   detail   برگ گروه جزئیات یا عضو ثابت درونش
 *   group    ردیف ثابت After درون یک گروه (سرگروه)
 *   total    ردیف ثابت Before (جمع گروه یا جمع کل)
 */
function rowRoles(t) {
  const roles = [];
  const visit = (membersEl, insideGroup, insideDetails) => {
    for (const m of kids(membersEl, "TablixMember")) {
      const g = kid(m, "Group");
      const isDetails = g && !kid(g, "GroupExpressions");
      const inner = kid(m, "TablixMembers");
      if (inner && kids(inner, "TablixMember").length) {
        visit(inner, insideGroup || Boolean(g), insideDetails || isDetails);
        continue;
      }
      const keep = childText(m, "KeepWithGroup");
      if (isDetails || insideDetails) roles.push("detail");
      else if (g) roles.push("detail"); // گروه پویای بی‌جزئیات: هر نمونه یک ردیف داده
      else if (keep === "Before") roles.push("total");
      else if (insideGroup) roles.push("group");
      else roles.push("header");
    }
  };
  if (t.rowMembers) visit(t.rowMembers, false, false);
  return roles;
}

/** نقشهٔ «شکاف ستون ← سلول» یک ردیف در شکل کامل (با سلول جایگزین). */
function slotMap(row, nCols) {
  if (row.cells.length !== nCols) return null;
  const map = [];
  for (let i = 0; i < row.cells.length; i++) {
    const c = row.cells[i];
    if (c.empty) {
      // سلول جایگزین زیر ادغام: صاحبش نزدیک‌ترین سلول پرِ قبلی با ColSpan کافی
      let owner = -1;
      for (let k = i - 1; k >= 0; k--) {
        if (!row.cells[k].empty) {
          if (k + row.cells[k].colSpan > i) owner = k;
          break;
        }
      }
      map.push({ cell: c, owner, placeholder: true });
    } else map.push({ cell: c, owner: i, placeholder: false });
  }
  return map;
}

// ───────────────────────── افزودن ستون ─────────────────────────

/**
 * ستون تازه در Tablix.
 *
 * opts: { tablix, index, width, header, field, typeName, format, addField }
 *   index   جایگاه در XML (۰ = نخستین ستون؛ در Tablix راست‌به‌چپ یعنی راست‌ترین)
 *   field   نام فیلد دیتاست؛ اگر نباشد، ستون خالی با عنوان ساخته می‌شود
 *
 * هر سلول تازه از سلولِ همسایه در همان ردیف کپی می‌شود (با همهٔ Style، Border
 * و Padding) و فقط نام و مقدارش عوض می‌شود — همان قاعدهٔ مهارت برای یکدست
 * ماندن ظاهر.
 */
export function addColumn(text, opts) {
  const info = load(text);
  const t = findTablix(info, opts.tablix);
  const n = t.columns.length;
  const index = Math.max(0, Math.min(n, Number.isFinite(opts.index) ? opts.index : n));
  if (findAll(t.colMembers, "Group").some((g) => ancestor(g, "Tablix") === t.el)) {
    throw new EditError(`Tablix «${t.name}» ستون پویا (گروه ستونی) دارد؛ افزودن ستون ثابت به ماتریس را در Report Builder انجام دهید.`);
  }
  const width = Number(opts.width) > 0 ? Number(opts.width) : 2.5;
  const field = (opts.field || "").trim();
  const ds = info.dataSets.find((d) => d.name === t.dataSet);
  if (field && !/^[A-Za-z_]\w*$/.test(field)) throw new EditError("نام فیلد فقط حروف لاتین، رقم و _ می‌تواند باشد.");
  const roles = rowRoles(t);
  const name = uniqueNamer(info);
  const edits = [];
  const changes = [];

  t.rows.forEach((r, ri) => {
    const map = slotMap(r, n);
    if (!map) throw new EditError(`ردیف ${ri + 1} از Tablix «${t.name}» شکل فشرده (ColSpan بی‌سلول جایگزین) دارد؛ ابتدا آن را در Report Builder باز و ذخیره کنید.`);
    // اگر جایگاه تازه وسط یک ادغام است، همان ادغام پهن‌تر می‌شود
    const leftOwner = index > 0 ? map[index - 1].owner : -1;
    const rightOwner = index < n ? map[index].owner : -2;
    // ادغامی که به لبهٔ جدول رسیده (عنوانِ تمام‌عرض، سرگروه) هم پهن‌تر می‌شود
    const edgeRight = index === n && leftOwner !== -1 && r.cells[leftOwner].colSpan > 1 && leftOwner + r.cells[leftOwner].colSpan === n;
    const edgeLeft = index === 0 && rightOwner === 0 && r.cells[0].colSpan > 1;
    if ((index > 0 && index < n && leftOwner === rightOwner && leftOwner !== -1) || edgeRight || edgeLeft) {
      const headIdx = edgeLeft ? 0 : leftOwner;
      const head = r.cells[headIdx];
      const span = kid(kid(head.el, "CellContents"), "ColSpan");
      edits.push(setInner(span, String(head.colSpan + 1)));
      edits.push(after(text, (edgeLeft ? r.cells[0] : r.cells[index - 1]).el, "<TablixCell />"));
      return;
    }
    const srcIdx = index > 0 ? index - 1 : 0;
    const src = map[srcIdx] && !map[srcIdx].placeholder ? map[srcIdx].cell : r.cells.find((c) => !c.empty);
    const role = roles[ri] || "detail";
    let value = "";
    if (role === "header") value = opts.header || field || "ستون تازه";
    else if (role === "detail" && field) value = `=Fields!${field}.Value`;
    else if (role === "total" && field && opts.total) value = `=Sum(Fields!${field}.Value)`;
    const xml = cloneCell(text, src, value, name(`${role === "header" ? "hdr" : role === "total" ? "tot" : "cel"}_${field || "New"}`), role === "detail" || role === "total" ? opts.format : "");
    const anchor = index < n ? r.cells[index].el : r.cells[n - 1].el;
    edits.push(index < n ? before(text, anchor, xml) : after(text, anchor, xml));
  });

  // ستون و عضو سلسله‌مراتب
  const colEls = kids(kid(kid(t.el, "TablixBody"), "TablixColumns"), "TablixColumn");
  const colXml = `<TablixColumn><Width>${cm(width)}</Width></TablixColumn>`;
  edits.push(index < n ? before(text, colEls[index], colXml) : after(text, colEls[n - 1], colXml));
  const memEls = kids(t.colMembers, "TablixMember");
  edits.push(index < n ? before(text, memEls[index], "<TablixMember />") : after(text, memEls[n - 1], "<TablixMember />"));

  // عرض Tablix و بخش
  const widthEl = kid(t.el, "Width");
  const newWidth = (t.width ?? t.columns.reduce((a, c) => a + (c.cm ?? 0), 0)) + width;
  if (widthEl) edits.push(setInner(widthEl, cm(newWidth)));
  const sectionWidthEl = kid(info.sectionEl, "Width");
  if (sectionWidthEl && info.sectionWidth != null && t.left + newWidth > info.sectionWidth && !ancestor(t.el, "Tablix")) {
    edits.push(setInner(sectionWidthEl, cm(t.left + newWidth)));
    changes.push(`عرض بخش گزارش به ${(t.left + newWidth).toFixed(2)}cm رسید.`);
  }

  // فیلد دیتاست
  if (field && ds && opts.addField !== false && !ds.fields.some((f) => f.name === field)) {
    const fieldsEl = kid(ds.el, "Fields");
    const xml = `<Field Name="${escapeAttr(field)}"><DataField>${escapeText(field)}</DataField><rd:TypeName>${escapeText(opts.typeName || "System.String")}</rd:TypeName></Field>`;
    if (fieldsEl) edits.push(appendChild(text, fieldsEl, xml));
    else edits.push(after(text, kid(ds.el, "Query"), `<Fields>${xml}</Fields>`));
    changes.push(`فیلد «${field}» به دیتاست «${ds.name}» اضافه شد — مطمئن شوید کوئری ستونی به همین نام برمی‌گرداند.`);
  }
  changes.unshift(`ستون تازه در جایگاه ${index + 1} از Tablix «${t.name}» (${n} ← ${n + 1} ستون): یک TablixColumn، یک TablixMember و در هر ${t.rows.length} ردیف یک TablixCell.`);
  return finish(text, edits, changes);
}

/** کپی یک سلول با نام تازه برای هر آیتم و مقدار تازه برای Textbox اصلی. */
function cloneCell(text, src, value, mainName, format) {
  if (!src || src.empty || !src.item || src.item.type !== "Textbox") {
    return `<TablixCell><CellContents><Textbox Name="${escapeAttr(mainName)}"><CanGrow>true</CanGrow><KeepTogether>true</KeepTogether><Paragraphs><Paragraph><TextRuns><TextRun><Value>${escapeText(value)}</Value><Style>${format ? `<Format>${escapeText(format)}</Format>` : ""}</Style></TextRun></TextRuns><Style /></Paragraph></Paragraphs><rd:DefaultName>${escapeText(mainName)}</rd:DefaultName><Style><Border><Color>LightGrey</Color><Style>Solid</Style></Border><PaddingLeft>2pt</PaddingLeft><PaddingRight>2pt</PaddingRight></Style></Textbox></CellContents></TablixCell>`;
  }
  const cellEl = src.el;
  const tb = elements(kid(cellEl, "CellContents")).find((e) => local(e.name) === "Textbox");
  const edits = [];
  const base = cellEl.start;
  // نام Textbox و rd:DefaultName
  const nameAttr = tb.attrList.find((a) => a.name === "Name");
  edits.push({ start: nameAttr.valueStart - base, end: nameAttr.valueEnd - base, insert: escapeAttr(mainName) });
  const dn = kid(tb, "DefaultName");
  if (dn && !dn.selfClosing) edits.push({ start: dn.openEnd - base, end: dn.closeStart - base, insert: escapeText(mainName) });
  // فقط نخستین TextRun مقدار می‌گیرد؛ بقیه خالی می‌شوند
  const runs = findAll(tb, "TextRun");
  runs.forEach((run, i) => {
    const v = kid(run, "Value");
    const insert = i === 0 ? escapeText(value) : "";
    if (v && !v.selfClosing) edits.push({ start: v.openEnd - base, end: v.closeStart - base, insert });
    else if (v) edits.push({ start: v.start - base, end: v.end - base, insert: `<Value>${insert}</Value>` });
    if (i === 0) {
      const st = kid(run, "Style");
      const fmt = kid(st, "Format");
      if (fmt && !fmt.selfClosing) edits.push({ start: fmt.openEnd - base, end: fmt.closeStart - base, insert: escapeText(format || "") });
      else if (format && st && !st.selfClosing) edits.push({ start: st.closeStart - base, end: st.closeStart - base, insert: `<Format>${escapeText(format)}</Format>` });
      else if (format && st) edits.push({ start: st.start - base, end: st.end - base, insert: `<Style><Format>${escapeText(format)}</Format></Style>` });
    }
  });
  // سلولِ منبع اگر ColSpan داشت، کپی تک‌ستونه است
  const span = kid(kid(cellEl, "CellContents"), "ColSpan");
  if (span) edits.push({ start: span.start - base, end: span.end - base, insert: "" });
  // نام آیتم‌های تودرتو (نادر در Textbox) لازم نیست؛ Textbox فرزند آیتم ندارد
  return applyEdits(text.slice(cellEl.start, cellEl.end), edits);
}

// ───────────────────────── حذف ستون ─────────────────────────

export function removeColumn(text, opts) {
  const info = load(text);
  const t = findTablix(info, opts.tablix);
  const n = t.columns.length;
  const index = Number(opts.index);
  if (!(index >= 0 && index < n)) throw new EditError("شمارهٔ ستون معتبر نیست.");
  if (n <= 1) throw new EditError("Tablix باید دست‌کم یک ستون داشته باشد.");
  if (findAll(t.colMembers, "Group").some((g) => ancestor(g, "Tablix") === t.el)) {
    throw new EditError(`Tablix «${t.name}» ستون پویا دارد؛ حذف ستون ماتریس را در Report Builder انجام دهید.`);
  }
  const edits = [];
  const removedNames = [];
  t.rows.forEach((r, ri) => {
    const map = slotMap(r, n);
    if (!map) throw new EditError(`ردیف ${ri + 1} شکل فشرده دارد؛ ابتدا آن را در Report Builder باز و ذخیره کنید.`);
    const slot = map[index];
    if (slot.placeholder) {
      // ستون زیر یک ادغام: ادغام یکی کوتاه‌تر و یک سلول جایگزین کمتر
      const head = r.cells[slot.owner];
      edits.push(setInner(kid(kid(head.el, "CellContents"), "ColSpan"), String(head.colSpan - 1)));
      edits.push(removeEl(text, slot.cell.el));
      return;
    }
    const c = slot.cell;
    if (c.colSpan > 1) {
      // سرِ ادغام حذف نمی‌شود؛ سلول جایگزینِ بعدی حذف و ادغام کوتاه می‌شود
      const span = kid(kid(c.el, "CellContents"), "ColSpan");
      edits.push(c.colSpan - 1 === 1 ? removeEl(text, span) : setInner(span, String(c.colSpan - 1)));
      edits.push(removeEl(text, r.cells[index + 1].el));
      return;
    }
    if (c.item?.name) removedNames.push(c.item.name);
    edits.push(removeEl(text, c.el));
  });
  // ارجاع ReportItems! به نام‌های حذف‌شده
  const dangling = removedNames.filter((nm) => new RegExp(`ReportItems!${nm}\\b`).test(text));
  if (dangling.length) {
    throw new EditError(`عبارت‌های دیگر به ${dangling.join("، ")} ارجاع می‌دهند (ReportItems!)؛ اول آن ارجاع‌ها را بردارید.`);
  }
  const colEls = kids(kid(kid(t.el, "TablixBody"), "TablixColumns"), "TablixColumn");
  edits.push(removeEl(text, colEls[index]));
  edits.push(removeEl(text, kids(t.colMembers, "TablixMember")[index]));
  const w = t.columns[index].cm ?? 0;
  const widthEl = kid(t.el, "Width");
  if (widthEl && t.width != null) edits.push(setInner(widthEl, cm(Math.max(0.5, t.width - w))));
  return finish(text, edits, [`ستون ${index + 1} از Tablix «${t.name}» حذف شد (${n} ← ${n - 1}): ستون، عضو سلسله‌مراتب و سلول همهٔ ${t.rows.length} ردیف. عرض بخش گزارش دست نخورد تا چیدمان بقیهٔ آیتم‌ها نلغزد.`]);
}

// ───────────────────────── دیتاست ─────────────────────────

/**
 * CommandText تازه؛ QueryParameter های لازم را هم می‌سازد و برای @های بی‌پارامتر
 * ReportParameter رشته‌ای اضافه می‌کند تا گزارش بی‌خطای «Must declare» اجرا شود.
 */
export function setCommandText(text, { dataSet, sql }) {
  const info = load(text);
  const ds = info.dataSets.find((d) => d.name === dataSet) || info.dataSets[0];
  if (!ds) throw new EditError("فایل دیتاستی ندارد.");
  const ct = kid(kid(ds.el, "Query"), "CommandText");
  if (!ct) throw new EditError(`دیتاست «${ds.name}» CommandText ندارد (احتمالاً دیتاست مشترک است).`);
  const edits = [setInner(ct, String(sql ?? "").trim())];
  const changes = [`متن کوئری دیتاست «${ds.name}» جایگزین شد.`];
  const r = paramEdits(text, info, ds, String(sql ?? ""));
  edits.push(...r.edits);
  changes.push(...r.changes);
  return finish(text, edits, changes);
}

function paramEdits(text, info, ds, sql) {
  const edits = [];
  const changes = [];
  const used = queryParameters(sql);
  const qpEl = kid(kid(ds.el, "Query"), "QueryParameters");
  const have = new Set(ds.queryParams.map((q) => q.name.replace(/^@/, "").toLowerCase()));
  const params = new Map(info.params.map((p) => [p.name.toLowerCase(), p.name]));
  const missingQp = used.filter((u) => !have.has(u.toLowerCase()));
  if (missingQp.length) {
    const xml = missingQp.map((u) => `<QueryParameter Name="@${escapeAttr(u)}"><Value>=Parameters!${escapeText(params.get(u.toLowerCase()) || u)}.Value</Value></QueryParameter>`).join("");
    if (qpEl && !qpEl.selfClosing) edits.push(appendChild(text, qpEl, xml));
    else {
      const ct = kid(kid(ds.el, "Query"), "CommandText");
      edits.push(after(text, ct, `<QueryParameters>${xml}</QueryParameters>`));
    }
    changes.push(`QueryParameter برای ${missingQp.map((m) => "@" + m).join("، ")} ساخته شد.`);
  }
  const missingRp = used.filter((u) => !params.has(u.toLowerCase()));
  if (missingRp.length) {
    const xml = missingRp.map((u) => `<ReportParameter Name="${escapeAttr(u)}"><DataType>String</DataType><Prompt>${escapeText(u)}</Prompt></ReportParameter>`).join("");
    edits.push(insertParams(text, info, xml));
    changes.push(`ReportParameter رشته‌ای برای ${missingRp.join("، ")} ساخته شد — نوع و عنوانشان را در Report Builder بازبینی کنید.`);
  }
  return { edits, changes };
}

function insertParams(text, info, xml) {
  const rp = kid(info.root, "ReportParameters");
  if (rp) return appendChild(text, rp, xml);
  const anchor = kid(info.root, "ReportSections") || kid(info.root, "Body") || kid(info.root, "DataSets");
  return after(text, anchor, `<ReportParameters>${xml}</ReportParameters>`);
}

/**
 * فیلدهای دیتاست را با ستون‌های SELECT هم‌خوان می‌کند.
 * فیلد بی‌ستون فقط اگر `removeGhosts` باشد حذف می‌شود (ممکن است عبارت محاسبه‌ای باشد).
 */
export function syncFields(text, { dataSet, removeGhosts = false, types = {} }) {
  const info = load(text);
  const ds = info.dataSets.find((d) => d.name === dataSet) || info.dataSets[0];
  if (!ds) throw new EditError("فایل دیتاستی ندارد.");
  const out = outputColumns(ds.commandText);
  if (out.star) throw new EditError("کوئری SELECT * دارد؛ ستون‌ها از روی متن قابل دانستن نیست. ستون‌ها را صریح بنویسید.");
  if (!out.columns.length || out.columns.some((c) => !c.name)) throw new EditError("ستون‌های خروجی کوئری خوانده نشد (ستون بی‌نام یا کوئری پیچیده).");
  const fieldsEl = kid(ds.el, "Fields");
  const have = new Set(ds.fields.map((f) => (f.dataField || f.name).toLowerCase()));
  const names = new Set(ds.fields.map((f) => f.name.toLowerCase()));
  const edits = [];
  const changes = [];
  const add = out.columns.filter((c) => !have.has(c.name.toLowerCase()));
  if (add.length) {
    const xml = add.map((c) => {
      let fname = c.name.replace(/[^\w]/g, "_");
      while (names.has(fname.toLowerCase())) fname += "_";
      names.add(fname.toLowerCase());
      return `<Field Name="${escapeAttr(fname)}"><DataField>${escapeText(c.name)}</DataField><rd:TypeName>${rdlType(types[c.name] || c.sqlType)}</rd:TypeName></Field>`;
    }).join("");
    if (fieldsEl) edits.push(appendChild(text, fieldsEl, xml));
    else edits.push(after(text, kid(ds.el, "Query"), `<Fields>${xml}</Fields>`));
    changes.push(`فیلدهای تازه: ${add.map((c) => c.name).join("، ")}`);
  }
  const select = new Set(out.columns.map((c) => c.name.toLowerCase()));
  const ghosts = ds.fields.filter((f) => f.dataField && !select.has(f.dataField.toLowerCase()));
  if (ghosts.length) {
    if (removeGhosts) {
      for (const g of ghosts) edits.push(removeEl(text, g.el));
      changes.push(`فیلدهای بی‌ستون حذف شد: ${ghosts.map((g) => g.name).join("، ")} — ارجاع‌های آن‌ها در Tablix را هم بررسی کنید.`);
    } else {
      changes.push(`فیلدهای بی‌ستون (دست‌نخورده): ${ghosts.map((g) => g.name).join("، ")}`);
    }
  }
  const r = paramEdits(text, info, ds, ds.commandText);
  edits.push(...r.edits);
  changes.push(...r.changes);
  return finish(text, edits, changes);
}

// ───────────────────────── قراردادهای میزبان ─────────────────────────

/** KeepWithGroup ردیف‌های ثابتِ تکرارشونده: بالای گروه After، پایینش Before. */
export function fixKeepWithGroup(text) {
  const info = load(text);
  const edits = [];
  const changes = [];
  for (const t of info.tablixes) {
    if (!t.rowMembers) continue;
    const top = kids(t.rowMembers, "TablixMember");
    const firstGroup = top.findIndex((m) => kid(m, "Group"));
    if (firstGroup === -1) continue;
    top.forEach((m, i) => {
      if (kid(m, "Group") || childText(m, "RepeatOnNewPage") !== "true") return;
      const want = i < firstGroup ? "After" : "Before";
      const keep = kid(m, "KeepWithGroup");
      if (keep && textOf(keep).trim() === want) return;
      if (keep) edits.push(setInner(keep, want));
      else {
        const rep = kid(m, "RepeatOnNewPage");
        edits.push(before(text, rep, `<KeepWithGroup>${want}</KeepWithGroup>`));
      }
      changes.push(`Tablix «${t.name}»، ردیف ثابت ${i + 1}: KeepWithGroup ← ${want}`);
    });
  }
  return finish(text, edits, changes);
}

/**
 * PageHeader ← بالای بدنه؛ PageFooter ← حذف (یا پایین بدنه).
 *
 * آیتم‌های بدنه به‌اندازهٔ ارتفاع هدر پایین می‌روند تا روی هم نیفتند. این همان
 * کاری است که نرم‌افزار میزبان لازم دارد، ولی هدر دیگر در هر صفحه تکرار
 * نمی‌شود؛ برای تکرار، ردیف ثابت تکرارشونده در Tablix لازم است.
 */
export function movePageBandsToBody(text, { footer = "remove" } = {}) {
  const info = load(text);
  const header = info.pageHeader;
  const foot = info.pageFooter;
  if (!header && !foot) return finish(text, [], ["گزارش PageHeader و PageFooter ندارد."]);
  const bodyItems = kid(info.body.el, "ReportItems");
  if (!bodyItems) throw new EditError("بدنهٔ گزارش ReportItems ندارد.");
  const edits = [];
  const changes = [];
  const shift = header ? toCm(childText(header, "Height")) ?? 0 : 0;
  const bodyH = info.body.height ?? 0;
  const movedXml = [];
  const bandItems = (band, dy) => elements(kid(band, "ReportItems")).map((el) => {
    let xml = text.slice(el.start, el.end);
    const topEl = kid(el, "Top");
    const y = (toCm(childText(el, "Top")) ?? 0) + dy;
    if (topEl) {
      const rel = { start: topEl.start - el.start, end: topEl.end - el.start };
      xml = xml.slice(0, rel.start) + `<Top>${cm(y)}</Top>` + xml.slice(rel.end);
    }
    return xml;
  });
  if (header) {
    movedXml.push(...bandItems(header, 0));
    for (const it of elements(bodyItems)) {
      const topEl = kid(it, "Top");
      const y = (toCm(childText(it, "Top")) ?? 0) + shift;
      if (topEl) edits.push(setInner(topEl, cm(y)));
      else edits.push(before(text, kid(it, "Left") || kid(it, "Height") || kid(it, "Width") || kid(it, "Style") || elements(it)[0], `<Top>${cm(y)}</Top>`));
    }
    changes.push(`${movedXml.length} آیتم از هدر صفحه به بالای بدنه منتقل شد و آیتم‌های بدنه ${shift.toFixed(2)}cm پایین رفتند.`);
  }
  let addH = shift;
  if (foot) {
    if (footer === "body") {
      const fItems = bandItems(foot, bodyH + shift);
      movedXml.push(...fItems);
      addH += toCm(childText(foot, "Height")) ?? 0;
      changes.push(`${fItems.length} آیتم فوتر به پایین بدنه منتقل شد.`);
    } else {
      changes.push("فوتر صفحه حذف شد.");
    }
  }
  if (movedXml.length) {
    const first = elements(bodyItems)[0];
    edits.push(first ? before(text, first, movedXml.join("\n")) : appendChild(text, bodyItems, movedXml.join("\n")));
  }
  const bh = kid(info.body.el, "Height");
  if (bh && addH) edits.push(setInner(bh, cm(bodyH + addH)));
  if (header) edits.push(removeEl(text, header));
  if (foot) edits.push(removeEl(text, foot));
  if (/Globals!(PageNumber|TotalPages|OverallPageNumber|OverallTotalPages)/.test(movedXml.join(""))) {
    changes.push("هشدار: آیتمی که شمارهٔ صفحه نشان می‌داد اکنون در بدنه است؛ اگر نرم‌افزار میزبان خطا داد آن را حذف کنید.");
  }
  changes.push("برای تکرار عنوان در همهٔ صفحه‌ها، آن را ردیف ثابت تکرارشوندهٔ Tablix کنید (KeepWithGroup=After + RepeatOnNewPage).");
  return finish(text, edits, changes);
}

/** پارامترهای سیستمی Sys_* که نیستند — پنهان و تهی‌پذیر. */
export function addSysParams(text) {
  const info = load(text);
  const have = new Set(info.params.map((p) => p.name.toLowerCase()));
  const missing = SYS_PARAMS.filter((s) => !have.has(s.toLowerCase()));
  if (!missing.length) return finish(text, [], ["همهٔ پارامترهای سیستمی هستند."]);
  const xml = missing.map((s) => `<ReportParameter Name="${s}"><DataType>String</DataType><Nullable>true</Nullable><AllowBlank>true</AllowBlank><Prompt>${s}</Prompt><Hidden>true</Hidden></ReportParameter>`).join("");
  return finish(text, [insertParams(text, info, xml)], [`پارامترهای سیستمی اضافه شد: ${missing.join("، ")}`]);
}

/** هر Sys_* گزارش والد به هر زیرگزارش هم برسد. */
export function passSysToSubreports(text) {
  const info = load(text);
  const sys = SYS_PARAMS.filter((s) => info.params.some((p) => p.name === s));
  if (!info.subreports.length) return finish(text, [], ["گزارش زیرگزارش ندارد."]);
  if (!sys.length) throw new EditError("خود گزارش پارامتر Sys_* ندارد؛ اول «افزودن پارامترهای سیستمی» را بزنید.");
  const edits = [];
  const changes = [];
  for (const s of info.subreports) {
    const have = new Set(s.params.map((p) => p.name));
    const missing = sys.filter((p) => !have.has(p));
    if (!missing.length) continue;
    const xml = missing.map((p) => `<Parameter Name="${p}"><Value>=Parameters!${p}.Value</Value></Parameter>`).join("");
    const pe = kid(s.el, "Parameters");
    if (pe) edits.push(appendChild(text, pe, xml));
    else edits.push(after(text, kid(s.el, "ReportName"), `<Parameters>${xml}</Parameters>`));
    changes.push(`زیرگزارش «${s.name}»: ${missing.join("، ")}`);
  }
  return finish(text, edits, changes);
}

/** Direction مستقیم زیر Tablix ← LayoutDirection. */
export function fixTablixDirection(text) {
  const info = load(text);
  const edits = [];
  const changes = [];
  for (const t of info.tablixes) {
    const d = kid(t.el, "Direction");
    if (!d) continue;
    const value = textOf(d).trim() || "RTL";
    if (kid(t.el, "LayoutDirection")) edits.push(removeEl(text, d));
    else edits.push(replaceEl(d, `<LayoutDirection>${escapeText(value)}</LayoutDirection>`));
    changes.push(`Tablix «${t.name}»: <Direction> ← <LayoutDirection>${value}</LayoutDirection>`);
  }
  return finish(text, edits, changes);
}

/** شناسهٔ تازه برای گزارشی که از روی گزارش دیگر کپی شده. */
export function newReportId(text) {
  const info = load(text);
  const id = kid(info.root, "ReportID");
  const value = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-000000000000`;
  if (!id) return finish(text, [], ["گزارش rd:ReportID ندارد؛ Report Builder هنگام ذخیره می‌سازد."]);
  return finish(text, [setInner(id, value)], [`rd:ReportID تازه: ${value}`]);
}

/** عرض بخش گزارش = لبهٔ راستِ دورترین آیتم بدنه. */
export function fitSectionWidth(text) {
  const info = load(text);
  const right = Math.max(0, ...info.bodyItems.map((it) => it.left + (it.width ?? 0)));
  const el = kid(info.sectionEl, "Width");
  if (!el || !right) return finish(text, [], ["عرض قابل محاسبه نبود."]);
  if (info.sectionWidth != null && Math.abs(info.sectionWidth - right) < 0.01) return finish(text, [], ["عرض بخش از قبل درست است."]);
  return finish(text, [setInner(el, cm(right))], [`عرض بخش گزارش ${info.sectionWidth?.toFixed(2) ?? "?"} ← ${right.toFixed(2)}cm`]);
}
