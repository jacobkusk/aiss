"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";
import { GAP, LINE_STYLE } from "@/lib/trackRules";

const SOURCE = "track";
const FOCUS_SOURCE = "track-focus";
const LAYER_LINE = "track-line";
const LAYER_DOTS = "track-dots";
const LAYER_RING = "track-rings";
const LAYER_SOG = "track-sog";
const LAYER_COG = "track-cog";
const LAYER_GAP   = "track-gap";
const LAYER_FOCUS = "track-focus-dot";

interface WaypointHover { x: number; y: number; mmsi: number | null; speed: number | null; course: number | null; heading: number | null; recorded_at: string | null; lat: number; lon: number; sources: number | null; }

interface LivePosition {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updated_at: string | null;
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
}

function buildGeoJSON(points: GeoJSON.Feature[], timeRange: [number, number] | null | undefined, livePosition?: LivePosition | null): GeoJSON.FeatureCollection {
  let filtered = points;
  if (timeRange) {
    filtered = points.filter((f) => {
      const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
      return t >= timeRange[0] && t <= timeRange[1];
    });
    filtered.forEach((f, i) => { (f.properties as any).seq = i + 1; });
  }

  const features: GeoJSON.Feature[] = [...filtered];

  // Emit line features
  for (let i = 0; i < filtered.length - 1; i++) {
    const from  = (filtered[i].geometry as GeoJSON.Point).coordinates;
    const to    = (filtered[i + 1].geometry as GeoJSON.Point).coordinates;
    const tA    = new Date((filtered[i].properties as any)?.recorded_at).getTime() / 1000;
    const tB    = new Date((filtered[i + 1].properties as any)?.recorded_at).getTime() / 1000;
    const isGap = (tB - tA) > GAP.THRESHOLD_SEC;
    const color = (filtered[i + 1].properties as any)?.prediction_color ?? "#2ba8c8";
    if (isGap) {
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [from, to] }, properties: { type: "gap", prediction_color: GAP.COLOR } });
    } else {
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [from, to] }, properties: { type: "line", prediction_color: color } });
    }
  }

  // Live position extension — draw line from last waypoint to current vessel position
  if (livePosition?.updated_at && filtered.length > 0) {
    const lastPt   = filtered[filtered.length - 1];
    const lastT    = new Date((lastPt.properties as any)?.recorded_at ?? 0).getTime() / 1000;
    const liveT    = new Date(livePosition.updated_at).getTime() / 1000;
    const dtSec    = liveT - lastT;
    if (dtSec > 10) {
      const fromCoord = (lastPt.geometry as GeoJSON.Point).coordinates;
      const toCoord   = [livePosition.lon, livePosition.lat];
      // Gap line (dashed purple if > threshold, solid green if recent)
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [fromCoord, toCoord] },
        properties: dtSec > GAP.THRESHOLD_SEC
          ? { type: "gap", prediction_color: GAP.COLOR }
          : { type: "line", prediction_color: "#00e676" },
      });
      // Live dot (shows as ring + dot + COG indicator, same as waypoints)
      const liveProps: Record<string, unknown> = {
        mmsi:             livePosition.mmsi,
        recorded_at:      livePosition.updated_at,
        prediction_color: "#00e676",
      };
      if (livePosition.sog != null)     liveProps.speed   = livePosition.sog;
      if (livePosition.cog != null)     liveProps.course  = livePosition.cog;
      if (livePosition.heading != null) liveProps.heading = livePosition.heading;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: toCoord },
        properties: liveProps,
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export default function TrackLayer({ selectedMmsi, onClear, onHover, onWaypointClick, timeRange, onTimeBounds, onWaypointTimes, focusedTime, replayMode, livePosition }: Props) {
  const map = useMap();
  const initializedRef = useRef(false);
  const allPointsRef   = useRef<GeoJSON.Feature[]>([]);
  const onWpClickRef      = useRef(onWaypointClick);
  const replayModeRef     = useRef(replayMode);
  const onHoverRef        = useRef(onHover);
  const timeRangeRef      = useRef(timeRange);
  const livePositionRef   = useRef(livePosition);
  useEffect(() => { onWpClickRef.current    = onWaypointClick; }, [onWaypointClick]);
  useEffect(() => { replayModeRef.current   = replayMode; },      [replayMode]);
  useEffect(() => { onHoverRef.current      = onHover; },         [onHover]);
  useEffect(() => { timeRangeRef.current    = timeRange; },       [timeRange]);
  useEffect(() => { livePositionRef.current = livePosition; },    [livePosition]);

  useEffect(() => {
    if (!map || initializedRef.current) return;
    initializedRef.current = true;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource(SOURCE, { type: "geojson", data: empty });
    map.addSource(FOCUS_SOURCE, { type: "geojson", data: empty });

    map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "type"], "line"],
      paint: {
        "line-color": ["coalesce", ["get", "prediction_color"], "#2ba8c8"],
        "line-width": LINE_STYLE.normal.width,
        "line-opacity": LINE_STYLE.normal.opacity,
      },
    });

    // Dashed line for signal gaps — color matches destination waypoint prediction
    map.addLayer({
      id: LAYER_GAP,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "type"], "gap"],
      paint: {
        "line-color": ["coalesce", ["get", "prediction_color"], "#00e676"],
        "line-width": LINE_STYLE.gap.width,
        "line-opacity": LINE_STYLE.gap.opacity,
        "line-dasharray": LINE_STYLE.gap.dash,
      },
    });

    map.addLayer({
      id: LAYER_RING,
      type: "circle",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "speed"]],
      paint: {
        "circle-radius": 9,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": ["coalesce", ["get", "prediction_color"], "#00e676"],
      },
    });

    map.addLayer({
      id: LAYER_DOTS,
      type: "circle",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "mmsi"]],
      paint: { "circle-radius": 3, "circle-color": "#ffffff", "circle-opacity": 0.9 },
    });

    // Highlighted (focused) waypoint — on top of everything
    map.addLayer({
      id: LAYER_FOCUS,
      type: "circle",
      source: FOCUS_SOURCE,
      paint: {
        "circle-radius": 9,
        "circle-color": "#f59e0b",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#020a12",
        "circle-opacity": 1,
      },
    });

    map.addLayer({
      id: LAYER_SOG,
      type: "symbol",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "seq"]],
      layout: {
        "text-field": ["to-string", ["get", "seq"]],
        "text-size": 10,
        "text-offset": [1.4, -0.1],
        "text-anchor": "left",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": ["coalesce", ["get", "prediction_color"], "#00e676"],
      },
    });

    map.addLayer({
      id: LAYER_COG,
      type: "symbol",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "course"]],
      layout: {
        "text-field": "●",
        "text-size": 8,
        "text-offset": [0, -1.125],
        "text-anchor": "center",
        "text-rotate": ["get", "course"],
        "text-rotation-alignment": "map",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#020a12",
        "text-halo-width": 1,
        "text-opacity": 0.9,
      },
    });

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      // Waypoint click — select it
      const wpHit = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOTS, LAYER_RING, LAYER_FOCUS] });
      if (wpHit.length) {
        const ra = (wpHit[0].properties as any)?.recorded_at;
        if (ra && onWpClickRef.current) {
          onWpClickRef.current(new Date(ra).getTime());
        }
        return;
      }
      // In replay mode, ReplayLayer owns clearing — never clear here
      if (replayModeRef.current) return;
      // Live mode: don't clear if clicking a vessel dot
      const hasLayer = !!map.getLayer("vessel-dots");
      const dotHit = hasLayer ? map.queryRenderedFeatures(e.point, { layers: ["vessel-dots"] }) : [];
      if (!dotHit.length) {
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
        onClear();
      }
    };
    map.on("click", handleClick);

    const handleWpMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOTS, LAYER_RING] });
      if (!features.length) { onHoverRef.current(null); map.getCanvas().style.cursor = ""; return; }
      map.getCanvas().style.cursor = "crosshair";
      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      onHoverRef.current({
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        mmsi: p.mmsi ?? null,
        speed: p.speed != null ? Number(p.speed) : null,
        course: p.course != null ? Number(p.course) : null,
        heading: p.heading != null ? Number(p.heading) : null,
        recorded_at: p.recorded_at ?? null,
        lat: coords[1],
        lon: coords[0],
        sources: p.sources != null ? Number(p.sources) : null,
      });
    };
    const handleWpLeave = () => { onHoverRef.current(null); };

    map.on("mousemove", LAYER_DOTS, handleWpMove);
    map.on("mouseleave", LAYER_DOTS, handleWpLeave);
    map.on("mousemove", LAYER_RING, handleWpMove);
    map.on("mouseleave", LAYER_RING, handleWpLeave);

    return () => {
      map.off("click", handleClick);
      map.off("mousemove", LAYER_DOTS, handleWpMove);
      map.off("mouseleave", LAYER_DOTS, handleWpLeave);
      map.off("mousemove", LAYER_RING, handleWpMove);
      map.off("mouseleave", LAYER_RING, handleWpLeave);
      [LAYER_FOCUS, LAYER_COG, LAYER_SOG, LAYER_RING, LAYER_DOTS, LAYER_GAP, LAYER_LINE].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(FOCUS_SOURCE)) map.removeSource(FOCUS_SOURCE);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      initializedRef.current = false;
    };
  }, [map]);

  // Fetch when selectedMmsi changes
  useEffect(() => {
    if (!map || !selectedMmsi) {
      allPointsRef.current = [];
      if (map && map.getSource(SOURCE)) {
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
      }
      return;
    }

    let isFirst = true;

    async function fetchTrack() {
      const { data, error } = await supabase.rpc("get_vessel_track", {
        p_mmsi: selectedMmsi,
        p_minutes: 2880,
      });
      if (error || !data || !map) return;

      const geojson = typeof data === "string" ? JSON.parse(data) : data;

      const points: GeoJSON.Feature[] = (geojson.features ?? []).filter(
        (f: GeoJSON.Feature) => f.geometry?.type === "Point" && (f.properties as any)?.mmsi != null
      );

      points.sort((a: GeoJSON.Feature, b: GeoJSON.Feature) => {
        const ta = (a.properties as any)?.recorded_at ?? "";
        const tb = (b.properties as any)?.recorded_at ?? "";
        return ta < tb ? -1 : 1;
      });

      points.forEach((f, i) => { (f.properties as any).seq = i + 1; });

      allPointsRef.current = points;

      // Only report time bounds on first fetch — subsequent polls don't reset the slider
      if (isFirst && points.length >= 2) {
        isFirst = false;
        const tFirst = new Date((points[0].properties as any)?.recorded_at).getTime();
        const tLast  = new Date((points[points.length - 1].properties as any)?.recorded_at).getTime();
        if (!isNaN(tFirst) && !isNaN(tLast)) {
          if (onTimeBounds) onTimeBounds([tFirst, tLast]);
          if (onWaypointTimes) {
            const times = points
              .map(f => new Date((f.properties as any)?.recorded_at ?? 0).getTime())
              .filter(t => !isNaN(t));
            onWaypointTimes(times);
          }
        }
      }

      // Use timeRangeRef so the interval always has the current slider range
      (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(buildGeoJSON(points, timeRangeRef.current, livePositionRef.current));
    }

    fetchTrack();
    const pollId = setInterval(fetchTrack, 30_000);

    return () => { clearInterval(pollId); };
  }, [map, selectedMmsi]);

  // Re-filter when timeRange changes (without re-fetching)
  useEffect(() => {
    if (!map || !map.getSource(SOURCE)) return;
    const points = allPointsRef.current;
    if (!points.length) return;
    (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(buildGeoJSON(points, timeRange, livePositionRef.current));
  }, [map, timeRange]);

  // Show focused waypoint highlight dot
  useEffect(() => {
    if (!map || !map.getSource(FOCUS_SOURCE)) return;
    const focusSrc = map.getSource(FOCUS_SOURCE) as maplibregl.GeoJSONSource;
    if (focusedTime == null || !allPointsRef.current.length) {
      focusSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    // Find waypoint closest to focusedTime
    let closest: GeoJSON.Feature | null = null;
    let minDiff = Infinity;
    for (const f of allPointsRef.current) {
      const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
      const diff = Math.abs(t - focusedTime);
      if (diff < minDiff) { minDiff = diff; closest = f; }
    }
    if (closest) focusSrc.setData({ type: "FeatureCollection", features: [closest] });
  }, [map, focusedTime]);

  return null;
}
