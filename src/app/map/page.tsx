"use client";

import { useState, useCallback, useRef } from "react";
import Map from "@/components/map/Map";
import VesselLayer from "@/components/map/VesselLayer";
import HistoricalLayer from "@/components/map/HistoricalLayer";
import TrackLayer from "@/components/map/TrackLayer";
import VesselPanel from "@/components/map/VesselPanel";
import Sidebar from "@/components/map/Sidebar";
import Tooltip, { type TooltipData } from "@/components/map/Tooltip";
import TimeSlider from "@/components/map/TimeSlider";
import TimeMachineControl from "@/components/map/TimeMachineControl";

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

// Format Date → "YYYY-MM-DDTHH:MM" for datetime-local input
function toDatetimeLocal(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MapPage() {
  const [selectedVessel, setSelectedVessel] = useState<SelectedVessel | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  // Time slider
  const [timeBounds, setTimeBounds] = useState<[number, number] | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const focusTimeRef = useRef<number | null>(null); // historical time to auto-center slider on

  // Time machine
  const [histMode, setHistMode] = useState(false);
  const [histTimeStr, setHistTimeStr] = useState(() => toDatetimeLocal(new Date(Date.now() - 3600_000)));
  const histTime = new Date(histTimeStr);

  const handleTimeBounds = useCallback((bounds: [number, number]) => {
    setTimeBounds(bounds);
    // If we came from a historical click, center the slider around that time
    const focus = focusTimeRef.current;
    if (focus != null) {
      const WINDOW = 45 * 60_000; // ±45 min around historical click
      setTimeRange([
        Math.max(bounds[0], focus - WINDOW),
        Math.min(bounds[1], focus + WINDOW),
      ]);
      focusTimeRef.current = null;
    } else {
      setTimeRange(bounds);
    }
  }, []);

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

  const handleClear = useCallback(() => {
    setSelectedVessel(null);
    setTimeBounds(null);
    setTimeRange(null);
    focusTimeRef.current = null;
  }, []);

  const handleHistVesselClick = useCallback((vessel: SelectedVessel) => {
    // Store the historical time so slider auto-centers when track loads
    focusTimeRef.current = histTime.getTime();
    setSelectedVessel(vessel);
  }, [histTime]);

  const handleToggleHistMode = useCallback(() => {
    setHistMode((v) => !v);
    handleClear();
  }, [handleClear]);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      <Sidebar />
      <div style={{ position: "relative", flex: 1 }}>
        <Map>
          {histMode ? (
            <HistoricalLayer
              time={histTime}
              windowMinutes={10}
              onVesselClick={handleHistVesselClick}
              onHover={handleVesselHover}
              hiddenMmsi={selectedVessel?.mmsi ?? null}
            />
          ) : (
            <VesselLayer
              onVesselClick={setSelectedVessel}
              onHover={handleVesselHover}
              hiddenMmsi={selectedVessel?.mmsi ?? null}
            />
          )}
          <TrackLayer
            selectedMmsi={selectedVessel?.mmsi ?? null}
            onClear={handleClear}
            onHover={handleWaypointHover}
            timeRange={timeRange}
            onTimeBounds={handleTimeBounds}
          />
        </Map>

        <TimeMachineControl
          active={histMode}
          time={histTimeStr}
          onToggle={handleToggleHistMode}
          onTimeChange={setHistTimeStr}
        />

        {selectedVessel && (
          <VesselPanel vessel={selectedVessel} onClose={handleClear} />
        )}
        {hover && <Tooltip data={hover.data} x={hover.x} y={hover.y} />}
        {timeBounds && timeRange && (
          <TimeSlider
            minTime={timeBounds[0]}
            maxTime={timeBounds[1]}
            value={timeRange}
            onChange={setTimeRange}
          />
        )}
      </div>
    </div>
  );
}
