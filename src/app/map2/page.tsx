"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import MapView from "@/components/map/Map";
import VesselLayer from "@/components/map/VesselLayer";
import ReplayLayer, { type TrackMap } from "@/components/map/ReplayLayer";
import TrackLayer from "@/components/map/TrackLayer";
import VesselPanel from "@/components/map/VesselPanel";
import Sidebar from "@/components/map/Sidebar";
import Tooltip, { type TooltipData } from "@/components/map/Tooltip";
import TimeSlider from "@/components/map/TimeSlider2";
import GlobeMapToggle from "@/components/map/GlobeMapToggle";
import MaritimeOverlays from "@/components/map/MaritimeOverlays";
import MomentVesselLayer2 from "@/components/map/MomentVesselLayer2";
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

const REPLAY_SPEEDS: number[] = [1, 5, 15, 60, 300];
const EMPTY_TRACKS: TrackMap = new Map();

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
  const [waypointSpeeds, setWaypointSpeeds] = useState<(number | null)[]>([]);
  const [waypointColors, setWaypointColors] = useState<(string | null)[]>([]);
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
  const [replayTracks, setReplayTracks] = useState<TrackMap>(EMPTY_TRACKS);
  const [replayStart, setReplayStart] = useState<number | null>(null);  // loaded bounds (fixed)
  const [replayEnd, setReplayEnd] = useState<number | null>(null);        // loaded bounds (fixed)
  const [replayViewRange, setReplayViewRange] = useState<[number, number] | null>(null); // TRACK handle range
  const [replayTime, setReplayTime] = useState<number | null>(null);

  // Aggregeret flåde-timeline for TIMESTRIP i TIME MACHINE-mode.
  // Uden dette er timestrip'en tom når man har loadet 2 dages replay-data men
  // endnu ikke har valgt en specifik båd. Parres som {t, sog} for at holde
  // speeds justeret efter sortering.
  const replayAggregate = useMemo<{ times: number[]; speeds: (number | null)[] }>(() => {
    if (replayTracks.size === 0) return { times: [], speeds: [] };
    const pairs: { t: number; sog: number | null }[] = [];
    replayTracks.forEach((v) => {
      for (const p of v.points) pairs.push({ t: p.t * 1000, sog: p.sog });
    });
    pairs.sort((a, b) => a.t - b.t);
    return {
      times:  pairs.map((p) => p.t),
      speeds: pairs.map((p) => p.sog),
    };
  }, [replayTracks]);

  // Panel mode (LIVE vs TIME MACHINE)
  const [panelMode, setPanelMode] = useState<"live" | "timemachine">("live");

  // Timeline panel visibility — user-controlled toggle (floating button on map)
  const [timePanelOpen, setTimePanelOpen] = useState(true);

  // Auto-open Timeline when a vessel gets selected or Time Machine is engaged
  useEffect(() => {
    if (selectedVessel) setTimePanelOpen(true);
  }, [selectedVessel]);
  useEffect(() => {
    if (panelMode === "timemachine") setTimePanelOpen(true);
  }, [panelMode]);

  // Replay animation loop state
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedIdx, setReplaySpeedIdx] = useState(2); // default 15×
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

  // Replay animation loop — reads replayTime via ref so setReplayTime doesn't
  // tear down the rAF cycle on every frame (previously wasted ~50% of frames).
  useEffect(() => {
    if (!replayPlaying || replayStart == null || replayEnd == null) return;
    const speed = REPLAY_SPEEDS[replaySpeedIdx];
    const tick = (now: number) => {
      const current = replayTimeRef2.current;
      if (current == null) return;
      if (replayLastRef.current != null) {
        const wall = now - replayLastRef.current;
        const sim = wall * speed;
        const next = Math.min(current + sim, replayEnd);
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
  }, [replayPlaying, replaySpeedIdx, replayStart, replayEnd]);

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

    // Only auto-default timeRange when we don't already have one
    // (i.e. first fetch for this vessel). TrackLayer polls every 30s and
    // re-emits bounds — we must NOT reset the user's chosen viewport on each poll,
    // otherwise the handles "jump out to the side" a few seconds after the user
    // drags them in. handleClear() sets timeRange to null on vessel switch,
    // which is the correct moment to re-initialize here.
    setTimeRange((prev) => {
      if (prev != null) return prev;
      if (voyageMode) return effectiveBounds;
      if (!inReplay) {
        // Live: show from UTC midnight today → now (max 24h)
        const midnight = new Date(effectiveBounds[1]);
        midnight.setUTCHours(0, 0, 0, 0);
        const dayStart = Math.max(effectiveBounds[0], midnight.getTime());
        return [dayStart, effectiveBounds[1]];
      }
      // Replay: show the vessel's full available track
      return [effectiveBounds[0], effectiveBounds[1]];
    });
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
    setWaypointSpeeds([]);
    setWaypointColors([]);
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
        timelineOpen={timePanelOpen}
        onTimelineToggle={() => setTimePanelOpen((v) => !v)}
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
              hiddenMmsi={selectedVessel?.mmsi ?? null}
              dimOthers={!!selectedVessel}
              followedMmsi={followedMmsi}
            />
          ) : (
            <>
              {/* Live-lag skjules når brugeren har rullet tilbage i tid.
                  Vi tjekker BÅDE øvre håndtag OG MOMENT-playhead — ellers
                  ville VesselLayer og MomentVesselLayer2 male ovenpå hinanden
                  hvis brugeren har åbnet MOMENT og scrubbet tilbage mens
                  øvre handle stadig sidder ved NU. */}
              {(() => {
                const target = focusedWpTime ?? (timeRange ? timeRange[1] : null);
                const isSliderLive = target == null || (Date.now() - target) < 60_000;
                return isSliderLive ? (
                  <VesselLayer
                    onVesselClick={(v) => { setSelectedVessel(v); setVoyageMode(false); }}
                    onVesselUpdate={setSelectedVessel}
                    selectedMmsi={selectedVessel?.mmsi ?? null}
                    onHover={handleVesselHover}
                    hiddenMmsi={selectedVessel?.mmsi ?? null}
                  />
                ) : null;
              })()}
              {/* atTime = hvad MomentVesselLayer2 skal rendere.
                  Rangorden:
                  1. Hvis MOMENT-slideren er i brug (focusedWpTime != null),
                     vælg den — brugeren scrubber aktivt det præcise tidspunkt.
                  2. Ellers brug øvre handle (timeRange[1]) som grov sortering.
                  Vi viser kun historiske prikker når target er ≥ 60 s tilbage;
                  i LIVE-vinduet ejer VesselLayer visningen. */}
              <MomentVesselLayer2
                windowHours={12}
                atTime={(() => {
                  if (selectedVessel || !timeRange) return null;
                  const target = focusedWpTime ?? timeRange[1];
                  return (Date.now() - target) >= 60_000 ? target : null;
                })()}
              />
            </>
          )}
          <TrackLayer
            selectedMmsi={selectedVessel?.mmsi ?? null}
            onClear={handleClear}
            onHover={handleWaypointHover}
            onWaypointClick={setFocusedWpTime}

            // I TIME MACHINE-mode følger track-filteret TIMESTRIP'en (replayViewRange)
            // så kortet beskæres til den smalle valgte tidsperiode. I LIVE-mode bruger
            // vi timeRange direkte. Uden dette var TrackLayer hængt på timeRange mens
            // TIMESTRIP-dragget kun skrev til replayViewRange → kortet klippede ikke.
            timeRange={panelMode === "timemachine" ? (replayViewRange ?? timeRange) : timeRange}
            onTimeBounds={handleTimeBounds}
            onWaypointTimes={(times) => {
              setWaypointTimes(times);
              // Auto-place the MOMENT marker on the LATEST waypoint so the orange
              // dot appears immediately when a vessel is selected — scrub the FRAME
              // to move it along the line.
              if (times.length) {
                setFocusedWpTime((prev) => prev == null ? times[times.length - 1] : prev);
              }
            }}
            onWaypointSpeeds={setWaypointSpeeds}
            onWaypointColors={setWaypointColors}
            focusedTime={replayMode ? (replayTime ?? focusedWpTime) : focusedWpTime}
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
          {/* Maritime overlays */}
          <MaritimeOverlays showSeamarks={showSeamarks} showEEZ={showEEZ} showLand={showLand} />
        </MapView>

        {selectedVessel && (
          <VesselPanel vessel={selectedVessel} onClose={handleClear} />
        )}
        {hover && <Tooltip data={hover.data} x={hover.x} y={hover.y} />}

        {timePanelOpen && (
          <TimeSlider
            minTime={
              panelMode === "timemachine" && replayStart != null
                ? replayStart
                // Ingen båd åben: giv øvre slider 72t spillerum — brugeren skal
                // kunne gå langt tilbage i tid uden at ramme væggen. Matcher
                // MomentVesselLayer2.windowHours som pre-loader samme periode.
                : (sliderMinTime || (Date.now() - 72 * 60 * 60_000))
            }
            maxTime={
              panelMode === "timemachine" && replayEnd != null
                ? replayEnd
                : (sliderMaxTime || Date.now())
            }
            value={
              panelMode === "timemachine" && replayViewRange != null
                ? replayViewRange
                : (timeRange || [Date.now() - 6 * 60 * 60_000, Date.now()])
            }
            onChange={panelMode === "timemachine" ? setReplayViewRange : setTimeRange}
            onClose={() => {
              // X just hides the Timeline panel — vessel selection + replay state are preserved.
              // Clicking the floating Timeline button re-opens it with the same state.
              setTimePanelOpen(false);
            }}
            bottom={28}
            waypoints={
              waypointTimes.length
                ? waypointTimes
                : (panelMode === "timemachine" && replayAggregate.times.length
                    ? replayAggregate.times
                    : undefined)
            }
            waypointSpeeds={
              waypointTimes.length
                ? waypointSpeeds
                : (panelMode === "timemachine" && replayAggregate.speeds.length
                    ? replayAggregate.speeds
                    : undefined)
            }
            waypointColors={waypointTimes.length ? waypointColors : undefined}
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
            vesselOpen={!!selectedVessel}
            onPanelModeChange={(mode) => {
              setPanelMode(mode);
              if (mode === "timemachine") {
                setReplayMode(true);
              } else {
                setReplayMode(false);
                setReplayTracks(EMPTY_TRACKS);
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
