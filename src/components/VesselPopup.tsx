"use client";

import { mmsiToFlag, formatSpeed, formatCourse, formatCoord } from "@/lib/utils";
import type { Vessel } from "@/lib/types";

interface Props {
  vessel: Vessel;
  onClose: () => void;
}

export default function VesselPopup({ vessel, onClose }: Props) {
  const isWaveo = vessel.source === "waveo";

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-40 rounded-xl shadow-2xl max-w-md w-[90%]"
      style={{
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(0, 0, 0, 0.1)",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
        style={{ color: "#8899aa" }}
      >
        ✕
      </button>

      <div className="p-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          {vessel.image_url && (
            <img
              src={vessel.image_url}
              alt={vessel.ship_name ?? ""}
              className="w-12 h-12 rounded-lg object-cover"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">{mmsiToFlag(vessel.mmsi)}</span>
              <span className="font-semibold" style={{ color: "#1a2a3a" }}>
                {vessel.ship_name || "Unknown Vessel"}
              </span>
              {isWaveo && (
                <span
                  className="rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wider"
                  style={{ background: "rgba(43, 168, 200, 0.15)", color: "var(--aqua)" }}
                >
                  AISs
                </span>
              )}
            </div>
            <div className="text-xs font-mono" style={{ color: "#8899aa" }}>
              MMSI {vessel.mmsi}
              {vessel.destination && <span> · {vessel.destination}</span>}
            </div>
          </div>
        </div>

        {/* Data grid */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "SOG", value: formatSpeed(vessel.sog) },
            { label: "COG", value: formatCourse(vessel.cog) },
            { label: "LAT", value: formatCoord(vessel.lat, "lat") },
            { label: "LON", value: formatCoord(vessel.lon, "lon") },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-[9px] tracking-wider uppercase" style={{ color: "#8899aa" }}>
                {item.label}
              </div>
              <div className="text-xs font-mono font-medium" style={{ color: "#3a5a6a" }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Waveo link */}
        {isWaveo && vessel.vessel_id && (
          <a
            href={`https://waveo.blue/profile/vessels/${vessel.vessel_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-3 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: "var(--aqua)" }}
          >
            View on WEARE.BLUE →
          </a>
        )}
      </div>
    </div>
  );
}
