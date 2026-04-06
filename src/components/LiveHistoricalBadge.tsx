"use client";

interface Props {
  isLive: boolean;
  vesselCount: number;
  date: string | null;
  routeCount: number;
  sidebarOpen?: boolean;
}

export default function LiveHistoricalBadge({ isLive, vesselCount, date, routeCount, sidebarOpen = true }: Props) {
  return (
    <div
      className="absolute top-4 z-30 flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        left: sidebarOpen ? "16px" : "60px",
        background: "var(--bg-panel)",
        backdropFilter: "blur(20px)",
        border: "1px solid var(--border)",
        transition: "left 0.15s",
      }}
    >
      {isLive ? (
        <>
          <span
            className="inline-block w-2 h-2 rounded-full pulse-live"
            style={{ background: "var(--green-live)" }}
          />
          <span className="text-xs font-bold font-mono" style={{ color: "var(--green-live)" }}>
            LIVE
          </span>
          <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            {vesselCount.toLocaleString()} vessels
          </span>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
