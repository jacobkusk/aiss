"use client";

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
  const date = d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
  const local = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const utc = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC", hour12: false });
  return `${date} ${local}\n${utc} UTC`;
}

export default function VesselPanel({ vessel, onClose }: Props) {
  const rows = [
    { label: "SOG", value: fmt(vessel.sog, "kn") },
    { label: "COG", value: fmt(vessel.cog, "°", 1) },
    { label: "LAT", value: fmtCoord(vessel.lat, "lat") },
    { label: "LON", value: fmtCoord(vessel.lon, "lon") },
    { label: "Updated", value: fmtTime(vessel.updated_at) },
  ];

  return (
    <div style={{
      position: "absolute",
      top: 16,
      right: 16,
      zIndex: 40,
      width: 240,
      background: "rgba(4, 12, 20, 0.92)",
      border: "1px solid rgba(43, 168, 200, 0.2)",
      borderRadius: 12,
      backdropFilter: "blur(16px)",
      padding: "14px 16px",
      color: "#c8dce8",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#ffffff", lineHeight: 1.2 }}>
            {vessel.name || "Unknown"}
          </div>
          <div style={{ fontSize: 11, fontFamily: "monospace", color: "#5a8090", marginTop: 2 }}>
            MMSI {vessel.mmsi}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#5a8090", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2 }}
        >
          ✕
        </button>
      </div>

      {/* Data rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map(({ label, value }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.8px", color: "#5a8090" }}>
              {label}
            </span>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "#c8dce8", whiteSpace: "pre-line", textAlign: "right" }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
