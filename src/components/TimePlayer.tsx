"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  rangeMinutes: number;
  onScrub: (minutesAgo: number) => void;
  onLive: () => void;
}

const SPEEDS = [
  { label: "1×", factor: 1 },
  { label: "5×", factor: 5 },
  { label: "10×", factor: 10 },
  { label: "50×", factor: 50 },
];

// Each tick = 1 real minute of history, played back at `factor` min/sec
const TICK_MS = 1000;

export default function TimePlayer({ rangeMinutes, onScrub, onLive }: Props) {
  const [minutesAgo, setMinutesAgo] = useState(0); // 0 = live
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[1]); // default 5×
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLive = minutesAgo <= 0;

  const formatClock = (minsAgo: number) => {
    if (minsAgo <= 0) return "Nu";
    const d = new Date(Date.now() - minsAgo * 60_000);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return isToday ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
  };

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    stop();
    setPlaying(true);
  }, [stop]);

  // Advance playhead
  useEffect(() => {
    if (!playing) return;
    intervalRef.current = setInterval(() => {
      setMinutesAgo(prev => {
        const next = prev - speed.factor;
        if (next <= 0) {
          stop();
          onLive();
          return 0;
        }
        onScrub(next);
        return next;
      });
    }, TICK_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speed, stop, onScrub, onLive]);

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ago = Number(e.target.value);
    setMinutesAgo(ago);
    if (ago <= 0) {
      onLive();
    } else {
      onScrub(ago);
    }
  };

  const handleLive = () => {
    stop();
    setMinutesAgo(0);
    onLive();
  };

  const handlePlayPause = () => {
    if (playing) {
      stop();
    } else {
      // Start from max if at live
      if (isLive) setMinutesAgo(rangeMinutes);
      play();
    }
  };

  const pct = ((rangeMinutes - minutesAgo) / rangeMinutes) * 100;

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
        gap: "8px",
      }}
    >
      {/* Top row: play/pause + time + speed + live */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Step back */}
        <button
          onClick={() => {
            stop();
            const next = Math.min(minutesAgo + 60, rangeMinutes);
            setMinutesAgo(next);
            onScrub(next);
          }}
          style={btnStyle}
          title="−1 time"
        >
          ◀◀
        </button>

        {/* Play/Pause */}
        <button onClick={handlePlayPause} style={{ ...btnStyle, fontSize: "16px", width: "28px" }}>
          {playing ? "⏸" : "▶"}
        </button>

        {/* Step forward */}
        <button
          onClick={() => {
            stop();
            const next = Math.max(minutesAgo - 60, 0);
            setMinutesAgo(next);
            if (next <= 0) onLive(); else onScrub(next);
          }}
          style={btnStyle}
          title="+1 time"
        >
          ▶▶
        </button>

        {/* Current time */}
        <span style={{
          flex: 1,
          fontSize: "11px",
          fontFamily: "var(--font-mono)",
          color: isLive ? "#00e676" : "rgba(255,255,255,0.7)",
          textAlign: "center",
        }}>
          {formatClock(minutesAgo)}
        </span>

        {/* Speed selector */}
        <div style={{ display: "flex", gap: "2px" }}>
          {SPEEDS.map(s => (
            <button
              key={s.label}
              onClick={() => setSpeed(s)}
              style={{
                fontSize: "9px",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                color: speed.label === s.label ? "#6b8aff" : "rgba(255,255,255,0.3)",
                background: speed.label === s.label ? "rgba(107,138,255,0.15)" : "transparent",
                border: speed.label === s.label ? "1px solid rgba(107,138,255,0.3)" : "1px solid transparent",
                borderRadius: "3px",
                padding: "2px 5px",
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Live */}
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
          LIVE
        </button>
      </div>

      {/* Slider row */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "9px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
          {formatClock(rangeMinutes)}
        </span>
        <input
          type="range"
          min={0}
          max={rangeMinutes}
          step={5}
          value={rangeMinutes - minutesAgo}
          onChange={handleSlider}
          style={{
            flex: 1,
            height: "4px",
            appearance: "none",
            background: `linear-gradient(to right, #6b8aff ${pct}%, rgba(255,255,255,0.15) ${pct}%)`,
            borderRadius: "2px",
            outline: "none",
            cursor: "pointer",
          }}
        />
        <span style={{ fontSize: "9px", fontFamily: "var(--font-mono)", color: "#00e676", whiteSpace: "nowrap" }}>
          NU
        </span>
      </div>

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

const btnStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "rgba(255,255,255,0.6)",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "4px",
  padding: "3px 7px",
  cursor: "pointer",
  fontFamily: "var(--font-mono)",
};
