"use client";

import { useCallback, useRef } from "react";

interface Props {
  minTime: number;
  maxTime: number;
  value: [number, number];
  onChange: (range: [number, number]) => void;
  onClose: () => void;
  bottom?: number; // px from bottom, default 28
}

function fmtTime(epoch: number) {
  return new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDate(epoch: number) {
  return new Date(epoch).toLocaleDateString([], { month: "short", day: "numeric" });
}

const STEP = 60_000;

export default function TimeSlider({ minTime, maxTime, value, onChange, onClose, bottom = 28 }: Props) {
  const span     = maxTime - minTime || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | null>(null);

  const startPct = ((value[0] - minTime) / span) * 100;
  const endPct   = ((value[1] - minTime) / span) * 100;

  const timeFromX = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round((minTime + pct * span) / STEP) * STEP;
  }, [minTime, span]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const t = timeFromX(e.clientX);
    dragging.current = Math.abs(t - value[0]) <= Math.abs(t - value[1]) ? "start" : "end";
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [timeFromX, value]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const t = timeFromX(e.clientX);
    if (dragging.current === "start") onChange([Math.min(t, value[1] - STEP), value[1]]);
    else onChange([value[0], Math.max(t, value[0] + STEP)]);
  }, [timeFromX, value, onChange]);

  const onPointerUp = useCallback(() => { dragging.current = null; }, []);

  const spanDays = (maxTime - minTime) / 86_400_000;
  const showDate = spanDays > 0.9;

  return (
    <div style={{
      position: "absolute",
      bottom,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(600px, calc(100vw - 40px))",
      background: "rgba(4, 12, 20, 0.95)",
      border: "1px solid rgba(43, 168, 200, 0.35)",
      borderRadius: 8,
      padding: "9px 14px 10px",
      zIndex: 20,
      backdropFilter: "blur(8px)",
      fontFamily: "var(--font-mono, monospace)",
      userSelect: "none",
      boxShadow: "0 0 0 1px rgba(43,168,200,0.08)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: "#2ba8c8", letterSpacing: "0.08em" }}>TRACK INSPECTOR</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#2ba8c8", marginRight: 10 }}>
          {fmtTime(value[0])} – {fmtTime(value[1])}
        </span>
        <span style={{ fontSize: 10, color: "#5a8090", marginRight: 10 }}>
          {Math.round((value[1] - value[0]) / 60_000)} min
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#5a8090",
            fontSize: 14,
            cursor: "pointer",
            padding: "0 2px",
            lineHeight: 1,
            fontFamily: "inherit",
          }}
        >
          ✕
        </button>
      </div>

      {/* Axis labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#5a8090" }}>
          {showDate && fmtDate(minTime) + " "}{fmtTime(minTime)}
        </span>
        <span style={{ fontSize: 10, color: "#5a8090" }}>
          {showDate && fmtDate(maxTime) + " "}{fmtTime(maxTime)}
        </span>
      </div>

      {/* Interactive track */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ position: "relative", height: 20, cursor: "pointer" }}
      >
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3, borderRadius: 2, background: "rgba(43,168,200,0.15)", transform: "translateY(-50%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "50%", left: `${startPct}%`, width: `${endPct - startPct}%`, height: 3, borderRadius: 2, background: "#2ba8c8", transform: "translateY(-50%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "50%", left: `${startPct}%`, width: 14, height: 14, borderRadius: "50%", background: "#2ba8c8", border: "2px solid #020a12", transform: "translate(-50%,-50%)", pointerEvents: "none", boxShadow: "0 0 0 2px rgba(43,168,200,0.35)" }} />
        <div style={{ position: "absolute", top: "50%", left: `${endPct}%`, width: 14, height: 14, borderRadius: "50%", background: "#2ba8c8", border: "2px solid #020a12", transform: "translate(-50%,-50%)", pointerEvents: "none", boxShadow: "0 0 0 2px rgba(43,168,200,0.35)" }} />
      </div>
    </div>
  );
}
