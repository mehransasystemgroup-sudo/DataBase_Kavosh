import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { cn } from "@/lib/utils";

/*
  زیرساخت مشترک هر دو گراف: اندازه‌گیری واکنش‌گرای بوم، بزرگ‌نمایی/جابه‌جایی،
  و دکمه‌های ناوبری. هر دو نما همین را استفاده می‌کنند تا رفتار حرکت، کلید‌های
  میان‌بر و ظاهر کنترل‌ها دقیقاً یکسان بماند.
*/

/** اندازه‌ی زندهٔ یک عنصر — پایه‌ی واکنش‌گرایی گراف. */
export function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    // فقط وقتی اندازه واقعاً عوض شده state را می‌زنیم، وگرنه هر تیک
    // ResizeObserver یک رندر بی‌فایده تولید می‌کند.
    const measure = () =>
      setSize((prev) => {
        const width = node.clientWidth || 0;
        const height = node.clientHeight || 0;
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/** رفتار زوم d3 روی یک svg، با APIی که دکمه‌ها صدا می‌زنند. */
export function useZoom(svgRef, rootRef, { min = 0.15, max = 4 } = {}) {
  const behaviorRef = useRef(null);
  const [level, setLevel] = useState(1);

  const attach = useCallback(() => {
    if (!svgRef.current || !rootRef.current) return;
    const svg = d3.select(svgRef.current);
    const root = d3.select(rootRef.current);
    const zoom = d3
      .zoom()
      .scaleExtent([min, max])
      .on("zoom", (event) => {
        root.attr("transform", event.transform);
        setLevel(event.transform.k);
      });
    svg.call(zoom).on("dblclick.zoom", null);
    behaviorRef.current = zoom;
  }, [svgRef, rootRef, min, max]);

  const scaleBy = useCallback(
    (factor) => {
      if (!behaviorRef.current || !svgRef.current) return;
      d3.select(svgRef.current).transition().duration(200).call(behaviorRef.current.scaleBy, factor);
    },
    [svgRef],
  );

  const reset = useCallback(() => {
    if (!behaviorRef.current || !svgRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(320)
      .call(behaviorRef.current.transform, d3.zoomIdentity);
  }, [svgRef]);

  /** همهٔ محتوا را داخل کادر جا می‌دهد — پرکاربردترین دکمه‌ی گراف. */
  const fit = useCallback(
    (padding = 48) => {
      if (!behaviorRef.current || !svgRef.current || !rootRef.current) return;
      const bounds = rootRef.current.getBBox();
      if (!bounds.width || !bounds.height) return;
      const { width, height } = svgRef.current.getBoundingClientRect();
      const scale = Math.min(
        max,
        Math.max(
          min,
          Math.min((width - padding) / bounds.width, (height - padding) / bounds.height),
        ),
      );
      const tx = width / 2 - scale * (bounds.x + bounds.width / 2);
      const ty = height / 2 - scale * (bounds.y + bounds.height / 2);
      d3.select(svgRef.current)
        .transition()
        .duration(420)
        .call(behaviorRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    },
    [svgRef, rootRef, min, max],
  );

  // کنترل‌ها با هویت پایدار برمی‌گردند تا افکت رندرِ گراف به‌خاطر تغییر
  // سطح زوم دوباره اجرا نشود؛ `level` جدا داده می‌شود چون فقط نمایشی است.
  const controls = useMemo(() => ({ attach, scaleBy, reset, fit }), [attach, scaleBy, reset, fit]);

  return { controls, level };
}

/** خوشهٔ دکمه‌های شناور ناوبری بوم. */
export function CanvasControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  onToggleFullscreen,
  isFullscreen,
  physics,
  onTogglePhysics,
  level,
  className,
}) {
  const btn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:border-brand/45 hover:text-brand-text sm:h-8 sm:w-8";

  /*
    روی موبایل کنترل‌ها نوار افقیِ پایین می‌شوند: ستونِ کنارِ صفحه شش دکمه‌ی
    ۴۴پیکسلی است و ارتفاع کمِ گوشی را می‌بلعد. روی دسکتاپ همان ستون کنار بوم.
  */
  return (
    <div
      className={cn(
        "absolute z-10 flex gap-1.5",
        "inset-x-2 bottom-2 flex-row-reverse justify-start",
        "sm:inset-x-auto sm:bottom-auto sm:end-2 sm:top-2 sm:flex-col sm:gap-1",
        className,
      )}
    >
      <button type="button" onClick={onZoomIn} title="بزرگ‌نمایی" className={btn}>
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onZoomOut} title="کوچک‌نمایی" className={btn}>
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onFit} title="جا دادن همه در کادر" className={btn}>
        <Scan className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onReset} title="بازنشانی نما" className={btn}>
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
      {onTogglePhysics && (
        <button
          type="button"
          onClick={onTogglePhysics}
          title={physics ? "توقف چیدمان خودکار" : "ادامهٔ چیدمان خودکار"}
          className={cn(btn, physics && "border-brand/45 text-brand-text")}
        >
          {physics ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      )}
      {onToggleFullscreen && (
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
          className={btn}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {typeof level === "number" && (
        <span className="hidden rounded-md border border-border bg-surface/90 px-1 py-0.5 text-center font-mono text-[9px] text-muted-foreground backdrop-blur sm:block">
          {Math.round(level * 100)}٪
        </span>
      )}
    </div>
  );
}

/** حالت تمام‌صفحه‌ی نرم: عنصر روی کل پنجره می‌نشیند، بدون Fullscreen API. */
export function useFullscreen() {
  const [isFullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => e.key === "Escape" && setFullscreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  return [isFullscreen, setFullscreen, isFullscreen ? "fixed inset-0 z-50 rounded-none" : ""];
}
