"use client";

import { useState, useCallback, useRef } from "react";
import MapView from "@/components/map/Map";
import VesselLayer from "@/components/map/VesselLayer";
import ReplayLayer, { type TrackMap } from "@/components/map/ReplayLayer";
import TrackLayer from "@/components/map/TrackLayer";
import VesselPanel from "@/components/map/VesselPanel";
import Sidebar from "@/components/map/Sidebar";
import Tooltip, { type TooltipData } from "@/components/map/Tooltip";
import TimeSlider from "@/components/map/TimeSlider";
import ReplayControl from "@/components/map/ReplayControl";

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

  // Track time slider
  const [timeBounds, setTimeBounds] = useState<[number, number] | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const focusTimeRef = useRef<number | null>(null);

  // Replay mode
  const [replayMode, setReplayMode] = useState(false);
  const emptyTracks: TrackMap = new Map();
  const [replayTracks, setReplayTracks] = useState<TrackMap>(emptyTracks);
  const [replayStart, setReplayStart] = useState<number | null>(null);
  const [replayEnd, setReplayEnd] = useState<number | null>(null);
  const [replayTime, setReplayTime] = useState<number | null>(null);

  const handleTimeBounds = useCallback((bounds: [number, number]) => {
    setTimeBounds(bounds);
    const focus = focusTimeRef.current;
    if (focus != null) {
      const WINDOW = 45 * 60_000;
      setTimeRange([Math.max(bounds[0], focus - WINDOW), Math.min(bounds[1], focus + WINDOW)]);
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

  const handleReplayVesselClick = useCallback((vessel: SelectedVessel) => {
    if (replayTime != null) focusTimeRef.current = replayTime;
    setSelectedVessel(vessel);
  }, [replayTime]);

  const handleReplayLoad = useCallback((tracks: TrackMap, start: number, end: number) => {
    setReplayTracks(tracks);
    setReplayStart(start);
    setReplayEnd(end);
    handleClear();
  }, [handleClear]);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      <Sidebar />
      <div style={{ position: "relative", flex: 1 }}>
        <MapView>
          {replayMode ? (
            <ReplayLayer
              tracks={replayTracks}
              currentTime={replayTime ?? replayStart ?? Date.now()}
              onVesselClick={handleReplayVesselClick}
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
        </MapView>

        {/* Replay toggle button */}
        {!replayMode && (
          <button
            onClick={() => { setReplayMode(true); handleClear(); }}
            title="Replay — se historisk trafik"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 10,
              background: "rgba(4, 12, 20, 0.88)",
              border: "1px solid rgba(43, 168, 200, 0.2)",
              borderRadius: 6,
              color: "#5a8090",
              fontSize: 11,
              padding: "5px 10px",
              cursor: "pointer",
              fontFamily: "var(--font-mono, monospace)",
              letterSpacing: "0.05em",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span style={{ fontSize: 13 }}>⏱</span> REPLAY
          </button>
        )}

        {replayMode && (
          <ReplayControl
            onLoad={handleReplayLoad}
            onTimeChange={setReplayTime}
            onClose={() => { setReplayMode(false); setReplayTracks(emptyTracks); setReplayTime(null); setReplayStart(null); setReplayEnd(null); handleClear(); }}
            currentTime={replayTime}
            start={replayStart}
            end={replayEnd}
            dimmed={!!(timeBounds && timeRange)}
          />
        )}

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
            onClose={handleClear}
            bottom={replayMode ? 158 : 28}
          />
        )}
      </div>
    </div>
  );
}
