"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";
import { GAP, LINE_STYLE } from "@/lib/trackRules";

const SOURCE        = "track";
const FOCUS_SOURCE  = "track-focus";
const ENDPOINT_SOURCE = "track-endpoints";

// Douglas-Peucker overlay — single source with feature types
const DOUGLAS_SOURCE   = "track-dp";
const DOUGLAS_LINE_LYR = "track-dp-line";
const DOUGLAS_DOT_LYR  = "track-dp-dots";
const DOUGLAS_HIT_LYR  = "track-dp-hit";

const LAYER_LINE    = "track-line";
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
 * Map a normalized fraction [0,1] of the visible track range to an HSL color.
 * fraction 0 = start of visible range, 1 = end. Hue spans 0–300° (red → magenta)
 * so we don't loop back to the same color. Constant saturation/lightness for
 * good contrast on the dark map background.
 *
 * Used in line mode to disentangle overlapping segments visited at different
 * times within the *currently shown* track window — not absolute time of day.
 */
function trackRangeColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  // Start green (120°), end purple (280°), going the LONG way around the
  // hue circle: green → yellow → orange → red → magenta → purple. 200° span,
  // covering most of the visible spectrum.
  const hue = ((120 - f * 200) % 360 + 360) % 360;
  return `hsl(${hue.toFixed(1)}, 72%, 60%)`;
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

  // ── Distance-weighted gradient ────────────────────────────────────────────
  // Pre-pass: measure each solid segment's geographic length so the colour
  // fraction is proportional to distance, not point count. Long stretches of
  // open water get more colour range than tight harbour manoeuvres.
  const approxDeg = (a: number[], b: number[]) => {
    const dx = (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180);
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  let totalSolidDist = 0;
  const segCount   = Math.max(0, filtered.length - 1);
  const segDist    = new Array<number>(segCount).fill(0);
  const segCumDist = new Array<number>(segCount).fill(0);
  for (let i = 0; i < filtered.length - 1; i++) {
    const fpAi = (filtered[i].properties as any);
    const fpBi = (filtered[i + 1].properties as any);
    const tAi  = new Date(fpAi?.recorded_at).getTime() / 1000;
    const tBi  = new Date(fpBi?.recorded_at).getTime() / 1000;
    const frm  = (filtered[i].geometry as GeoJSON.Point).coordinates;
    const too  = (filtered[i + 1].geometry as GeoJSON.Point).coordinates;
    segCumDist[i] = totalSolidDist;
    if ((tBi - tAi) <= GAP.lowerThresholdSec(fpAi?.speed ?? null)) {
      segDist[i] = approxDeg(frm, too);
      totalSolidDist += segDist[i];
    }
  }
  if (totalSolidDist === 0) totalSolidDist = 1;


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
    const isShortGap = dtSec > lowerSec && dtSec <= GAP.SHORT_UPPER_SEC; // 5-10 min
    const isLongGap  = dtSec > GAP.SHORT_UPPER_SEC && dtSec <= GAP.LONG_SEC; // 10-20 min
    const isTooLong  = dtSec > GAP.LONG_SEC; // > 20 min
    const color = fpB?.prediction_color ?? "#2ba8c8";

    if (isTooLong) {
      // > 20 min = vessel disappeared. Draw nothing — new track if vessel returns
      continue;
    }
    if (isShortGap || isLongGap) {
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
      // Subdivision caused tile-boundary fragmentation at low zoom.
      // Colour is based on the segment's cumulative distance position.
      const frac = segCumDist[i] / totalSolidDist;
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: {
          type: "line",
          prediction_color: color,
          time_color: trackRangeColor(frac),
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
            : { type: "line",     prediction_color: "#00e676" },
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

  // ENDPOINTS rule (see lib/trackRules.ts → ENDPOINTS):
  //   FROM = filtered[0]          — first waypoint in visible range
  //   TO   = filtered[length - 1] — last  waypoint in visible range
  // Every waypoint is a CRC-verified AIS fix; a gap before the last fix is a
  // reporting-rate gap, not a data-quality issue. The dashed line communicates
  // the gap — the TO marker stays on the actual last known position.

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
  timeRange, onTimeBounds, onWaypointTimes, focusedTime,
  replayMode, livePosition, voyageMode = false, windowStartMs,
  voyageRange, onVoyageLoaded, douglasMode = false,
  showLine = true, showDots = false,
}: Props) {
  const map = useMap();
  const initializedRef    = useRef(false);
  const allPointsRef      = useRef<GeoJSON.Feature[]>([]);

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
    // Gap segmenter — grå stiplet
    if (!map.getLayer("track-dp-gap")) {
      map.addLayer({ id: "track-dp-gap", type: "line", source: DOUGLAS_SOURCE,
        filter: ["==", ["get", "t"], "gap"],
        paint: {
          "line-color": "#5a8090",
          "line-width": 1.5,
          "line-opacity": 0.5,
          "line-dasharray": [3, 4],
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
        "line-color":   ["coalesce", ["get", "prediction_color"], "#2ba8c8"],
        "line-width":   LINE_STYLE.normal.width,
        "line-opacity": LINE_STYLE.normal.opacity,
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

    // COG sprite — ring med markering på toppen (roteres efter course)
    if (!map.hasImage("cog-arrow")) {
      const size = 80;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const cx = size / 2, cy = size / 2;
      const r = 28; // ring radius
      // Hvid trekant der peger udad fra centrum
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(cx, cy - r - 8);   // top-spids
      ctx.lineTo(cx - 6, cy - r + 2);
      ctx.lineTo(cx + 6, cy - r + 2);
      ctx.closePath();
      ctx.fill();

      const url = canvas.toDataURL();
      const img = new Image();
      img.onload = () => {
        if (!map.hasImage("cog-arrow")) {
          try { map.addImage("cog-arrow", img, { pixelRatio: 2 }); }
          catch (e) { console.error("COG sprite load failed:", e); }
        }
      };
      img.onerror = (e) => console.error("COG sprite image error:", e);
      img.src = url;
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
      paint: { "icon-opacity": 1 },
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
         LAYER_RING, LAYER_DOTS, LAYER_LINE_HIT, LAYER_GAP_LONG, LAYER_GAP, LAYER_LINE,
         DOUGLAS_LINE_LYR, DOUGLAS_DOT_LYR, "track-dp-labels", DOUGLAS_HIT_LYR].forEach((id) => {
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
    [LAYER_LINE, LAYER_GAP, LAYER_GAP_LONG, LAYER_LINE_HIT].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", lineVis);
    });
    [LAYER_ENDPOINT_DOTS, LAYER_ENDPOINT_LABELS].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", lineVis);
    });
    if (map.getLayer(LAYER_LINE)) {
      map.setPaintProperty(LAYER_LINE, "line-color",
        voyageMode ? "#f59e0b"
        : showDots ? ["coalesce", ["get", "prediction_color"], "#2ba8c8"]
        :            ["coalesce", ["get", "time_color"],       "#2ba8c8"]);
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
    ["track-dp-line", "track-dp-gap", "track-dp-dots", "track-dp-labels", "track-dp-hit"].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
    });
  }, [map, voyageMode, showLine, showDots]);

  // ── fetch track when vessel or voyageRange changes ───────────────────────────
  useEffect(() => {
    if (!map || !selectedMmsi) {
      allPointsRef.current = [];
      if (map) {
        (map.getSource(SOURCE)          as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
        (map.getSource(ENDPOINT_SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
      }
      return;
    }

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
          if (onWaypointTimes) {
            const times = points.map(f => new Date((f.properties as any)?.recorded_at ?? 0).getTime()).filter(t => !isNaN(t));
            onWaypointTimes(times);
          }
        }
      }

      if (voyageRange && onVoyageLoaded) onVoyageLoaded(points.length);

      const tr = timeRangeRef.current;
      (map.getSource(SOURCE)          as maplibregl.GeoJSONSource)?.setData(buildGeoJSON(points, tr, livePositionRef.current, map.getZoom()));
      (map.getSource(ENDPOINT_SOURCE) as maplibregl.GeoJSONSource)?.setData(buildEndpointGeoJSON(points, tr));
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
  useEffect(() => {
    if (!map) return;

    const LYRS = [DOUGLAS_LINE_LYR, "track-dp-gap", DOUGLAS_DOT_LYR, "track-dp-labels", DOUGLAS_HIT_LYR];
    const vis = douglasMode ? "visible" : "none";
    LYRS.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis); });

    if (!douglasMode || !selectedMmsi) return;

    // Fetch D·P track for current time window
    const tr = timeRangeRef.current;
    const params: Record<string, unknown> = { p_mmsi: selectedMmsi };
    if (tr) { params.p_start = tr[0] / 1000; params.p_end = tr[1] / 1000; }

    supabase.rpc("get_track_geojson", params).then((res: any) => {
      if (!res?.data) return;
      let raw = res.data;
      if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { return; }
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw === "string") try { raw = JSON.parse(raw); } catch { return; }
      raw = raw ?? {};

      const coords: [number, number, number, number][] = raw.coords ?? [];
      if (coords.length < 2) return;

      const fmtT = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

      // Gap-detection: brug gap_intervals fra RPC til at splitte i solid/gap segmenter
      const gaps: [number, number][] = raw.gaps ?? [];
      const isGap = (t1: number, t2: number) =>
        gaps.some(([gs, ge]) => gs < t2 && ge > t1);

      const features: GeoJSON.Feature[] = [];
      let solidRun: [number, number][] = [[coords[0][0], coords[0][1]]];

      for (let i = 0; i < coords.length - 1; i++) {
        const [lon1, lat1, , tStart] = coords[i];
        const [lon2, lat2, , tEnd]   = coords[i + 1];
        if (isGap(tStart, tEnd)) {
          if (solidRun.length >= 2) {
            features.push({ type: "Feature", properties: { t: "line" },
              geometry: { type: "LineString", coordinates: solidRun } });
          }
          solidRun = [];
          features.push({ type: "Feature", properties: { t: "gap" },
            geometry: { type: "LineString", coordinates: [[lon1, lat1], [lon2, lat2]] } });
        } else {
          solidRun.push([lon2, lat2]);
        }
      }
      if (solidRun.length >= 2) {
        features.push({ type: "Feature", properties: { t: "line" },
          geometry: { type: "LineString", coordinates: solidRun } });
      }

      // FROM/TO dots — brug første/sidste komprimerede punkt (matcher LINE positionelt)
      features.push(
        { type: "Feature", properties: { t: "dot", label: `FROM ${fmtT(tr ? tr[0]/1000 : coords[0][3])}` },
          geometry: { type: "Point", coordinates: [coords[0][0], coords[0][1]] } },
        { type: "Feature", properties: { t: "dot", label: `TO ${fmtT(tr ? tr[1]/1000 : coords[coords.length-1][3])}` },
          geometry: { type: "Point", coordinates: [coords[coords.length-1][0], coords[coords.length-1][1]] } },
      );

      (map.getSource(DOUGLAS_SOURCE) as maplibregl.GeoJSONSource)?.setData({
        type: "FeatureCollection", features,
      });
    });
  }, [map, douglasMode, selectedMmsi, timeRange]);

  // ── re-render when timeRange changes ───────────────────────────────────────
  useEffect(() => {
    if (!map || !map.getSource(SOURCE)) return;
    const points = allPointsRef.current;
    if (!points.length) return;
    (map.getSource(SOURCE)          as maplibregl.GeoJSONSource)?.setData(buildGeoJSON(points, timeRange, livePositionRef.current, map.getZoom()));
    (map.getSource(ENDPOINT_SOURCE) as maplibregl.GeoJSONSource)?.setData(buildEndpointGeoJSON(points, timeRange));
  }, [map, timeRange]);


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
