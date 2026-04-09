"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";

const SOURCE = "track";
const LAYER_LINE = "track-line";
const LAYER_DOTS = "track-dots";
const LAYER_RING = "track-rings";
const LAYER_SOG = "track-sog";
const LAYER_COG = "track-cog";
const LAYER_GAP     = "track-gap";
const LAYER_OUTLIER = "track-outlier";

interface WaypointHover { x: number; y: number; mmsi: number | null; speed: number | null; course: number | null; heading: number | null; recorded_at: string | null; lat: number; lon: number; }

interface Props {
  selectedMmsi: number | null;
  onClear: () => void;
  onHover: (data: WaypointHover | null) => void;
  timeRange?: [number, number] | null; // epoch ms [start, end]
  onTimeBounds?: (bounds: [number, number]) => void; // epoch ms [min, max]
}

const GAP_THRESHOLD     = 300;  // 5 minutes in seconds
const OUTLIER_SPEED_KN  = 60;   // implied speed above this → outlier

function distMeters(a: number[], b: number[]): number {
  const dLat = (b[1] - a[1]) * 111320;
  const dLon = (b[0] - a[0]) * 111320 * Math.cos(a[1] * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

function buildGeoJSON(points: GeoJSON.Feature[], timeRange: [number, number] | null | undefined): GeoJSON.FeatureCollection {
  let filtered = points;
  if (timeRange) {
    filtered = points.filter((f) => {
      const t = new Date((f.properties as any)?.recorded_at ?? 0).getTime();
      return t >= timeRange[0] && t <= timeRange[1];
    });
    filtered.forEach((f, i) => { (f.properties as any).seq = i + 1; });
  }

  const features: GeoJSON.Feature[] = [...filtered];

  for (let i = 0; i < filtered.length - 1; i++) {
    const from  = (filtered[i].geometry as GeoJSON.Point).coordinates;
    const to    = (filtered[i + 1].geometry as GeoJSON.Point).coordinates;
    const tA    = new Date((filtered[i].properties as any)?.recorded_at).getTime() / 1000;
    const tB    = new Date((filtered[i + 1].properties as any)?.recorded_at).getTime() / 1000;
    const dtSec = tB - tA;
    const isGap = dtSec > GAP_THRESHOLD;

    const impliedKn = dtSec > 0 ? (distMeters(from, to) / dtSec) / 0.514444 : 999;
    const isOutlier = impliedKn > OUTLIER_SPEED_KN;

    if (isOutlier) {
      // Physically impossible jump — dashed red
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: { type: "outlier" },
      });
    } else if (isGap) {
      // Signal gap — dashed in same color as destination waypoint
      const color = (filtered[i + 1].properties as any)?.prediction_color ?? "#00e676";
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: { type: "gap", prediction_color: color },
      });
    } else {
      const color = (filtered[i + 1].properties as any)?.prediction_color ?? "#2ba8c8";
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [from, to] },
        properties: { type: "line", prediction_color: color },
      });
    }
  }

  return { type: "FeatureCollection", features };
}

export default function TrackLayer({ selectedMmsi, onClear, onHover, timeRange, onTimeBounds }: Props) {
  const map = useMap();
  const initializedRef = useRef(false);
  const allPointsRef = useRef<GeoJSON.Feature[]>([]);

  useEffect(() => {
    if (!map || initializedRef.current) return;
    initializedRef.current = true;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource(SOURCE, { type: "geojson", data: empty });

    map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "type"], "line"],
      paint: {
        "line-color": ["coalesce", ["get", "prediction_color"], "#2ba8c8"],
        "line-width": 1.5,
        "line-opacity": 0.7,
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
        "line-width": 1,
        "line-opacity": 0.55,
        "line-dasharray": [4, 4],
      },
    });

    // Dashed red for outlier positions (implied speed > 60 kn — bad GPS fix)
    map.addLayer({
      id: LAYER_OUTLIER,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "type"], "outlier"],
      paint: {
        "line-color": "#f44336",
        "line-width": 1,
        "line-opacity": 0.6,
        "line-dasharray": [3, 4],
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

    map.addLayer({
      id: LAYER_SOG,
      type: "symbol",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "seq"]],
      layout: {
        "text-field": ["to-string", ["get", "seq"]],
        "text-size": 10,
        "text-offset": [1.4, 0],
        "text-anchor": "left",
      },
      paint: {
        "text-color": ["coalesce", ["get", "prediction_color"], "#00e676"],
        "text-halo-color": "#020a12",
        "text-halo-width": 1.5,
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
      const hit = map.queryRenderedFeatures(e.point, { layers: ["vessel-dots"] });
      if (!hit.length) {
        (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features: [] });
        onClear();
      }
    };
    map.on("click", handleClick);

    const handleWpMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOTS, LAYER_RING] });
      if (!features.length) { onHover(null); map.getCanvas().style.cursor = ""; return; }
      map.getCanvas().style.cursor = "crosshair";
      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      onHover({
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        mmsi: p.mmsi ?? null,
        speed: p.speed != null ? Number(p.speed) : null,
        course: p.course != null ? Number(p.course) : null,
        heading: p.heading != null ? Number(p.heading) : null,
        recorded_at: p.recorded_at ?? null,
        lat: coords[1],
        lon: coords[0],
      });
    };
    const handleWpLeave = () => { onHover(null); };

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
      [LAYER_COG, LAYER_SOG, LAYER_RING, LAYER_DOTS, LAYER_OUTLIER, LAYER_GAP, LAYER_LINE].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
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

      // Report time bounds
      if (points.length >= 2 && onTimeBounds) {
        const tFirst = new Date((points[0].properties as any)?.recorded_at).getTime();
        const tLast  = new Date((points[points.length - 1].properties as any)?.recorded_at).getTime();
        if (!isNaN(tFirst) && !isNaN(tLast)) {
          onTimeBounds([tFirst, tLast]);
        }
      }

      // Apply current timeRange filter when rendering
      (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(buildGeoJSON(points, timeRange));
    }

    fetchTrack();
  }, [map, selectedMmsi]);

  // Re-filter when timeRange changes (without re-fetching)
  useEffect(() => {
    if (!map || !map.getSource(SOURCE)) return;
    const points = allPointsRef.current;
    if (!points.length) return;
    (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData(buildGeoJSON(points, timeRange));
  }, [map, timeRange]);

  return null;
}
