"use client";

import { useEffect, useState, useRef } from "react";

interface CollectorStats {
  status: "ok" | "degraded" | "down";
  uptime_seconds: number;
  vessels_tracked: number;
  aisstream: { messages: number; perMin: number };
  db: { inserted: number; errors: number };
  dedup_skipped: number;
  linebuilder: { flushes: number; segments: number; points: number; nm: number };
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    const diff = value - prev.current;
    const steps = Math.min(Math.abs(diff), 12);
    const step = diff / steps;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplay(Math.round(prev.current + step * i));
      if (i >= steps) {
        clearInterval(id);
        setDisplay(value);
        prev.current = value;
      }
    }, 30);
    return () => clearInterval(id);
  }, [value]);

  return <>{display.toLocaleString()}</>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
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
        <AnimatedNumber value={value} />
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

export default function CollectorTile() {
  const [stats, setStats] = useState<CollectorStats | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetch_() {
      try {
        const res = await fetch("/api/collector");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        setStats(data);
        setPulse(true);
        setTimeout(() => setPulse(false), 300);
      } catch {}
    }

    fetch_();
    const id = setInterval(fetch_, 3000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const status = stats?.status ?? "down";
  const statusColor = status === "ok" ? "#2DB891" : status === "degraded" ? "#f59e0b" : "#ef4444";

  return (
    <div style={{
      margin: "0 16px 12px",
      borderRadius: "10px",
      padding: "14px 16px",
      background: "rgba(43, 168, 200, 0.04)",
      border: "1px solid rgba(255,255,255,0.07)",
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
          Collector
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: statusColor,
            boxShadow: pulse ? `0 0 6px ${statusColor}` : "none",
            transition: "box-shadow 0.3s",
          }} />
          <span style={{
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            color: statusColor,
          }}>
            {status}
          </span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "12px 8px",
      }}>
        <Stat label="AIS in" value={stats?.aisstream.messages ?? 0} accent="#2ba8c8" />
        <Stat label="/min" value={stats?.aisstream.perMin ?? 0} accent="#2ba8c8" />
        <Stat label="DB writes" value={stats?.db.inserted ?? 0} accent="#2DB891" />
        <Stat label="Dedup skip" value={stats?.dedup_skipped ?? 0} />
        <Stat label="Vessels" value={stats?.vessels_tracked ?? 0} />
      </div>
    </div>
  );
}
