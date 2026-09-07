import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  AlertTriangle,
  Database,
  ExternalLink,
  Layers,
  Link2,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { errorMessage, http } from "@/lib/api";
import { cn, fa, faCompact, splitTable } from "@/lib/utils";
import { schemaAccent, schemaLabel } from "@/lib/schemaTheme";
import { Badge, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { useGraphTheme } from "@/components/graph/useGraphTheme";
import {
  CanvasControls,
  useElementSize,
  useFullscreen,
  useZoom,
} from "@/components/graph/canvas";

const DEGREES = [
  { id: 0, label: "همهٔ جدول‌ها" },
  { id: 1, label: "فقط متصل‌ها" },
  { id: 3, label: "هاب‌ها (۳+ رابطه)" },
  { id: 6, label: "هسته (۶+ رابطه)" },
];

const NODE_LIMITS = [40, 75, 120, 200];

function radiusOf(node) {
  return 9 + Math.min(13, Math.sqrt(node.degree || 0) * 3.4);
}

/** پنل جزئیات گرهٔ انتخاب‌شده. */
function Inspector({ node, links, onSelectTable, onClose, isDark }) {
  const accent = schemaAccent(node.schema, isDark);
  const related = useMemo(
    () =>
      links
        .filter((l) => l.source === node.id || l.target === node.id)
        .map((l) => ({
          other: l.source === node.id ? l.target : l.source,
          outgoing: l.source === node.id,
          from_col: l.from_col,
          to_col: l.to_col,
          verified: l.verified,
        })),
    [links, node.id],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
            style={{ color: accent.text, background: accent.soft }}
          >
            {node.schema}
          </span>
          <h3 className="ltr mt-1 break-all font-mono text-sm font-bold text-foreground">
            {splitTable(node.id).name}
          </h3>
          {node.title_fa && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{node.title_fa}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن پنل"
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border p-3">
        {node.has_data ? (
          <Badge tone="ok">{faCompact(node.row_count)} ردیف</Badge>
        ) : (
          <Badge tone="warn">بدون داده</Badge>
        )}
        <Badge tone="muted">{fa(node.n_cols)} ستون</Badge>
        <Badge tone="brand">{fa(node.degree)} رابطه</Badge>
        {node.external && <Badge tone="info">اسکیمای بیرونی</Badge>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="px-1 pb-1.5 text-[10.5px] font-semibold text-muted-foreground">
          روابط این جدول
        </p>
        <div className="space-y-1">
          {related.map((r, i) => (
            <button
              key={`${r.other}-${r.from_col}-${i}`}
              type="button"
              onClick={() => onSelectTable?.(r.other)}
              className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-ink p-1.5 text-start transition-colors hover:border-brand/40 hover:bg-surfaceHover"
            >
              <div className="min-w-0">
                <div className="ltr truncate font-mono text-[11px] text-foreground">
                  {r.other}
                </div>
                <div className="ltr truncate font-mono text-[9.5px] text-muted-foreground">
                  {r.from_col} → {r.to_col}
                </div>
              </div>
              {r.verified ? (
                <ShieldCheck className="h-3 w-3 shrink-0 text-ok" />
              ) : (
                <AlertTriangle className="h-3 w-3 shrink-0 text-warn" />
              )}
            </button>
          ))}
          {related.length === 0 && (
            <p className="p-3 text-center text-[11px] text-muted-foreground">
              در این نما رابطه‌ای ندارد.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <Button className="w-full" onClick={() => onSelectTable?.(node.id)}>
          <ExternalLink />
          باز کردن جزئیات کامل جدول
        </Button>
      </div>
    </div>
  );
}

export default function SchemaGraphView({ schema, onSchemaChange, onSelectTable }) {
  const t = useGraphTheme();
  const [wrapRef, size] = useElementSize();
  const svgRef = useRef(null);
  const rootRef = useRef(null);
  const simulationRef = useRef(null);

  const [schemas, setSchemas] = useState([]);
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [minDegree, setMinDegree] = useState(0);
  const [maxNodes, setMaxNodes] = useState(75);
  const [includeExternal, setIncludeExternal] = useState(false);
  const [onlyWithData, setOnlyWithData] = useState(false);
  const [physics, setPhysics] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);
  const [isFullscreen, setFullscreen, fullscreenClass] = useFullscreen();

  const { controls: zoom, level: zoomLevel } = useZoom(svgRef, rootRef);

  useEffect(() => {
    http
      .get("/schemas")
      .then(({ data }) => setSchemas(data.schemas || []))
      .catch(() => setSchemas([]));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    http
      .get(`/schema/${encodeURIComponent(schema)}/graph`, {
        params: { includeExternal, onlyWithData, maxNodes },
      })
      .then(({ data }) => {
        if (!alive) return;
        setGraph(data);
        setSelected(null);
      })
      .catch((e) => {
        if (!alive) return;
        const msg = errorMessage(e, "بارگذاری گراف ناموفق بود.");
        setError(msg);
        setGraph(null);
        toast.error(msg);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [schema, includeExternal, onlyWithData, maxNodes]);

  const view = useMemo(() => {
    if (!graph) return { nodes: [], links: [] };
    let nodes = graph.nodes.filter((n) => (n.degree || 0) >= minDegree);
    const q = query.trim().toLowerCase();
    if (q) {
      nodes = nodes.filter(
        (n) =>
          n.full_name.toLowerCase().includes(q) ||
          (n.title_fa || "").toLowerCase().includes(q),
      );
    }
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      links: graph.links.filter((l) => ids.has(l.source) && ids.has(l.target)),
    };
  }, [graph, minDegree, query]);

  const legend = useMemo(() => {
    const counts = new Map();
    for (const n of view.nodes) counts.set(n.schema, (counts.get(n.schema) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [view.nodes]);

  const render = useCallback(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    simulationRef.current?.stop();

    const { width, height } = size;
    if (!width || !height || view.nodes.length === 0) return;

    const nodes = view.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = view.links
      .map((l) => ({ ...l, source: byId.get(l.source), target: byId.get(l.target) }))
      .filter((l) => l.source && l.target);

    svg
      .append("defs")
      .append("marker")
      .attr("id", "sg-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 4.5)
      .attr("markerHeight", 4.5)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", t.link);

    const root = svg.append("g");
    rootRef.current = root.node();

    const linkSel = root
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("class", "sg-link")
      .attr("stroke", (d) => (d.cross ? t.linkWeak : t.linkVerified))
      .attr("stroke-width", (d) => (d.verified ? 1.3 : 0.9))
      .attr("stroke-dasharray", (d) => (d.verified ? null : "3 3"))
      .attr("marker-end", "url(#sg-arrow)")
      .attr("opacity", 0.55);

    const nodeSel = root
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "sg-node")
      .attr("cursor", "pointer")
      .on("click", (_event, d) => setSelected(d))
      .on("dblclick", (_event, d) => onSelectTable?.(d.id));

    nodeSel
      .append("circle")
      .attr("r", radiusOf)
      .attr("fill", (d) => schemaAccent(d.schema, t.isDark).fill)
      .attr("stroke", (d) => schemaAccent(d.schema, t.isDark).stroke)
      .attr("stroke-width", (d) => (d.external ? 1 : 1.8))
      .attr("stroke-dasharray", (d) => (d.external ? "3 2" : null));

    // جدول‌های بدون داده با یک نقطهٔ کم‌رنگ داخل دایره مشخص می‌شوند
    nodeSel
      .filter((d) => !d.has_data)
      .append("circle")
      .attr("r", 2.5)
      .attr("fill", t.mutedFg)
      .attr("opacity", 0.8);

    // در گراف شلوغ فقط گره‌های پرارتباط برچسب می‌گیرند؛ بقیه با کلیک یا
    // بزرگ‌نمایی خوانده می‌شوند. بدون این قاعده، متن‌ها روی هم می‌افتند.
    const labelCutoff = nodes.length > 60 ? 3 : 0;
    nodeSel
      .filter((d) => (d.degree || 0) >= labelCutoff)
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => radiusOf(d) + 11)
      .attr("class", "graph-label")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-size", 9.5)
      .attr("paint-order", "stroke")
      .attr("stroke", t.labelShadow)
      .attr("stroke-width", 3)
      .attr("stroke-linejoin", "round")
      .attr("fill", t.fg)
      .text((d) => (d.name.length > 18 ? `${d.name.slice(0, 17)}…` : d.name));

    nodeSel.append("title").text((d) => `${d.full_name}\n${d.title_fa || ""}`);

    const paint = () => {
      linkSel
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    };

    /*
      تنظیم نیروها با دو هدف: خوشه‌های معنادار از هم جدا بمانند، و گره‌های
      کم‌ارتباط به لبه‌های دوردست پرت نشوند. دافعه بردِ محدود دارد و دو نیروی
      ضعیف X/Y همه را دور مرکز نگه می‌دارند — بدون آن‌ها، `جا دادن در کادر`
      مجبور می‌شود کل گراف را تا حد ناخوانایی کوچک کند.
    */
    const sim = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3.forceLink(links).id((d) => d.id).distance(78).strength(0.45),
      )
      .force("charge", d3.forceManyBody().strength(-190).distanceMax(420))
      .force("x", d3.forceX(width / 2).strength(0.06))
      .force("y", d3.forceY(height / 2).strength(0.08))
      .force(
        "collide",
        d3.forceCollide((d) => radiusOf(d) + 18).iterations(2),
      )
      .on("tick", paint);

    nodeSel.call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.2).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

    // شبیه‌سازی را همان‌جا تا آرام‌شدن جلو می‌بریم و بعد رسم می‌کنیم: کاربر
    // به‌جای دیدن انفجار گره‌ها، یک چیدمان نشسته و آمادهٔ خواندن تحویل می‌گیرد.
    sim.stop();
    for (let i = 0; i < 260; i += 1) sim.tick();
    paint(); // simulation.tick() رویداد tick نمی‌فرستد، پس یک‌بار دستی رسم می‌کنیم

    zoom.attach();
    simulationRef.current = sim;
    if (physics) sim.alpha(0.2).restart();
    const frame = requestAnimationFrame(() => zoom.fit());
    return () => cancelAnimationFrame(frame);
  }, [view, size, t, zoom, physics, onSelectTable]);

  useEffect(() => {
    const cleanup = render();
    return () => {
      cleanup?.();
      simulationRef.current?.stop();
    };
  }, [render]);

  useEffect(() => {
    const sim = simulationRef.current;
    if (!sim) return;
    if (physics) sim.alphaTarget(0.1).restart();
    else sim.stop();
  }, [physics]);

  // برجسته‌سازی همسایه‌های گرهٔ انتخاب‌شده، بدون رندر دوبارهٔ گراف
  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode) return;
    const svg = d3.select(svgNode);
    const nodeSel = svg.selectAll("g.sg-node");
    const linkSel = svg.selectAll("line.sg-link");

    if (!selected) {
      nodeSel.attr("opacity", 1);
      linkSel.attr("opacity", 0.55);
      return;
    }
    const near = new Set([selected.id]);
    for (const l of view.links) {
      if (l.source === selected.id) near.add(l.target);
      if (l.target === selected.id) near.add(l.source);
    }
    nodeSel.attr("opacity", (d) => (near.has(d.id) ? 1 : t.dim));
    linkSel.attr("opacity", (d) =>
      d.source.id === selected.id || d.target.id === selected.id ? 0.95 : t.dim * 0.6,
    );
  }, [selected, view.links, t.dim]);

  const stats = graph?.stats;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", fullscreenClass, isFullscreen && "bg-background")}>
      {/* نوار ابزار */}
      <div className="shrink-0 space-y-2 border-b border-border bg-surface/60 p-2 sm:p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[11rem] flex-1 items-center gap-1.5 sm:max-w-xs">
            <Layers className="h-4 w-4 shrink-0 text-brand-text" />
            <Select
              value={schema}
              onChange={(e) => onSchemaChange?.(e.target.value)}
              className="h-9 text-xs"
              aria-label="انتخاب اسکیما"
            >
              {schemas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}
                  {schemaLabel(s.id) ? ` · ${schemaLabel(s.id)}` : ""} — {s.table_count} جدول
                </option>
              ))}
            </Select>
          </div>

          <div className="relative min-w-[9rem] flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی جدول در گراف…"
              className="h-9 ps-8 text-xs"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
              showFilters
                ? "border-brand/50 bg-brand/12 text-brand-text"
                : "border-border bg-ink text-muted-foreground hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">تنظیمات نما</span>
          </button>
        </div>

        {showFilters && (
          <div className="grid animate-fade-up grid-cols-1 gap-2.5 rounded-lg border border-brand/20 bg-ink p-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1">
              <span className="text-[10.5px] font-semibold text-muted-foreground">
                حداقل تعداد رابطه
              </span>
              <Select
                value={minDegree}
                onChange={(e) => setMinDegree(Number(e.target.value))}
                className="h-8 text-[11px]"
              >
                {DEGREES.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1">
              <span className="text-[10.5px] font-semibold text-muted-foreground">
                سقف گره‌های نما
              </span>
              <Select
                value={maxNodes}
                onChange={(e) => setMaxNodes(Number(e.target.value))}
                className="h-8 text-[11px]"
              >
                {NODE_LIMITS.map((n) => (
                  <option key={n} value={n}>
                    {n} جدول پرارتباط
                  </option>
                ))}
              </Select>
            </label>

            <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
              <span className="text-[11px] text-foreground">نمایش اسکیماهای بیرونی</span>
              <Switch checked={includeExternal} onCheckedChange={setIncludeExternal} />
            </label>

            <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
              <span className="text-[11px] text-foreground">فقط جدول‌های دارای داده</span>
              <Switch checked={onlyWithData} onCheckedChange={setOnlyWithData} />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">
            <Network className="h-2.5 w-2.5" />
            {fa(view.nodes.length)} گره
          </Badge>
          <Badge tone="muted">
            <Link2 className="h-2.5 w-2.5" />
            {fa(view.links.length)} یال
          </Badge>
          {stats?.cross > 0 && <Badge tone="warn">{fa(stats.cross)} رابطهٔ بین‌اسکیمایی</Badge>}
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            {legend.map(([s, count]) => {
              const accent = schemaAccent(s, t.isDark);
              return (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9.5px]"
                  style={{ color: accent.text, borderColor: accent.ring, background: accent.soft }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: accent.stroke }}
                  />
                  {s} · {fa(count)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* بوم + پنل */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={wrapRef} className="relative min-h-[18rem] flex-1 bg-ink/40">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-brand-text" />
              در حال ساخت گراف اسکیمای {schema}…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-4">
              <EmptyState
                icon={AlertTriangle}
                title="گراف بارگذاری نشد"
                description={error}
                className="border-0 bg-transparent"
              />
            </div>
          ) : view.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center p-4">
              <EmptyState
                icon={Database}
                title="گرهی برای نمایش نیست"
                description="فیلترها را کمی باز بگذارید یا سقف گره‌ها را بالا ببرید."
                className="border-0 bg-transparent"
              />
            </div>
          ) : (
            <svg ref={svgRef} width="100%" height="100%" className="touch-none select-none" />
          )}

          <CanvasControls
            className="absolute end-2 top-2"
            onZoomIn={() => zoom.scaleBy(1.35)}
            onZoomOut={() => zoom.scaleBy(0.72)}
            onFit={() => zoom.fit()}
            onReset={zoom.reset}
            onToggleFullscreen={() => setFullscreen((f) => !f)}
            isFullscreen={isFullscreen}
            physics={physics}
            onTogglePhysics={() => setPhysics((p) => !p)}
            level={zoomLevel}
          />

          <div className="pointer-events-none absolute bottom-2 start-2 hidden gap-1.5 text-[10px] sm:flex">
            <span className="rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-muted-foreground backdrop-blur">
              اندازهٔ گره = تعداد روابط
            </span>
            <span className="rounded-md border border-border bg-surface/90 px-1.5 py-0.5 text-muted-foreground backdrop-blur">
              حلقهٔ خط‌چین = اسکیمای بیرونی
            </span>
          </div>
        </div>

        {selected && (
          <aside className="max-h-[45dvh] shrink-0 overflow-hidden border-t border-border bg-surface lg:max-h-none lg:w-[19rem] lg:border-s lg:border-t-0">
            <Inspector
              node={selected}
              links={view.links}
              onSelectTable={onSelectTable}
              onClose={() => setSelected(null)}
              isDark={t.isDark}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
