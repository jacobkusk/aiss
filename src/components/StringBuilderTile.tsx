"use client";

import { useEffect, useState, useRef } from "react";

interface LbStats {
  flushes: number;
  segments: number;
  points: number;
  nm: number;
}

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    const diff = value - prev.current;
    const steps = Math.min(Math.abs(diff), 10);
    const step = diff / steps;
    let i = 0;
    const id = setInterval(() => {
      i++;
      const v = prev.current + step * i;
      setDisplay(decimals > 0 ? Math.round(v * 10) / 10 : Math.round(v));
      if (i >= steps) {
        clearInterval(id);
        setDisplay(value);
        prev.current = value;
      }
    }, 30);
    return () => clearInterval(id);
  }, [value, decimals]);

  return <>{decimals > 0 ? display.toFixed(decimals) : display.toLocaleString()}</>;
}

function Stat({ label, value, accent, decimals = 0 }: { label: string; value: number; accent?: string; decimals?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      <div style={{
        fontFamily: "monospace",
        fontSize: "15px",
        fontWeight: 700,
        color: accent || "rgba(255,255,255,0.9)",
        letterSpacing: "-0.3px",
        lineHeight: 1,
      }}>
        <AnimatedNumber value={value} decimals={decimals} />
      </div>
      <div style={{
        fontSize: "9px",
        fontWeight: 600,
        letterSpacing: "0.8px",
        textTransform: "uppercase",
        color: "rgba(255,255,255,0.3)",
      }}>
        {label}
      </div>
    </div>
  );
}

const FLUSH_INTERVAL_SEC = 5 * 60;

export default function StringBuilderTile() {
  const [lb, setLb] = useState<LbStats | null>(null);
  const [secondsSinceFlush, setSecondsSinceFlush] = useState(0);
  const lastFlushCount = useRef(0);
  const flushTimestamp = useRef(Date.now());

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch("/api/collector");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        const next: LbStats = data.linebuilder ?? { flushes: 0, segments: 0, points: 0, nm: 0 };
        if (next.flushes > lastFlushCount.current) {
          lastFlushCount.current = next.flushes;
          flushTimestamp.current = Date.now();
        }
        setLb(next);
      } catch {}
    }

    poll();
    const pollId = setInterval(poll, 3000);

    // Countdown ticker
    const tickId = setInterval(() => {
      if (!mounted) return;
      const elapsed = Math.round((Date.now() - flushTimestamp.current) / 1000);
      setSecondsSinceFlush(Math.min(elapsed, FLUSH_INTERVAL_SEC));
    }, 1000);

    return () => { mounted = false; clearInterval(pollId); clearInterval(tickId); };
  }, []);

  const progress = secondsSinceFlush / FLUSH_INTERVAL_SEC;
  const remaining = Math.max(0, FLUSH_INTERVAL_SEC - secondsSinceFlush);
  const remMin = Math.floor(remaining / 60);
  const remSec = remaining % 60;
  const isBuilding = remaining < 5;

  return (
    <div style={{
      margin: "0 16px 12px",
      borderRadius: "10px",
      padding: "14px 16px",
      background: "rgba(107, 138, 255, 0.04)",
      border: "1px solid rgba(107,138,255,0.12)",
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "12px",
      }}>
        <span style={{
          fontSize: "10px",
          fontWeight: 600,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.35)",
        }}>
          String Builder
        </span>
        <span style={{
          fontSize: "9px",
          fontFamily: "monospace",
          color: isBuilding ? "#2DB891" : "rgba(107,138,255,0.6)",
          fontWeight: 700,
          letterSpacing: "0.5px",
        }}>
          {isBuilding ? "building..." : `next ${remMin}:${String(remSec).padStart(2, "0")}`}
        </span>
      </div>

      {/* Stats */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px 8px",
        marginBottom: "12px",
      }}>
        <Stat label="NM built" value={lb?.nm ?? 0} accent="#6b8aff" />
        <Stat label="Segments" value={lb?.segments ?? 0} accent="#6b8aff" />
        <Stat label="Points" value={lb?.points ?? 0} />
        <Stat label="Flushes" value={lb?.flushes ?? 0} />
      </div>

      {/* Progress bar — time until next flush */}
      <div>
        <div style={{
          height: "3px",
          borderRadius: "2px",
          background: "rgba(107,138,255,0.1)",
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: isBuilding
              ? "linear-gradient(90deg, #2DB891, #2ba8c8)"
              : "linear-gradient(90deg, #6b8aff, #2ba8c8)",
            transition: "width 1s linear, background 0.3s",
            borderRadius: "2px",
          }} />
        </div>
      </div>
    </div>
  );
}
