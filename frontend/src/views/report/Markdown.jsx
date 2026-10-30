import { Fragment, useMemo } from "react";

import { cn } from "@/lib/utils";
import { slug } from "@/lib/report/docs";
import { SqlBlock } from "@/components/primitives";

/*
  نمایشگر Markdown سبک و امن برای مرجع‌های داخل برنامه.

  هیچ HTML خامی تزریق نمی‌شود (dangerouslySetInnerHTML ندارد): هر سطر به عنصر
  React تبدیل می‌شود، پس متن مرجع — هرچه باشد — نمی‌تواند اسکریپت اجرا کند.
  فقط همان زیرمجموعه‌ای که مرجع‌ها به‌کار می‌برند: سرتیتر، بند، فهرست، جدول،
  نقل‌قول، بلوک کد، خط افقی و درون‌خطی‌های ** و ` و [پیوند](…).
*/

const LTR = /^[\x00-\x7F]+$/;

function inline(text, keyBase = "i") {
  const out = [];
  // متن پررنگ می‌تواند کد درون‌خطی با «*» داشته باشد (مثل `schemas/*.md`)
  const re = /(\*\*(?:`[^`]+`|[^*`])+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      const code = tok.slice(1, -1);
      out.push(<code key={`${keyBase}${k++}`} dir={LTR.test(code) ? "ltr" : undefined} className="rounded bg-ink px-1 py-0.5 font-mono text-[0.88em] text-brand-text">{code}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyBase}${k++}`} className="font-bold text-foreground">{inline(tok.slice(2, -2), `${keyBase}${k}b`)}</strong>);
    } else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      const href = lm[2];
      out.push(/^https?:\/\//.test(href)
        ? <a key={`${keyBase}${k++}`} href={href} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-2">{lm[1]}</a>
        : <span key={`${keyBase}${k++}`} className="text-brand-text">{lm[1]}</span>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parse(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({ type: "h", level: h[1].length, text: h[2].trim() });
      i += 1;
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      // «\|» داخل سلول جداکننده نیست (بی lookbehind، که نمایشگرهای وب قدیمی ندارند)
      const row = (l) => l.trim().replace(/^\||\|$/g, "").replace(/\\\|/g, "\u0000").split("|").map((c) => c.trim().replace(/\u0000/g, "|"));
      const head = row(line);
      const body = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) body.push(row(lines[i++]));
      blocks.push({ type: "table", head, body });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        if (/^\s*([-*]|\d+[.)])\s+/.test(l)) items.push({ text: l.replace(/^\s*([-*]|\d+[.)])\s+/, ""), depth: Math.min(2, Math.floor((l.match(/^\s*/)[0].length) / 2)) });
        else items[items.length - 1].text += ` ${l.trim()}`;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*>|\s*([-*]|\d+[.)])\s+|\s*\|)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim());
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

export default function Markdown({ text, className }) {
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <div className={cn("space-y-2.5 text-[12.5px] leading-7 text-foreground/90", className)}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h": {
            const Tag = `h${Math.min(b.level + 1, 5)}`;
            const size = ["text-base", "text-[14px]", "text-[13px]", "text-[12.5px]"][b.level - 1];
            return <Tag key={i} id={slug(b.text)} className={cn("scroll-mt-20 pt-2 font-extrabold text-foreground", size)}>{inline(b.text, `h${i}`)}</Tag>;
          }
          case "code":
            return <SqlBlock key={i} sql={b.text} title={b.lang || "کد"} />;
          case "hr":
            return <hr key={i} className="border-border" />;
          case "quote":
            return <blockquote key={i} className="rounded-md border-s-4 border-brand/50 bg-brand/5 px-3 py-2 text-[12px]">{inline(b.text, `q${i}`)}</blockquote>;
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-ink/60"><tr>{b.head.map((c, k) => <th key={k} className="px-2 py-1.5 text-start font-semibold text-foreground">{inline(c, `th${i}${k}`)}</th>)}</tr></thead>
                  <tbody>{b.body.map((r, k) => <tr key={k} className="border-t border-border/70 align-top">{r.map((c, j) => <td key={j} className="px-2 py-1.5">{inline(c, `td${i}${k}${j}`)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={cn("space-y-1 ps-5", b.ordered ? "list-decimal" : "list-disc")}>
                {b.items.map((it, k) => {
                  const task = /^\[( |x)\]\s+/i.exec(it.text);
                  return (
                    <li key={k} className={cn(it.depth && "ms-4", task && "list-none -ms-5")}>
                      {task ? (
                        <Fragment>
                          <span className="me-1.5 inline-block font-mono text-brand-text">{task[1].trim() ? "☑" : "☐"}</span>
                          {inline(it.text.slice(task[0].length), `l${i}${k}`)}
                        </Fragment>
                      ) : inline(it.text, `l${i}${k}`)}
                    </li>
                  );
                })}
              </Tag>
            );
          }
          default:
            return <p key={i}>{inline(b.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
}
