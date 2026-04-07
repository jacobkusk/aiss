"use client";

import { useRef, useState, useCallback, useEffect } from "react";

interface Props {
  onScrub: (minutesAgo: number) => void;
  onLive: () => void;
}

// Zoom levels: [label interval in minutes, tick label format]
const ZOOM_LEVELS = [
  { range: 525600, tickEvery: 43200,  fmt: (d: Date) => d.toLocaleDateString([], { month: "short", year: "2-digit" }) }, // 1yr, tick=30d
  { range: 131400, tickEvery: 10080,  fmt: (d: Date) => d.toLocaleDateString([], { day: "numeric", month: "short" }) },   // 3mo, tick=1w
  { range: 20160,  tickEvery: 1440,   fmt: (d: Date) => d.toLocaleDateString([], { day: "numeric", month: "short" }) },   // 2w, tick=1d
  { range: 2880,   tickEvery: 360,    fmt: (d: Date) => d.toLocaleDateString([], { day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit" }) }, // 2d, tick=6h
  { range: 720,    tickEvery: 60,     fmt: (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }, // 12h, tick=1h
  { range: 120,    tickEvery: 15,     fmt: (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }, // 2h, tick=15m
  { range: 30,     tickEvery: 5,      fmt: (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }, // 30m, tick=5m
];

export default function ZoomTimeline({ onScrub, onLive }: Props) {
  const [zoomIdx, setZoomIdx] = useState(3);       // start at 2-day view
  const [centerAgo, setCenterAgo] = useState(0);   // minutes ago at center (0=now)
  const [cursorAgo, setCursorAgo] = useState<number | null>(null);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartCenter = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const zoom = ZOOM_LEVELS[zoomIdx];
  const halfRange = zoom.range / 2;

  // Clamp center so "now" is always reachable
  const clampCenter = (c: number) => Math.max(halfRange, c);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY > 0 && zoomIdx < ZOOM_LEVELS.length - 1) {
      setZoomIdx(z => z + 1);
    } else if (e.deltaY < 0 && zoomIdx > 0) {
      setZoomIdx(z => z - 1);
    }
  }, [zoomIdx]);

  const handleMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartCenter.current = centerAgo;
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!containerRef.current) return;
    const w = containerRef.current.clientWidth;
    const minsPerPx = zoom.range / w;

    if (dragging.current) {
      const dx = dragStartX.current - e.clientX;
      const newCenter = clampCenter(dragStartCenter.current + dx * minsPerPx);
      setCenterAgo(newCenter);
    }

    // Cursor position
    const rect = containerRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const pct = px / w;
    const ago = clampCenter(centerAgo) - halfRange + pct * zoom.range;
    setCursorAgo(Math.max(0, ago));
  }, [zoom, centerAgo, halfRange]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (dragging.current && containerRef.current) {
      const w = containerRef.current.clientWidth;
      const rect = containerRef.current.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const pct = px / w;
      const ago = clampCenter(centerAgo) - halfRange + pct * zoom.range;
      const clamped = Math.max(0, ago);
      if (clamped <= 0) onLive(); else onScrub(clamped);
    }
    dragging.current = false;
  }, [centerAgo, halfRange, zoom, onScrub, onLive]);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Generate ticks
  const effectiveCenter = clampCenter(centerAgo);
  const startAgo = effectiveCenter + halfRange;
  const endAgo   = Math.max(0, effectiveCenter - halfRange);
  const now = Date.now();

  const ticks: { pct: number; label: string }[] = [];
  const startMs = now - startAgo * 60_000;
  const endMs   = now - endAgo   * 60_000;
  const spanMs  = endMs - startMs;
  const tickMs  = zoom.tickEvery * 60_000;
  const firstTick = Math.ceil(startMs / tickMs) * tickMs;

  for (let t = firstTick; t <= endMs; t += tickMs) {
    const pct = (t - startMs) / spanMs * 100;
    ticks.push({ pct, label: zoom.fmt(new Date(t)) });
  }

  const nowPct = (now - startMs) / spanMs * 100;
  const cursorPct = cursorAgo !== null
    ? ((now - cursorAgo * 60_000) - startMs) / spanMs * 100
    : null;

  const formatAgo = (ago: number) => {
    if (ago <= 0) return "Nu";
    const d = new Date(now - ago * 60_000);
    return zoom.fmt(d);
  };

  return (
    <div style={{
      background: "rgba(15,15,42,0.9)",
      backdropFilter: "blur(12px)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "10px",
      padding: "8px 14px",
      minWidth: "320px",
      maxWidth: "460px",
      width: "50%",
      userSelect: "none",
    }}>
      {/* Zoom level indicator */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
        <div style={{ display: "flex", gap: "3px" }}>
          {ZOOM_LEVELS.map((_, i) => (
            <button key={i} onClick={() => setZoomIdx(i)} style={{
              width: 6, height: 6,
              borderRadius: "50%",
              background: i === zoomIdx ? "#6b8aff" : "rgba(255,255,255,0.15)",
              border: "none", cursor: "pointer", padding: 0,
            }} />
          ))}
        </div>
        <span style={{ fontSize: "9px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.3)" }}>
          scroll = zoom · drag = pan
        </span>
      </div>

      {/* Timeline track */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ position: "relative", height: "32px", cursor: dragging.current ? "grabbing" : "crosshair" }}
      >
        {/* Track */}
        <div style={{
          position: "absolute", top: "12px", left: 0, right: 0,
          height: "3px", background: "rgba(255,255,255,0.1)", borderRadius: "2px",
        }} />

        {/* Ticks */}
        {ticks.map((t, i) => (
          <div key={i} style={{ position: "absolute", left: `${t.pct}%`, top: 0, transform: "translateX(-50%)" }}>
            <div style={{ width: 1, height: 8, background: "rgba(255,255,255,0.2)", margin: "8px auto 0" }} />
            <div style={{ fontSize: "8px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap", marginTop: 2 }}>
              {t.label}
            </div>
          </div>
        ))}

        {/* NOW marker */}
        {nowPct >= 0 && nowPct <= 100 && (
          <div style={{ position: "absolute", left: `${nowPct}%`, top: 0, transform: "translateX(-50%)" }}>
            <div style={{ width: 1, height: 32, background: "#00e676", opacity: 0.6 }} />
          </div>
        )}

        {/* Cursor line */}
        {cursorPct !== null && cursorPct >= 0 && cursorPct <= 100 && (
          <div style={{ position: "absolute", left: `${cursorPct}%`, top: 0, transform: "translateX(-50%)", pointerEvents: "none" }}>
            <div style={{ width: 1, height: 32, background: "rgba(107,138,255,0.6)" }} />
            <div style={{
              position: "absolute", top: -18, left: "50%", transform: "translateX(-50%)",
              fontSize: "9px", fontFamily: "var(--font-mono)", color: "#6b8aff",
              background: "rgba(15,15,42,0.9)", padding: "1px 4px", borderRadius: 3, whiteSpace: "nowrap",
            }}>
              {formatAgo(cursorAgo!)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
