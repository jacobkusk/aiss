"use client";

import { useEffect, useState } from "react";

interface Funnel {
  incoming: number;
  incomingInterval: number;
  filters: { broadcast: number; teleport: number; interval: number; stationary: number; straight: number };
  filtersInterval: { broadcast: number; teleport: number; interval: number; stationary: number; straight: number };
}

const FILTER_LABELS: { key: keyof Funnel["filters"]; label: string; desc: string }[] = [
  { key: "broadcast",  label: "Broadcast dedup", desc: "Samme broadcast, flere stationer" },
  { key: "interval",   label: "Min interval",    desc: "< 30s siden sidst" },
  { key: "stationary", label: "Stilleliggende",  desc: "Sog < 0.3kn, ingen bevægelse" },
  { key: "straight",   label: "Lige kurs",       desc: "Kursændring < 5°" },
  { key: "teleport",   label: "Anti-teleport",   desc: "> 100nm på < 60s" },
];

export default function FilterTile() {
  const [funnel, setFunnel] = useState<Funnel | null>(null);

  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch("/api/collector");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && data.funnel) setFunnel(data.funnel);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 3_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const incoming = funnel?.incoming ?? 0;
  const totalFiltered = funnel ? Object.values(funnel.filters).reduce((a, b) => a + b, 0) : 0;
  const passed = incoming - totalFiltered;
  const passedPct = incoming > 0 ? Math.round((passed / incoming) * 100) : 0;

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
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px" }}>
        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
          Filter Funnel
        </span>
        <span style={{ fontFamily: "monospace", fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>
          {incoming.toLocaleString()} ind
        </span>
      </div>

      {/* Filter rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }}>
        {FILTER_LABELS.map(({ key, label, desc }) => {
          const count = funnel?.filters[key] ?? 0;
          const pct = incoming > 0 ? (count / incoming) * 100 : 0;
          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)" }}>{label}</span>
                <span style={{ fontFamily: "monospace", fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
                  {count.toLocaleString()} <span style={{ opacity: 0.5 }}>({Math.round(pct)}%)</span>
                </span>
              </div>
              <div style={{ height: "2px", borderRadius: "1px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(pct, 100)}%`,
                  background: "rgba(107,138,255,0.5)",
                  borderRadius: "1px",
                  transition: "width 0.8s ease",
                }} />
              </div>
              <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)", marginTop: "1px" }}>{desc}</div>
            </div>
          );
        })}
      </div>

      {/* Divider + passed through */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>→ til DB</span>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontFamily: "monospace", fontSize: "14px", fontWeight: 700, color: "#2DB891" }}>
            {passed.toLocaleString()}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: "11px", color: "rgba(255,255,255,0.25)", marginLeft: "6px" }}>
            ({passedPct}%)
          </span>
        </div>
      </div>
    </div>
  );
}
