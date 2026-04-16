"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  minTime: number;
  maxTime: number;
  value: [number, number];
  onChange: (range: [number, number]) => void;
  onClose: () => void;
  bottom?: number;
  // Waypoint navigation
  waypoints?: number[];
  focusTime?: number | null;
  onFocusTimeChange?: (t: number) => void;
  // Independent visibility toggles
  showLine?: boolean;
  onShowLineChange?: (v: boolean) => void;
  showDots?: boolean;
  onShowDotsChange?: (v: boolean) => void;
  // Douglas toggle
  douglasMode?: boolean;
  onDouglasModeChange?: (v: boolean) => void;
  // Voyage: expand timeRange to full timeBounds
  onExpandToVoyage?: () => void;
  isVoyageView?: boolean;
  /** Cap the selectable window to this many ms (e.g. 24h for LINE mode) */
  maxSpanMs?: number;
  // Date range picker (for historical vessels — replaces VoyagePicker)
  showDatePicker?: boolean;
  onDateRangeLoad?: (startMs: number, endMs: number) => void;
  loading?: boolean;
  pointCount?: number | null;
  loadedRange?: [number, number] | null;
  // Panel mode
  panelMode?: "live" | "timemachine";
  onPanelModeChange?: (mode: "live" | "timemachine") => void;
  // Replay props (only used in timemachine mode)
  replay?: {
    dateStart: string;
    dateEnd: string;
    onDateStartChange: (v: string) => void;
    onDateEndChange: (v: string) => void;
    loading: boolean;
    onLoad: () => void;
    vesselCount: number | null;
    playing: boolean;
    onPlayToggle: () => void;
    speedIdx: number;
    speeds: number[];
    onSpeedChange: (idx: number) => void;
  };
}

function toDateStr(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtTime(epoch: number) {
  return new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDate(epoch: number) {
  return new Date(epoch).toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtDateTime(epoch: number) {
  return `${fmtDate(epoch)} ${fmtTime(epoch)}`;
}

const STEP = 60_000;

function snapToNearest(t: number, waypoints: number[]): number {
  if (!waypoints.length) return t;
  return waypoints.reduce((best, wp) => Math.abs(wp - t) < Math.abs(best - t) ? wp : best);
}

export default function TimeSlider({ minTime, maxTime, value, onChange, onClose, bottom = 28, waypoints, focusTime, onFocusTimeChange, onExpandToVoyage, isVoyageView, maxSpanMs, showDatePicker, onDateRangeLoad, loading, pointCount, loadedRange, douglasMode, onDouglasModeChange, showLine = true, onShowLineChange, showDots = false, onShowDotsChange, panelMode = "live", onPanelModeChange, replay }: Props) {
  // Local state for date picker inputs (only used when showDatePicker is true)
  const [dateStart, setDateStart] = useState(() => toDateStr(new Date(minTime)));
  const [dateEnd,   setDateEnd]   = useState(() => toDateStr(new Date(maxTime)));

  // Re-sync date inputs when vessel changes (minTime/maxTime changes)
  useEffect(() => {
    setDateStart(toDateStr(new Date(minTime)));
    setDateEnd(toDateStr(new Date(maxTime)));
  }, [minTime, maxTime]);

  const handleDateLoad = useCallback(() => {
    if (!onDateRangeLoad) return;
    const s = new Date(dateStart + "T00:00:00Z").getTime();
    const e = new Date(dateEnd + "T23:59:59Z").getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return;
    onDateRangeLoad(s, e);
  }, [dateStart, dateEnd, onDateRangeLoad]);

  const span     = maxTime - minTime || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const zoomRef  = useRef<HTMLDivElement>(null);
  const dragging = useRef<"start" | "end" | "focus" | "focus-zoom" | null>(null);
  const [activeHandle, setActiveHandle] = useState<"start" | "end" | null>(null);

  const startPct = ((value[0] - minTime) / span) * 100;
  const endPct   = ((value[1] - minTime) / span) * 100;
  // Focus is only valid when within the selected range — keeps both sliders honest
  const focusInRange = focusTime != null && focusTime >= value[0] && focusTime <= value[1];
  const focusPct     = focusInRange ? ((focusTime! - minTime) / span) * 100 : null;

  // ── zoom slider state (lower track) ─────────────────────────────────────────
  // Maps the selected window [value[0], value[1]] across the full slider width
  // so the orange focus dot has full pixel precision even when the window is tiny.
  const zoomSpan      = Math.max(1, value[1] - value[0]);
  const focusZoomPct  = focusInRange ? ((focusTime! - value[0]) / zoomSpan) * 100 : null;
  // Show only waypoints that fall within the current visible window
  const zoomWaypoints = waypoints?.filter((t) => t >= value[0] && t <= value[1]) ?? [];

  const timeFromX = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round((minTime + pct * span) / STEP) * STEP;
  }, [minTime, span]);

  const timeFromZoomX = useCallback((clientX: number) => {
    const rect = zoomRef.current!.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round((value[0] + pct * zoomSpan) / STEP) * STEP;
  }, [value, zoomSpan]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const t = timeFromX(e.clientX);
    const distStart = Math.abs(t - value[0]);
    const distEnd   = Math.abs(t - value[1]);
    const distFocus = focusTime != null ? Math.abs(t - focusTime) : Infinity;

    const min = Math.min(distStart, distEnd, distFocus);
    if (distFocus === min && onFocusTimeChange && waypoints?.length) {
      dragging.current = "focus";
    } else if (distStart <= distEnd) {
      dragging.current = "start";
      setActiveHandle("start");
    } else {
      dragging.current = "end";
      setActiveHandle("end");
    }
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [timeFromX, value, focusTime, waypoints, onFocusTimeChange]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || dragging.current === "focus-zoom") return;
    const t = timeFromX(e.clientX);
    if (dragging.current === "start") {
      let newStart = Math.min(t, value[1] - STEP);
      if (maxSpanMs) newStart = Math.max(newStart, value[1] - maxSpanMs);
      onChange([newStart, value[1]]);
      if (focusTime != null && focusTime < newStart && onFocusTimeChange) {
        const inRange = waypoints?.filter((w) => w >= newStart && w <= value[1]) ?? [];
        if (inRange.length) onFocusTimeChange(snapToNearest(newStart, inRange));
      }
    } else if (dragging.current === "end") {
      let newEnd = Math.max(t, value[0] + STEP);
      if (maxSpanMs) newEnd = Math.min(newEnd, value[0] + maxSpanMs);
      onChange([value[0], newEnd]);
      if (focusTime != null && focusTime > newEnd && onFocusTimeChange) {
        const inRange = waypoints?.filter((w) => w >= value[0] && w <= newEnd) ?? [];
        if (inRange.length) onFocusTimeChange(snapToNearest(newEnd, inRange));
      }
    } else if (dragging.current === "focus" && onFocusTimeChange) {
      onFocusTimeChange(t);
    }
  }, [timeFromX, value, onChange, waypoints, zoomWaypoints, focusTime, onFocusTimeChange]);

  // Zoom slider — glides freely, no snapping. The map's TrackLayer already
  // finds the nearest real waypoint from focusedTime independently.
  const onZoomPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!onFocusTimeChange) return;
    const t = timeFromZoomX(e.clientX);
    onFocusTimeChange(t);
    dragging.current = "focus-zoom";
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [timeFromZoomX, onFocusTimeChange]);

  const onZoomPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current !== "focus-zoom" || !onFocusTimeChange) return;
    const t = timeFromZoomX(e.clientX);
    onFocusTimeChange(t);
  }, [timeFromZoomX, onFocusTimeChange]);

  const onPointerUp = useCallback(() => { dragging.current = null; setActiveHandle(null); }, []);

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
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        {/* Mode toggle buttons */}
        {onPanelModeChange && (
          <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
            <button
              onClick={() => onPanelModeChange("live")}
              title="Switch to LIVE mode"
              style={{
                ...btnToggleStyle(panelMode === "live", "#00e676"),
                fontSize: 9,
                padding: "2px 7px",
              }}
            >
              ● LIVE
            </button>
            <button
              onClick={() => onPanelModeChange("timemachine")}
              title="Switch to TIME MACHINE mode"
              style={{
                ...btnToggleStyle(panelMode === "timemachine", "#f59e0b"),
                fontSize: 9,
                padding: "2px 7px",
              }}
            >
              ⏱ TIME MACHINE
            </button>
          </div>
        )}

        {/* ── View toggles ──────────────────────────────── */}
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {/* LINE toggle — independent */}
          {onShowLineChange && (
            <button
              onClick={() => onShowLineChange(!showLine)}
              title="Vis/skjul farvegradieret linje"
              style={btnToggleStyle(showLine)}
            >
              LINE
            </button>
          )}

          {/* WP toggle — independent */}
          {onShowDotsChange && (
            <button
              onClick={() => onShowDotsChange(!showDots)}
              title="Vis/skjul AIS-waypoints"
              style={btnToggleStyle(showDots)}
            >
              WP
            </button>
          )}

          {/* DOUGLAS toggle */}
          {onDouglasModeChange && (
            <button
              onClick={() => onDouglasModeChange(!douglasMode)}
              title="Douglas-Peucker komprimeret track"
              style={btnToggleStyle(!!douglasMode, "#f59e0b")}
            >
              D·P
            </button>
          )}

          {/* Separator */}
          {onExpandToVoyage && <span style={{ color: "rgba(43,168,200,0.2)", fontSize: 10, margin: "0 2px" }}>|</span>}

          {/* VOYAGE — expands time range (time control, not view) */}
          {onExpandToVoyage && (
            <button
              onClick={onExpandToVoyage}
              title="Udvid til hele rejsen"
              style={btnToggleStyle(!!isVoyageView, "#f59e0b")}
            >
              VOYAGE ↗
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#2ba8c8", marginRight: 6 }}>
          {spanDays > 1 ? fmtDateTime(value[0]) : fmtTime(value[0])}
          {" – "}
          {spanDays > 1 ? fmtDateTime(value[1]) : fmtTime(value[1])}
        </span>
        <span style={{ fontSize: 10, color: "#5a8090", marginRight: 6 }}>
          {Math.round((value[1] - value[0]) / 60_000)} min
        </span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#5a8090", fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1, fontFamily: "inherit" }}
        >✕</button>
      </div>

      {/* Replay controls row (timemachine mode) */}
      {panelMode === "timemachine" && replay && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(43,168,200,0.12)" }}
        >
          <input
            type="date"
            value={replay.dateStart}
            onChange={(e) => replay.onDateStartChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            style={datePickerStyle}
          />
          <span style={{ fontSize: 10, color: "#5a8090" }}>→</span>
          <input
            type="date"
            value={replay.dateEnd}
            min={replay.dateStart}
            max="2100-12-31"
            onChange={(e) => replay.onDateEndChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            style={datePickerStyle}
          />
          <button
            onClick={replay.onLoad}
            disabled={replay.loading}
            style={{
              background: "rgba(4,12,20,0.7)",
              border: "1px solid rgba(43,168,200,0.4)",
              borderRadius: 4,
              color: "#2ba8c8",
              fontSize: 10,
              padding: "3px 9px",
              cursor: replay.loading ? "wait" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.06em",
            }}
          >
            {replay.loading ? "…" : "LOAD"}
          </button>
          <div style={{ flex: 1 }} />
          {replay.vesselCount != null && (
            <span style={{ fontSize: 10, color: "#5a8090" }}>
              {replay.vesselCount} vessels
            </span>
          )}
          <button
            onClick={replay.onPlayToggle}
            style={{
              background: "rgba(4,12,20,0.7)",
              border: "1px solid rgba(245,158,11,0.5)",
              borderRadius: 4,
              color: "#f59e0b",
              fontSize: 13,
              padding: "3px 8px",
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: "bold",
            }}
          >
            {replay.playing ? "⏸" : "▶"}
          </button>
          {replay.speeds.map((speed, idx) => (
            <button
              key={speed}
              onClick={() => replay.onSpeedChange(idx)}
              style={{
                background: idx === replay.speedIdx ? "rgba(245,158,11,0.26)" : "transparent",
                border: `1px solid ${idx === replay.speedIdx ? "#f59e0b" : "#f59e0b44"}`,
                borderRadius: 4,
                color: idx === replay.speedIdx ? "#f59e0b" : "#5a8090",
                fontSize: 9,
                padding: "3px 7px",
                cursor: "pointer",
                fontFamily: "inherit",
                opacity: idx === replay.speedIdx ? 1 : 0.5,
              }}
            >
              {speed}×
            </button>
          ))}
        </div>
      )}

      {/* Date range picker row (historical vessels) */}
      {showDatePicker && onDateRangeLoad && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(43,168,200,0.12)" }}
        >
          <span style={{ fontSize: 10, color: "#f59e0b", letterSpacing: "0.06em" }}>⛵ VOYAGE</span>
          <input
            type="date"
            value={dateStart}
            min="1800-01-01"
            max="2100-12-31"
            onChange={(e) => setDateStart(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            style={datePickerStyle}
          />
          <span style={{ fontSize: 10, color: "#5a8090" }}>→</span>
          <input
            type="date"
            value={dateEnd}
            min={dateStart}
            max="2100-12-31"
            onChange={(e) => setDateEnd(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
            style={datePickerStyle}
          />
          <button
            onClick={handleDateLoad}
            disabled={loading}
            style={{
              background: "rgba(4,12,20,0.7)",
              border: "1px solid rgba(43,168,200,0.4)",
              borderRadius: 4,
              color: "#2ba8c8",
              fontSize: 10,
              padding: "3px 9px",
              cursor: loading ? "wait" : "pointer",
              fontFamily: "inherit",
              letterSpacing: "0.06em",
            }}
          >
            {loading ? "…" : "LOAD"}
          </button>
          <div style={{ flex: 1 }} />
          {pointCount != null && loadedRange && (
            <span style={{ fontSize: 9, color: "#5a8090" }}>
              {pointCount} pts
            </span>
          )}
        </div>
      )}

      {/* Axis labels — only show when single-day (multi-day uses handle tooltips) */}
      {!showDate && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: "#5a8090" }}>{fmtTime(minTime)}</span>
          <span style={{ fontSize: 10, color: "#5a8090" }}>{fmtTime(maxTime)}</span>
        </div>
      )}

      {/* TRACK slider label */}
      <div style={{ fontSize: 8, color: "#2ba8c8", letterSpacing: "0.12em", marginBottom: 2, opacity: 0.7 }}>TRACK</div>

      {/* Interactive track — overview (range handles + passive focus indicator) */}
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        style={{ position: "relative", height: 20, cursor: "pointer" }}
      >
        {/* Background rail */}
        <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 3, borderRadius: 2, background: "rgba(43,168,200,0.15)", transform: "translateY(-50%)", pointerEvents: "none" }} />
        {/* Selected range */}
        <div style={{ position: "absolute", top: "50%", left: `${startPct}%`, width: `${endPct - startPct}%`, height: 3, borderRadius: 2, background: "#2ba8c8", transform: "translateY(-50%)", pointerEvents: "none" }} />
        {/* Start handle + drag tooltip */}
        <div style={{ position: "absolute", top: "50%", left: `${startPct}%`, transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
          {activeHandle === "start" && spanDays > 1 && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 9, color: "#2ba8c8", background: "rgba(4,12,20,0.9)", padding: "2px 6px", borderRadius: 3, border: "1px solid rgba(43,168,200,0.3)" }}>
              {fmtDateTime(value[0])}
            </div>
          )}
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#2ba8c8", border: "2px solid #020a12", boxShadow: "0 0 0 2px rgba(43,168,200,0.35)" }} />
        </div>
        {/* End handle + drag tooltip */}
        <div style={{ position: "absolute", top: "50%", left: `${endPct}%`, transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
          {activeHandle === "end" && spanDays > 1 && (
            <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 9, color: "#2ba8c8", background: "rgba(4,12,20,0.9)", padding: "2px 6px", borderRadius: 3, border: "1px solid rgba(43,168,200,0.3)" }}>
              {fmtDateTime(value[1])}
            </div>
          )}
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#2ba8c8", border: "2px solid #020a12", boxShadow: "0 0 0 2px rgba(43,168,200,0.35)" }} />
        </div>
        {/* Focus waypoint handle (overview — thinner; precise dragging happens on zoom track below) */}
        {focusPct != null && (
          <>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${focusPct}%`, width: 1, background: "rgba(245,158,11,0.4)", transform: "translateX(-50%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: "50%", left: `${focusPct}%`, width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", border: "2px solid #020a12", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />
          </>
        )}
      </div>

      {/* ── Zoom track: full-width re-projection of the selected range ─────── */}
      {/* Only the focus dot is interactive here. Each waypoint in the visible */}
      {/* window gets a tiny tick so the snap targets are visible.             */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 8, color: "#f59e0b", letterSpacing: "0.12em", opacity: 0.7 }}>MOMENT</span>
        <span style={{ fontSize: 9, color: "#5a8090" }}>{zoomWaypoints.length} waypoints</span>
        <span style={{ fontSize: 8, width: 45 }} />
      </div>
      <div
        ref={zoomRef}
        onPointerDown={onZoomPointerDown}
        onPointerMove={onZoomPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        style={{ position: "relative", height: 18, cursor: zoomWaypoints.length ? "pointer" : "default" }}
      >
        {/* Continuous orange rail — smooth across the full window even when */}
        {/* waypoints are unevenly distributed. Snapping still happens on drag. */}
        <div style={{
          position: "absolute", top: "50%", left: 0, right: 0,
          height: 3, borderRadius: 2,
          background: "rgba(245,158,11,0.45)",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }} />
        {/* Focus dot (zoom — bigger, draggable) + date label */}
        {focusZoomPct != null && focusTime != null && (
          <div style={{ position: "absolute", top: "50%", left: `${focusZoomPct}%`, transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
            <div style={{
              position: "absolute", bottom: 12, left: "50%",
              transform: "translateX(-50%)",
              whiteSpace: "nowrap", fontSize: 9, color: "#f59e0b",
              background: "rgba(4,12,20,0.85)", padding: "1px 5px", borderRadius: 3,
            }}>
              {spanDays > 1 ? fmtDateTime(focusTime) : fmtTime(focusTime)}
            </div>
            <div style={{
              width: 12, height: 12, borderRadius: "50%",
              background: "#f59e0b", border: "2px solid #020a12",
              boxShadow: "0 0 0 2px rgba(245,158,11,0.4)",
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

function btnToggleStyle(active: boolean, color = "#2ba8c8"): React.CSSProperties {
  return {
    background: active ? `${color}26` : "transparent",
    border: `1px solid ${active ? color : `${color}44`}`,
    borderRadius: 4,
    color: active ? color : "#5a8090",
    fontSize: 9,
    padding: "2px 7px",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.06em",
    fontWeight: active ? 600 : 400,
  };
}

const datePickerStyle: React.CSSProperties = {
  background: "rgba(4,12,20,0.9)",
  border: "1px solid rgba(245,158,11,0.3)",
  borderRadius: 4,
  color: "#c8dce8",
  fontSize: 10,
  padding: "2px 5px",
  outline: "none",
  fontFamily: "inherit",
  colorScheme: "dark",
};
