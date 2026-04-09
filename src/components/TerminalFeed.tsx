"use client";

import { useEffect, useRef, useState } from "react";

interface Event {
  seq: number;
  t: number;
  type: "collect" | "build" | "flush" | "gap";
  msg: string;
}

const TYPE_COLOR: Record<string, string> = {
  collect: "rgba(43,168,200,0.8)",
  build:   "rgba(107,138,255,0.8)",
  flush:   "rgba(45,184,145,0.8)",
  gap:     "rgba(240,160,60,0.8)",
};

const TYPE_LABEL: Record<string, string> = {
  collect: "collecting",
  build:   "building  ",
  flush:   "committed ",
  gap:     "gap       ",
};

export default function TerminalFeed() {
  const [lines, setLines] = useState<Event[]>([]);
  const seqRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    async function poll() {
      try {
        const res = await fetch(`/api/collector/events?since=${seqRef.current}`);
        if (!res.ok) return;
        const data: Event[] = await res.json();
        if (!mounted || data.length === 0) return;
        seqRef.current = data[data.length - 1].seq;
        setLines(prev => {
          const next = [...prev, ...data].slice(-40);
          return next;
        });
      } catch {}
    }

    poll();
    const id = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div style={{
      margin: "0 16px 16px",
      borderRadius: "10px",
      background: "rgba(0,0,0,0.25)",
      border: "1px solid rgba(255,255,255,0.06)",
      overflow: "hidden",
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px 7px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}>
        <div style={{
          width: "5px", height: "5px", borderRadius: "50%",
          background: lines.length > 0 ? "#2DB891" : "rgba(255,255,255,0.15)",
          boxShadow: lines.length > 0 ? "0 0 5px #2DB891" : "none",
        }} />
        <span style={{
          fontSize: "9px", fontWeight: 600, letterSpacing: "1px",
          textTransform: "uppercase", color: "rgba(255,255,255,0.25)",
        }}>
          Live feed
        </span>
      </div>

      {/* Log lines */}
      <div ref={scrollRef} style={{
        height: "140px",
        overflowY: "auto",
        padding: "8px 0 4px",
        scrollbarWidth: "none",
      }}>
        {lines.length === 0 ? (
          <div style={{
            padding: "0 12px",
            fontSize: "10px",
            fontFamily: "monospace",
            color: "rgba(255,255,255,0.15)",
          }}>
            waiting for events...
          </div>
        ) : (
          lines.map(ev => (
            <div key={ev.seq} style={{
              padding: "1px 12px",
              display: "flex",
              gap: "8px",
              alignItems: "baseline",
              fontSize: "10px",
              fontFamily: "monospace",
              lineHeight: "1.6",
            }}>
              <span style={{
                color: TYPE_COLOR[ev.type] || "rgba(255,255,255,0.4)",
                fontWeight: 700,
                flexShrink: 0,
                minWidth: "68px",
              }}>
                {TYPE_LABEL[ev.type] || ev.type}
              </span>
              <span style={{ color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ev.msg}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
