"use client";

import { useState, useCallback } from "react";

interface Props {
  onScrub: (minutesAgo: number) => void;
  onLive: () => void;
}

const COARSE_RANGE = 2880; // 2 dage
const FINE_RANGE   = 120;  // 2 timer

export default function DualScrubber({ onScrub, onLive }: Props) {
  // coarseAgo = hvor langt tilbage vi er på den store slider (0 = nu)
  const [coarseAgo, setCoarseAgo] = useState(0);
  // fineOffset = justering fra fine slider inden for ±FINE_RANGE/2 af coarse position
  const [fineAgo, setFineAgo] = useState(0);

  const isLive = coarseAgo === 0 && fineAgo === 0;

  const formatClock = (minsAgo: number) => {
    if (minsAgo <= 0) return "Nu";
    const d = new Date(Date.now() - minsAgo * 60_000);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return isToday ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  };

  const handleCoarse = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const ago = COARSE_RANGE - Number(e.target.value);
    setCoarseAgo(ago);
    setFineAgo(0); // nulstil fin slider når grov flyttes
    if (ago <= 0) onLive(); else onScrub(ago);
  }, [onScrub, onLive]);

  const handleFine = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const offset = Number(e.target.value); // -60 til +60
    const total = Math.max(0, coarseAgo + offset);
    setFineAgo(offset);
    if (total <= 0) onLive(); else onScrub(total);
  }, [coarseAgo, onScrub, onLive]);

  const handleLive = () => {
    setCoarseAgo(0);
    setFineAgo(0);
    onLive();
  };

  const coarsePct = ((COARSE_RANGE - coarseAgo) / COARSE_RANGE) * 100;
  const finePct   = ((fineAgo + FINE_RANGE / 2) / FINE_RANGE) * 100;
  const totalAgo  = Math.max(0, coarseAgo + fineAgo);

  return (
    <div
      style={{
        background: "rgba(15, 15, 42, 0.9)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px",
        padding: "10px 14px",
        minWidth: "320px",
        maxWidth: "460px",
        width: "50%",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      {/* Fin slider — 2 timer */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={labelStyle}>−2t</span>
        <input
          type="range"
          min={-FINE_RANGE / 2}
          max={FINE_RANGE / 2}
          step={1}
          value={fineAgo}
          onChange={handleFine}
          style={{ ...sliderStyle, background: sliderBg(finePct, "#2BA8C8") }}
        />
        <span style={labelStyle}>+2t</span>
        <span style={{ ...timeStyle, color: "#2BA8C8", minWidth: 42 }}>
          {fineAgo === 0 ? "·" : (fineAgo > 0 ? `+${fineAgo}m` : `${fineAgo}m`)}
        </span>
      </div>

      {/* Grov slider — 2 dage */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={labelStyle}>2d</span>
        <input
          type="range"
          min={0}
          max={COARSE_RANGE}
          step={15}
          value={COARSE_RANGE - coarseAgo}
          onChange={handleCoarse}
          style={{ ...sliderStyle, background: sliderBg(coarsePct, "#6b8aff") }}
        />
        <button onClick={handleLive} style={{
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          fontWeight: 600,
          color: isLive ? "#00e676" : "#6b8aff",
          background: isLive ? "rgba(0,230,118,0.1)" : "rgba(107,138,255,0.1)",
          border: isLive ? "1px solid rgba(0,230,118,0.3)" : "1px solid rgba(107,138,255,0.3)",
          borderRadius: "4px",
          padding: "2px 8px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}>
          {isLive ? "LIVE" : formatClock(totalAgo)}
        </button>
      </div>

      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid #6b8aff;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(107,138,255,0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid #6b8aff;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

const sliderBg = (pct: number, color: string) =>
  `linear-gradient(to right, ${color} ${pct}%, rgba(255,255,255,0.15) ${pct}%)`;

const sliderStyle: React.CSSProperties = {
  flex: 1,
  height: "4px",
  appearance: "none",
  borderRadius: "2px",
  outline: "none",
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  fontSize: "9px",
  fontFamily: "var(--font-mono)",
  color: "rgba(255,255,255,0.3)",
  whiteSpace: "nowrap",
};

const timeStyle: React.CSSProperties = {
  fontSize: "11px",
  fontFamily: "var(--font-mono)",
  color: "rgba(255,255,255,0.5)",
  whiteSpace: "nowrap",
};
