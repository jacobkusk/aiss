"use client";

import { useEffect, useRef, useState, MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import { mmsiToFlag } from "@/lib/utils";
import type { Vessel } from "@/lib/types";

export { OVERLAY_LABELS, DEFAULT_OVERLAYS };

export type Overlays = Record<string, boolean>;
export type MapStyle = "light" | "dark" | "satellite";

const MAP_TILES: Record<MapStyle, { base: string; labels: string }> = {
  light: {
    base: "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
    labels: "https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  },
  dark: {
    base: "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
    labels: "https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  },
  satellite: {
    base: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  },
};

interface Props {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  isGlobe: boolean;
  isLive: boolean;
  historicalDate: string | null;
  scrubMinutesAgo: number;
  overlays: Overlays;
  mapStyle: MapStyle;
  onVesselsUpdate: (vessels: Vessel[]) => void;
  onVesselClick: (vessel: Vessel) => void;
  onRouteCountUpdate: (count: number) => void;
  onToggleGlobe: (globe: boolean) => void;
  onToggleOverlay: (key: string) => void;
  onZoomChange?: (zoom: number) => void;
}

// ── Naval metrics helpers ────────────────────────────────────────────────────

/** Haversine distance in nautical miles between two [lon, lat] points */
function nmBetween(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.asin(Math.sqrt(s)) * 2 * 3440.065;
}

/**
 * Theoretical max speed for a vessel by AIS ship_type.
 * Displacement vessels: hull speed ≈ 1.34 × √LWL_ft — without known length
 * we use conservative type-based upper bounds that flag true anomalies.
 */
function estimateMaxSpeed(shipType: number): number {
  if (shipType >= 36 && shipType <= 37) return 12;  // sailing/pleasure
  if (shipType >= 30 && shipType <= 35) return 14;  // fishing
  if (shipType >= 60 && shipType <= 69) return 30;  // passenger / ferry
  if (shipType >= 70 && shipType <= 79) return 22;  // cargo
  if (shipType >= 80 && shipType <= 89) return 16;  // tanker
  if (shipType >= 40 && shipType <= 49) return 50;  // high-speed craft
  if (shipType >= 50 && shipType <= 59) return 20;  // tug / special
  return 25; // unknown / other
}

function formatDurationParts(ms: number): { value: string; unit: string } {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return { value: `${m}`, unit: "minutes" };
  if (m === 0) return { value: `${h}`, unit: "hours" };
  return { value: `${h}h ${m}`, unit: "minutes" };
}

// ── Position prediction ───────────────────────────────────────────────────────

// Predict position based on COG and SOG
function predictedPosition(lon: number, lat: number, cogDeg: number, sogKn: number, hoursAhead = 0.5): [number, number] {
  const R = 3440.065;
  const d = sogKn * hoursAhead;
  const cogRad = (cogDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d / R) +
    Math.cos(latRad) * Math.sin(d / R) * Math.cos(cogRad)
  );
  const newLonRad = lonRad + Math.atan2(
    Math.sin(cogRad) * Math.sin(d / R) * Math.cos(latRad),
    Math.cos(d / R) - Math.sin(latRad) * Math.sin(newLatRad)
  );
  return [(newLonRad * 180) / Math.PI, (newLatRad * 180) / Math.PI];
}

function buildPredictions(geojson: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of geojson.features) {
    const p = f.properties ?? {};
    const speed = p.speed ?? 0;
    const heading = p.heading ?? 0;
    if (speed < 2 || heading === 511 || heading === 0) continue;
    const coords = (f.geometry as GeoJSON.Point).coordinates;
    const predicted = predictedPosition(coords[0], coords[1], heading, speed, 0.5);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [coords, predicted] },
      properties: { mmsi: p.mmsi },
    });
  }
  return { type: "FeatureCollection", features };
}

function vesselFromFeature(f: GeoJSON.Feature): Vessel {
  const p = f.properties ?? {};
  const coords = (f.geometry as GeoJSON.Point).coordinates;
  return {
    mmsi: p.mmsi ?? 0,
    ship_name: p.name ?? null,
    lat: coords[1],
    lon: coords[0],
    sog: p.speed ?? null,
    cog: p.course ?? null,
    heading: p.heading ?? null,
    speed: p.speed ?? null,
    ship_type: p.ship_type ?? null,
    destination: p.destination ?? null,
    source: p.source ?? "ais",
    updated_at: p.updated_at ?? null,
  };
}

// Overlay config
const OVERLAY_LABELS: Record<string, { label: string; color: string }> = {
  seamarks: { label: "Sea Marks", color: "#5a8090" },
  underway: { label: "Underway", color: "#00e676" },
  anchored: { label: "At Anchor", color: "#5a8090" },
  predictions: { label: "Predictions", color: "#ffffff" },
  cargo: { label: "Cargo", color: "#38b038" },
  tanker: { label: "Tanker", color: "#c44040" },
  passenger: { label: "Passenger", color: "#4a90d9" },
  fishing: { label: "Fishing", color: "#d4a017" },
  sailing: { label: "Sailing", color: "#2ba8c8" },
  names: { label: "Names", color: "#8ba8b8" },
  landmask: { label: "Land mask", color: "#e05a3a" },
};


const DEFAULT_OVERLAYS: Overlays = {
  seamarks: false,
  underway: true,
  anchored: true,
  predictions: false,
  cargo: true,
  tanker: true,
  passenger: true,
  fishing: true,
  sailing: true,
  names: false,
  landmask: false,
};

// Ship type color mapping
const SHIP_TYPE_COLORS = [
  // Fishing (30-39)
  30, "#d4a017", 31, "#d4a017", 32, "#d4a017", 33, "#d4a017", 34, "#d4a017", 35, "#d4a017",
  36, "#2ba8c8", 37, "#2ba8c8", // Sailing & Pleasure
  38, "#d4a017", 39, "#d4a017",
  // High-speed / WIG (40-49)
  40, "#e07020", 41, "#e07020", 42, "#e07020", 43, "#e07020", 44, "#e07020",
  45, "#e07020", 46, "#e07020", 47, "#e07020", 48, "#e07020", 49, "#e07020",
  // Pilot/Tug/Special (50-59)
  50, "#e07020", 51, "#e07020", 52, "#e07020", 53, "#e07020", 54, "#e07020",
  55, "#e07020", 56, "#e07020", 57, "#e07020", 58, "#8b5cf6", 59, "#e07020",
  // Passenger (60-69)
  60, "#4a90d9", 61, "#4a90d9", 62, "#4a90d9", 63, "#4a90d9", 64, "#4a90d9",
  65, "#4a90d9", 66, "#4a90d9", 67, "#4a90d9", 68, "#4a90d9", 69, "#4a90d9",
  // Cargo (70-79)
  70, "#38b038", 71, "#38b038", 72, "#38b038", 73, "#38b038", 74, "#38b038",
  75, "#38b038", 76, "#38b038", 77, "#38b038", 78, "#38b038", 79, "#38b038",
  // Tanker (80-89)
  80, "#c44040", 81, "#c44040", 82, "#c44040", 83, "#c44040", 84, "#c44040",
  85, "#c44040", 86, "#c44040", 87, "#c44040", 88, "#c44040", 89, "#c44040",
] as (string | number)[];

// Build vessel filter from overlay state
function buildVesselFilter(ov: Overlays): maplibregl.FilterSpecification {
  const conditions: maplibregl.FilterSpecification[] = [["!", ["has", "point_count"]]];

  // Speed filter
  if (ov.underway && !ov.anchored) {
    conditions.push([">=", ["to-number", ["get", "speed"], 0], 0.5]);
  } else if (!ov.underway && ov.anchored) {
    conditions.push(["<", ["to-number", ["get", "speed"], 0], 0.5]);
  } else if (!ov.underway && !ov.anchored) {
    conditions.push(["==", 1, 0]); // hide all
  }

  // Ship type filter
  const typeConditions: maplibregl.FilterSpecification[] = [];
  const st = ["to-number", ["get", "ship_type"], 0] as maplibregl.ExpressionSpecification;
  if (ov.cargo) typeConditions.push(["all", [">=", st, 70], ["<=", st, 79]]);
  if (ov.tanker) typeConditions.push(["all", [">=", st, 80], ["<=", st, 89]]);
  if (ov.passenger) typeConditions.push(["all", [">=", st, 60], ["<=", st, 69]]);
  if (ov.fishing) typeConditions.push(["all", [">=", st, 30], ["<=", st, 35]]);
  if (ov.sailing) typeConditions.push(["any", ["==", st, 36], ["==", st, 37]]);
  // Always include unknown/other types and types not in the toggle list (40-59, 90-99, 0)
  typeConditions.push(["all", [">=", st, 40], ["<=", st, 59]]);
  typeConditions.push([">=", st, 90]);
  typeConditions.push(["==", st, 0]);
  // Include vessels with no ship_type (null → becomes 0)
  if (ov.cargo || ov.tanker || ov.passenger || ov.sailing) {
    typeConditions.push(["==", st, 0]);
  }

  if (typeConditions.length > 0) {
    conditions.push(["any", ...typeConditions] as any);
  }

  return ["all", ...conditions] as any;
}

export default function MapView({
  mapRef,
  isGlobe,
  isLive,
  historicalDate,
  scrubMinutesAgo,
  overlays,
  mapStyle,
  onVesselsUpdate,
  onVesselClick,
  onRouteCountUpdate,
  onToggleGlobe,
  onToggleOverlay,
  onZoomChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const trackRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedMmsiRef = useRef<number | null>(null);
  const fetchVesselsRef = useRef<(() => void) | null>(null);
  const trackFeaturesRef = useRef<GeoJSON.Feature[]>([]);

  // Hover tooltips
  type HoverTooltip = { x: number; y: number; content: React.ReactNode };
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltip | null>(null);
  const setHoverTooltipRef = useRef(setHoverTooltip);
  setHoverTooltipRef.current = setHoverTooltip;

  // Measurement tool
  const [measureActive, setMeasureActive] = useState(false);
  const measureActiveRef = useRef(false);
  const measurePoints = useRef<[number, number][]>([]);
  const measureMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [measureDistance, setMeasureDistance] = useState<{ nm: number; km: number } | null>(null);

  // Segment analysis
  type SegmentPanel = {
    a: any; b: any;
    distNm: number; distKm: number;
    timeMs: number; avgSpeedKn: number;
    maxSpeedKn: number; anomaly: boolean;
  };
  const [segmentPanel, setSegmentPanel] = useState<SegmentPanel | null>(null);
  const segmentPanelSetRef = useRef(setSegmentPanel);
  segmentPanelSetRef.current = setSegmentPanel;
  const [waypointASelected, setWaypointASelected] = useState(false);
  const setWaypointASelectedRef = useRef(setWaypointASelected);
  setWaypointASelectedRef.current = setWaypointASelected;
  const waypointARef = useRef<any>(null);
  const waypointBRef = useRef<any>(null);
  const vesselJustClickedRef = useRef(false);
  const trackDotJustClickedRef = useRef(false);
  const clusterJustClickedRef = useRef(false);
  const filteredWaypointsRef = useRef<any[]>([]);
  const selectedShipTypeRef = useRef<number>(0);

  const onVesselsUpdateRef = useRef(onVesselsUpdate);
  const onVesselClickRef = useRef(onVesselClick);
  const onRouteCountUpdateRef = useRef(onRouteCountUpdate);
  const onZoomChangeRef = useRef(onZoomChange);
  onVesselsUpdateRef.current = onVesselsUpdate;
  onZoomChangeRef.current = onZoomChange;
  onVesselClickRef.current = onVesselClick;
  onRouteCountUpdateRef.current = onRouteCountUpdate;

  // Helper: update track display based on scrub position
  const scrubRef = useRef(scrubMinutesAgo);
  scrubRef.current = scrubMinutesAgo;

  function updateTrackDisplay(map: maplibregl.Map) {
    const features = trackFeaturesRef.current;
    const trackSrc = map.getSource("selected-track") as maplibregl.GeoJSONSource | undefined;
    if (!trackSrc) return;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (features.length === 0) {
      trackSrc.setData(empty);
      return;
    }

    // Separate lines (shape) from points (timestamped waypoints) and gap arrows
    const lines = features.filter((f: any) => f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString");
    const waypoints = features.filter((f: any) => f.geometry?.type === "Point" && f.properties?.recorded_at);
    const segmentEnds = features.filter((f: any) => f.geometry?.type === "Point" && f.properties?.type === "segment_end");

    // Sort waypoints by time — DB order is not guaranteed
    const sortedWaypoints = [...waypoints].sort((a: any, b: any) =>
      new Date(a.properties.recorded_at).getTime() - new Date(b.properties.recorded_at).getTime()
    );

    // Store for segment analysis click handler
    filteredWaypointsRef.current = sortedWaypoints;

    // Build track: all shape lines + waypoint line + dots
    const trackFeatures: GeoJSON.Feature[] = [];

    // Add shape lines (always show full ais_line shape)
    for (const line of lines) {
      trackFeatures.push(line as GeoJSON.Feature);
    }

    // Connect all waypoints as a single unbroken line in time order
    const rawPts: [number, number][] = sortedWaypoints.map((f: any) => f.geometry.coordinates);
    if (rawPts.length >= 2) {
      trackFeatures.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: rawPts } });
    }

    // Waypoint dots — skip the last point (most recent = current vessel position, already shown by vessel icon)
    const step = sortedWaypoints.length > 200 ? 10 : sortedWaypoints.length > 50 ? 5 : 1;
    const lastIdx = sortedWaypoints.length - 1;
    for (let i = 0; i < sortedWaypoints.length; i++) {
      if (i === lastIdx) continue;
      if (i === 0 || i % step === 0) {
        trackFeatures.push(sortedWaypoints[i] as GeoJSON.Feature);
      }
    }

    // Add segment endpoint arrows
    for (const se of segmentEnds) {
      trackFeatures.push(se as GeoJSON.Feature);
    }

    trackSrc.setData({ type: "FeatureCollection", features: trackFeatures });
  }

  // Scrubber removed — effect kept as no-op placeholder
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _scrubMinutesAgoUnused = scrubMinutesAgo;

  // Sync overlay state to map layers
  const prevOverlaysRef = useRef(overlays);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const ov = overlays;
    try {
      map.setLayoutProperty("openseamap", "visibility", ov.seamarks ? "visible" : "none");
      map.setLayoutProperty("vessel-predictions", "visibility", ov.predictions ? "visible" : "none");
      map.setLayoutProperty("vessel-labels", "visibility", ov.names ? "visible" : "none");
      map.setFilter("ais-vessels", buildVesselFilter(ov));
      map.setFilter("ais-vessels-static", ["all", buildVesselFilter(ov), ["<", ["to-number", ["get", "speed"], 0], 0.5]] as any);

      // Land mask toggle
      if (ov.landmask) {
        map.setLayoutProperty("land-mask-fill", "visibility", "visible");
        const src = map.getSource("land-mask") as maplibregl.GeoJSONSource;
        const b = map.getBounds();
        const url = `/api/land-layer?min_lon=${b.getWest()}&min_lat=${b.getSouth()}&max_lon=${b.getEast()}&max_lat=${b.getNorth()}`;
        fetch(url)
          .then(r => r.json())
          .then(geojson => { src.setData(geojson); })
          .catch(e => console.error("[land-mask]", e));
      } else {
        map.setLayoutProperty("land-mask-fill", "visibility", "none");
      }
    } catch {
      // Layers not ready
    }
    prevOverlaysRef.current = ov;
  }, [overlays]);

  // Swap map tiles when style changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      const baseSrc = map.getSource("carto-dark") as any;
      const labelSrc = map.getSource("carto-labels") as any;
      if (baseSrc) baseSrc.setTiles([MAP_TILES[mapStyle].base]);
      if (labelSrc) labelSrc.setTiles([MAP_TILES[mapStyle].labels]);
    } catch { /* not ready */ }
  }, [mapStyle]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const map = new maplibregl.Map({
      attributionControl: false,
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [MAP_TILES[mapStyle].base],
            tileSize: 256,
            attribution: "&copy; CARTO &copy; OpenStreetMap",
          },
          "carto-labels": {
            type: "raster",
            tiles: [MAP_TILES[mapStyle].labels],
            tileSize: 256,
          },
        },
        layers: [
          { id: "carto-dark", type: "raster", source: "carto-dark", minzoom: 0, maxzoom: 19 },
          { id: "carto-labels", type: "raster", source: "carto-labels", minzoom: 0, maxzoom: 19 },
        ],
      },
      center: [12.5, 55.7],
      zoom: 2,
      maxPitch: 85,
    } as maplibregl.MapOptions);

    mapRef.current = map;



    async function fetchVessels() {
      const { data, error } = await supabase.rpc("get_live_vessels_compact");
      if (error || !data) return;

      // Compact format: [[mmsi, lat, lon, speed, course, heading, nav_status, ship_type], ...]
      // Convert to GeoJSON
      let geojson: GeoJSON.FeatureCollection;
      if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
        geojson = {
          type: "FeatureCollection",
          features: data.map((r: number[]) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [r[2], r[1]] },
            properties: {
              mmsi: r[0], name: r[11] || "", ship_type: r[7], speed: r[3],
              course: r[4], heading: r[5], nav_status: r[6],
              destination: "", source: "aisstream",
              prev_lat: r[8], prev_lon: r[9],
              updated_at: r[10] ? new Date(r[10] * 1000).toISOString() : null,
              stale: r[10] ? (Date.now() / 1000 - r[10]) > 1800 : false,
            },
          })),
        };
      } else {
        // GeoJSON from get_vessels_at_time or legacy format
        geojson = typeof data === "string" ? JSON.parse(data) : data;
      }
      const features: GeoJSON.Feature[] = geojson?.features ?? [];

      onVesselsUpdateRef.current(features.map(vesselFromFeature));

      const src = map.getSource("vessels") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);

      const predSrc = map.getSource("predictions") as maplibregl.GeoJSONSource | undefined;
      if (predSrc) predSrc.setData(buildPredictions(geojson));

    }

    map.on("load", () => {
      // Globe projection
      try { (map as any).setProjection({ type: "globe" }); } catch {}

      // Dark atmosphere
      try {
        (map as any).setFog({
          color: "#0d1b2a",
          "high-color": "#0a1525",
          "horizon-blend": 0.04,
          "space-color": "#111820",
          "star-intensity": 0.15,
        });
      } catch {}

      // Generate vessel icons via canvas (sync)
      const iconColors: Record<string, string> = {
        cargo: "#38b038", tanker: "#c44040", passenger: "#4a90d9",
        fishing: "#d4a017", sailing: "#2ba8c8", special: "#e07020", unknown: "#38b038",
      };
      // Draw at 2× resolution and register with pixelRatio:2 for crisp retina rendering
      const PR = 2;
      const makeArrow = (color: string, w: number, h: number): ImageData => {
        const c = document.createElement("canvas");
        c.width = w * PR; c.height = h * PR;
        const ctx = c.getContext("2d")!;
        ctx.scale(PR, PR);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w - 1, h);
        ctx.lineTo(w / 2, h * 0.7);
        ctx.lineTo(1, h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
        return ctx.getImageData(0, 0, w * PR, h * PR);
      };
      const makeCircle = (color: string): ImageData => {
        const size = 14;
        const c = document.createElement("canvas");
        c.width = size * PR; c.height = size * PR;
        const ctx = c.getContext("2d")!;
        ctx.scale(PR, PR);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        return ctx.getImageData(0, 0, size * PR, size * PR);
      };
      for (const [name, color] of Object.entries(iconColors)) {
        const arrow = makeArrow(color, 12, 20);
        map.addImage(`tri-${name}`, { width: 12 * PR, height: 20 * PR, data: new Uint8Array(arrow.data.buffer) }, { pixelRatio: PR });
        const circ = makeCircle(color);
        map.addImage(`circ-${name}`, { width: 14 * PR, height: 14 * PR, data: new Uint8Array(circ.data.buffer) }, { pixelRatio: PR });
      }
      // Gap arrow icons — directional chevron for segment endpoints, 3 gap-duration colours
      const makeGapArrow = (color: string): ImageData => {
        const w = 9, h = 15;
        const c = document.createElement("canvas");
        c.width = w * PR; c.height = h * PR;
        const ctx = c.getContext("2d")!;
        ctx.scale(PR, PR);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.lineTo(w, h);
        ctx.lineTo(w / 2, h * 0.65);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        return ctx.getImageData(0, 0, w * PR, h * PR);
      };
      const gapArrowColors: Record<string, string> = {
        grey: "#aabbcc",    // < 30 min — brief signal loss
        orange: "#ff9900",  // 30 min – 6 h — unknown
        red: "#e03030",     // > 6 h — likely different trip
      };
      for (const [name, color] of Object.entries(gapArrowColors)) {
        const img = makeGapArrow(color);
        map.addImage(`gap-arrow-${name}`, { width: 9 * PR, height: 15 * PR, data: new Uint8Array(img.data.buffer) }, { pixelRatio: PR });
      }

      // Sources
      map.addSource("land-mask", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "land-mask-fill",
        type: "fill",
        source: "land-mask",
        paint: {
          "fill-color": "#e05a3a",
          "fill-opacity": 0.35,
        },
        layout: { visibility: "none" },
      });

      map.addSource("vessels", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 5,
        clusterRadius: 50,
      });
      map.addSource("predictions", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("selected-track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("measure-line", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("segment-highlight", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("waypoint-markers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("openseamap", {
        type: "raster",
        tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
        tileSize: 256,
      });

      // Layers — ordered bottom to top

      // OpenSeaMap (default OFF)
      map.addLayer({
        id: "openseamap",
        type: "raster",
        source: "openseamap",
        minzoom: 10,
        paint: { "raster-opacity": 0.8 },
        layout: { visibility: "none" },
      });

      // Clusters
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "vessels",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            "rgba(43, 168, 200, 0.6)", 100,
            "rgba(43, 168, 200, 0.7)", 500,
            "rgba(43, 168, 200, 0.8)",
          ],
          "circle-radius": ["step", ["get", "point_count"], 15, 100, 20, 500, 25],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "vessels",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 11 },
        paint: { "text-color": "#ffffff" },
      });


      // Selected vessel track
      map.addLayer({
        id: "selected-track-line",
        type: "line",
        source: "selected-track",
        filter: ["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "MultiLineString"]],
        paint: {
          "line-color": "#ffd633",
          "line-width": 2.5,
          "line-opacity": 0.85,
        },
      });

      // Segment highlight (cyan line) — below waypoint dots so dots stay visible
      map.addLayer({
        id: "segment-highlight-line",
        type: "line",
        source: "segment-highlight",
        paint: {
          "line-color": "#00e5ff",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });

      // Waypoint dots on top of the cyan line
      map.addLayer({
        id: "selected-track-dots",
        type: "circle",
        source: "selected-track",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "type"], "segment_end"]],
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffd633",
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "rgba(0,0,0,0.5)",
        },
      });

      // Invisible larger hit area for waypoint clicks (easier to click)
      map.addLayer({
        id: "selected-track-dots-hitarea",
        type: "circle",
        source: "selected-track",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "type"], "segment_end"]],
        paint: {
          "circle-radius": 12,
          "circle-color": "rgba(0,0,0,0)",
          "circle-opacity": 0,
        },
      });
      // Segment endpoint gap arrows — directional, colour-coded by gap duration
      map.addLayer({
        id: "segment-gap-arrows",
        type: "symbol",
        source: "selected-track",
        filter: ["==", ["get", "type"], "segment_end"],
        layout: {
          "icon-image": [
            "case",
            ["<", ["to-number", ["get", "gap_sec"], 0], 1800], "gap-arrow-grey",
            ["<", ["to-number", ["get", "gap_sec"], 0], 21600], "gap-arrow-orange",
            "gap-arrow-red",
          ] as any,
          "icon-rotate": ["to-number", ["get", "bearing"], 0] as any,
          "icon-rotation-alignment": "map",
          "icon-anchor": "top",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": 1.0,
        },
        paint: { "icon-opacity": 0.9 },
      });

      // Waypoint A marker (cyan)
      map.addLayer({
        id: "waypoint-a-marker",
        type: "circle",
        source: "waypoint-markers",
        filter: ["==", ["get", "role"], "A"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#00e5ff",
          "circle-opacity": 1,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
      // Waypoint B marker (orange)
      map.addLayer({
        id: "waypoint-b-marker",
        type: "circle",
        source: "waypoint-markers",
        filter: ["==", ["get", "role"], "B"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#ff6b35",
          "circle-opacity": 1,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Vessel icons (MarineTraffic style)
      // Use match with explicit values — more reliable than range comparisons
      const spd = ["to-number", ["get", "speed"], 0];
      const uw = [">", spd, 0.5];
      // Map ship_type to category name
      const typeCategory = [
        "match", ["get", "ship_type"],
        [70,71,72,73,74,75,76,77,78,79], "cargo",
        [80,81,82,83,84,85,86,87,88,89], "tanker",
        [60,61,62,63,64,65,66,67,68,69], "passenger",
        [30,31,32,33,34,35], "fishing",
        [36,37], "sailing",
        [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59], "special",
        "unknown",
      ];
      // All vessels — symbol layer (handles all clicks + arrows for underway)
      map.addLayer({
        id: "ais-vessels",
        type: "symbol",
        source: "vessels",
        filter: buildVesselFilter(DEFAULT_OVERLAYS),
        layout: {
          "icon-image": ["concat", ["case", uw, "tri-", "circ-"], typeCategory] as any,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 8, 1.1, 14, 1.6] as any,
          "icon-rotate": ["case", uw, ["to-number", ["get", "heading"], 0], 0] as any,
          "icon-anchor": ["case", uw, "top", "center"] as any,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": ["case", uw, ["case", ["get", "stale"], 0.35, 0.95], 0] as any,
        },
      } as any);

      // Static vessels — native circle layer on top for crisp rendering (visual only, click falls through to ais-vessels)
      map.addLayer({
        id: "ais-vessels-static",
        type: "circle",
        source: "vessels",
        filter: ["all", buildVesselFilter(DEFAULT_OVERLAYS), ["<", ["to-number", ["get", "speed"], 0], 0.5]] as any,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 8, 5, 14, 7] as any,
          "circle-color": ["match", ["to-number", ["get", "ship_type"], 0], ...SHIP_TYPE_COLORS, "#38b038"] as any,
          "circle-opacity": ["case", ["get", "stale"], 0.3, 0.85] as any,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.5)",
        },
      } as any);

      // Vessel labels (default OFF)
      map.addLayer({
        id: "vessel-labels",
        type: "symbol",
        source: "vessels",
        filter: ["!", ["has", "point_count"]],
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          visibility: "none",
        },
        paint: {
          "text-color": "#2a4a5a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      });

      // Predicted course lines (default ON)
      map.addLayer({
        id: "vessel-predictions",
        type: "line",
        source: "predictions",
        minzoom: 6,
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.5,
          "line-opacity": 0.5,
          "line-dasharray": [2, 3],
        },
      });

      // Historical routes
      map.addLayer({
        id: "historical-routes",
        type: "line",
        source: "routes",
        paint: { "line-color": "#f59e0b", "line-width": 1.5, "line-opacity": 0.6 },
        layout: { visibility: "none" },
      });

      // Measure layers (on top of everything)
      map.addLayer({
        id: "measure-line",
        type: "line",
        source: "measure-line",
        paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [4, 2], "line-opacity": 0.9 },
      });

      // Measure helpers
      const nmBetweenPts = (a: [number, number], b: [number, number]) => {
        const dLat = (b[1] - a[1]) * Math.PI / 180;
        const dLon = (b[0] - a[0]) * Math.PI / 180;
        const lat1 = a[1] * Math.PI / 180;
        const lat2 = b[1] * Math.PI / 180;
        const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        return Math.asin(Math.sqrt(s)) * 2 * 3440.065;
      };

      const redrawMeasureLine = () => {
        const pts = measurePoints.current;
        const lineSrc = map.getSource("measure-line") as maplibregl.GeoJSONSource | undefined;
        if (lineSrc) lineSrc.setData({
          type: "FeatureCollection",
          features: pts.length >= 2 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } }] : [],
        });
        if (pts.length >= 2) {
          let total = 0;
          for (let i = 1; i < pts.length; i++) total += nmBetweenPts(pts[i - 1], pts[i]);
          setMeasureDistance({ nm: Math.round(total * 10) / 10, km: Math.round(total * 1.852 * 10) / 10 });
        } else {
          setMeasureDistance(null);
        }
      };

      const addMeasureMarker = (lngLat: [number, number], index: number) => {
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;border-radius:50%;background:#2BA8C8;border:2px solid #ffffff;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.4);";
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat(lngLat)
          .addTo(map);
        marker.on("drag", () => {
          const { lng, lat } = marker.getLngLat();
          measurePoints.current[index] = [lng, lat];
          redrawMeasureLine();
        });
        measureMarkersRef.current.push(marker);
      };

      map.on("click", (e) => {
        if (!measureActiveRef.current) return;
        const idx = measurePoints.current.length;
        measurePoints.current = [...measurePoints.current, [e.lngLat.lng, e.lngLat.lat]];
        addMeasureMarker([e.lngLat.lng, e.lngLat.lat], idx);
        redrawMeasureLine();
      });

      // Click vessel — show popup + fetch full yellow track with waypoints
      const handleVesselClick = async (e: maplibregl.MapLayerMouseEvent) => {
        if (measureActiveRef.current) return;
        vesselJustClickedRef.current = true;
        requestAnimationFrame(() => { vesselJustClickedRef.current = false; });
        if (e.features?.[0]) {
          const p    = e.features[0].properties;
          const mmsi = p.mmsi;
          const clickLat = (e.features[0].geometry as GeoJSON.Point).coordinates[1];
          const clickLon = (e.features[0].geometry as GeoJSON.Point).coordinates[0];
          selectedShipTypeRef.current = p.ship_type ?? 0;
          waypointARef.current = null;
          waypointBRef.current = null;
          setWaypointASelectedRef.current(false);
          segmentPanelSetRef.current(null);

          const vesselBase = {
            mmsi,
            ship_name:   p.name ?? p.ship_name,
            lat:         clickLat,
            lon:         clickLon,
            sog:         p.speed ?? p.sog,
            cog:         p.cog ?? p.course ?? null,
            heading:     p.heading,
            speed:       p.speed ?? p.sog,
            ship_type:   p.ship_type,
            destination: p.destination,
            source:      p.source,
          };

          onVesselClickRef.current(vesselBase);

          const fetchTrack = async () => {
            const { data } = await supabase.rpc("get_vessel_track", { p_mmsi: mmsi, p_minutes: 2880 });
            if (data) {
              const geojson = typeof data === "string" ? JSON.parse(data) : data;
              trackFeaturesRef.current = geojson.features ?? [];
              updateTrackDisplay(map);
              const stats = geojson.stats ?? {};
              onVesselClickRef.current({ ...vesselBase, max_speed: stats.max_speed ?? null, avg_speed_moving: stats.avg_speed_moving ?? null });
            }
          };

          // Stop evt. tidligere track-refresh
          if (trackRefreshTimerRef.current) clearInterval(trackRefreshTimerRef.current);
          selectedMmsiRef.current = mmsi;

          // Hent med det samme + refresh hvert 10. sekund
          await fetchTrack();
          trackRefreshTimerRef.current = setInterval(fetchTrack, 10000);
        }
      };
      map.on("click", "ais-vessels", handleVesselClick);

      // Click on waypoint dot — segment analysis (first click = A, second click = B)
      map.on("click", "selected-track-dots-hitarea", (e) => {
        if (measureActiveRef.current) return;
        // Skip if a vessel was just clicked (ais-vessels fires first, sets this flag)
        if (vesselJustClickedRef.current) return;
        // Flag for the general click handler so it doesn't clear the track
        trackDotJustClickedRef.current = true;
        requestAnimationFrame(() => { trackDotJustClickedRef.current = false; });
        const raw = e.features?.[0];
        if (!raw) return;
        // Convert MapLibre feature to plain GeoJSON (MapLibre features have extra internal fields)
        const f: GeoJSON.Feature = {
          type: "Feature",
          geometry: raw.geometry as GeoJSON.Geometry,
          properties: raw.properties ?? {},
        };

        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        const markerSrc = map.getSource("waypoint-markers") as maplibregl.GeoJSONSource | undefined;
        const segSrc = map.getSource("segment-highlight") as maplibregl.GeoJSONSource | undefined;

        const computeSegment = (wpA: GeoJSON.Feature, wpB: GeoJSON.Feature) => {
          const tA = wpA.properties?.recorded_at ?? "";
          const tB = wpB.properties?.recorded_at ?? "";
          const [first, second] = tA <= tB ? [wpA, wpB] : [wpB, wpA];
          const tFirst: string = first.properties?.recorded_at;
          const tSecond: string = second.properties?.recorded_at;

          const all = filteredWaypointsRef.current;
          const segment = all.filter((w: any) => {
            const t = w.properties?.recorded_at;
            return t && t >= tFirst && t <= tSecond;
          });

          let distNm = 0;
          for (let i = 1; i < segment.length; i++) {
            distNm += nmBetween(
              segment[i - 1].geometry.coordinates as [number, number],
              segment[i].geometry.coordinates as [number, number],
            );
          }
          const distKm = distNm * 1.852;
          const timeMs = new Date(tSecond).getTime() - new Date(tFirst).getTime();
          const timeHrs = timeMs / 3_600_000;
          const avgSpeedKn = timeHrs > 0 ? distNm / timeHrs : 0;
          const maxSpeedKn = estimateMaxSpeed(selectedShipTypeRef.current);
          const anomaly = avgSpeedKn > maxSpeedKn * 1.15;

          if (segment.length >= 2) {
            segSrc?.setData({
              type: "FeatureCollection",
              features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: segment.map((w: any) => w.geometry.coordinates) } }],
            });
          }
          markerSrc?.setData({
            type: "FeatureCollection",
            features: [
              { ...first, properties: { ...first.properties, role: "A" } },
              { ...second, properties: { ...second.properties, role: "B" } },
            ],
          });
          segmentPanelSetRef.current({
            a: first, b: second,
            distNm: Math.round(distNm * 10) / 10,
            distKm: Math.round(distKm * 10) / 10,
            timeMs,
            avgSpeedKn: Math.round(avgSpeedKn * 10) / 10,
            maxSpeedKn, anomaly,
          });
        };

        if (!waypointARef.current) {
          // First click — set A
          waypointARef.current = f;
          waypointBRef.current = null;
          setWaypointASelectedRef.current(true);
          markerSrc?.setData({ type: "FeatureCollection", features: [{ ...f, properties: { ...f.properties, role: "A" } }] });
          segSrc?.setData(empty);
          segmentPanelSetRef.current(null);
        } else if (!waypointBRef.current) {
          // Second click — set B, compute segment
          waypointBRef.current = f;
          setWaypointASelectedRef.current(false);
          computeSegment(waypointARef.current, f);
        } else {
          // Third+ click — move the closer endpoint and recompute
          const tNew = new Date(f.properties?.recorded_at ?? 0).getTime();
          const tA   = new Date(waypointARef.current.properties?.recorded_at ?? 0).getTime();
          const tB   = new Date(waypointBRef.current.properties?.recorded_at ?? 0).getTime();
          if (Math.abs(tNew - tA) <= Math.abs(tNew - tB)) {
            waypointARef.current = f;
          } else {
            waypointBRef.current = f;
          }
          computeSegment(waypointARef.current, waypointBRef.current);
        }
      });

      map.on("mouseenter", "selected-track-dots-hitarea", (e) => {
        if (hoverLeaveTimer) { clearTimeout(hoverLeaveTimer); hoverLeaveTimer = null; }
        map.getCanvas().style.cursor = "crosshair";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties ?? {};
        const t = p.recorded_at ? new Date(p.recorded_at) : null;
        const timeStr = t ? (() => {
          const offsetHours = -t.getTimezoneOffset() / 60;
          const utcLabel = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
          const time = t.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const date = t.toLocaleDateString("da-DK", { day: "numeric", month: "short" });
          return `${time} ${utcLabel} · ${date}`;
        })() : "—";
        const speed = p.speed != null ? `${Number(p.speed).toFixed(1)} kn` : "—";
        const isRouteMark = p.source === "route_mark";
        const dirLabel = isRouteMark ? "COG" : "HDG";
        const dirValue = isRouteMark
          ? (p.course != null ? `${Number(p.course).toFixed(0)}°` : "—")
          : (p.heading != null && p.heading !== 511 ? `${p.heading}°` : "—");
        setHoverTooltipRef.current({
          x: e.point.x, y: e.point.y,
          content: (
            <div>
              <div style={{ fontSize: "13px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#1a2a3a", marginBottom: "6px" }}>{timeStr}</div>
              <div style={{ display: "flex", gap: "16px" }}>
                <div><div style={{ fontSize: "9px", color: "#8899aa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "2px" }}>SOG</div><div style={{ fontSize: "14px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#1a6b9a" }}>{speed}</div></div>
                <div><div style={{ fontSize: "9px", color: "#8899aa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "2px" }}>{dirLabel}</div><div style={{ fontSize: "14px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#1a6b9a" }}>{dirValue}</div></div>
              </div>
            </div>
          ),
        });
      });
      map.on("mouseleave", "selected-track-dots-hitarea", () => {
        map.getCanvas().style.cursor = "";
        hoverLeaveTimer = setTimeout(() => setHoverTooltipRef.current(null), 150);
      });

      // Click on empty map — clear selection (fires after all layer-specific handlers)
      map.on("click", () => {
        if (measureActiveRef.current) return;
        // If any layer-specific handler fired, don't clear
        if (vesselJustClickedRef.current || trackDotJustClickedRef.current || clusterJustClickedRef.current) return;
        // Stop track auto-refresh + ryd
        if (trackRefreshTimerRef.current) { clearInterval(trackRefreshTimerRef.current); trackRefreshTimerRef.current = null; }
        selectedMmsiRef.current = null;
        trackFeaturesRef.current = [];
        const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
        (map.getSource("selected-track") as maplibregl.GeoJSONSource | undefined)?.setData(empty);
        (map.getSource("segment-highlight") as maplibregl.GeoJSONSource | undefined)?.setData(empty);
        (map.getSource("waypoint-markers") as maplibregl.GeoJSONSource | undefined)?.setData(empty);
        waypointARef.current = null;
        waypointBRef.current = null;
        setWaypointASelectedRef.current(false);
        segmentPanelSetRef.current(null);
      });

      map.on("click", "clusters", (e) => {
        clusterJustClickedRef.current = true;
        requestAnimationFrame(() => { clusterJustClickedRef.current = false; });
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        const src = map.getSource("vessels") as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
        });
      });

      // Hover
      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
      const handleVesselHoverEnter = (e: maplibregl.MapLayerMouseEvent) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties ?? {};
        const name = p.name || p.ship_name || "Unknown Vessel";
        const flag = mmsiToFlag(Number(p.mmsi));
        const sog = p.speed != null ? `${Number(p.speed).toFixed(1)} kn` : "—";
        const cog = p.course != null ? `${Number(p.course).toFixed(0)}°` : "—";
        const updatedAt = p.updated_at ? new Date(p.updated_at) : null;
        const lastSeen = updatedAt ? (() => {
          const offsetHours = -updatedAt.getTimezoneOffset() / 60;
          const utcLabel = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
          const timeStr = updatedAt.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const dateStr = updatedAt.toLocaleDateString("da-DK", { day: "numeric", month: "short" });
          return `${timeStr} ${utcLabel} · ${dateStr}`;
        })() : null;
        setHoverTooltipRef.current({
          x: e.point.x, y: e.point.y,
          content: (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                {flag && <span style={{ fontSize: "16px", lineHeight: 1 }}>{flag}</span>}
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a3a" }}>{name}</span>
              </div>
              <div style={{ display: "flex", gap: "14px", marginBottom: lastSeen ? "6px" : 0 }}>
                <div><div style={{ fontSize: "8px", color: "#8899aa", letterSpacing: "0.08em", textTransform: "uppercase" }}>SOG</div><div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#1a6b9a" }}>{sog}</div></div>
                <div><div style={{ fontSize: "8px", color: "#8899aa", letterSpacing: "0.08em", textTransform: "uppercase" }}>COG</div><div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#1a6b9a" }}>{cog}</div></div>
              </div>
              {lastSeen && <div style={{ fontSize: "10px", color: "#8899aa", fontFamily: "var(--font-mono)" }}>{lastSeen}</div>}
            </div>
          ),
        });
      };
      const handleVesselHoverMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (!e.features?.[0]) return;
        setHoverTooltipRef.current(prev => prev ? { ...prev, x: e.point.x, y: e.point.y } : prev);
      };
      let hoverLeaveTimer: ReturnType<typeof setTimeout> | null = null;
      const handleVesselHoverLeave = () => {
        map.getCanvas().style.cursor = "";
        hoverLeaveTimer = setTimeout(() => setHoverTooltipRef.current(null), 400);
      };
      const handleVesselHoverEnterClearTimer = () => {
        if (hoverLeaveTimer) { clearTimeout(hoverLeaveTimer); hoverLeaveTimer = null; }
      };
      for (const layerId of ["ais-vessels", "ais-vessels-static"]) {
        map.on("mouseenter", layerId, (e) => { handleVesselHoverEnterClearTimer(); handleVesselHoverEnter(e); });
        map.on("mousemove", layerId, handleVesselHoverMove);
        map.on("mouseleave", layerId, handleVesselHoverLeave);
      }

      // Track zoom level
      map.on("zoomend", () => {
        onZoomChangeRef.current?.(Math.round(map.getZoom()));
      });

      // Fetch data
      fetchVesselsRef.current = fetchVessels;
      fetchVessels();
      refreshTimerRef.current = setInterval(() => {
        fetchVessels();
      }, 30_000);
    });

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      map.remove();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure mode sync
  useEffect(() => {
    measureActiveRef.current = measureActive;
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = measureActive ? "crosshair" : "";
    if (!measureActive) {
      measurePoints.current = [];
      setMeasureDistance(null);
      measureMarkersRef.current.forEach(m => m.remove());
      measureMarkersRef.current = [];
      const lineSrc = map.getSource("measure-line") as maplibregl.GeoJSONSource | undefined;
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      lineSrc?.setData(empty);
    }
  }, [measureActive, mapRef]);

  // Toggle projection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try { (map as any).setProjection({ type: isGlobe ? "globe" : "mercator" }); } catch {}
  }, [isGlobe, mapRef]);

  // Switch between live and historical
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const liveLayerIds = ["ais-vessels", "ais-vessels-static", "clusters", "cluster-count", "vessel-predictions", "vessel-labels"];

    if (isLive) {
      try {
        for (const id of liveLayerIds) map.setLayoutProperty(id, "visibility", "visible");
        map.setLayoutProperty("historical-routes", "visibility", "none");
      } catch {}
    } else if (historicalDate) {
      try {
        for (const id of liveLayerIds) map.setLayoutProperty(id, "visibility", "none");
        map.setLayoutProperty("historical-routes", "visibility", "visible");
      } catch {}

      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);

      (async () => {
        const { data, error } = await supabase.rpc("get_routes_for_date", { p_date: historicalDate });
        if (error || !data) { onRouteCountUpdateRef.current(0); return; }
        onRouteCountUpdateRef.current(data.length);
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: data
            .filter((r: { geojson: unknown }) => r.geojson)
            .map((r: { mmsi: number; ship_name: string; distance_nm: number; avg_speed: number; geojson: GeoJSON.Geometry }) => ({
              type: "Feature" as const,
              geometry: typeof r.geojson === "string" ? JSON.parse(r.geojson) : r.geojson,
              properties: { mmsi: r.mmsi, ship_name: r.ship_name, distance_nm: r.distance_nm, avg_speed: r.avg_speed },
            })),
        };
        const src = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(geojson);
      })();
    }
  }, [isLive, historicalDate, mapRef]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: mapStyle === "dark" ? "radial-gradient(ellipse at 50% 50%, #0d1b2a 0%, #060c14 100%)" : "#e8e8e8" }}
      />

      {/* Globe/Map Segmented Control */}
      <div style={{
        position: "absolute",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        background: "rgba(30, 30, 34, 0.75)",
        backdropFilter: "blur(12px)",
        borderRadius: "7px",
        padding: "2px",
        zIndex: 10,
      }}>
        <button
          onClick={() => { try { (mapRef.current as any)?.setProjection({ type: "globe" }); mapRef.current?.jumpTo({ zoom: 2 }); } catch {} onToggleGlobe(true); }}
          style={{
            padding: "5px 14px", fontSize: "11px", fontWeight: 600, border: "none",
            cursor: "pointer", transition: "all 0.2s",
            borderRadius: "5px",
            background: isGlobe ? "rgba(255, 255, 255, 0.9)" : "transparent",
            color: isGlobe ? "#1c1c1e" : "rgba(255, 255, 255, 0.6)",
            boxShadow: isGlobe ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}
        >Globe</button>
        <button
          onClick={() => { try { (mapRef.current as any)?.setProjection({ type: "mercator" }); } catch {} onToggleGlobe(false); }}
          style={{
            padding: "5px 14px", fontSize: "11px", fontWeight: 600, border: "none",
            cursor: "pointer", transition: "all 0.2s",
            borderRadius: "5px",
            background: !isGlobe ? "rgba(255, 255, 255, 0.9)" : "transparent",
            color: !isGlobe ? "#1c1c1e" : "rgba(255, 255, 255, 0.6)",
            boxShadow: !isGlobe ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}
        >Map</button>
      </div>

      {/* Measure tool button */}
      <button
        onClick={() => setMeasureActive(v => !v)}
        title="Mål afstand"
        style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          zIndex: 10,
          width: "36px",
          height: "36px",
          borderRadius: "8px",
          border: measureActive ? "1px solid rgba(43,168,200,0.6)" : "1px solid rgba(255,255,255,0.15)",
          background: measureActive ? "rgba(43,168,200,0.25)" : "rgba(30,30,34,0.75)",
          backdropFilter: "blur(12px)",
          color: measureActive ? "#2BA8C8" : "rgba(255,255,255,0.7)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "16px",
        }}
      >
        📏
      </button>

      {/* Measure distance readout */}
      {measureActive && (
        <div style={{
          position: "absolute",
          top: "56px",
          right: "12px",
          zIndex: 10,
          background: "rgba(15,15,42,0.95)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(43,168,200,0.35)",
          borderRadius: "10px",
          padding: "10px 14px",
          minWidth: "150px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "9px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.6)", letterSpacing: "0.08em" }}>
              AFSTANDSMÅLER
            </span>
            <button
              onClick={() => setMeasureActive(false)}
              style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", background: "transparent", border: "none", cursor: "pointer", padding: "0 0 0 8px", lineHeight: 1 }}
            >✕</button>
          </div>
          {measureDistance ? (
            <>
              <div style={{ fontSize: "20px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#ffffff" }}>
                {measureDistance.nm} <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)" }}>nm</span>
              </div>
              <div style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.6)", marginTop: "3px" }}>
                {measureDistance.km} km
              </div>
            </>
          ) : (
            <div style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.55)" }}>
              Klik på kortet
            </div>
          )}
          {measureDistance && (
            <button
              onClick={() => {
                measurePoints.current = [];
                measureMarkersRef.current.forEach(m => m.remove());
                measureMarkersRef.current = [];
                setMeasureDistance(null);
                (mapRef.current?.getSource("measure-line") as any)?.setData({ type: "FeatureCollection", features: [] });
              }}
              style={{ marginTop: "8px", fontSize: "10px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.45)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
            >
              Ryd
            </button>
          )}
        </div>
      )}

      {/* Segment analysis panel — below vessel popup on the left */}
      {segmentPanel && (
        <div style={{
          position: "absolute",
          top: "264px",
          left: "16px",
          zIndex: 20,
          background: "rgba(10, 14, 30, 0.97)",
          backdropFilter: "blur(16px)",
          border: segmentPanel.anomaly
            ? "1px solid rgba(255, 60, 60, 0.7)"
            : "1px solid rgba(0, 229, 255, 0.4)",
          borderRadius: "12px",
          padding: "16px 20px",
          minWidth: "300px",
          maxWidth: "360px",
          boxShadow: "0 6px 40px rgba(0,0,0,0.55)",
          pointerEvents: "auto",
        }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.75)", letterSpacing: "0.1em" }}>
              SEGMENT ANALYSIS
            </span>
            <button
              onClick={() => {
                setSegmentPanel(null);
                waypointARef.current = null;
                waypointBRef.current = null;
                setWaypointASelected(false);
                const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
                (mapRef.current?.getSource("segment-highlight") as any)?.setData(empty);
                (mapRef.current?.getSource("waypoint-markers") as any)?.setData(empty);
              }}
              style={{ fontSize: "14px", color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", padding: "0 0 0 8px", lineHeight: 1 }}
            >✕</button>
          </div>

          {/* From / To / Duration */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "#00e5ff", letterSpacing: "0.08em", marginBottom: "4px" }}>FROM ●</div>
              <div style={{ fontSize: "14px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#ffffff" }}>
                {new Date(segmentPanel.a.properties?.recorded_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
                {new Date(segmentPanel.a.properties?.recorded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "#ff6b35", letterSpacing: "0.08em", marginBottom: "4px" }}>TO ●</div>
              <div style={{ fontSize: "14px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "#ffffff" }}>
                {new Date(segmentPanel.b.properties?.recorded_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.75)", marginTop: "2px" }}>
                {new Date(segmentPanel.b.properties?.recorded_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {(() => {
                const dur = formatDurationParts(segmentPanel.timeMs);
                return <>
                  <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.8)", letterSpacing: "0.08em", marginBottom: "4px" }}>DURATION</div>
                  <div style={{ fontSize: "22px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#ffffff", lineHeight: 1 }}>
                    {dur.value}
                  </div>
                  <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.75)", marginTop: "3px" }}>
                    {dur.unit}
                  </div>
                </>;
              })()}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginBottom: "14px" }} />

          {/* Distance + Speed */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.8)", letterSpacing: "0.08em", marginBottom: "4px" }}>DISTANCE</div>
              <div style={{ fontSize: "22px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#ffffff", lineHeight: 1 }}>
                {segmentPanel.distNm}
              </div>
              <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.75)", marginTop: "3px" }}>
                nm / {segmentPanel.distKm} km
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.8)", letterSpacing: "0.08em", marginBottom: "4px" }}>AVG. SPEED</div>
              <div style={{ fontSize: "22px", fontFamily: "var(--font-mono)", fontWeight: 700, color: segmentPanel.anomaly ? "#ff4444" : "#ffffff", lineHeight: 1 }}>
                {segmentPanel.avgSpeedKn}
              </div>
              <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.75)", marginTop: "3px" }}>
                knots
              </div>
            </div>
          </div>

          {/* Checksum bar */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.8)", letterSpacing: "0.06em" }}>
                CHECKSUM — MAX {segmentPanel.maxSpeedKn} kn
              </span>
              {segmentPanel.anomaly && (
                <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "#ff4444", letterSpacing: "0.06em", fontWeight: 700 }}>
                  ⚠ ANOMALY
                </span>
              )}
            </div>
            <div style={{ height: "7px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min(100, (segmentPanel.avgSpeedKn / (segmentPanel.maxSpeedKn * 1.5)) * 100)}%`,
                background: segmentPanel.anomaly
                  ? "linear-gradient(90deg, #ff6b35, #ff4444)"
                  : "linear-gradient(90deg, #00e5ff, #2ba8c8)",
                borderRadius: "4px",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoverTooltip && (
        <div style={{
          position: "absolute",
          left: hoverTooltip.x + 14,
          top: hoverTooltip.y - 10,
          zIndex: 50,
          background: "rgba(255,255,255,0.97)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: "8px",
          padding: "10px 12px",
          pointerEvents: "none",
          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        }}>
          {hoverTooltip.content}
        </div>
      )}

      {/* Hint: first waypoint selected, waiting for second */}
      {waypointASelected && !segmentPanel && (
        <div style={{
          position: "absolute",
          bottom: "90px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          background: "rgba(10, 14, 30, 0.92)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(0, 229, 255, 0.35)",
          borderRadius: "8px",
          padding: "10px 18px",
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: "13px", fontFamily: "var(--font-mono)", color: "#00e5ff" }}>
            ● A set — click a second waypoint to measure
          </span>
        </div>
      )}

    </div>
  );
}
