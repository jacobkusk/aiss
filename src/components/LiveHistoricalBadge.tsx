"use client";

import { useState, useEffect } from "react";

interface Props {
  isLive: boolean;
  vesselCount: number;
  date: string | null;
  routeCount: number;
  sidebarOpen?: boolean;
}

function useClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export default function LiveHistoricalBadge({ isLive, vesselCount, date, routeCount, sidebarOpen = true }: Props) {
  const now = useClock();
  const offsetHours = -now.getTimezoneOffset() / 60;
  const utcLabel = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      className="flex flex-col rounded-lg px-3 py-2"
      style={{
        background: "var(--bg-panel)",
        backdropFilter: "blur(20px)",
        border: "1px solid var(--border)",
        minWidth: "160px",
      }}
    >
      {isLive ? (
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full pulse-live flex-shrink-0"
            style={{ background: "var(--green-live)" }}
          />
          <span className="font-mono font-bold" style={{ fontSize: "18px", color: "var(--green-live)", lineHeight: 1 }}>
            LIVE
          </span>
          <span className="font-mono font-bold" style={{ fontSize: "18px", color: "#ffffff", lineHeight: 1 }}>
            {timeStr}
          </span>
          <span className="font-mono font-bold" style={{ fontSize: "18px", color: "rgba(255,255,255,0.35)", lineHeight: 1 }}>
            {utcLabel}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: "var(--amber-historical)" }}
          />
          <span className="text-xs font-bold font-mono" style={{ color: "var(--amber-historical)" }}>
            HISTORICAL
          </span>
          <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            {date} · {routeCount} routes
          </span>
        </div>
      )}
    </div>
  );
}
