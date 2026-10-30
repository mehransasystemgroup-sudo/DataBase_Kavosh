/**
 * تجزیه‌گر سبک XML — مخصوص RDL، با موقعیت دقیق هر گره در متن اصلی.
 *
 * چرا خودمان و نه DOMParser:
 *   • ویرایش RDL باید «جراحی» باشد، نه بازنویسی. Report Builder فاصله‌ها،
 *     کامنت‌ها و ترتیب صفت‌ها را نگه می‌دارد و کاربر فایلش را در همان ابزار
 *     دوباره باز می‌کند. سریال‌سازی دوبارهٔ DOM همهٔ این‌ها را به‌هم می‌ریزد و
 *     diff تغییر را غیرقابل‌خواندن می‌کند. پس هر گره موقعیت شروع و پایانش را در
 *     متن اصلی دارد و ویرایش فقط همان بازه را عوض می‌کند.
 *   • همین کد در مرورگر، در نمایشگر وب اندروید و در آزمون‌های Node اجرا
 *     می‌شود؛ DOMParser در Node نیست.
 *   • پیام خطا باید سطر و ستون بدهد، چون RDL چندمگابایتی را چشمی نمی‌شود گشت.
 *
 * فقط آنچه RDL لازم دارد پشتیبانی می‌شود: عنصر، صفت، متن، CDATA، کامنت و
 * دستور پردازش. DTD در RDL نیست و اگر بیاید خطای صریح می‌دهد.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export class XmlError extends Error {
  constructor(message, offset, text) {
    const { line, col } = position(text, offset);
    super(`${message} (سطر ${line}، ستون ${col})`);
    this.offset = offset;
    this.line = line;
    this.col = col;
    this.reason = message;
  }
}

/** سطر و ستون یک موقعیت — یک‌مبنا، همان چیزی که ویرایشگرها نشان می‌دهند. */
export function position(text, offset) {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: end - last };
}

/** رمزگشایی ارجاع‌های نویسه‌ای؛ ارجاع ناشناخته خطاست، چون XML نامعتبر است. */
export function decode(raw, base = 0, text = raw) {
  if (raw.indexOf("&") === -1) return raw;
  return raw.replace(/&([^;&\s<]*);?/g, (match, name, at) => {
    if (!match.endsWith(";")) throw new XmlError("نویسهٔ & بدون ارجاع کامل (باید &amp; نوشته شود)", base + at, text);
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        throw new XmlError(`ارجاع نویسه‌ای نامعتبر «${match}»`, base + at, text);
      }
      return String.fromCodePoint(code);
    }
    if (!(name in ENTITIES)) throw new XmlError(`موجودیت ناشناختهٔ «${match}»`, base + at, text);
    return ENTITIES[name];
  });
}

/** متن برای قرار گرفتن داخل عنصر XML. */
export function escapeText(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** متن برای قرار گرفتن داخل مقدار صفت. */
export function escapeAttr(value) {
  return escapeText(value).replace(/"/g, "&quot;");
}

const NAME_START = /[A-Za-z_:À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￿]/;

/**
 * متن XML ← درخت.
 *
 * هر عنصر: { type: "element", name, attrs, attrList, children, parent,
 *            start, end, openEnd, closeStart, selfClosing }
 *   start      موقعیت «<» آغازین
 *   openEnd    موقعیت پس از «>» تگ آغازین
 *   closeStart موقعیت «</» پایانی (برای خودبسته برابر openEnd)
 *   end        موقعیت پس از «>» پایانی
 *
 * خطا را پرتاب می‌کند (XmlError)؛ برای نسخهٔ بی‌پرتاب `tryParse` هست.
 */
export function parseXml(text) {
  const n = text.length;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM

  const doc = { type: "document", children: [], start: 0, end: n };
  const stack = [doc];
  let root = null;
  const top = () => stack[stack.length - 1];

  const fail = (msg, at = i) => {
    throw new XmlError(msg, at, text);
  };

  const readName = () => {
    const begin = i;
    if (i >= n || !NAME_START.test(text[i])) fail("نام عنصر یا صفت نامعتبر است");
    i++;
    while (i < n && NAME_CHAR.test(text[i])) i++;
    return text.slice(begin, i);
  };

  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };

  while (i < n) {
    const lt = text.indexOf("<", i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      const raw = text.slice(i, textEnd);
      const parent = top();
      if (parent === doc) {
        if (raw.trim()) fail("متن بیرون از عنصر ریشه", i + raw.search(/\S/));
      } else {
        if (raw.includes("]]>")) fail("رشتهٔ «]]>» در متن مجاز نیست", i + raw.indexOf("]]>"));
        parent.children.push({ type: "text", value: decode(raw, i, text), raw, start: i, end: textEnd, parent });
      }
    }
    if (lt === -1) break;
    i = lt;

    if (text.startsWith("<!--", i)) {
      const close = text.indexOf("-->", i + 4);
      if (close === -1) fail("کامنت بسته نشده است");
      const body = text.slice(i + 4, close);
      const dash = body.indexOf("--");
      if (dash !== -1 || body.endsWith("-")) {
        fail("«--» داخل کامنت XML مجاز نیست (خط جداکننده را با = بنویسید)", i + 4 + (dash === -1 ? body.length - 1 : dash));
      }
      top().children.push({ type: "comment", value: body, start: i, end: close + 3, parent: top() });
      i = close + 3;
      continue;
    }

    if (text.startsWith("<![CDATA[", i)) {
      if (top() === doc) fail("CDATA بیرون از عنصر ریشه");
      const close = text.indexOf("]]>", i + 9);
      if (close === -1) fail("بخش CDATA بسته نشده است");
      top().children.push({ type: "cdata", value: text.slice(i + 9, close), start: i, end: close + 3, parent: top() });
      i = close + 3;
      continue;
    }

    if (text.startsWith("<?", i)) {
      const close = text.indexOf("?>", i + 2);
      if (close === -1) fail("دستور پردازش بسته نشده است");
      const target = text.slice(i + 2, close).split(/\s/)[0];
      if (target.toLowerCase() === "xml" && i > (text.charCodeAt(0) === 0xfeff ? 1 : 0)) {
        fail("اعلان <?xml ?> فقط باید اولین چیز فایل باشد");
      }
      top().children.push({ type: "pi", target, start: i, end: close + 2, parent: top() });
      i = close + 2;
      continue;
    }

    if (text.startsWith("<!", i)) fail("DTD یا اعلان ناشناخته در RDL پشتیبانی نمی‌شود");

    if (text[i + 1] === "/") {
      const start = i;
      i += 2;
      const name = readName();
      skipSpace();
      if (text[i] !== ">") fail(`تگ پایانی </${name}> درست بسته نشده است`);
      i++;
      const open = top();
      if (open === doc) fail(`تگ پایانی </${name}> بدون تگ آغازین`, start);
      if (open.name !== name) {
        fail(`تگ پایانی </${name}> با تگ آغازین <${open.name}> نمی‌خواند`, start);
      }
      open.closeStart = start;
      open.end = i;
      stack.pop();
      continue;
    }

    // تگ آغازین
    const start = i;
    i++;
    const name = readName();
    const attrs = {};
    const attrList = [];
    for (;;) {
      const before = i;
      skipSpace();
      if (text[i] === ">" || text.startsWith("/>", i)) break;
      if (i >= n) fail(`تگ <${name}> بسته نشده است`, start);
      if (i === before) fail(`بین صفت‌های <${name}> فاصله لازم است`);
      const attrStart = i;
      const attr = readName();
      skipSpace();
      if (text[i] !== "=") fail(`صفت «${attr}» در <${name}> مقدار ندارد`);
      i++;
      skipSpace();
      const quote = text[i];
      if (quote !== '"' && quote !== "'") fail(`مقدار صفت «${attr}» باید داخل گیومه باشد`);
      const close = text.indexOf(quote, i + 1);
      if (close === -1) fail(`گیومهٔ صفت «${attr}» بسته نشده است`);
      const raw = text.slice(i + 1, close);
      if (raw.includes("<")) fail(`نویسهٔ < داخل مقدار صفت «${attr}» مجاز نیست`, i + 1 + raw.indexOf("<"));
      if (attr in attrs) fail(`صفت «${attr}» در <${name}> تکراری است`, attrStart);
      const value = decode(raw, i + 1, text);
      attrs[attr] = value;
      attrList.push({ name: attr, value, start: attrStart, valueStart: i + 1, valueEnd: close });
      i = close + 1;
    }
    const selfClosing = text[i] === "/";
    i += selfClosing ? 2 : 1;
    const parent = top();
    if (parent === doc) {
      if (root) fail("بیش از یک عنصر ریشه", start);
    }
    const el = {
      type: "element", name, attrs, attrList, children: [], parent,
      start, openEnd: i, closeStart: selfClosing ? i : -1, end: selfClosing ? i : -1, selfClosing,
    };
    parent.children.push(el);
    if (parent === doc) root = el;
    if (!selfClosing) stack.push(el);
  }

  if (stack.length > 1) {
    const open = top();
    throw new XmlError(`تگ <${open.name}> بسته نشده است`, open.start, text);
  }
  if (!root) throw new XmlError("فایل هیچ عنصری ندارد", 0, text);
  doc.root = root;
  doc.text = text;
  return doc;
}

/** بی‌پرتاب: { doc } یا { error }. */
export function tryParse(text) {
  try {
    return { doc: parseXml(String(text ?? "")), error: null };
  } catch (error) {
    if (error instanceof XmlError) return { doc: null, error };
    throw error;
  }
}

// ───────────────────────── پیمایش ─────────────────────────

/** نام بدون پیشوند فضای نام: «rd:TypeName» ← «TypeName». */
export const local = (name) => (name.includes(":") ? name.slice(name.indexOf(":") + 1) : name);

export const elements = (node) => (node?.children || []).filter((c) => c.type === "element");

/** فرزندان مستقیم با نام (بدون پیشوند یا با پیشوند دقیق). */
export function kids(node, name) {
  return elements(node).filter((c) => c.name === name || local(c.name) === name);
}

export const kid = (node, name) => kids(node, name)[0] || null;

/** همهٔ نوادگان با این نام، به ترتیب سند. */
export function findAll(node, name) {
  const out = [];
  const visit = (el) => {
    for (const c of elements(el)) {
      if (c.name === name || local(c.name) === name) out.push(c);
      visit(c);
    }
  };
  if (node) visit(node);
  return out;
}

/** متن رمزگشایی‌شدهٔ یک عنصر (متن و CDATA مستقیم و نوادگان). */
export function textOf(node) {
  if (!node) return "";
  let out = "";
  for (const c of node.children || []) {
    if (c.type === "text" || c.type === "cdata") out += c.value;
    else if (c.type === "element") out += textOf(c);
  }
  return out;
}

/** متن فرزندِ نام‌دار — رایج‌ترین پرسش در RDL. */
export const childText = (node, name) => textOf(kid(node, name)).trim();

/** مسیر عنصر از ریشه — برای پیام‌های خطا. */
export function pathOf(node) {
  const parts = [];
  for (let el = node; el && el.type === "element"; el = el.parent) {
    parts.unshift(el.attrs?.Name ? `${local(el.name)}[${el.attrs.Name}]` : local(el.name));
  }
  return parts.join(" › ");
}

/** نزدیک‌ترین نیای با این نام. */
export function ancestor(node, name) {
  for (let el = node?.parent; el && el.type === "element"; el = el.parent) {
    if (el.name === name || local(el.name) === name) return el;
  }
  return null;
}

/** تورفتگی سطری که عنصر در آن شروع شده — برای درج هم‌تراز. */
export function indentOf(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(lineStart, offset));
  return m ? m[0] : "";
}
