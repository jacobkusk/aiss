"use client";

import { useEffect, useRef, useState } from "react";

interface VesselStats {
  hot: number;
  live: number;
  recent: number;
  total: number;
  types: {
    cargo: number;
    tanker: number;
    passenger: number;
    fishing: number;
    sailing: number;
    other: number;
  };
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    if (value === prev.current) return;
    const diff = value - prev.current;
    const steps = Math.min(Math.abs(diff), 15);
    const step = diff / steps;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplay(Math.round(prev.current + step * i));
      if (i >= steps) { clearInterval(id); setDisplay(value); prev.current = value; }
    }, 25);
    return () => clearInterval(id);
  }, [value]);

  return <>{display.toLocaleString()}</>;
}

const TYPES: { key: keyof VesselStats["types"]; label: string; color: string }[] = [
  { key: "cargo",     label: "Cargo",     color: "#4a8f4a" },
  { key: "tanker",    label: "Tanker",    color: "#c44040" },
  { key: "passenger", label: "Pass.",     color: "#4a90d9" },
  { key: "fishing",   label: "Fishing",   color: "#d4a017" },
  { key: "sailing",   label: "Sailing",   color: "#2ba8c8" },
  { key: "other",     label: "Other",     color: "rgba(255,255,255,0.25)" },
];

export default function VesselsTile() {
  const [stats, setStats] = useState<VesselStats | null>(null);

  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch("/api/vessels");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setStats(data);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 3_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const live = stats?.live ?? 0;
  const hot = stats?.hot ?? 0;
  const recent = stats?.recent ?? 0;

  // Bar widths relative to recent (largest bucket)
  const base = Math.max(recent, 1);

  return (
    <div style={{
      margin: "0 16px 12px",
      borderRadius: "10px",
      padding: "14px 16px",
      background: "rgba(45, 184, 145, 0.04)",
      border: "1px solid rgba(45,184,145,0.12)",
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: "12px",
      }}>
        <span style={{
          fontSize: "10px", fontWeight: 600, letterSpacing: "1px",
          textTransform: "uppercase", color: "rgba(255,255,255,0.35)",
        }}>
          Vessels
        </span>
        <span style={{
          fontFamily: "monospace", fontSize: "11px",
          color: "rgba(255,255,255,0.25)",
        }}>
          {(stats?.total ?? 0).toLocaleString()} total known
        </span>
      </div>

      {/* Signal layers */}
      <div style={{ display: "flex", flexDirection: "column", gap: "7px", marginBottom: "14px" }}>
        {[
          { label: "Hot", sublabel: "< 5 min",  value: hot,    color: "#2DB891" },
          { label: "Live", sublabel: "< 30 min", value: live,   color: "#2ba8c8" },
          { label: "Recent", sublabel: "< 2 hr", value: recent, color: "rgba(255,255,255,0.3)" },
        ].map(({ label, sublabel, value, color }) => (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color, fontFamily: "monospace" }}>
                  <AnimatedNumber value={value} />
                </span>
                <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>{label}</span>
              </div>
              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{sublabel}</span>
            </div>
            <div style={{ height: "2px", borderRadius: "1px", background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${(value / base) * 100}%`,
                background: color,
                borderRadius: "1px",
                transition: "width 0.8s ease",
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Type breakdown */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "6px 8px",
      }}>
        {TYPES.map(({ key, label, color }) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: "monospace", fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.85)", lineHeight: 1 }}>
                <AnimatedNumber value={stats?.types[key] ?? 0} />
              </div>
              <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>{label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
