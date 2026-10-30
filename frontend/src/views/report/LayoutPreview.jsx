import { useMemo } from "react";
import { EyeOff } from "lucide-react";

import { defaultWidth } from "@/lib/report/build";
import { cn } from "@/lib/utils";

/*
  پیش‌نمایش چیدمان — نمای «طراحی» گزارش، شبیه Report Builder: عنوان‌ها، [فیلد] در
  ردیف جزئیات، [Sum(…)] در ردیف‌های جمع. همان قواعد سازنده (ستون‌های گروه حذف،
  ستون ردیف، ادغام عنوان جمع) را دنبال می‌کند تا آنچه کاربر می‌بیند همان باشد که
  در RDL ساخته می‌شود. زمینه همیشه کاغذی است (مستقل از تم برنامه).
*/

// اندازهٔ واقعی (96dpi) تا نسبت متن به عرض ستون همان چاپ باشد
const PX_PER_CM = 37.8;
// ستون باریک‌تر از این در پیش‌نمایش ناخوانا می‌شود؛ عرض واقعی RDL دست نمی‌خورد
const MIN_CM = 1.4;
const colWidth = (c) => (c.key === "#" ? c.width : Math.max(MIN_CM, c.width));
const isToken = (text) => /^\[/.test(text);
const ref = (name) => `[${name}]`;
const sumRef = (name, agg = "Sum") => `[${agg}(${name})]`;

function tableModel(fields, layout) {
  const groups = layout.kind === "group" ? layout.groups.filter((g) => g.field) : [];
  const groupFields = new Set(groups.map((g) => g.field));
  const byName = new Map(fields.map((f) => [f.name, f]));
  const cols = [];
  if (layout.rowNumber) cols.push({ key: "#", label: "ردیف", width: 1, detail: "#" });
  for (const f of fields) {
    if (f.visible === false || groupFields.has(f.name)) continue;
    cols.push({ key: f.name, label: f.label || f.name, width: Number(f.width) || defaultWidth(f), detail: ref(f.name), total: Boolean(f.total), dynamic: Boolean(f.hideEmpty), field: f.name });
  }
  const firstMeasure = cols.findIndex((c) => c.total);
  const labelSpan = firstMeasure === -1 ? 1 : firstMeasure;
  const totalRow = (kind, label) => {
    const cells = labelSpan ? [{ text: label, span: labelSpan, label: true }] : [];
    for (let i = labelSpan; i < cols.length; i++) cells.push({ text: cols[i].total ? sumRef(cols[i].field) : "" });
    return { kind, cells };
  };
  const rows = [];
  if (layout.repeatTitle) rows.push({ kind: "title" });
  rows.push({ kind: "header", cells: cols.map((c) => ({ text: c.label })) });
  const walk = (level) => {
    if (level >= groups.length) {
      rows.push({ kind: "detail", cells: cols.map((c) => ({ text: c.detail })) });
      rows.push({ kind: "detail", stripe: true, cells: cols.map(() => ({ text: "…" })) });
      return;
    }
    const g = groups[level];
    const label = g.label || byName.get(g.field)?.label || g.field;
    if (g.header !== false) rows.push({ kind: "group_header", level, cells: [{ text: `${label}: ${ref(g.field)}`, span: cols.length }], pageBreak: g.pageBreak });
    walk(level + 1);
    if (g.total !== false) rows.push({ ...totalRow("group_total", `جمع ${label}`), level });
  };
  walk(0);
  if (layout.grandTotal) rows.push(totalRow("grand_total", "جمع کل"));
  return { cols, rows };
}

function matrixModel(fields, layout) {
  const m = layout.matrix || {};
  const byName = new Map(fields.map((f) => [f.name, f]));
  const rowF = byName.get(m.row);
  const colF = byName.get(m.column);
  const valF = byName.get(m.value);
  if (!rowF || !colF || !valF) return null;
  const agg = m.aggregate || "Sum";
  const totals = layout.grandTotal !== false;
  const valW = Math.max(2.2, Number(valF.width) || defaultWidth(valF));
  const cols = [
    { key: "row", width: Number(rowF.width) || defaultWidth(rowF) },
    { key: "col", width: valW, group: true },
    { key: "col2", width: valW, group: true, ghost: true },
    ...(totals ? [{ key: "tot", width: valW }] : []),
  ];
  const v = sumRef(valF.name, agg);
  const rows = [
    { kind: "header", cells: [{ text: rowF.label || rowF.name }, { text: ref(colF.name) }, { text: "…" }, ...(totals ? [{ text: "جمع" }] : [])] },
    { kind: "detail", cells: [{ text: ref(rowF.name), label: true }, { text: v }, { text: "…" }, ...(totals ? [{ text: v, strong: true }] : [])] },
    { kind: "detail", stripe: true, cells: [{ text: "…" }, { text: "…" }, { text: "…" }, ...(totals ? [{ text: "…" }] : [])] },
  ];
  if (totals) rows.push({ kind: "grand_total", cells: [{ text: "جمع کل", label: true }, { text: v }, { text: "…" }, { text: v }] });
  return { cols, rows, matrix: true };
}

export function LayoutPreview({ title, fields, params = [], layout, profile }) {
  const model = useMemo(
    () => (layout.kind === "matrix" ? matrixModel(fields, layout) : tableModel(fields, layout)),
    [fields, layout],
  );
  if (!model) {
    return <p className="text-[11.5px] text-muted-foreground">برای پیش‌نمایش ماتریس، فیلد سطر، ستون و مقدار را انتخاب کنید.</p>;
  }
  if (!model.cols.length) {
    return <p className="text-[11.5px] text-warn">هیچ ستونی برای نمایش انتخاب نشده است.</p>;
  }
  const width = model.cols.reduce((a, c) => a + colWidth(c), 0);
  const bgOf = (r) =>
    r.kind === "header" ? profile.headerBg
      : r.kind === "group_header" ? profile.groupBg
        : r.kind === "group_total" || r.kind === "grand_total" ? profile.totalBg
          : r.stripe && layout.stripes ? profile.stripeBg : "#FFFFFF";
  const dynamic = model.cols.filter((c) => c.dynamic);
  const shown = params.filter((p) => !p.hidden);
  const filters = layout.showFilters && shown.length ? shown.map((p) => `${p.prompt || p.name}: [${p.name}]`).join("   |   ") : "";

  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto rounded-md border border-border bg-[#f4f4f2] p-3">
        <div dir="rtl" className="mx-auto bg-white p-3 text-[#111] shadow-sm" style={{ width: width * PX_PER_CM + 24, fontFamily: `"${profile.fontFamily}", Vazirmatn, Tahoma, sans-serif` }}>
          {!layout.repeatTitle && (
            <div className="pb-1 text-center font-bold" style={{ fontSize: `${profile.titleFontSize}pt` }}>{title || "گزارش"}</div>
          )}
          {filters && <div className="pb-2 text-center text-[10px] text-[#555]">{filters}</div>}
          <table className="border-collapse" style={{ width: width * PX_PER_CM, tableLayout: "fixed", fontSize: `${profile.fontSize}pt` }}>
            <colgroup>
              {model.cols.map((c) => <col key={c.key} style={{ width: colWidth(c) * PX_PER_CM }} />)}
            </colgroup>
            <tbody>
              {model.rows.map((r, i) => {
                if (r.kind === "title") {
                  return (
                    <tr key={i}>
                      <td colSpan={model.cols.length} className="py-1 text-center font-bold" style={{ fontSize: `${profile.titleFontSize}pt` }}>{title || "گزارش"}</td>
                    </tr>
                  );
                }
                let c0 = 0;
                return (
                  <tr key={i} style={{ background: bgOf(r) }} className={cn(r.pageBreak && "border-b-2 border-dashed border-[#c55]")}>
                    {r.cells.map((cell, k) => {
                      const col = model.cols[c0];
                      c0 += cell.span || 1;
                      const heading = r.kind === "header" || r.kind === "group_header" || r.kind.endsWith("_total") || cell.label || cell.strong;
                      return (
                        <td
                          key={k}
                          colSpan={cell.span || 1}
                          dir={isToken(cell.text) ? "ltr" : undefined}
                          className={cn(
                            "border border-[#c8c8c8] px-1 py-0.5",
                            r.kind === "header" ? "break-words" : "truncate",
                            r.kind === "header" && "text-center",
                            r.kind === "group_header" && "text-start",
                            heading && "font-bold",
                            isToken(cell.text) && !cell.label && r.kind !== "group_header" && "font-mono text-[0.85em] text-[#1f4e79]",
                            col?.dynamic && (cell.span || 1) === 1 && "bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(197,85,85,0.08)_4px,rgba(197,85,85,0.08)_8px)]",
                            col?.ghost && "text-[#999]",
                          )}
                          title={cell.text}
                        >
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        نمای طراحی است، نه داده‌ی واقعی: [نام فیلد] جای مقدار هر ردیف و [Sum(…)] جای جمع است.
        {model.matrix ? " ستون‌های ماتریس به تعداد مقدارهای فیلد ستون تکثیر می‌شوند." : ""}
      </p>
      {dynamic.length > 0 && (
        <p className="flex items-start gap-1 text-[10.5px] leading-relaxed text-muted-foreground">
          <EyeOff className="mt-0.5 h-3 w-3 shrink-0" />
          ستون‌های هاشورخورده ({dynamic.map((c) => c.label).join("، ")}) پویا هستند: اگر در کل نتیجه هیچ مقداری (یا برای عددی‌ها فقط صفر) نداشته باشند، با عنوان و جمعشان پنهان می‌شوند.
        </p>
      )}
    </div>
  );
}
