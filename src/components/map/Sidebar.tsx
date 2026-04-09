"use client";

import { useEffect, useRef, useState } from "react";

interface Event {
  seq: number;
  t: number;
  type: "collect" | "build" | "flush" | "gap";
  msg: string;
}

interface CollectorStats {
  status: "ok" | "degraded" | "down";
  vessels_tracked: number;
  aisstream?: { messages: number; perMin: number };
  db?: { inserted: number; errors: number };
}

export default function Sidebar() {
  const [lines, setLines] = useState<Event[]>([]);
  const [stats, setStats] = useState<CollectorStats | null>(null);
  const [vesselCount, setVesselCount] = useState(0);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Terminal feed
  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch(`/api/collector/events?since=${seqRef.current}`);
        if (!res.ok) return;
        const data: Event[] = await res.json();
        if (!mounted || !data.length) return;
        seqRef.current = data[data.length - 1].seq;
        setLines((prev) => {
          const seen = new Set(prev.map((e) => e.seq));
          const fresh = data.filter((e) => !seen.has(e.seq));
          return [...prev, ...fresh].slice(-40);
        });
      } catch {}
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Collector stats
  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch("/api/collector");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted) setStats(data);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Vessel count
  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch("/api/vessels");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && data.live != null) setVesselCount(data.live);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 10_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const statusColor = stats?.status === "ok" ? "#00e676" : stats?.status === "degraded" ? "#f59e0b" : "#ef4444";

  return (
    <div style={{
      width: 220,
      flexShrink: 0,
      height: "100%",
      background: "rgba(4, 12, 20, 0.92)",
      borderRight: "1px solid rgba(43, 168, 200, 0.1)",
      display: "flex",
      flexDirection: "column",
      gap: 0,
    }}>
      {/* Logo */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "1px", color: "#2ba8c8" }}>AISS</div>
        <div style={{ fontSize: 9, color: "#5a8090", letterSpacing: "0.5px", marginTop: 1 }}>Ocean Evidence Protocol</div>
      </div>

      {/* Stats */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#00e676", lineHeight: 1 }}>
            {vesselCount}
          </div>
          <div style={{ fontSize: 9, color: "#5a8090", letterSpacing: "0.5px", marginTop: 2 }}>LIVE</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: statusColor, letterSpacing: "0.8px", textTransform: "uppercase" }}>
            {stats?.status ?? "—"}
          </span>
        </div>
      </div>

      {/* Terminal feed */}
      <div style={{ padding: "8px 0 4px" }}>
        <div style={{ padding: "0 16px 6px", fontSize: 9, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", color: "#5a8090" }}>
          Live feed
        </div>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", padding: "0 0 8px" }}>
        {lines.length === 0 ? (
          <div style={{ padding: "0 16px", fontSize: 10, fontFamily: "monospace", color: "#5a8090" }}>
            waiting...
          </div>
        ) : (
          lines.map((ev, idx) => (
            <div key={`${ev.seq}_${idx}`} style={{ padding: "1px 16px", fontSize: 10, fontFamily: "monospace", color: "#7a9aaa", lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ev.msg}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
