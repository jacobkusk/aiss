"use client";

import { useState, useCallback } from "react";
import Map from "@/components/map/Map";
import VesselLayer from "@/components/map/VesselLayer";
import TrackLayer from "@/components/map/TrackLayer";
import VesselPanel from "@/components/map/VesselPanel";
import Sidebar from "@/components/map/Sidebar";
import Tooltip, { type TooltipData } from "@/components/map/Tooltip";

interface SelectedVessel {
  mmsi: number;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updated_at: string | null;
}

interface HoverState {
  x: number;
  y: number;
  data: TooltipData;
}

function fmt(v: number | null, unit: string, dec = 1) {
  return v != null ? `${v.toFixed(dec)} ${unit}` : "—";
}
function fmtCoord(v: number, dir: "lat" | "lon") {
  return `${Math.abs(v).toFixed(5)}° ${dir === "lat" ? (v >= 0 ? "N" : "S") : (v >= 0 ? "E" : "W")}`;
}
function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function MapPage() {
  const [selectedVessel, setSelectedVessel] = useState<SelectedVessel | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const handleVesselHover = useCallback((d: Parameters<React.ComponentProps<typeof VesselLayer>["onHover"]>[0]) => {
    if (!d) { setHover(null); return; }
    setHover({
      x: d.x, y: d.y,
      data: {
        title: d.name || `MMSI ${d.mmsi}`,
        rows: [
          { label: "MMSI", value: String(d.mmsi) },
          { label: "SOG", value: fmt(d.sog, "kn") },
          { label: "COG", value: fmt(d.cog, "°") },
          { label: "HDG", value: fmt(d.heading, "°", 0) },
          { label: "LAT", value: fmtCoord(d.lat, "lat") },
          { label: "LON", value: fmtCoord(d.lon, "lon") },
          { label: "Updated", value: fmtTime(d.updated_at) },
        ],
      },
    });
  }, []);

  const handleWaypointHover = useCallback((d: Parameters<React.ComponentProps<typeof TrackLayer>["onHover"]>[0]) => {
    if (!d) { setHover(null); return; }
    setHover({
      x: d.x, y: d.y,
      data: {
        title: selectedVessel?.name || `MMSI ${d.mmsi ?? selectedVessel?.mmsi}`,
        rows: [
          { label: "MMSI", value: String(d.mmsi ?? selectedVessel?.mmsi ?? "—") },
          { label: "SOG", value: fmt(d.speed, "kn") },
          { label: "COG", value: fmt(d.course, "°") },
          { label: "HDG", value: fmt(d.heading, "°", 0) },
          { label: "LAT", value: fmtCoord(d.lat, "lat") },
          { label: "LON", value: fmtCoord(d.lon, "lon") },
          { label: "Time", value: fmtTime(d.recorded_at) },
        ],
      },
    });
  }, [selectedVessel]);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      <Sidebar />
      <div style={{ position: "relative", flex: 1 }}>
        <Map>
          <VesselLayer onVesselClick={setSelectedVessel} onHover={handleVesselHover} />
          <TrackLayer
            selectedMmsi={selectedVessel?.mmsi ?? null}
            onClear={() => setSelectedVessel(null)}
            onHover={handleWaypointHover}
          />
        </Map>
        {selectedVessel && (
          <VesselPanel vessel={selectedVessel} onClose={() => setSelectedVessel(null)} />
        )}
        {hover && <Tooltip data={hover.data} x={hover.x} y={hover.y} />}
      </div>
    </div>
  );
}
