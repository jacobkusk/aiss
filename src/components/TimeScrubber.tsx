"use client";

import { useState, useCallback } from "react";

interface Props {
  rangeMinutes: number;
  onScrub: (minutesAgo: number) => void;
  onLive: () => void;
  zoomLevel?: number;
}

const ZOOM_PRESETS = [
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "48h", minutes: 2880 },
];

export default function TimeScrubber({ rangeMinutes, onScrub, onLive, zoomLevel = 2 }: Props) {
  const [scrubRange, setScrubRange] = useState(rangeMinutes);
  const [value, setValue] = useState(scrubRange); // max = live
  const effectiveRange = Math.min(scrubRange, rangeMinutes);
  const isLive = value >= effectiveRange;
  const minutesAgo = effectiveRange - value;

  const formatClock = (minsAgo: number) => {
    if (minsAgo === 0) return "Now";
    const d = new Date(Date.now() - minsAgo * 60_000);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return isToday ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  };

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setValue(v);
    const ago = effectiveRange - v;
    if (ago <= 0) {
      onLive();
    } else {
      onScrub(ago);
    }
  }, [effectiveRange, onScrub, onLive]);

  const handleLive = () => {
    setValue(effectiveRange);
    onLive();
  };

  const handleZoom = (minutes: number) => {
    setScrubRange(minutes);
    // Keep current position if within new range, otherwise go live
    const currentAgo = effectiveRange - value;
    if (currentAgo > minutes) {
      setValue(minutes);
      onLive();
    } else {
      setValue(minutes - currentAgo);
    }
  };

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{
        background: "rgba(15, 15, 42, 0.9)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.1)",
        minWidth: "380px",
        maxWidth: "580px",
        width: "65%",
      }}
    >
      {/* Zoom presets */}
      <div style={{ display: "flex", gap: "2px" }}>
        {ZOOM_PRESETS.filter(p => p.minutes <= rangeMinutes).map(p => (
          <button
            key={p.label}
            onClick={() => handleZoom(p.minutes)}
            style={{
              fontSize: "9px",
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: scrubRange === p.minutes ? "#6b8aff" : "rgba(255,255,255,0.3)",
              background: scrubRange === p.minutes ? "rgba(107, 138, 255, 0.15)" : "transparent",
              border: scrubRange === p.minutes ? "1px solid rgba(107, 138, 255, 0.3)" : "1px solid transparent",
              borderRadius: "3px",
              padding: "2px 5px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <span style={{
        fontSize: "11px",
        fontFamily: "var(--font-mono)",
        color: "rgba(255,255,255,0.4)",
        whiteSpace: "nowrap",
      }}>
        {formatClock(effectiveRange)}
      </span>

      <input
        type="range"
        min={0}
        max={effectiveRange}
        step={1}
        value={Math.min(value, effectiveRange)}
        onChange={handleChange}
        style={{
          flex: 1,
          height: "4px",
          appearance: "none",
          background: `linear-gradient(to right, #6b8aff ${(Math.min(value, effectiveRange) / effectiveRange) * 100}%, rgba(255,255,255,0.15) ${(Math.min(value, effectiveRange) / effectiveRange) * 100}%)`,
          borderRadius: "2px",
          outline: "none",
          cursor: "pointer",
        }}
      />

      <button
        onClick={handleLive}
        style={{
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          color: isLive ? "#00e676" : "#6b8aff",
          background: isLive ? "rgba(0, 230, 118, 0.1)" : "rgba(107, 138, 255, 0.1)",
          border: isLive ? "1px solid rgba(0, 230, 118, 0.3)" : "1px solid rgba(107, 138, 255, 0.3)",
          borderRadius: "4px",
          padding: "2px 8px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isLive ? "LIVE" : formatClock(minutesAgo)}
      </button>

      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #6b8aff;
          border: 2px solid #ffffff;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(107, 138, 255, 0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #6b8aff;
          border: 2px solid #ffffff;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(107, 138, 255, 0.5);
        }
      `}</style>
    </div>
  );
}
