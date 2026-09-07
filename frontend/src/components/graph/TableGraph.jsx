import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  GitFork,
  Network,
  Search,
  Share2,
  Table2,
  X,
} from "lucide-react";

import { cn, fa, splitTable } from "@/lib/utils";
import { schemaAccent } from "@/lib/schemaTheme";
import { Badge, CopyButton, EmptyState } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useGraphTheme } from "@/components/graph/useGraphTheme";
import {
  CanvasControls,
  useElementSize,
  useFullscreen,
  useZoom,
} from "@/components/graph/canvas";

const LAYOUTS = [
  { id: "force", label: "نیرو‌محور", icon: Network },
  { id: "tree", label: "سلسله‌مراتبی", icon: GitFork },
  { id: "radial", label: "شعاعی", icon: Share2 },
  { id: "erd", label: "ERD متنی", icon: Table2 },
];

const DIRECTIONS = [
  { id: "all", label: "همه" },
  { id: "out", label: "خروجی" },
  { id: "in", label: "ورودی" },
];

const NODE_W = 132;
const NODE_H = 42;

/** گره‌ها و یال‌های همسایگی یک جدول را از داده‌ی همان جدول می‌سازد. */
function buildGraph(table, { direction, schema, query }) {
  const center = table.full_name;
  const nodes = new Map([
    [center, { id: center, center: true, schema: splitTable(center).schema, title: table.title_fa }],
  ]);
  const links = [];
  const q = query.trim().toLowerCase();

  const consider = (other, link) => {
    const otherSchema = splitTable(other).schema;
    if (schema !== "all" && otherSchema !== schema) return;
    if (q && !`${other} ${link.from_col} ${link.to_col}`.toLowerCase().includes(q)) return;
    if (!nodes.has(other)) {
      nodes.set(other, { id: other, center: false, schema: otherSchema });
    }
    links.push(link);
  };

  if (direction !== "in") {
    for (const j of table.outgoing || []) {
      consider(j.to_table, {
        source: center,
        target: j.to_table,
        from_col: j.from_col,
        to_col: j.to_col,
        verified: j.verified,
        direction: "out",
      });
    }
  }
  if (direction !== "out") {
    for (const j of table.incoming || []) {
      consider(j.from_table, {
        source: j.from_table,
        target: center,
        from_col: j.from_col,
        to_col: j.to_col,
        verified: j.verified,
        direction: "in",
      });
    }
  }

  return { nodes: [...nodes.values()], links };
}

/** چیدمان‌های قطعی (غیرفیزیکی) — نتیجه‌ی یکسان در هر بار رندر. */
function staticLayout(mode, nodes, links, width, height) {
  const center = nodes.find((n) => n.center);
  const outs = nodes.filter(
    (n) => !n.center && links.some((l) => l.direction === "out" && l.target === n.id),
  );
  const ins = nodes.filter((n) => !n.center && !outs.includes(n));

  const cx = width / 2;
  const cy = height / 2;

  if (center) {
    center.x = cx;
    center.y = cy;
  }

  if (mode === "radial") {
    const radius = Math.max(150, Math.min(width, height) / 2 - 90);
    const place = (list, from, to) =>
      list.forEach((n, i) => {
        const t = list.length === 1 ? 0.5 : i / (list.length - 1);
        const angle = from + (to - from) * t;
        n.x = cx + radius * Math.cos(angle);
        n.y = cy + radius * Math.sin(angle);
      });
    place(outs, -Math.PI * 0.42, Math.PI * 0.42);
    place(ins, Math.PI * 0.58, Math.PI * 1.42);
    return;
  }

  // سلسله‌مراتبی: ورودی‌ها بالا، جدول جاری وسط، خروجی‌ها پایین.
  const gapY = 190;
  const spread = (list, y) => {
    const step = NODE_W + 46;
    const totalWidth = Math.max(0, (list.length - 1) * step);
    list.forEach((n, i) => {
      n.x = cx - totalWidth / 2 + i * step;
      n.y = y;
    });
  };
  spread(ins, cy - gapY);
  spread(outs, cy + gapY);
}

/** خروجی ERD متنی — برای چسباندن در مستندات یا ابزارهای نموداری. */
function buildErd(table, links) {
  const lines = [`erDiagram`];
  for (const l of links) {
    const a = l.source.replace(".", "_");
    const b = l.target.replace(".", "_");
    lines.push(`  ${b} ||--o{ ${a} : "${l.from_col} → ${l.to_col}"`);
  }
  if (links.length === 0) lines.push(`  ${table.full_name.replace(".", "_")}`);
  return lines.join("\n");
}

export default function TableGraph({ table, onSelectTable }) {
  const t = useGraphTheme();
  const [wrapRef, size] = useElementSize();
  const svgRef = useRef(null);
  const rootRef = useRef(null);
  const simulationRef = useRef(null);

  const [layout, setLayout] = useState("force");
  const [direction, setDirection] = useState("all");
  const [schemaFilter, setSchemaFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [physics, setPhysics] = useState(false);
  const [selected, setSelected] = useState(null);
  const [isFullscreen, setFullscreen, fullscreenClass] = useFullscreen();

  const { controls: zoom, level: zoomLevel } = useZoom(svgRef, rootRef);

  const schemas = useMemo(() => {
    const set = new Set([splitTable(table.full_name).schema]);
    (table.outgoing || []).forEach((j) => set.add(splitTable(j.to_table).schema));
    (table.incoming || []).forEach((j) => set.add(splitTable(j.from_table).schema));
    return [...set].sort();
  }, [table]);

  const graph = useMemo(
    () => buildGraph(table, { direction, schema: schemaFilter, query }),
    [table, direction, schemaFilter, query],
  );

  // با تعویض جدول، انتخاب قبلی بی‌معنا می‌شود
  useEffect(() => setSelected(null), [table.full_name]);

  const erd = useMemo(() => buildErd(table, graph.links), [table, graph.links]);

  const render = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    simulationRef.current?.stop();

    const { width, height } = size;
    if (!width || !height || graph.nodes.length === 0) return;

    // کپی تازه: d3 مختصات را روی خود شیء می‌نویسد
    const nodes = graph.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = graph.links
      .map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) }))
      .filter((l) => l.source && l.target);

    const defs = svg.append("defs");
    for (const [id, color] of [
      ["tg-arrow", t.link],
      ["tg-arrow-on", t.brand],
    ]) {
      defs
        .append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 12)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color);
    }

    const root = svg.append("g");
    rootRef.current = root.node();

    const linkLayer = root.append("g");
    const nodeLayer = root.append("g");

    const linkSel = linkLayer
      .selectAll("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", (d) => (d.verified ? t.linkVerified : t.linkWeak))
      .attr("stroke-width", 1.4)
      .attr("stroke-dasharray", (d) => (d.verified ? null : "4 3"))
      .attr("marker-end", "url(#tg-arrow)")
      .attr("opacity", 0.75);

    const nodeSel = nodeLayer
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (_event, d) => setSelected(d))
      .on("dblclick", (_event, d) => !d.center && onSelectTable?.(d.id));

    nodeSel
      .append("rect")
      .attr("x", -NODE_W / 2)
      .attr("y", -NODE_H / 2)
      .attr("width", NODE_W)
      .attr("height", NODE_H)
      .attr("rx", 9)
      .attr("fill", (d) => (d.center ? t.surface : schemaAccent(d.schema, t.isDark).fill))
      .attr("stroke", (d) =>
        d.center ? t.brand : schemaAccent(d.schema, t.isDark).stroke,
      )
      .attr("stroke-width", (d) => (d.center ? 2.2 : 1.2));

    nodeSel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("y", -3)
      .attr("class", "graph-label")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .attr("fill", (d) => (d.center ? t.brandText : t.fg))
      .text((d) => {
        const { name } = splitTable(d.id);
        return name.length > 16 ? `${name.slice(0, 15)}…` : name;
      });

    nodeSel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("y", 12)
      .attr("class", "graph-label")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", 9)
      .attr("fill", (d) => schemaAccent(d.schema, t.isDark).text)
      .text((d) => splitTable(d.id).schema);

    nodeSel.append("title").text((d) => d.id);

    const curve = (d) => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dr = Math.hypot(dx, dy) * 1.9 || 1;
      return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
    };

    const paint = () => {
      linkSel.attr("d", curve);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    };

    zoom.attach();

    if (layout === "force") {
      const sim = d3
        .forceSimulation(nodes)
        .force(
          "link",
          d3.forceLink(links).id((d) => d.id).distance(170).strength(0.65),
        )
        .force("charge", d3.forceManyBody().strength(-620))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide(NODE_W * 0.62))
        .on("tick", paint);

      nodes.forEach((n) => {
        if (n.center) {
          n.fx = width / 2;
          n.fy = height / 2;
        }
      });

      nodeSel.call(
        d3
          .drag()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            if (!d.center) {
              d.fx = null;
              d.fy = null;
            }
          }),
      );

      // چیدمان را پیش از رسم تا آرام‌شدن جلو می‌بریم تا گراف بدون پرش
      // و در جای درست ظاهر شود.
      sim.stop();
      for (let i = 0; i < 220; i += 1) sim.tick();
      paint();

      simulationRef.current = sim;
      if (physics) sim.alpha(0.2).restart();
    } else {
      staticLayout(layout, nodes, links, width, height);
      paint();
    }

    const frame = requestAnimationFrame(() => zoom.fit());
    return () => cancelAnimationFrame(frame);
  }, [graph, size, layout, physics, t, zoom, onSelectTable]);

  useEffect(() => {
    if (layout === "erd") return undefined;
    const cleanup = render();
    return () => {
      cleanup?.();
      simulationRef.current?.stop();
    };
  }, [render, layout]);

  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim) return;
    if (physics) sim.alphaTarget(0.12).restart();
    else sim.stop();
  }, [physics]);

  const total = (table.outgoing || []).length + (table.incoming || []).length;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-surface",
        fullscreenClass,
      )}
    >
      {/* نوار ابزار */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-ink/60 p-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          {LAYOUTS.map((l) => {
            const Icon = l.icon;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayout(l.id)}
                title={l.label}
                className={cn(
                  "flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  layout === l.id
                    ? "bg-brand text-brand-foreground"
                    : "text-muted-foreground hover:bg-surfaceHover hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden md:inline">{l.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5">
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDirection(d.id)}
              className={cn(
                "rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                direction === d.id
                  ? "bg-brand/15 text-brand-text"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[9rem] flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="فیلتر جدول یا ستون…"
            className="h-8 ps-8 text-[11px]"
          />
        </div>

        <Select
          value={schemaFilter}
          onChange={(e) => setSchemaFilter(e.target.value)}
          className="h-8 w-32 text-[11px]"
          aria-label="فیلتر اسکیما"
        >
          <option value="all">همهٔ اسکیماها</option>
          {schemas.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Badge tone="brand">{fa(graph.links.length)} از {fa(total)} رابطه</Badge>
      </div>

      {/* بوم */}
      {layout === "erd" ? (
        <div className="p-3">
          <div className="overflow-hidden rounded-lg border border-border bg-ink">
            <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                Mermaid erDiagram
              </span>
              <CopyButton text={erd} message="نمودار ERD کپی شد." />
            </div>
            <pre className="sql-block max-h-[26rem] overflow-auto p-3 text-[11.5px] leading-6 text-foreground/90">
              <code>{erd}</code>
            </pre>
          </div>
        </div>
      ) : (
        <div
          ref={wrapRef}
          className={cn(
            "relative min-h-0 w-full bg-ink/40",
            isFullscreen ? "flex-1" : "h-[clamp(320px,52vh,620px)]",
          )}
        >
          {graph.nodes.length <= 1 ? (
            <div className="flex h-full items-center justify-center p-4">
              <EmptyState
                icon={Network}
                title="رابطه‌ای برای نمایش نیست"
                description="این جدول با فیلترهای فعلی به جدول دیگری وصل نمی‌شود."
                className="border-0 bg-transparent"
              />
            </div>
          ) : (
            <svg ref={svgRef} width="100%" height="100%" className="touch-none select-none" />
          )}

          <CanvasControls
            onZoomIn={() => zoom.scaleBy(1.35)}
            onZoomOut={() => zoom.scaleBy(0.72)}
            onFit={() => zoom.fit()}
            onReset={zoom.reset}
            onToggleFullscreen={() => setFullscreen((f) => !f)}
            isFullscreen={isFullscreen}
            physics={layout === "force" ? physics : undefined}
            onTogglePhysics={layout === "force" ? () => setPhysics((p) => !p) : undefined}
            level={zoomLevel}
          />

          {/* راهنما */}
          <div className="pointer-events-none absolute bottom-2 start-2 hidden flex-wrap gap-1.5 text-[10px] sm:flex">
            <span className="rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-muted-foreground backdrop-blur">
              دوبار کلیک روی گره = باز کردن جدول
            </span>
            <span className="rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-muted-foreground backdrop-blur">
              خط‌چین = رابطهٔ تأییدنشده
            </span>
          </div>

          {/* کارت گرهٔ انتخاب‌شده */}
          {selected && (
            <div className="absolute bottom-16 end-2 w-[min(19rem,calc(100%-1rem))] animate-fade-up sm:bottom-2 rounded-lg border border-border bg-surface/95 p-2.5 shadow-panel backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="font-mono text-[10px]"
                    style={{ color: schemaAccent(selected.schema, t.isDark).text }}
                  >
                    {selected.schema}
                  </div>
                  <div className="ltr truncate font-mono text-xs font-bold text-foreground">
                    {splitTable(selected.id).name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="بستن"
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {graph.links
                  .filter((l) => l.source === selected.id || l.target === selected.id)
                  .slice(0, 4)
                  .map((l, i) => (
                    <span
                      key={`${l.from_col}-${l.to_col}-${i}`}
                      className="ltr inline-flex items-center gap-1 rounded border border-border bg-ink px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                    >
                      {l.direction === "out" ? (
                        <ArrowUpRight className="h-2.5 w-2.5 text-brand-text" />
                      ) : (
                        <ArrowDownLeft className="h-2.5 w-2.5 text-info" />
                      )}
                      {l.from_col} → {l.to_col}
                    </span>
                  ))}
              </div>

              {!selected.center && (
                <button
                  type="button"
                  onClick={() => onSelectTable?.(selected.id)}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-2 py-1.5 text-[11px] font-semibold text-brand-foreground transition-opacity hover:opacity-90"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  باز کردن این جدول
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
