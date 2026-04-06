"use client";

import { mmsiToFlag, formatSpeed, formatCourse } from "@/lib/utils";
import type { Vessel } from "@/lib/types";

interface Props {
  vessels: Vessel[];
  onSelect: (vessel: Vessel) => void;
}

export default function VesselList({ vessels, onSelect }: Props) {
  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="text-[10px] tracking-wider uppercase px-2 pb-2" style={{ color: "var(--text-muted)" }}>
        {vessels.length.toLocaleString()} vessels
      </div>
      <div className="space-y-1">
        {vessels.slice(0, 200).map((v) => {
          const isWaveo = v.source === "waveo";
          return (
            <button
              key={v.mmsi}
              onClick={() => onSelect(v)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/5"
              style={{ borderLeft: `2px solid ${isWaveo ? "var(--aqua)" : "transparent"}` }}
            >
              <span className="text-sm mt-0.5 shrink-0">{mmsiToFlag(v.mmsi)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                    {v.ship_name || "Unknown"}
                  </span>
                  {isWaveo && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold tracking-wider"
                      style={{ background: "rgba(43, 168, 200, 0.15)", color: "var(--aqua)" }}
                    >
                      AISs
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-0.5 text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                  <span>{formatSpeed(v.sog)}</span>
                  <span>{formatCourse(v.cog)}</span>
                  <span>{v.mmsi}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
