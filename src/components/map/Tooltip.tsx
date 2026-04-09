"use client";

export interface TooltipData {
  rows: { label: string; value: string }[];
  title?: string;
}

interface Props {
  data: TooltipData;
  x: number;
  y: number;
}

export default function Tooltip({ data, x, y }: Props) {
  const OFFSET = 14;
  // Keep tooltip inside viewport
  const left = x + OFFSET;
  const top = y + OFFSET;

  return (
    <div style={{
      position: "fixed",
      left,
      top,
      zIndex: 1000,
      pointerEvents: "none",
      background: "rgba(4, 12, 20, 0.95)",
      border: "1px solid rgba(43, 168, 200, 0.25)",
      borderRadius: 8,
      padding: "8px 11px",
      minWidth: 160,
      backdropFilter: "blur(12px)",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    }}>
      {data.title && (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", marginBottom: 6, lineHeight: 1.2 }}>
          {data.title}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {data.rows.map(({ label, value }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.7px", color: "#5a8090", flexShrink: 0 }}>
              {label}
            </span>
            <span style={{ fontSize: 11, fontFamily: "monospace", color: "#c8dce8", textAlign: "right" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
