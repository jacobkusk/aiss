"use client";

import { useCallback } from "react";

interface Props {
  minTime: number; // epoch ms
  maxTime: number; // epoch ms
  value: [number, number]; // epoch ms [start, end]
  onChange: (range: [number, number]) => void;
}

function fmtTime(epoch: number) {
  return new Date(epoch).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDate(epoch: number) {
  return new Date(epoch).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function TimeSlider({ minTime, maxTime, value, onChange }: Props) {
  const span = maxTime - minTime || 1;

  const handleStart = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    onChange([Math.min(v, value[1] - 60_000), value[1]]);
  }, [value, onChange]);

  const handleEnd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    onChange([value[0], Math.max(v, value[0] + 60_000)]);
  }, [value, onChange]);

  const startPct = ((value[0] - minTime) / span) * 100;
  const endPct   = ((value[1] - minTime) / span) * 100;

  const spanDays = (maxTime - minTime) / 86_400_000;
  const showDate = spanDays > 0.9;

  return (
    <div style={{
      position: "absolute",
      bottom: 28,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(600px, calc(100vw - 40px))",
      background: "rgba(4, 12, 20, 0.88)",
      border: "1px solid rgba(43, 168, 200, 0.18)",
      borderRadius: 8,
      padding: "12px 16px 10px",
      zIndex: 10,
      backdropFilter: "blur(6px)",
      fontFamily: "var(--font-mono, monospace)",
    }}>
      {/* Labels row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "#5a8090" }}>
          {showDate ? fmtDate(minTime) : ""} {fmtTime(minTime)}
        </span>
        <span style={{ fontSize: 11, color: "#2ba8c8", letterSpacing: "0.03em" }}>
          {fmtTime(value[0])} – {fmtTime(value[1])}
        </span>
        <span style={{ fontSize: 11, color: "#5a8090" }}>
          {showDate ? fmtDate(maxTime) : ""} {fmtTime(maxTime)}
        </span>
      </div>

      {/* Track + selection highlight */}
      <div style={{ position: "relative", height: 20 }}>
        {/* Base track */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 3,
          borderRadius: 2,
          background: "rgba(43, 168, 200, 0.15)",
          transform: "translateY(-50%)",
        }} />
        {/* Selected range highlight */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: `${startPct}%`,
          width: `${endPct - startPct}%`,
          height: 3,
          borderRadius: 2,
          background: "#2ba8c8",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }} />

        {/* Start handle */}
        <input
          type="range"
          className="time-slider-input"
          min={minTime}
          max={maxTime}
          step={60_000}
          value={value[0]}
          onChange={handleStart}
          style={{ zIndex: 1 }}
        />
        {/* End handle */}
        <input
          type="range"
          className="time-slider-input"
          min={minTime}
          max={maxTime}
          step={60_000}
          value={value[1]}
          onChange={handleEnd}
          style={{ zIndex: 2 }}
        />

        {/* Visible thumb: start */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: `${startPct}%`,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#2ba8c8",
          border: "2px solid #020a12",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          boxShadow: "0 0 0 1px rgba(43,168,200,0.4)",
        }} />
        {/* Visible thumb: end */}
        <div style={{
          position: "absolute",
          top: "50%",
          left: `${endPct}%`,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "#2ba8c8",
          border: "2px solid #020a12",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          boxShadow: "0 0 0 1px rgba(43,168,200,0.4)",
        }} />
      </div>

      {/* Duration hint */}
      <div style={{ textAlign: "center", marginTop: 6, fontSize: 10, color: "#5a8090" }}>
        {Math.round((value[1] - value[0]) / 60_000)} min window
      </div>
    </div>
  );
}
