"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import MapView from "@/components/map/Map";
import VesselLayer from "@/components/map/VesselLayer";
import ReplayLayer, { type TrackMap } from "@/components/map/ReplayLayer";
import TrackLayer from "@/components/map/TrackLayer";
import VesselPanel from "@/components/map/VesselPanel";
import Sidebar from "@/components/map/Sidebar";
import Tooltip, { type TooltipData } from "@/components/map/Tooltip";
import TimeSlider from "@/components/map/TimeSlider";
import GlobeMapToggle from "@/components/map/GlobeMapToggle";
import RoutesLayer from "@/components/map/RoutesLayer";
import MaritimeOverlays from "@/components/map/MaritimeOverlays";
import { supabase } from "@/lib/supabase";

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
function fmtTime(iso: string | null, approx = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = approx
    ? { hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const local = d.toLocaleTimeString([], opts);
  const utc   = d.toLocaleTimeString([], { ...opts, timeZone: "UTC", hour12: false });
  const date  = d.toLocaleDateString([], { month: "short", day: "numeric" });

  const offset = -d.getTimezoneOffset();
  const tzSign = offset >= 0 ? "+" : "-";
  const tzHours = Math.floor(Math.abs(offset) / 60);
  const tzMins  = Math.abs(offset) % 60;
  const tzLabel = `UTC${tzSign}${tzHours}${tzMins ? `:${String(tzMins).padStart(2, "0")}` : ""}`;

  const prefix = approx ? "~" : "";
  return `${prefix}${date} ${local} (${tzLabel})\n${prefix}${utc} UTC`;
}

export default function MapPage() {
  const [selectedVessel, setSelectedVessel] = useState<SelectedVessel | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [theme, setTheme] = useState<import("@/components/map/Map").MapTheme>("dark");
  const [showLabels, setShowLabels] = useState(false);
  const [isGlobe, setIsGlobe] = useState(false);
  const [showSeamarks, setShowSeamarks] = useState(false);
  const [showEEZ, setShowEEZ] = useState(false);
  const [showLand, setShowLand] = useState(false);
  const [douglasMode, setDouglasMode] = useState(false);
  const [showLine, setShowLine] = useState(true);
  const [showDots, setShowDots] = useState(false);

  // Voyage view: true = full historical range (multi-day), false = 24h window (default)
  const [voyageMode, setVoyageMode] = useState<boolean>(false);

  // Track time slider
  const [timeBounds, setTimeBounds] = useState<[number, number] | null>(null);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const focusTimeRef = useRef<number | null>(null);
  const [waypointTimes, setWaypointTimes] = useState<number[]>([]);
  const [focusedWpTime, setFocusedWpTime] = useState<number | null>(null);

  // Voyage picker (historical range fetch)
  const [voyagePickerOpen, setVoyagePickerOpen] = useState(false);
  const [voyageRange, setVoyageRange]           = useState<[number, number] | null>(null);
  const [voyageLoading, setVoyageLoading]       = useState(false);
  const [voyagePointCount, setVoyagePointCount] = useState<number | null>(null);
  const [voyageLoadedRange, setVoyageLoadedRange] = useState<[number, number] | null>(null);
  const [pendingHistoricalVessel, setPendingHistoricalVessel] = useState(false);

  // Replay mode
  const [replayMode, setReplayMode] = useState(false);
  const emptyTracks: TrackMap = new Map();
  const [replayTracks, setReplayTracks] = useState<TrackMap>(emptyTracks);
  const [replayStart, setReplayStart] = useState<number | null>(null);  // loaded bounds (fixed)
  const [replayEnd, setReplayEnd] = useState<number | null>(null);        // loaded bounds (fixed)
  const [replayViewRange, setReplayViewRange] = useState<[number, number] | null>(null); // TRACK handle range
  const [replayTime, setReplayTime] = useState<number | null>(null);

  // Panel mode (LIVE vs TIME MACHINE)
  const [panelMode, setPanelMode] = useState<"live" | "timemachine">("live");

  // Replay animation loop state
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedIdx, setReplaySpeedIdx] = useState(2); // default 15×
  const REPLAY_SPEEDS = [1, 5, 15, 60, 300];
  const replayRafRef = useRef<number | undefined>(undefined);
  const replayLastRef = useRef<number | null>(null);

  // Replay date/load state
  const [replayDateStart, setReplayDateStart] = useState(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [replayDateEnd, setReplayDateEnd] = useState(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayVesselCount, setReplayVesselCount] = useState<number | null>(null);
  // Overview slider bounds: DAY mode shows just today (handles fill full width),
  // VOYAGE shows full 7-day timeBounds. Computed here to avoid IIFE in JSX.
  const sliderMinTime = (() => {
    if (!timeBounds || !timeRange) return 0;
    if (voyageMode) return timeBounds[0];
    const d = new Date(timeRange[0]); d.setUTCHours(0, 0, 0, 0);
    return Math.max(timeBounds[0], d.getTime());
  })();
  const sliderMaxTime = (() => {
    if (!timeBounds) return 0;
    if (voyageMode) return timeBounds[1];
    return Math.min(timeBounds[1], sliderMinTime + 24 * 60 * 60_000);
  })();

  const replayModeRef2  = useRef(false);
  const replayStartRef  = useRef<number | null>(null);
  const replayEndRef    = useRef<number | null>(null);
  const replayTimeRef2  = useRef<number | null>(null);
  useEffect(() => { replayModeRef2.current  = replayMode;  }, [replayMode]);
  useEffect(() => { replayStartRef.current  = replayStart; }, [replayStart]);
  useEffect(() => { replayEndRef.current    = replayEnd;   }, [replayEnd]);
  useEffect(() => { replayTimeRef2.current  = replayTime;  }, [replayTime]);
  const [followedMmsi, setFollowedMmsi] = useState<number | null>(null); // Tilstand A
  const followedMmsiRef = useRef<number | null>(null);
  useEffect(() => { followedMmsiRef.current = followedMmsi; }, [followedMmsi]);

  // Replay animation loop
  useEffect(() => {
    if (!replayPlaying || replayTime == null || replayStart == null || replayEnd == null) return;
    const speed = REPLAY_SPEEDS[replaySpeedIdx];
    const tick = (now: number) => {
      if (replayLastRef.current != null) {
        const wall = now - replayLastRef.current;
        const sim = wall * speed;
        const next = Math.min(replayTime + sim, replayEnd);
        setReplayTime(next);
        if (next >= replayEnd) { setReplayPlaying(false); return; }
      }
      replayLastRef.current = now;
      replayRafRef.current = requestAnimationFrame(tick);
    };
    replayRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (replayRafRef.current) cancelAnimationFrame(replayRafRef.current);
      replayLastRef.current = null;
    };
  }, [replayPlaying, replaySpeedIdx, replayTime, replayStart, replayEnd]);

  // Async load function for replay (will be defined after handleClear, but we'll move the logic here as a placeholder)
  // This will be properly initialized in the render section

  const handleTimeBounds = useCallback((bounds: [number, number]) => {
    const rs = replayStartRef.current;
    const re = replayEndRef.current;
    const inReplay = replayModeRef2.current;

    // In replay mode, cap overview to the replay window so the slider is usable
    const effectiveBounds: [number, number] = (inReplay && rs != null && re != null)
      ? [Math.max(bounds[0], rs), Math.min(bounds[1], re)]
      : bounds;

    setTimeBounds(effectiveBounds);

    // If waiting for historical vessel timeBounds, open VoyagePicker now
    if (pendingHistoricalVessel) {
      setVoyagePickerOpen(true);
      setPendingHistoricalVessel(false);
    }

    focusTimeRef.current = null;

    // In voyage mode (historical vessels), show the full range — don't clamp to a day
    if (voyageMode) {
      setTimeRange(effectiveBounds);
      return;
    }

    const MAX_MS = 24 * 60 * 60_000; // Track Inspector default = 24 hours
    const span   = effectiveBounds[1] - effectiveBounds[0];

    if (!inReplay) {
      // Live: show from UTC midnight today → now (max 24h)
      const midnight = new Date(effectiveBounds[1]);
      midnight.setUTCHours(0, 0, 0, 0);
      const dayStart = Math.max(effectiveBounds[0], midnight.getTime());
      setTimeRange([dayStart, effectiveBounds[1]]);
    } else {
      // Replay: show the vessel's full available track — MOMENT handle shows current replay time
      setTimeRange([effectiveBounds[0], effectiveBounds[1]]);
    }
  }, [pendingHistoricalVessel, voyageMode]);

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
    const isApprox = !!d.interpolated;
    setHover({
      x: d.x, y: d.y,
      data: {
        title: selectedVessel?.name || `MMSI ${d.mmsi ?? selectedVessel?.mmsi}`,
        rows: [
          { label: "MMSI", value: String(d.mmsi ?? selectedVessel?.mmsi ?? "—") },
          // Skip SOG/COG/HDG for interpolated positions — we don't have that data
          ...(!isApprox ? [
            { label: "SOG", value: fmt(d.speed, "kn") },
            { label: "COG", value: fmt(d.course, "°") },
            { label: "HDG", value: fmt(d.heading, "°", 0) },
          ] : []),
          { label: "LAT", value: fmtCoord(d.lat, "lat") },
          { label: "LON", value: fmtCoord(d.lon, "lon") },
          { label: isApprox ? "ca. Tid" : "Tid", value: fmtTime(d.recorded_at, isApprox) },
          ...(d.sources != null && d.sources > 1 && !isApprox ? [{ label: "Sources", value: `${d.sources} stations` }] : []),
        ],
      },
    });
  }, [selectedVessel]);

  const handleClear = useCallback(() => {
    setSelectedVessel(null);
    setFollowedMmsi(null);
    setTimeBounds(null);
    setTimeRange(null);
    setWaypointTimes([]);
    setFocusedWpTime(null);
    setVoyageMode(false);
    setVoyagePickerOpen(false);
    setVoyageRange(null);
    setVoyagePointCount(null);
    setVoyageLoadedRange(null);
    focusTimeRef.current = null;
    // Reset view toggles to defaults
    setShowLine(true);
    setShowDots(false);
    setDouglasMode(false);
  }, []);

  // Tilstand A — single click: follow vessel, or open inspector if already followed.
  // NOTE: we read followedMmsiRef (not state) to avoid calling setSelectedVessel
  // inside a state-updater function — that React anti-pattern caused the track
  // to flicker on/off due to unpredictable render ordering in React 18.
  const handleReplayVesselSingleClick = useCallback((vessel: SelectedVessel) => {
    if (followedMmsiRef.current === vessel.mmsi) {
      // Already followed → open track inspector
      if (replayTime != null) focusTimeRef.current = replayTime;
      setFollowedMmsi(null);
      setSelectedVessel(vessel);
      setVoyageMode(false);
    } else {
      setFollowedMmsi(vessel.mmsi);
    }
  }, [replayTime]);

  // Tilstand B — double click: open track inspector (existing behaviour)
  const handleReplayVesselDoubleClick = useCallback((vessel: SelectedVessel) => {
    setFollowedMmsi(null);
    if (replayTime != null) focusTimeRef.current = replayTime;
    setSelectedVessel(vessel);
    setVoyageMode(false);
  }, [replayTime]);

  const handleReplayClickEmpty = useCallback(() => {
    setFollowedMmsi(null);
  }, []);

  const handleReplayDataLoaded = useCallback((tracks: TrackMap, start: number, end: number) => {
    setReplayTracks(tracks);
    setReplayStart(start);
    setReplayEnd(end);
    setReplayViewRange([start, end]);  // initialize view range to full loaded bounds
    handleClear();
  }, [handleClear]);

  // Async load function for replay (fetches data from Supabase)
  const handleReplayLoad = useCallback(async () => {
    setReplayLoading(true);
    setReplayPlaying(false);
    const dayStart = new Date(replayDateStart + "T00:00:00");
    const dayEnd = new Date(replayDateEnd + "T23:59:59");
    const now = new Date();
    const { data, error } = await supabase.rpc("get_tracks_in_range", {
      p_start: dayStart.toISOString(),
      p_end: (dayEnd > now ? now : dayEnd).toISOString(),
    });
    setReplayLoading(false);
    if (error) {
      console.error("[replay] rpc error:", error);
      return;
    }
    if (!data) {
      console.warn("[replay] no data returned");
      return;
    }

    // Supabase JS may wrap scalar JSON in various formats — unwrap defensively
    let raw: any = data;
    if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { /* keep as-is */ }
    if (Array.isArray(raw)) raw = raw[0];
    if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { /* keep as-is */ }
    if (raw?.get_tracks_in_range != null) raw = raw.get_tracks_in_range;
    if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { /* keep as-is */ }
    raw = raw ?? {};

    console.log("[replay] loaded:", raw.points?.length ?? 0, "points");
    const pts: { mmsi: number; name: string | null; lon: number; lat: number; sog: number | null; cog: number | null; t: number }[] = raw.points ?? [];

    const map: TrackMap = new Map();
    for (const p of pts) {
      if (!map.has(p.mmsi)) map.set(p.mmsi, { name: p.name, points: [] });
      map.get(p.mmsi)!.points.push({ t: p.t, lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog });
    }
    map.forEach((v) => v.points.sort((a, b) => a.t - b.t));
    setReplayVesselCount(map.size);
    const s = dayStart.getTime();
    const e = Math.min(dayEnd.getTime(), now.getTime());
    handleReplayDataLoaded(map, s, e);
    let firstPointMs = s;
    map.forEach((v) => {
      if (v.points.length > 0) {
        const pt = v.points[0].t * 1000;
        if (firstPointMs === s || pt < firstPointMs) firstPointMs = pt;
      }
    });
    setReplayTime(Math.max(s, firstPointMs));
  }, [replayDateStart, replayDateEnd, handleReplayDataLoaded]);

  // Handler: søgefelt vælger et skib
  const handleSearchSelect = useCallback((r: {
    mmsi: number; name: string | null;
    lat: number | null; lon: number | null;
    last_t: number | null; first_t: number | null;
    is_historical: boolean;
  }) => {
    const vessel = {
      mmsi: r.mmsi,
      name: r.name,
      lat:  r.lat  ?? 0,
      lon:  r.lon  ?? 0,
      sog:  null, cog: null, heading: null, updated_at: null,
    };
    setSelectedVessel(vessel);

    if (r.is_historical && r.first_t != null && r.last_t != null) {
      // Pre-set timeBounds from RPC data (unix seconds → ms)
      const firstMs = r.first_t * 1000;
      const lastMs  = r.last_t  * 1000;
      setTimeBounds([firstMs, lastMs]);
      setTimeRange([firstMs, lastMs]);
      setVoyageRange([firstMs, lastMs]);
      setVoyageMode(true); // Show full voyage, not day-clamped
      setVoyagePickerOpen(true);
    } else {
      setVoyageMode(false);
    }

    // Centrer kortet på skibet
    if (r.lat != null && r.lon != null) {
      (window as any).__map?.flyTo({ center: [r.lon, r.lat], zoom: r.is_historical ? 3 : 9, duration: 800 });
    }
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden" }}>
      <Sidebar
        onSearchSelect={handleSearchSelect}
        theme={theme} onThemeChange={setTheme}
        showSeamarks={showSeamarks} onSeamarksChange={setShowSeamarks}
        showEEZ={showEEZ} onEEZChange={setShowEEZ}
        showLand={showLand} onLandChange={setShowLand}
        showLabels={showLabels} onLabelsChange={setShowLabels}
        isGlobe={isGlobe} onGlobeChange={(v) => {
          setIsGlobe(v);
          const m = (window as any).__map;
          if (!m) return;
          (m as any).setProjection(v ? { type: "globe" } : { type: "mercator" });
          if (v && m.getZoom() > 5) m.easeTo({ zoom: 2.5, duration: 600 });
        }}
      />
      <div style={{ position: "relative", flex: 1 }}>
        <MapView theme={theme} showLabels={showLabels}>
          {replayMode ? (
            <ReplayLayer
              tracks={replayTracks}
              currentTime={replayTime ?? replayStart ?? Date.now()}
              onVesselSingleClick={handleReplayVesselSingleClick}
              onVesselDoubleClick={handleReplayVesselDoubleClick}
              onClickEmpty={handleReplayClickEmpty}
              onHover={handleVesselHover}
              hiddenMmsi={null}
              dimOthers={!!selectedVessel}
              followedMmsi={followedMmsi}
            />
          ) : (
            <VesselLayer
              onVesselClick={(v) => { setSelectedVessel(v); setVoyageMode(false); }}
              onVesselUpdate={setSelectedVessel}
              selectedMmsi={selectedVessel?.mmsi ?? null}
              onHover={handleVesselHover}
              hiddenMmsi={selectedVessel?.mmsi ?? null}
            />
          )}
          <TrackLayer
            selectedMmsi={selectedVessel?.mmsi ?? null}
            onClear={handleClear}
            onHover={handleWaypointHover}
            onWaypointClick={setFocusedWpTime}

            timeRange={timeRange}
            onTimeBounds={handleTimeBounds}
            onWaypointTimes={setWaypointTimes}
            focusedTime={focusedWpTime}
            replayMode={replayMode}
            livePosition={!replayMode ? selectedVessel : null}
            voyageMode={voyageMode}
            windowStartMs={replayMode && replayStart ? replayStart : undefined}
            douglasMode={douglasMode}
            showLine={showLine}
            showDots={showDots}
            voyageRange={voyageRange}
            onVoyageLoaded={(count) => {
              setVoyagePointCount(count);
              setVoyageLoading(false);
              if (voyageRange) setVoyageLoadedRange(voyageRange);
            }}
          />
          {/* D·P routes for all vessels in viewport */}
          <RoutesLayer visible={!replayMode} />
          {/* Maritime overlays */}
          <MaritimeOverlays showSeamarks={showSeamarks} showEEZ={showEEZ} showLand={showLand} />
        </MapView>

        {selectedVessel && (
          <VesselPanel vessel={selectedVessel} onClose={handleClear} />
        )}
        {hover && <Tooltip data={hover.data} x={hover.x} y={hover.y} />}
        {((timeBounds && timeRange) || panelMode === "timemachine") && (
          <TimeSlider
            minTime={panelMode === "timemachine" && replayStart != null ? replayStart : (sliderMinTime || 0)}
            maxTime={panelMode === "timemachine" && replayEnd != null ? replayEnd : (sliderMaxTime || Date.now())}
            value={panelMode === "timemachine" && replayViewRange != null ? replayViewRange : (timeRange || [0, Date.now()])}
            onChange={panelMode === "timemachine" ? setReplayViewRange : setTimeRange}
            onClose={() => {
              handleClear();
              if (panelMode === "timemachine") {
                setPanelMode("live");
                setReplayMode(false);
                setReplayTracks(emptyTracks);
                setReplayTime(null);
                setReplayStart(null);
                setReplayEnd(null);
                setReplayViewRange(null);
                setReplayPlaying(false);
                setReplayVesselCount(null);
              }
            }}
            bottom={28}
            waypoints={panelMode === "live" ? waypointTimes : undefined}
            focusTime={panelMode === "live" ? focusedWpTime : (panelMode === "timemachine" ? replayTime : null)}
            onFocusTimeChange={panelMode === "live" ? setFocusedWpTime : (panelMode === "timemachine" ? setReplayTime : undefined)}
            onExpandToVoyage={panelMode === "live" ? () => {
              setVoyageMode(true);
              setTimeRange(timeBounds);
              setVoyagePickerOpen(true);
            } : undefined}
            isVoyageView={voyageMode}
            maxSpanMs={panelMode === "timemachine" ? undefined : !voyageMode ? 24 * 60 * 60_000 : undefined}
            showLine={showLine}
            onShowLineChange={(v) => { setShowLine(v); if (v) setShowDots(false); }}
            showDots={showDots}
            onShowDotsChange={(v) => { setShowDots(v); if (v) setShowLine(false); }}
            douglasMode={douglasMode}
            onDouglasModeChange={setDouglasMode}
            showDatePicker={panelMode === "live" ? voyagePickerOpen : false}
            loading={voyageLoading}
            pointCount={voyagePointCount}
            loadedRange={voyageLoadedRange}
            onDateRangeLoad={panelMode === "live" ? (startMs, endMs) => {
              setVoyageLoading(true);
              setVoyagePointCount(null);
              setVoyageRange([startMs, endMs]);
              setTimeBounds([startMs, endMs]);
              setTimeRange([startMs, endMs]);
              setVoyageMode(true);
            } : undefined}
            panelMode={panelMode}
            onPanelModeChange={(mode) => {
              setPanelMode(mode);
              if (mode === "timemachine") {
                setReplayMode(true);
              } else {
                setReplayMode(false);
                setReplayTracks(emptyTracks);
                setReplayTime(null);
                setReplayStart(null);
                setReplayEnd(null);
                setReplayPlaying(false);
              }
            }}
            replay={panelMode === "timemachine" ? {
              dateStart: replayDateStart,
              dateEnd: replayDateEnd,
              onDateStartChange: setReplayDateStart,
              onDateEndChange: setReplayDateEnd,
              loading: replayLoading,
              onLoad: handleReplayLoad,
              vesselCount: replayVesselCount,
              playing: replayPlaying,
              onPlayToggle: () => {
                if (replayPlaying) { setReplayPlaying(false); return; }
                if (replayTime != null && replayEnd != null && replayTime >= replayEnd) setReplayTime(replayStart ?? replayTime);
                setReplayPlaying(true);
              },
              speedIdx: replaySpeedIdx,
              speeds: REPLAY_SPEEDS,
              onSpeedChange: setReplaySpeedIdx,
            } : undefined}
          />
        )}
      </div>
    </div>
  );
}
