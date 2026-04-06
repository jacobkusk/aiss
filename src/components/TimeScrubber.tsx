"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface Props {
  /** Total range in minutes */
  rangeMinutes: number;
  /** Called with minutes offset from "now" (negative = past) */
  onScrub: (minutesAgo: number) => void;
  /** Called when scrubbing ends (returns to live) */
  onLive: () => void;
}

export default function TimeScrubber({ rangeMinutes, onScrub, onLive }: Props) {
  const [value, setValue] = useState(rangeMinutes); // far right = now
  const [isDragging, setIsDragging] = useState(false);
  const isLive = value === rangeMinutes;

  const formatTime = (minutesAgo: number) => {
    if (minutesAgo === 0) return "Now";
    const h = Math.floor(minutesAgo / 60);
    const m = minutesAgo % 60;
    if (h === 0) return `-${m}m`;
    if (m === 0) return `-${h}h`;
    return `-${h}h ${m}m`;
  };

  const minutesAgo = rangeMinutes - value;

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
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{
        background: "rgba(15, 15, 42, 0.9)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.1)",
        minWidth: "360px",
        maxWidth: "500px",
        width: "60%",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          color: "rgba(255,255,255,0.4)",
          whiteSpace: "nowrap",
        }}
      >
        -{Math.floor(rangeMinutes / 60)}h
      </span>

      <input
        type="range"
        min={0}
        max={rangeMinutes}
        step={1}
        value={value}
        onChange={handleChange}
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={() => setIsDragging(false)}
        onTouchStart={() => setIsDragging(true)}
        onTouchEnd={() => setIsDragging(false)}
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
          color: isLive ? "#00e676" : "rgba(255,255,255,0.5)",
          background: isLive ? "rgba(0, 230, 118, 0.1)" : "rgba(255,255,255,0.06)",
          border: isLive ? "1px solid rgba(0, 230, 118, 0.3)" : "1px solid rgba(255,255,255,0.1)",
          borderRadius: "4px",
          padding: "2px 8px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {isLive ? "LIVE" : formatTime(minutesAgo)}
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
