import { useEffect, useRef, useState } from "react";
import {
  Expand,
  MapPin,
  Minimize2,
  Pause,
  Play,
  RotateCw,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Hotspot } from "@/data/tours";

type Props = {
  image: string;
  title: string;
  hotspots: Hotspot[];
};

export function PanoramaViewer({ image, title, hotspots }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const [offset, setOffset] = useState(0); // 0-100 percent of panorama scroll
  const [zoom, setZoom] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [active, setActive] = useState<Hotspot | null>(null);

  useEffect(() => {
    if (!autoRotate) return;
    const id = window.setInterval(() => setOffset((o) => (o + 0.15) % 100), 40);
    return () => window.clearInterval(id);
  }, [autoRotate]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      setFullscreen((v) => !v);
    }
  };

  const startDrag = (clientX: number) => {
    setAutoRotate(false);
    dragRef.current = { startX: clientX, startOffset: offset };
  };

  const moveDrag = (clientX: number) => {
    const drag = dragRef.current;
    const el = containerRef.current;
    if (!drag || !el) return;
    const delta = ((clientX - drag.startX) / el.clientWidth) * 60;
    setOffset(((drag.startOffset - delta) % 100 + 100) % 100);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-3xl border border-border bg-navy shadow-card select-none"
    >
      <div
        className="relative h-[260px] cursor-grab active:cursor-grabbing sm:h-[420px]"
        onMouseDown={(e) => startDrag(e.clientX)}
        onMouseMove={(e) => dragRef.current && moveDrag(e.clientX)}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onTouchStart={(e) => {
          const x = e.touches[0]?.clientX;
          if (x !== undefined) startDrag(x);
        }}
        onTouchMove={(e) => {
          const x = e.touches[0]?.clientX;
          if (x !== undefined) moveDrag(x);
        }}
        onTouchEnd={endDrag}
        role="img"
        aria-label={`${title} — 360° համայնապատկեր`}
      >
        <div
          className="absolute inset-0 transition-[background-size] duration-300"
          style={{
            backgroundImage: `url(${image})`,
            backgroundRepeat: "repeat-x",
            backgroundSize: `${220 * zoom}% 100%`,
            backgroundPosition: `${offset}% center`,
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy/70 via-transparent to-navy/30" />

        {hotspots.map((h) => {
          const left = ((h.x - offset * 1.4) % 100 + 100) % 100;
          return (
            <button
              key={h.id}
              onClick={() => {
                setAutoRotate(false);
                setActive(h);
              }}
              style={{ left: `${left}%`, top: `${h.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              aria-label={h.title}
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-foreground shadow-float ring-4 ring-accent/30 transition-transform hover:scale-110">
                <MapPin className="h-4 w-4" />
              </span>
            </button>
          );
        })}

        <span className="pointer-events-none absolute left-4 top-4 rounded-full bg-navy/80 px-3 py-1 text-[11px] font-bold text-navy-foreground backdrop-blur">
          360° վիրտուալ տուր · քաշեք՝ պտտելու համար
        </span>

        {active && (
          <div className="absolute inset-x-4 bottom-20 rounded-2xl bg-card/95 p-4 shadow-float backdrop-blur sm:max-w-sm">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-sm font-bold">{active.title}</h4>
              <button onClick={() => setActive(null)} aria-label="Փակել">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 bg-navy px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => setAutoRotate((v) => !v)}
          >
            {autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {autoRotate ? "Կանգնեցնել" : "Պտտել"}
            </span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => setOffset((o) => (o + 12) % 100)}
            aria-label="Պտտել աջ"
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(2)))}
            aria-label="Մեծացնել"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => setZoom((z) => Math.max(1, +(z - 0.2).toFixed(2)))}
            aria-label="Փոքրացնել"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] font-semibold text-navy-foreground/70 sm:inline">
            {hotspots.length} տեսարժան կետ
          </span>
          <Button size="sm" variant="secondary" className="rounded-full" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
            <span className="hidden sm:inline">Ամբողջ էկրանով</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
