"use client";

import { useState, useCallback } from "react";

interface Props {
  rangeMinutes: number;
  onScrub: (minutesAgo: number) => void;
  onLive: () => void;
  zoomLevel?: number;
}

const AREA_PLAYBACK_MIN_ZOOM = 9;

export default function TimeScrubber({ rangeMinutes, onScrub, onLive, zoomLevel = 2 }: Props) {
  const [value, setValue] = useState(rangeMinutes);
  const isLive = value === rangeMinutes;
  const minutesAgo = rangeMinutes - value;
  const canAreaPlayback = zoomLevel >= AREA_PLAYBACK_MIN_ZOOM;

  const formatClock = (minsAgo: number) => {
    if (minsAgo === 0) return "Now";
    const d = new Date(Date.now() - minsAgo * 60_000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const startClock = () => {
    const d = new Date(Date.now() - rangeMinutes * 60_000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setValue(v);
    const ago = rangeMinutes - v;
    if (ago === 0) {
      onLive();
    } else {
      onScrub(ago);
    }
  }, [rangeMinutes, onScrub, onLive]);

  const handleLive = () => {
    setValue(rangeMinutes);
    onLive();
  };

  return (
    <div
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{
        background: "rgba(15, 15, 42, 0.9)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.1)",
        minWidth: "360px",
        maxWidth: "520px",
        width: "60%",
      }}
    >
      <span style={{
        fontSize: "11px",
        fontFamily: "var(--font-mono)",
        color: "rgba(255,255,255,0.4)",
        whiteSpace: "nowrap",
      }}>
        {startClock()}
      </span>

      <input
        type="range"
        min={0}
        max={rangeMinutes}
        step={1}
        value={value}
        onChange={handleChange}
        style={{
          flex: 1,
          height: "4px",
          appearance: "none",
          background: `linear-gradient(to right, #6b8aff ${(value / rangeMinutes) * 100}%, rgba(255,255,255,0.15) ${(value / rangeMinutes) * 100}%)`,
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

      {/* Area playback indicator */}
      <span style={{
        fontSize: "8px",
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        letterSpacing: "0.5px",
        color: canAreaPlayback ? "rgba(107, 138, 255, 0.6)" : "rgba(255,255,255,0.2)",
        whiteSpace: "nowrap",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        paddingLeft: "10px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        transition: "color 0.3s",
      }}>
        <span style={{
          width: "4px",
          height: "4px",
          borderRadius: "50%",
          background: canAreaPlayback ? "#6b8aff" : "rgba(255,255,255,0.15)",
          transition: "background 0.3s",
        }} />
        {canAreaPlayback ? "AREA" : "AREA"}
      </span>

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
