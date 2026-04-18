"use client";

import Link from "next/link";

interface Vessel {
  mmsi: number;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updated_at: string | null;
}

interface Props {
  vessel: Vessel;
  onClose: () => void;
}

function fmt(v: number | null, unit: string, decimals = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(decimals)} ${unit}`;
}

function fmtCoord(v: number, dir: "lat" | "lon"): string {
  const abs = Math.abs(v).toFixed(5);
  const suffix = dir === "lat" ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W");
  return `${abs}° ${suffix}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const local = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const utc = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false });
  return `${local}\n${utc} UTC`;
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.round(sec)}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export default function VesselPanel({ vessel, onClose }: Props) {
  const rows = [
    { label: "SOG", value: fmt(vessel.sog, "kn"), color: "#2BA8C8" },
    { label: "COG", value: fmt(vessel.cog, "°", 1), color: undefined },
    { label: "LAT", value: fmtCoord(vessel.lat, "lat"), color: undefined },
    { label: "LON", value: fmtCoord(vessel.lon, "lon"), color: undefined },
    { label: "Updated", value: fmtTime(vessel.updated_at), color: undefined },
  ];

  const freshness = vessel.updated_at ? ago(vessel.updated_at) : "";

  return (
    <div style={{
      position: "absolute",
      top: 16,
      right: 16,
      zIndex: 40,
      width: 260,
      background: "rgba(4, 12, 20, 0.92)",
      border: "1px solid rgba(43, 168, 200, 0.2)",
      borderRadius: 12,
      backdropFilter: "blur(16px)",
      padding: 0,
      color: "#c8dce8",
      overflow: "hidden",
    }}>
      {/* Photo header */}
      <div style={{
        height: 80,
        background: "linear-gradient(180deg, transparent 40%, rgba(4,12,20,0.92) 100%), url(/vessel-placeholder.svg) center/cover no-repeat",
        position: "relative",
      }}>
        {freshness && (
          <span style={{
            position: "absolute", left: 10, top: 10,
            background: "rgba(4,12,20,0.75)", border: "1px solid rgba(0,230,118,0.35)",
            borderRadius: 5, padding: "3px 7px",
            fontFamily: "var(--font-jetbrains, monospace)",
            fontSize: 9, color: "#00e676", letterSpacing: "0.08em",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#00e676", boxShadow: "0 0 6px #00e676" }} />
            {freshness}
          </span>
        )}
        <button
          onClick={onClose}
          style={{
            position: "absolute", right: 8, top: 8,
            background: "rgba(4,12,20,0.7)", border: "1px solid rgba(43,168,200,0.2)",
            borderRadius: 6, color: "#5a8090", cursor: "pointer",
            fontSize: 12, lineHeight: 1, padding: "4px 6px",
            fontFamily: "var(--font-jetbrains, monospace)",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: "10px 14px 14px" }}>
        {/* Header */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontWeight: 700, fontSize: 14, color: "#ffffff", lineHeight: 1.2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {vessel.name || "Unknown"}
          </div>
          <div style={{
            fontSize: 10, fontFamily: "var(--font-jetbrains, monospace)",
            color: "#5a8090", marginTop: 2,
          }}>
            MMSI {vessel.mmsi}
          </div>
        </div>

        {/* Data rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {rows.map(({ label, value, color }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{
                fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em",
                color: "#4a6878", fontFamily: "var(--font-jetbrains, monospace)",
              }}>
                {label}
              </span>
              <span style={{
                fontSize: 12, fontFamily: "var(--font-jetbrains, monospace)",
                color: color ?? "#c8dce8", whiteSpace: "pre-line", textAlign: "right",
              }}>
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* CTA → detail page */}
        <Link
          href={`/vessel/${vessel.mmsi}`}
          style={{
            display: "block",
            marginTop: 12,
            padding: "8px 12px",
            background: "#2BA8C8",
            color: "#041018",
            borderRadius: 7,
            textAlign: "center",
            textDecoration: "none",
            fontFamily: "var(--font-jetbrains, monospace)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          Open details →
        </Link>
      </div>
    </div>
  );
}
