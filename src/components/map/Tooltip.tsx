"use client";

export interface TooltipData {
  rows: { label: string; value: string }[];
  title?: string;
  mmsi?: number;
  sourceCount?: number;
  shipType?: string | null;
}

interface Props {
  data: TooltipData;
  x: number;
  y: number;
}

const STATUS_COLOR: Record<number, string> = {
  1: "#00e676", // 1× = still verified but minimal
  2: "#00e676",
  3: "#2BA8C8",
  4: "#2BA8C8",
};

function trustLabel(n: number): { text: string; color: string } {
  if (n >= 4) return { text: `VERIFIED · ${n}×`, color: "#2BA8C8" };
  if (n >= 2) return { text: `VERIFIED · ${n}×`, color: "#00e676" };
  if (n === 1) return { text: "1 SOURCE", color: "#f59e0b" };
  return { text: "NO FIX", color: "#4a6878" };
}

export default function Tooltip({ data, x, y }: Props) {
  const OFFSET = 14;

  // Keep tooltip inside viewport
  const cardW = 268;
  const cardH = 260;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
  const left = x + OFFSET + cardW > vw ? x - cardW - OFFSET : x + OFFSET;
  const top  = y + OFFSET + cardH > vh ? y - cardH - OFFSET : y + OFFSET;

  const sc = data.sourceCount ?? 0;
  const trust = trustLabel(sc);
  const showTrust = sc > 0;

  return (
    <div style={{
      position: "fixed",
      left,
      top,
      zIndex: 1000,
      pointerEvents: "none",
      width: cardW,
      background: "rgba(4, 12, 20, 0.96)",
      border: "1px solid rgba(43, 168, 200, 0.30)",
      borderRadius: 12,
      backdropFilter: "blur(16px)",
      boxShadow: "0 8px 36px rgba(0,0,0,0.55), 0 0 0 1px rgba(43,168,200,0.08)",
      overflow: "hidden",
    }}>
      {/* Photo slot — vessel placeholder */}
      <div style={{
        height: 90,
        background: "linear-gradient(180deg, transparent 50%, rgba(4,12,20,0.92) 100%), url(/vessel-placeholder.svg) center/cover no-repeat",
        position: "relative",
      }}>
        {/* Flag / type chip */}
        {data.shipType && (
          <span style={{
            position: "absolute", left: 8, top: 8,
            background: "rgba(4,12,20,0.7)", border: "1px solid rgba(43,168,200,0.2)",
            borderRadius: 5, padding: "3px 7px", fontFamily: "var(--font-jetbrains, monospace)",
            fontSize: 9, letterSpacing: "0.1em", color: "#7a9aaa", textTransform: "uppercase",
          }}>
            {data.shipType}
          </span>
        )}
        {/* Signed badge */}
        {showTrust && sc >= 2 && (
          <span style={{
            position: "absolute", right: 8, top: 8,
            background: "rgba(4,12,20,0.75)", border: `1px solid ${trust.color}55`,
            borderRadius: 5, padding: "3px 7px", fontFamily: "var(--font-jetbrains, monospace)",
            fontSize: 9, letterSpacing: "0.1em", color: trust.color,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: trust.color, boxShadow: `0 0 6px ${trust.color}`,
            }} />
            {sc >= 2 ? "SIGNED" : ""}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "10px 12px 12px" }}>
        {/* Title */}
        {data.title && (
          <div style={{
            fontWeight: 700, fontSize: 13, color: "#ffffff",
            lineHeight: 1.2, marginBottom: 2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {data.title}
          </div>
        )}
        {data.mmsi && (
          <div style={{
            fontFamily: "var(--font-jetbrains, monospace)",
            fontSize: 10, color: "#5a8090", marginBottom: 8,
          }}>
            MMSI {data.mmsi}
          </div>
        )}

        {/* Data grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: "5px 12px",
        }}>
          {data.rows.slice(0, 8).map(({ label, value }) => (
            <div key={label}>
              <div style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 8.5, textTransform: "uppercase",
                letterSpacing: "0.14em", color: "#4a6878", marginBottom: 1,
              }}>
                {label}
              </div>
              <div style={{
                fontFamily: "var(--font-jetbrains, monospace)",
                fontSize: 11, color: "#c0d4dc", whiteSpace: "pre-line",
                lineHeight: 1.3,
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Trust badge */}
        {showTrust && (
          <div style={{
            marginTop: 8, padding: "6px 8px",
            background: `${trust.color}12`,
            border: `1px solid ${trust.color}30`,
            borderRadius: 7,
            display: "flex", alignItems: "center", gap: 7,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: trust.color, boxShadow: `0 0 6px ${trust.color}`,
              flexShrink: 0,
            }} />
            <span style={{
              fontFamily: "var(--font-jetbrains, monospace)",
              fontSize: 10, fontWeight: 600, color: trust.color,
              letterSpacing: "0.06em",
            }}>
              {trust.text}
            </span>
            <span style={{ fontSize: 10, color: "#5a8090", flex: 1 }}>
              {sc >= 2
                ? `${sc} sources agree`
                : sc === 1
                  ? "single source"
                  : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
