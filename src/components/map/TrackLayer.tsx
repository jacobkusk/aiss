"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";
import { GAP, LINE_STYLE, DIRECTION } from "@/lib/trackRules";

const SOURCE        = "track";
const FOCUS_SOURCE  = "track-focus";
const ENDPOINT_SOURCE = "track-endpoints";

// Douglas-Peucker overlay — single source with feature types.
// Mirrors LINE layer's 4-segment model (solid / short gap / long gap / blank).
// Gap classification is computed client-side from consecutive D·P point time
// deltas, using the same GAP thresholds as LINE. See trackRules.ts header.
const DOUGLAS_SOURCE        = "track-dp";
const DOUGLAS_LINE_LYR      = "track-dp-line";
const DOUGLAS_GAP_LYR       = "track-dp-gap";       // short gap  (5–10 min)
const DOUGLAS_GAP_LONG_LYR  = "track-dp-gap-long";  // long  gap (10–20 min)
const DOUGLAS_DOT_LYR       = "track-dp-dots";
const DOUGLAS_HIT_LYR       = "track-dp-hit";

const LAYER_LINE    = "track-line";
const LAYER_DIR     = "track-direction";
const LAYER_DOTS    = "track-dots";
const LAYER_RING    = "track-rings";
const LAYER_SOG     = "track-sog";
const LAYER_COG     = "track-cog";
const LAYER_GAP      = "track-gap";       // kort gap — tæt stiplet grå
const LAYER_GAP_LONG = "track-gap-long";  // langt brud — spredt stiplet lysere grå
const LAYER_FOCUS   = "track-focus-dot";
const LAYER_LINE_HIT        = "track-line-hit";
const LAYER_ENDPOINT_DOTS   = "track-endpoint-dots";
const LAYER_ENDPOINT_LABELS = "track-endpoint-labels";

interface WaypointHover {
  x: number; y: number; mmsi: number | null; speed: number | null;
  course: number | null; heading: number | null; recorded_at: string | null;
  lat: number; lon: number; sources: number | null;
  /** true = timestamp was interpolated between two waypoints, not an exact stored position */
  interpolated?: boolean;
}

interface LivePosition {
  mmsi: number; lat: number; lon: number;
  sog: number | null; cog: number | null; heading: number | null; updated_at: string | null;
}

interface Props {
  selectedMmsi: number | null;
  onClear: () => void;
  onHover: (data: WaypointHover | null) => void;
  onWaypointClick?: (t: number) => void;
  timeRange?: [number, number] | null;
  onTimeBounds?: (bounds: [number, number]) => void;
  onWaypointTimes?: (times: number[]) => void;
  /** Emitted in parallel with onWaypointTimes — speed (SOG, knots) for each waypoint, null if unknown */
  onWaypointSpeeds?: (speeds: (number | null)[]) => void;
  /** Emitted in parallel with onWaypointTimes — prediction_color hex per waypoint (matches line) */
  onWaypointColors?: (colors: (string | null)[]) => void;
  focusedTime?: number | null;
  replayMode?: boolean;
  livePosition?: LivePosition | null;
  /**
   * When true: flat amber line, full time range, macro orientation view
   * (used for historical vessels spanning multiple days).
   * When false: coloured gradient line for the current 24h window (default).
   */
  voyageMode?: boolean;
  /** Independent visibility toggles — can combine freely */
  showLine?: boolean;
  showDots?: boolean;
  /**
   * Epoch ms of the earliest time we care about.
   * Live mode: omit → defaults to UTC midnight today.
   * Replay mode: pass replayStart so we fetch the vessel's data for the full replay window.
   */
  windowStartMs?: number | null;
  /**
   * When set, fetch using get_vessel_track_range (absolute timestamps) instead of
   * get_vessel_track (relative minutes). Used for historical voyages and long-range queries.
   * [startMs, endMs] in epoch milliseconds.
   */
  voyageRange?: [number, number] | null;
  /** Called when voyage fetch finishes — returns point count. */
  onVoyageLoaded?: (pointCount: number) => void;
  /** Show Douglas-Peucker compressed track from tracks table instead of raw waypoints */
  douglasMode?: boolean;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Flat-earth approximation of segment length in metres.
 * Accurate to ~0.1% for distances < 10 km at typical AIS waypoint spacing.
 * Used to accumulate cumulative track distance for chevron placement
 * (see DIRECTION.SPACING_M in trackRules.ts).
 */
function segmentLengthM(a: number[], b: number[]): number {
  const latRad = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dxM = (b[0] - a[0]) * 111320 * Math.cos(latRad);
  const dyM = (b[1] - a[1]) * 111320;
  return Math.hypot(dxM, dyM);
}

function filterPoints(points: GeoJSON.Feature[], timeRange: [number, number] | null | undefined): GeoJSON.Feature[] {
  if (!timeRange) return points;
  return points.filter((f) => {
    const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
    return t >= timeRange[0] && t <= timeRange[1];
  });
}

function buildGeoJSON(
  points: GeoJSON.Feature[],
  timeRange: [number, number] | null | undefined,
  livePosition?: LivePosition | null,
  zoom: number = 10,
): GeoJSON.FeatureCollection {
  const filtered = filterPoints(points, timeRange);
  filtered.forEach((f, i) => { (f.properties as any).seq = i + 1; });

  const features: GeoJSON.Feature[] = [...filtered];

  // Chevron placement — see DIRECTION in trackRules.ts.
  // Accumulator resets on track breaks (> LONG gap); starts at SPACING_M so
  // the first eligible segment fires a chevron.
  let cumDistM = DIRECTION.SPACING_M;
  let prevColor: string | null = null;

  for (let i = 0; i < filtered.length - 1; i++) {
    const from  = (filtered[i].geometry as GeoJSON.Point).coordinates;
    const to    = (filtered[i + 1].geometry as GeoJSON.Point).coordinates;
    const fpA   = (filtered[i].properties as any);
    const fpB   = (filtered[i + 1].properties as any);
    const tA    = new Date(fpA?.recorded_at).getTime() / 1000;
    const tB    = new Date(fpB?.recorded_at).getTime() / 1000;
    const dtSec = tB - tA;
    const sogKn: number | null = fpA?.speed ?? null;
    const lowerSec = GAP.lowerThresholdSec(sogKn);
    const isShortGap = dtSec > lowerSec && dtSec <= GAP.SHORT_UPPER_SEC;
    const isLongGap  = dtSec > GAP.SHORT_UPPER_SEC && dtSec <= GAP.LONG_SEC;
    const isTooLong  = dtSec > GAP.LONG_SEC;
    // Fallback to green — see PREDICTION auto-green cases in trackRules.ts.
    const color = fpB?.prediction_color ?? "#00e676";

    if (isTooLong) {
      // > 20 min = new track. Reset accumulator + colour so the next segment
      // starts fresh with a chevron.
      cumDistM = DIRECTION.SPACING_M;
      prevColor = null;
      continue;
    }
    if (isShortGap || isLongGap) {
      // No chevron on gap dashes — but don't reset the accumulator: the
      // visual rhythm continues across short silences.
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: {
          type: isLongGap ? "gap-long" : "gap",
          prediction_color: isLongGap ? GAP.LONG_COLOR : GAP.SHORT_COLOR,
          from_t: fpA?.recorded_at ?? null,
          to_t:   fpB?.recorded_at ?? null,
          mmsi:   fpA?.mmsi ?? null,
        },
      });
    } else {
      // One feature per waypoint-to-waypoint segment — no subdivision.
      // (Subdivision caused tile-boundary fragmentation at low zoom.)
      const segLen = segmentLengthM(from, to);
      cumDistM += segLen;
      const colorChanged = DIRECTION.FIRE_ON_COLOR_CHANGE
        && prevColor != null
        && color !== prevColor;
      const showChevron = (cumDistM >= DIRECTION.SPACING_M || colorChanged) ? 1 : 0;
      if (showChevron) cumDistM = 0;
      prevColor = color;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: {
          type: "line",
          prediction_color: color,
          chevron:  showChevron,
          from_t: fpA?.recorded_at ?? null,
          to_t:   fpB?.recorded_at ?? null,
          mmsi:   fpA?.mmsi ?? null,
        },
      });
    }
  }

  if (livePosition?.updated_at && filtered.length > 0) {
    const lastPt   = filtered[filtered.length - 1];
    const lastT    = new Date((lastPt.properties as any)?.recorded_at ?? 0).getTime() / 1000;
    const liveT    = new Date(livePosition.updated_at).getTime() / 1000;
    const dtSec    = liveT - lastT;
    if (dtSec > 10) {
      const fromCoord = (lastPt.geometry as GeoJSON.Point).coordinates;
      const toCoord   = [livePosition.lon, livePosition.lat];
      const lastSog: number | null = (lastPt.properties as any)?.speed ?? null;
      // Connecting line only when gap ≤ 20 min — above 20 min = new track
      if (dtSec <= GAP.LONG_SEC) {
        const isLongGap  = dtSec > GAP.SHORT_UPPER_SEC;
        const isShortGap = dtSec > GAP.lowerThresholdSec(lastSog) && !isLongGap;
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [fromCoord, toCoord] },
          properties: isLongGap
            ? { type: "gap-long", prediction_color: GAP.LONG_COLOR }
            : isShortGap
            ? { type: "gap",      prediction_color: GAP.SHORT_COLOR }
            : { type: "line",     prediction_color: "#00e676",
                chevron:  1 }, // live connector → always show direction arrow
        });
      }
      const liveProps: Record<string, unknown> = {
        mmsi: livePosition.mmsi, recorded_at: livePosition.updated_at,
        prediction_color: "#00e676", live: true, seq: filtered.length + 1,
      };
      if (livePosition.sog  != null) liveProps.speed   = livePosition.sog;
      if (livePosition.cog  != null) liveProps.course  = livePosition.cog;
      if (livePosition.heading != null) liveProps.heading = livePosition.heading;
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: toCoord }, properties: liveProps });
    }
  }

  // COG is shown via icon-rotate directly on waypoint points — no extra geometry
  return { type: "FeatureCollection", features };
}

function fmtEndpointTime(iso: string | null): string {
  if (!iso) return "";
  // Local time only (matches TimeSlider). Full UTC + tz precision is in the Track Inspector.
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function buildEndpointGeoJSON(
  points: GeoJSON.Feature[],
  timeRange: [number, number] | null | undefined,
): GeoJSON.FeatureCollection {
  const filtered = filterPoints(points, timeRange);
  if (filtered.length === 0) return { type: "FeatureCollection", features: [] };

  // FROM / TO rule — see ENDPOINTS in trackRules.ts.
  const features: GeoJSON.Feature[] = [];

  const first = filtered[0];
  features.push({
    type: "Feature",
    geometry: first.geometry,
    properties: {
      role: "start",
      role_label: "FROM",
      time_label: fmtEndpointTime((first.properties as any)?.recorded_at),
    },
  });

  if (filtered.length > 1) {
    const last = filtered[filtered.length - 1];
    features.push({
      type: "Feature",
      geometry: last.geometry,
      properties: {
        role: "end",
        role_label: "TO",
        time_label: fmtEndpointTime((last.properties as any)?.recorded_at),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

// ─── component ───────────────────────────────────────────────────────────────


export default function TrackLayer({
  selectedMmsi, onClear, onHover, onWaypointClick,
  timeRange, onTimeBounds, onWaypointTimes, onWaypointSpeeds, onWaypointColors, focusedTime,
  replayMode, livePosition, voyageMode = false, windowStartMs,
  voyageRange, onVoyageLoaded, douglasMode = false,
  showLine = true, showDots = false,
}: Props) {
  const map = useMap();
  const initializedRef    = useRef(false);
  const allPointsRef      = useRef<GeoJSON.Feature[]>([]);
  // Bumped when a fresh fetchTrack finishes. Triggers the single render effect
  // below together with timeRange — ensures the track is only painted when both
  // data AND time-filter are in sync (prevents the "long green/yellow flash"
  // where 7 days of points were briefly painted with a stale or null filter
  // before the parent's onTimeBounds callback narrowed timeRange).
  const [dataVersion, setDataVersion] = useState(0);

  // Stable refs so event handlers always see latest values
  const onWpClickRef    = useRef(onWaypointClick);
  const replayModeRef   = useRef(replayMode);
  const onHoverRef      = useRef(onHover);
  const timeRangeRef    = useRef(timeRange);
  const livePositionRef = useRef(livePosition);

  useEffect(() => { onWpClickRef.current    = onWaypointClick; }, [onWaypointClick]);
  useEffect(() => { replayModeRef.current   = replayMode;      }, [replayMode]);
  useEffect(() => { onHoverRef.current      = onHover;         }, [onHover]);
  useEffect(() => { timeRangeRef.current    = timeRange;       }, [timeRange]);
  useEffect(() => { livePositionRef.current = livePosition;    }, [livePosition]);

  // ── init: add sources + layers once ────────────────────────────────────────
  useEffect(() => {
    if (!map || initializedRef.current) return;
    initializedRef.current = true;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource(SOURCE,          { type: "geojson", data: empty });
    map.addSource(FOCUS_SOURCE,    { type: "geojson", data: empty });
    map.addSource(ENDPOINT_SOURCE, { type: "geojson", data: empty });

    // ── Douglas D·P overlay ──────────────────────────────────────────────────
    if (!map.getSource(DOUGLAS_SOURCE)) {
      map.addSource(DOUGLAS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!map.getLayer(DOUGLAS_LINE_LYR)) {
      map.addLayer({ id: DOUGLAS_LINE_LYR, type: "line", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "line"],
        paint: { "line-color": "#f59e0b", "line-width": 2.5, "line-opacity": 0.9 },
        layout: { visibility: "none" },
      });
    }
    // Short gap (5–10 min silent) — dense dashed, matches LAYER_GAP on LINE
    if (!map.getLayer(DOUGLAS_GAP_LYR)) {
      map.addLayer({ id: DOUGLAS_GAP_LYR, type: "line", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "gap"],
        paint: {
          "line-color":     GAP.SHORT_COLOR,
          "line-width":     LINE_STYLE.gap.width,
          "line-opacity":   LINE_STYLE.gap.opacity,
          "line-dasharray": LINE_STYLE.gap.dash!,
        },
        layout: { visibility: "none" },
      });
    }
    // Long gap (10–20 min silent) — sparse dashed, matches LAYER_GAP_LONG on LINE
    if (!map.getLayer(DOUGLAS_GAP_LONG_LYR)) {
      map.addLayer({ id: DOUGLAS_GAP_LONG_LYR, type: "line", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "gap-long"],
        paint: {
          "line-color":     GAP.LONG_COLOR,
          "line-width":     LINE_STYLE.gap_long.width,
          "line-opacity":   LINE_STYLE.gap_long.opacity,
          "line-dasharray": LINE_STYLE.gap_long.dash!,
        },
        layout: { visibility: "none" },
      });
    }
    if (!map.getLayer(DOUGLAS_DOT_LYR)) {
      map.addLayer({ id: DOUGLAS_DOT_LYR, type: "circle", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "dot"],
        paint: { "circle-radius": 5, "circle-color": "#f59e0b", "circle-stroke-width": 2, "circle-stroke-color": "#020a12" },
        layout: { visibility: "none" },
      });
    }
    if (!map.getLayer("track-dp-labels")) {
      map.addLayer({ id: "track-dp-labels", type: "symbol", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "dot"],
        layout: {
          visibility: "none",
          "text-field": ["get", "label"],
          "text-size": 10, "text-offset": [1.2, 0], "text-anchor": "left",
        },
        paint: { "text-color": "#f59e0b", "text-halo-color": "#020a12", "text-halo-width": 1 },
      });
    }
    if (!map.getLayer(DOUGLAS_HIT_LYR)) {
      map.addLayer({ id: DOUGLAS_HIT_LYR, type: "line", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "line"],
        paint: { "line-color": "rgba(0,0,0,0)", "line-width": 16 },
        layout: { visibility: "none" },
      });
    }

    // ── route lines ───────────────────────────────────────────────────────────
    map.addLayer({
      id: LAYER_LINE, type: "line", source: SOURCE,
      filter: ["==", ["get", "type"], "line"],
      paint: {
        "line-color":   ["coalesce", ["get", "prediction_color"], "#00e676"],
        "line-width":   LINE_STYLE.normal.width,
        "line-opacity": LINE_STYLE.normal.opacity,
      },
    });

    // ── direction chevrons — forward-pointing arrows along the line ──────────
    // Placement rules: see DIRECTION in trackRules.ts. buildGeoJSON marks
    // eligible segments with `chevron: 1`; we filter on that here.
    // Added BEFORE gap layers so gap-dashes render on top on any overlap.
    if (!map.hasImage("track-chevron")) {
      const size = DIRECTION.ICON_SIZE_PX;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.strokeStyle = "#FFFFFF"; // SDF: tinted via icon-color at layer level
      ctx.lineWidth = size * DIRECTION.STROKE_FRACTION;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(size * 0.32, size * 0.24);
      ctx.lineTo(size * 0.72, size * 0.50);
      ctx.lineTo(size * 0.32, size * 0.76);
      ctx.stroke();
      try {
        const imgData = ctx.getImageData(0, 0, size, size);
        map.addImage(
          "track-chevron",
          { width: size, height: size, data: imgData.data },
          { pixelRatio: 2, sdf: true },
        );
      } catch (e) {
        console.error("track-chevron sprite load failed:", e);
      }
    }
    map.addLayer({
      id: LAYER_DIR, type: "symbol", source: SOURCE,
      filter: ["all",
        ["==", ["get", "type"], "line"],
        ["==", ["number", ["get", "chevron"], 0], 1],
      ],
      layout: {
        "symbol-placement": "line-center",
        "icon-image": "track-chevron",
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          ...DIRECTION.ICON_SIZE_BY_ZOOM.flatMap(([z, s]) => [z, s]),
        ],
        "icon-rotate": 0,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-color": ["coalesce", ["get", "prediction_color"], "#00e676"],
        "icon-opacity": 0.88,
      },
    });

    map.addLayer({
      id: LAYER_GAP, type: "line", source: SOURCE,
      filter: ["==", ["get", "type"], "gap"],
      paint: {
        "line-color":     ["coalesce", ["get", "prediction_color"], GAP.SHORT_COLOR],
        "line-width":     LINE_STYLE.gap.width,
        "line-opacity":   LINE_STYLE.gap.opacity,
        "line-dasharray": LINE_STYLE.gap.dash,
      },
    });

    map.addLayer({
      id: LAYER_GAP_LONG, type: "line", source: SOURCE,
      filter: ["==", ["get", "type"], "gap-long"],
      paint: {
        "line-color":     ["coalesce", ["get", "prediction_color"], GAP.LONG_COLOR],
        "line-width":     LINE_STYLE.gap_long.width,
        "line-opacity":   LINE_STYLE.gap_long.opacity,
        "line-dasharray": LINE_STYLE.gap_long.dash,
      },
    });

    // Wide transparent hit area — makes line easy to click
    map.addLayer({
      id: LAYER_LINE_HIT, type: "line", source: SOURCE,
      filter: ["in", ["get", "type"], ["literal", ["line", "gap", "gap-long"]]],
      paint: {
        "line-color":   "rgba(255,255,255,0.001)",
        "line-width":   20,
        "line-opacity": 1,
      },
    });

    // ── waypoint detail layers (hidden initially in line mode) ────────────────
    map.addLayer({
      id: LAYER_RING, type: "circle", source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "speed"]],
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 9,
        "circle-color": ["case", ["boolean", ["get", "live"], false], "#00e676", "rgba(0,0,0,0)"],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": ["coalesce", ["get", "prediction_color"], "#00e676"],
      },
    });

    map.addLayer({
      id: LAYER_DOTS, type: "circle", source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "mmsi"], ["!", ["boolean", ["get", "live"], false]]],
      layout: { visibility: "none" },
      paint: { "circle-radius": 3, "circle-color": "#ffffff", "circle-opacity": 0.9 },
    });

    map.addLayer({
      id: LAYER_FOCUS, type: "circle", source: FOCUS_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 9, "circle-color": "#f59e0b",
        "circle-stroke-width": 2, "circle-stroke-color": "#020a12", "circle-opacity": 1,
      },
    });

    map.addLayer({
      id: LAYER_SOG, type: "symbol", source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "seq"]],
      layout: {
        visibility: "none",
        "text-field": ["to-string", ["get", "seq"]],
        "text-size": 10, "text-offset": [1.4, -0.1], "text-anchor": "left",
        "text-allow-overlap": true, "text-ignore-placement": true,
      },
      paint: { "text-color": ["coalesce", ["get", "prediction_color"], "#00e676"] },
    });

    // COG sprite — SDF triangle på toppen af canvas, roteres efter course.
    // SDF = GPU-renderede vektor-skarpe kanter ved alle zoom-niveauer, samme
    // kvalitet som MapLibre's native circle-lag. Tintes via icon-color.
    if (!map.hasImage("cog-arrow")) {
      const size = 80;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const cx = size / 2, cy = size / 2;
      const r = 28;
      ctx.fillStyle = "#FFFFFF"; // SDF → tintes via icon-color på layer
      ctx.beginPath();
      ctx.moveTo(cx, cy - r - 10);   // top-spids (+1px display-px)
      ctx.lineTo(cx - 8, cy - r + 2);
      ctx.lineTo(cx + 8, cy - r + 2);
      ctx.closePath();
      ctx.fill();
      try {
        const imgData = ctx.getImageData(0, 0, size, size);
        map.addImage("cog-arrow",
          { width: size, height: size, data: imgData.data },
          { pixelRatio: 2, sdf: true });
      } catch (e) { console.error("COG sprite load failed:", e); }
    }
    map.addLayer({
      id: LAYER_COG, type: "symbol", source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "course"], [">=", ["number", ["get", "speed"], 0], 0.5]],
      layout: {
        visibility: "none",
        "icon-image": "cog-arrow",
        "icon-rotate": ["get", "course"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"],
          13, 0.4,
          17, 0.8,
          19, 1.0,
        ],
      },
      paint: {
        "icon-color": "#ffffff",
        "icon-opacity": 1,
      },
    });

    // ── endpoint markers (FROM / TO) ──────────────────────────────────────────
    map.addLayer({
      id: LAYER_ENDPOINT_DOTS, type: "circle", source: ENDPOINT_SOURCE,
      layout: { visibility: "visible" },
      paint: {
        "circle-radius": 7,
        // FROM = hollow (dark fill + white ring), TO = solid white
        "circle-color": [
          "case", ["==", ["get", "role"], "start"],
          "rgba(6,13,26,0.92)",
          "#ffffff",
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    map.addLayer({
      id: LAYER_ENDPOINT_LABELS, type: "symbol", source: ENDPOINT_SOURCE,
      layout: {
        visibility: "visible",
        // Dash-prefix style, anchored to the right of the dot — same convention as
        // vessel name labels. Keeps the label off the line itself.
        "text-field": ["concat", "─ ", ["get", "role_label"], " ", ["get", "time_label"]],
        "text-size": 10,
        "text-offset": [0.9, 0],
        "text-anchor": "left",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#c8dce8",
        "text-halo-color": "#060d1a",
        "text-halo-width": 1.5,
      },
    });

    // ── event handlers ────────────────────────────────────────────────────────
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Waypoint dot click → set focus marker (both live and replay)
      const wpDotHit = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOTS] });
      if (wpDotHit.length) {
        const ra = (wpDotHit[0].properties as any)?.recorded_at;
        if (ra && onWpClickRef.current) onWpClickRef.current(new Date(ra).getTime());
        return;
      }

      // Ring / focus dot click → set focus marker
      const ringHit = map.queryRenderedFeatures(e.point, { layers: [LAYER_RING, LAYER_FOCUS] });
      if (ringHit.length) {
        const ra = (ringHit[0].properties as any)?.recorded_at;
        if (ra && onWpClickRef.current) onWpClickRef.current(new Date(ra).getTime());
        return;
      }

      // Clicking the line does NOTHING.

      // Click on empty space (not on any vessel dot) → deselect and clear track.
      // Works in both live and replay mode.
      const liveDotHit   = map.getLayer("vessel-dots")  ? map.queryRenderedFeatures(e.point, { layers: ["vessel-dots"]  }) : [];
      const replayDotHit = map.getLayer("replay-dots")  ? map.queryRenderedFeatures(e.point, { layers: ["replay-dots"]  }) : [];
      const trackLineHit = map.queryRenderedFeatures(e.point, { layers: [LAYER_LINE_HIT, LAYER_LINE, LAYER_GAP, LAYER_GAP_LONG] });

      if (!liveDotHit.length && !replayDotHit.length && !trackLineHit.length) {
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
        onClear();
      }
    };
    map.on("click", handleClick);

    // ── line hover: shows exact or interpolated timestamp ─────────────────────
    const WAYPOINT_PX = 14; // pixel radius to snap to an exact waypoint endpoint

    const handleLineHover = (e: maplibregl.MapMouseEvent) => {
      // Set cursor immediately — we know we're on the line because this event fired on LAYER_LINE_HIT.
      // Do NOT rely on queryRenderedFeatures for cursor state: the qRF result can be empty in the
      // same frame the event fires (sub-pixel timing), which would cause the flicker the user sees.
      map.getCanvas().style.cursor = "pointer";

      // If the cursor is over a dot, defer to the dot handler
      const wpHit = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOTS, LAYER_RING] });
      if (wpHit.length) return;

      // Get feature data for the tooltip (best-effort — don't reset cursor if empty)
      const lineFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_LINE_HIT, LAYER_LINE, LAYER_GAP, LAYER_GAP_LONG] });
      if (!lineFeatures.length) return; // No feature data this frame — keep cursor, skip tooltip

      const feat = lineFeatures[0];
      const fp   = feat.properties as any;
      const fromT: string | null = fp?.from_t ?? null;
      const toT:   string | null = fp?.to_t   ?? null;
      const mmsi:  number | null = fp?.mmsi   ?? null;

      if (!fromT || !toT) return;

      // Get segment coordinates from geometry (LineString with exactly 2 points)
      const geomCoords = (feat.geometry as GeoJSON.LineString).coordinates;
      if (geomCoords.length < 2) return;
      const fromCoord = geomCoords[0];
      const toCoord   = geomCoords[geomCoords.length - 1];

      // Project segment endpoints to screen space
      const fromPx = map.project([fromCoord[0], fromCoord[1]]);
      const toPx   = map.project([toCoord[0],   toCoord[1]]);
      const mx = e.point.x, my = e.point.y;

      const distFrom = Math.hypot(fromPx.x - mx, fromPx.y - my);
      const distTo   = Math.hypot(toPx.x   - mx, toPx.y   - my);

      // ── exact waypoint snap ───────────────────────────────────────────────
      const snapT = distFrom < WAYPOINT_PX ? fromT : (distTo < WAYPOINT_PX ? toT : null);
      if (snapT) {
        const wp = allPointsRef.current.find((f) => (f.properties as any)?.recorded_at === snapT);
        if (wp) {
          const p = wp.properties as any;
          const wc = (wp.geometry as GeoJSON.Point).coordinates;
          onHoverRef.current({
            x: e.originalEvent.clientX, y: e.originalEvent.clientY,
            mmsi: p.mmsi ?? null,
            speed: p.speed != null ? Number(p.speed) : null,
            course: p.course != null ? Number(p.course) : null,
            heading: p.heading != null ? Number(p.heading) : null,
            recorded_at: p.recorded_at ?? null,
            lat: wc[1], lon: wc[0],
            sources: p.sources != null ? Number(p.sources) : null,
            interpolated: false,
          });
          return;
        }
      }

      // ── interpolated position along segment ───────────────────────────────
      const segDx = toPx.x - fromPx.x;
      const segDy = toPx.y - fromPx.y;
      const segLen2 = segDx * segDx + segDy * segDy;
      const dot  = (mx - fromPx.x) * segDx + (my - fromPx.y) * segDy;
      const frac = segLen2 > 0 ? Math.max(0, Math.min(1, dot / segLen2)) : 0.5;

      const tFrom = new Date(fromT).getTime();
      const tTo   = new Date(toT).getTime();
      const interpTime = tFrom + frac * (tTo - tFrom);
      const interpLat  = fromCoord[1] + frac * (toCoord[1] - fromCoord[1]);
      const interpLon  = fromCoord[0] + frac * (toCoord[0] - fromCoord[0]);

      onHoverRef.current({
        x: e.originalEvent.clientX, y: e.originalEvent.clientY,
        mmsi, speed: null, course: null, heading: null,
        recorded_at: new Date(interpTime).toISOString(),
        lat: interpLat, lon: interpLon, sources: null,
        interpolated: true,
      });
    };

    const handleLineLeave = () => { onHoverRef.current(null); map.getCanvas().style.cursor = ""; };

    // Only attach to LAYER_LINE_HIT — it covers the full 20px hit area for both
    // "line" and "gap" segment types. Attaching to LAYER_LINE/LAYER_GAP as well
    // causes cross-layer mouseleave/mousemove races that flicker the cursor.
    map.on("mousemove",  LAYER_LINE_HIT, handleLineHover);
    map.on("mouseleave", LAYER_LINE_HIT, handleLineLeave);

    // ── waypoint dot hover (when dots are visible) ────────────────────────────
    const handleWpMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOTS, LAYER_RING] });
      if (!features.length) { onHoverRef.current(null); map.getCanvas().style.cursor = ""; return; }
      map.getCanvas().style.cursor = "crosshair";
      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      onHoverRef.current({
        x: e.originalEvent.clientX, y: e.originalEvent.clientY,
        mmsi: p.mmsi ?? null, speed: p.speed != null ? Number(p.speed) : null,
        course: p.course != null ? Number(p.course) : null,
        heading: p.heading != null ? Number(p.heading) : null,
        recorded_at: p.recorded_at ?? null, lat: coords[1], lon: coords[0],
        sources: p.sources != null ? Number(p.sources) : null,
        interpolated: false,
      });
    };
    const handleWpLeave = () => { onHoverRef.current(null); };

    map.on("mousemove",  LAYER_DOTS, handleWpMove);
    map.on("mouseleave", LAYER_DOTS, handleWpLeave);
    map.on("mousemove",  LAYER_RING,  handleWpMove);
    map.on("mouseleave", LAYER_RING,  handleWpLeave);

    // ── Douglas D·P hover ────────────────────────────────────────────────────
    const handleDPHover = (e: maplibregl.MapMouseEvent) => {
      map.getCanvas().style.cursor = "crosshair";
      const lp = livePositionRef.current;
      onHoverRef.current({
        x: e.point.x, y: e.point.y,
        mmsi:        lp?.mmsi    ?? null,
        speed:       lp?.sog     ?? null,
        course:      lp?.cog     ?? null,
        heading:     lp?.heading ?? null,
        recorded_at: lp?.updated_at ?? null,
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
        sources: null,
        interpolated: true, // markerer at position er D·P gæt, ikke præcis waypoint
      });
    };
    const handleDPLeave = () => {
      map.getCanvas().style.cursor = "";
      onHoverRef.current(null);
    };
    map.on("mousemove",  DOUGLAS_HIT_LYR, handleDPHover);
    map.on("mouseleave", DOUGLAS_HIT_LYR, handleDPLeave);

    return () => {
      try {
        map.off("click", handleClick);
        map.off("mousemove",  LAYER_LINE_HIT, handleLineHover);
        map.off("mouseleave", LAYER_LINE_HIT, handleLineLeave);
        map.off("mousemove",  LAYER_DOTS, handleWpMove);
        map.off("mouseleave", LAYER_DOTS, handleWpLeave);
        map.off("mousemove",  LAYER_RING,  handleWpMove);
        map.off("mouseleave", LAYER_RING,  handleWpLeave);
        map.off("mousemove",  DOUGLAS_HIT_LYR, handleDPHover);
        map.off("mouseleave", DOUGLAS_HIT_LYR, handleDPLeave);

        [LAYER_ENDPOINT_LABELS, LAYER_ENDPOINT_DOTS, LAYER_FOCUS, LAYER_COG, LAYER_SOG,
         LAYER_RING, LAYER_DOTS, LAYER_DIR, LAYER_LINE_HIT, LAYER_GAP_LONG, LAYER_GAP, LAYER_LINE,
         DOUGLAS_LINE_LYR, DOUGLAS_GAP_LYR, DOUGLAS_GAP_LONG_LYR, DOUGLAS_DOT_LYR, "track-dp-labels", DOUGLAS_HIT_LYR].forEach((id) => {
          if (map.getLayer(id)) map.removeLayer(id);
        });
        [ENDPOINT_SOURCE, FOCUS_SOURCE, SOURCE, DOUGLAS_SOURCE].forEach((id) => {
          if (map.getSource(id)) map.removeSource(id);
        });
      } catch { /* map already destroyed */ }
      initializedRef.current = false;
    };
  }, [map]);

  // ── toggle layer visibility + colors ──────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const lineVis = (showLine || showDots) ? "visible" : "none";
    const dotsVis = showDots ? "visible" : "none";

    [LAYER_RING, LAYER_SOG, LAYER_COG].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", dotsVis);
    });
    if (map.getLayer(LAYER_FOCUS)) map.setLayoutProperty(LAYER_FOCUS, "visibility", "visible");
    if (map.getLayer(LAYER_DOTS)) {
      map.setLayoutProperty(LAYER_DOTS, "visibility", voyageMode ? "none" : dotsVis);
      if (showDots && !voyageMode) {
        map.setPaintProperty(LAYER_DOTS, "circle-radius", 2);
        map.setPaintProperty(LAYER_DOTS, "circle-opacity",
          ["interpolate", ["linear"], ["zoom"], 13, 0, 15, 0.55]);
      }
    }
    [LAYER_LINE, LAYER_GAP, LAYER_GAP_LONG, LAYER_LINE_HIT, LAYER_DIR].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", lineVis);
    });
    [LAYER_ENDPOINT_DOTS, LAYER_ENDPOINT_LABELS].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", lineVis);
    });
    if (map.getLayer(LAYER_LINE)) {
      // Prediction colour in both line-only and WP modes (see trackRules.ts).
      // voyageMode overrides to flat amber — deliberate historic macro view.
      map.setPaintProperty(LAYER_LINE, "line-color",
        voyageMode ? "#f59e0b"
                   : ["coalesce", ["get", "prediction_color"], "#00e676"]);
      map.setPaintProperty(LAYER_LINE, "line-width",   voyageMode ? 3.0  : LINE_STYLE.normal.width);
      map.setPaintProperty(LAYER_LINE, "line-opacity", voyageMode ? 0.95 : 0.78);
    }
    if (map.getLayer(LAYER_GAP)) {
      map.setPaintProperty(LAYER_GAP, "line-color",   ["coalesce", ["get", "prediction_color"], GAP.SHORT_COLOR]);
      map.setPaintProperty(LAYER_GAP, "line-opacity", voyageMode ? 0.35 : LINE_STYLE.gap.opacity);
    }
    if (map.getLayer(LAYER_GAP_LONG)) {
      map.setPaintProperty(LAYER_GAP_LONG, "line-color",   ["coalesce", ["get", "prediction_color"], GAP.LONG_COLOR]);
      map.setPaintProperty(LAYER_GAP_LONG, "line-opacity", voyageMode ? 0.25 : LINE_STYLE.gap_long.opacity);
    }
    if (map.getLayer(LAYER_DIR)) {
      // Chevron colour follows the line (voyage = flat amber, else prediction).
      map.setPaintProperty(LAYER_DIR, "icon-color",
        voyageMode ? "#f59e0b"
                   : ["coalesce", ["get", "prediction_color"], "#00e676"]);
    }
    [DOUGLAS_LINE_LYR, DOUGLAS_GAP_LYR, DOUGLAS_GAP_LONG_LYR, DOUGLAS_DOT_LYR, "track-dp-labels", DOUGLAS_HIT_LYR].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }, [map, voyageMode, showLine, showDots]);

  // ── fetch track when vessel or voyageRange changes ───────────────────────────
  useEffect(() => {
    if (!map) return;

    // Clear the source IMMEDIATELY on selection change — before the async fetch
    // starts. Otherwise the previous vessel's track stays painted for the ~200-
    // 500 ms of the RPC roundtrip, which is the "flash of a longer route" bug.
    // Also resets dataVersion so the single render effect below drops to empty
    // until fresh points + a fresh timeRange are both in hand.
    allPointsRef.current = [];
    (map.getSource(SOURCE)          as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
    (map.getSource(ENDPOINT_SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
    setDataVersion(v => v + 1);

    if (!selectedMmsi) return;

    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;

    async function fetchTrack() {
      let data: any;
      let error: any;

      if (voyageRange) {
        // ── Historical / voyage mode: use absolute timestamps ────────────────
        const p_start = new Date(voyageRange[0]).toISOString();
        const p_end   = new Date(voyageRange[1]).toISOString();
        const res = await supabase.rpc("get_vessel_track_range", {
          p_mmsi: selectedMmsi, p_start, p_end,
        });
        data  = res.data;
        error = res.error;
      } else {
        // ── Live mode: use relative minutes from now ─────────────────────────
        const now = Date.now();
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60_000;
        const windowStart = windowStartMs ? windowStartMs : now - SEVEN_DAYS_MS;
        const p_minutes = Math.max(60, Math.ceil((now - windowStart) / 60_000));
        const res = await supabase.rpc("get_vessel_track", { p_mmsi: selectedMmsi, p_minutes });
        data  = res.data;
        error = res.error;
      }

      if (cancelled || error || !data || !map) return;

      const geojson = typeof data === "string" ? JSON.parse(data) : data;
      const points: GeoJSON.Feature[] = (geojson.features ?? []).filter(
        (f: GeoJSON.Feature) => f.geometry?.type === "Point" && (f.properties as any)?.mmsi != null,
      );
      points.sort((a, b) => {
        const ta = (a.properties as any)?.recorded_at ?? "";
        const tb = (b.properties as any)?.recorded_at ?? "";
        return ta < tb ? -1 : 1;
      });
      points.forEach((f, i) => { (f.properties as any).seq = i + 1; });
      allPointsRef.current = points;

      if (points.length >= 2) {
        const tFirst = new Date((points[0].properties as any)?.recorded_at).getTime();
        const tLast  = new Date((points[points.length - 1].properties as any)?.recorded_at).getTime();
        if (!isNaN(tFirst) && !isNaN(tLast)) {
          if (onTimeBounds) onTimeBounds([tFirst, tLast]);
          if (onWaypointTimes || onWaypointSpeeds || onWaypointColors) {
            const times: number[] = [];
            const speeds: (number | null)[] = [];
            const colors: (string | null)[] = [];
            for (const f of points) {
              const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
              if (isNaN(t)) continue;
              const s = (f.properties as any)?.speed;
              const c = (f.properties as any)?.prediction_color;
              times.push(t);
              speeds.push(s == null ? null : Number(s));
              colors.push(typeof c === "string" && c ? c : null);
            }
            if (onWaypointTimes)  onWaypointTimes(times);
            if (onWaypointSpeeds) onWaypointSpeeds(speeds);
            if (onWaypointColors) onWaypointColors(colors);
          }
        }
      }

      if (voyageRange && onVoyageLoaded) onVoyageLoaded(points.length);

      // Don't setData here. The single render effect below owns painting —
      // it fires when BOTH dataVersion (bumped below) and timeRange (set by
      // parent's handleTimeBounds response to onTimeBounds above) are ready.
      setDataVersion(v => v + 1);
    }

    fetchTrack();
    // Only poll in live mode — historical data doesn't change
    if (!voyageRange) pollId = setInterval(fetchTrack, 30_000);
    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, [map, selectedMmsi, voyageRange]);

  // ── Douglas D·P overlay ──────────────────────────────────────────────────
  // Mirrors the LINE layer's 4-segment model:
  //   solid   — dt < GAP.lowerThresholdSec (default 5 min)
  //   gap     — dt ∈ [5 min, 10 min]         → dense dashed (GAP.SHORT_COLOR)
  //   gap-long— dt ∈ [10 min, 20 min]        → sparse dashed (GAP.LONG_COLOR)
  //   blank   — dt > 20 min                   → no line drawn (visual break)
  //
  // Inter-segment gaps are always "blank" because build_segment_track splits
  // on gap_sec = 1800 s, i.e. ≥ 30 min — always beyond GAP.LONG_SEC.
  useEffect(() => {
    if (!map) return;

    const LYRS = [DOUGLAS_LINE_LYR, DOUGLAS_GAP_LYR, DOUGLAS_GAP_LONG_LYR, DOUGLAS_DOT_LYR, "track-dp-labels", DOUGLAS_HIT_LYR];
    const vis = douglasMode ? "visible" : "none";
    LYRS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis); });

    if (!douglasMode || !selectedMmsi) return;

    const tr = timeRangeRef.current;
    const params: Record<string, unknown> = { p_mmsi: selectedMmsi };
    if (tr) { params.p_start = tr[0] / 1000; params.p_end = tr[1] / 1000; }

    supabase.rpc("get_track_geojson_segments", params).then((res: any) => {
      if (!res?.data) return;
      let raw = res.data;
      if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { return; }
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { return; }
      raw = raw ?? {};

      const segments: Array<{ coords: [number, number, number, number][]; t_start: number; t_end: number }> =
        (raw.segments ?? []).map((s: any) => ({
          coords: s.coords as [number, number, number, number][],
          t_start: Number(s.t_start),
          t_end:   Number(s.t_end),
        })).filter((s: any) => Array.isArray(s.coords) && s.coords.length >= 2);

      if (segments.length === 0) {
        (map.getSource(DOUGLAS_SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
        return;
      }

      const fmtT = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
      const features: GeoJSON.Feature[] = [];

      // Classify each consecutive pair of D·P points inside a segment.
      // Between segments: no feature pushed → visually blank (matches LINE "> 20 min" rule).
      const classify = (dtSec: number): "solid" | "gap" | "gap-long" | "blank" => {
        const lower = GAP.lowerThresholdSec(null);
        if (dtSec < lower)                   return "solid";
        if (dtSec <= GAP.SHORT_UPPER_SEC)    return "gap";
        if (dtSec <= GAP.LONG_SEC)           return "gap-long";
        return "blank";
      };

      for (const seg of segments) {
        const pts = seg.coords;
        let solidRun: [number, number][] = [[pts[0][0], pts[0][1]]];

        const flushSolid = () => {
          if (solidRun.length >= 2) {
            features.push({ type: "Feature", properties: { t: "line" },
              geometry: { type: "LineString", coordinates: solidRun } });
          }
          solidRun = [];
        };

        for (let i = 0; i < pts.length - 1; i++) {
          const [lon1, lat1, , t1] = pts[i];
          const [lon2, lat2, , t2] = pts[i + 1];
          const kind = classify(Math.max(0, t2 - t1));
          if (kind === "solid") {
            solidRun.push([lon2, lat2]);
          } else if (kind === "blank") {
            // No line; end current solid run, start fresh at next point.
            flushSolid();
            solidRun = [[lon2, lat2]];
          } else {
            // "gap" or "gap-long" — emit a single-segment dashed feature.
            flushSolid();
            features.push({ type: "Feature", properties: { t: kind },
              geometry: { type: "LineString", coordinates: [[lon1, lat1], [lon2, lat2]] } });
            solidRun = [[lon2, lat2]];
          }
        }
        flushSolid();
      }

      // FROM = first D·P point of first segment. TO = last D·P point of last segment.
      const first = segments[0].coords[0];
      const lastSeg = segments[segments.length - 1].coords;
      const last  = lastSeg[lastSeg.length - 1];
      features.push(
        { type: "Feature", properties: { t: "dot", label: `FROM ${fmtT(tr ? tr[0]/1000 : first[3])}` },
          geometry: { type: "Point", coordinates: [first[0], first[1]] } },
        { type: "Feature", properties: { t: "dot", label: `TO ${fmtT(tr ? tr[1]/1000 : last[3])}` },
          geometry: { type: "Point", coordinates: [last[0], last[1]] } },
      );

      (map.getSource(DOUGLAS_SOURCE) as maplibregl.GeoJSONSource)?.setData({
        type: "FeatureCollection", features,
      });
    });
  }, [map, douglasMode, selectedMmsi, timeRange]);

  // ── single render effect: data + timeRange together ─────────────────────────
  // The SOURCE is the single source of truth for what's painted. We only paint
  // when BOTH the points (dataVersion) and the filter (timeRange) are ready —
  // otherwise we leave the source empty. This is what kills the "long track
  // flash on click": no premature render with stale/null filter.
  useEffect(() => {
    if (!map || !map.getSource(SOURCE)) return;
    const points = allPointsRef.current;
    const src    = map.getSource(SOURCE)          as maplibregl.GeoJSONSource;
    const epSrc  = map.getSource(ENDPOINT_SOURCE) as maplibregl.GeoJSONSource;
    if (!points.length || !timeRange) {
      src?.setData({ type: "FeatureCollection", features: [] });
      epSrc?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src?.setData(buildGeoJSON(points, timeRange, livePositionRef.current, map.getZoom()));
    epSrc?.setData(buildEndpointGeoJSON(points, timeRange));
  }, [map, timeRange, dataVersion]);


  // ── focused position — interpolated, not snapped ──────────────────────────
  // The drawn line is already an interpolation between waypoints; the grey
  // dashed gap is too. Showing the orange dot at the exact slider position
  // (linearly interpolated between the two surrounding waypoints) is no less
  // honest than the line itself.
  useEffect(() => {
    if (!map || !map.getSource(FOCUS_SOURCE)) return;
    const focusSrc = map.getSource(FOCUS_SOURCE) as maplibregl.GeoJSONSource;
    const pts = allPointsRef.current;
    if (focusedTime == null || !pts.length) {
      focusSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    // Only interpolate within the visible (filtered) window so the dot never
    // overshoots the TO endpoint by referencing a waypoint beyond timeRange.
    const tr = timeRangeRef.current;
    const visiblePts = tr
      ? pts.filter((f) => {
          const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
          return t >= tr[0] && t <= tr[1];
        })
      : pts;

    // Find the two waypoints that bracket focusedTime
    let before: GeoJSON.Feature | null = null;
    let after:  GeoJSON.Feature | null = null;
    for (const f of visiblePts) {
      const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
      if (t <= focusedTime) before = f;
      if (t >= focusedTime && after === null) after = f;
    }
    if (!before) before = after;
    if (!after)  after  = before;
    if (!before) return;

    const tFrom = new Date((before!.properties as any)?.recorded_at ?? 0).getTime();
    const tTo   = new Date((after!.properties  as any)?.recorded_at ?? 0).getTime();
    const fromC = (before!.geometry as GeoJSON.Point).coordinates;
    const toC   = (after!.geometry  as GeoJSON.Point).coordinates;

    const frac = tTo > tFrom ? (focusedTime - tFrom) / (tTo - tFrom) : 0;
    const lon  = fromC[0] + frac * (toC[0] - fromC[0]);
    const lat  = fromC[1] + frac * (toC[1] - fromC[1]);

    focusSrc.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} }],
    });
  }, [map, focusedTime]);

  return null;
}
