"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";

const SOURCE = "replay";
const LAYER_DOT = "replay-dots";
const LAYER_COG = "replay-cog";
const LAYER_LABEL = "replay-labels";

export interface VesselPoint {
  t: number;   // epoch seconds
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
}

export type TrackMap = Map<number, { name: string | null; points: VesselPoint[] }>;

interface HoverData {
  x: number; y: number;
  mmsi: number; name: string | null;
  sog: number | null; cog: number | null; heading: number | null;
  lat: number; lon: number; updated_at: string | null;
}

export interface VesselClickData {
  mmsi: number; name: string | null;
  lat: number; lon: number;
  sog: number | null; cog: number | null;
  heading: null; updated_at: string | null;
}

interface Props {
  tracks: TrackMap;
  currentTime: number; // epoch ms
  onVesselSingleClick: (v: VesselClickData) => void;
  onVesselDoubleClick: (v: VesselClickData) => void;
  onClickEmpty: () => void;
  onHover: (d: HoverData | null) => void;
  hiddenMmsi?: number | null;
  dimOthers?: boolean;
  followedMmsi?: number | null;
}

const DBLCLICK_MS = 280;

function interpolate(points: VesselPoint[], tMs: number): VesselPoint | null {
  const t = tMs / 1000;
  if (!points.length) return null;
  if (t < points[0].t - 600) return null;
  if (t > points[points.length - 1].t + 600) return null;

  let lo = 0, hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (!b || b.t === a.t) return a;
  const frac = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  return {
    t,
    lat: a.lat + frac * (b.lat - a.lat),
    lon: a.lon + frac * (b.lon - a.lon),
    sog: a.sog,
    cog: a.cog,
  };
}

export default function ReplayLayer({ tracks, currentTime, onVesselSingleClick, onVesselDoubleClick, onClickEmpty, onHover, hiddenMmsi, dimOthers, followedMmsi }: Props) {
  const map = useMap();
  const initializedRef = useRef(false);

  // Stable refs so click handlers don't go stale
  const singleClickRef = useRef(onVesselSingleClick);
  const doubleClickRef = useRef(onVesselDoubleClick);
  const clickEmptyRef  = useRef(onClickEmpty);
  useEffect(() => { singleClickRef.current = onVesselSingleClick; }, [onVesselSingleClick]);
  useEffect(() => { doubleClickRef.current = onVesselDoubleClick; }, [onVesselDoubleClick]);
  useEffect(() => { clickEmptyRef.current  = onClickEmpty; },        [onClickEmpty]);

  // Initialize layers once
  useEffect(() => {
    if (!map || initializedRef.current) return;
    initializedRef.current = true;

    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

    map.addLayer({
      id: LAYER_DOT,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7, 14, 10],
        "circle-color": "#f59e0b",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.95,
      },
    });

    map.addLayer({
      id: LAYER_COG,
      type: "symbol",
      source: SOURCE,
      filter: [">=", ["number", ["get", "cog"], -1], 0],
      layout: {
        "text-field": "●",
        "text-size": 8,
        "text-offset": [0, -1.125],
        "text-anchor": "center",
        "text-rotate": ["number", ["get", "cog"], 0],
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

    map.addLayer({
      id: LAYER_LABEL,
      type: "symbol",
      source: SOURCE,
      layout: {
        "text-field": ["coalesce", ["get", "name"], ["to-string", ["get", "mmsi"]]],
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#f5d57a",
      },
    });

    // Prevent map zoom on double-click over a vessel dot
    const handleDblClick = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); };
    map.on("dblclick", LAYER_DOT, handleDblClick);

    // Click: count clicks within DBLCLICK_MS to distinguish single vs double
    let clickCount = 0;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOT] });

      clickCount++;
      if (clickTimer) clearTimeout(clickTimer);

      if (!features.length) {
        // Click on empty map
        clickTimer = setTimeout(() => { clickCount = 0; clickEmptyRef.current(); }, DBLCLICK_MS);
        return;
      }

      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      const data: VesselClickData = {
        mmsi: p.mmsi, name: p.name || null,
        lat: coords[1], lon: coords[0],
        sog: p.sog ?? null, cog: p.cog ?? null,
        heading: null, updated_at: null,
      };

      clickTimer = setTimeout(() => {
        if (clickCount >= 2) {
          doubleClickRef.current(data);
        } else {
          singleClickRef.current(data);
        }
        clickCount = 0;
      }, DBLCLICK_MS);
    };

    map.on("click", handleClick);

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOT] });
      if (!features.length) { onHover(null); map.getCanvas().style.cursor = ""; return; }
      map.getCanvas().style.cursor = "pointer";
      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      onHover({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, mmsi: p.mmsi, name: p.name || null, sog: p.sog ?? null, cog: p.cog ?? null, heading: null, lat: coords[1], lon: coords[0], updated_at: p.t ? new Date(p.t * 1000).toISOString() : null });
    };
    const handleMouseLeave = () => { onHover(null); map.getCanvas().style.cursor = ""; };
    map.on("mousemove", LAYER_DOT, handleMouseMove);
    map.on("mouseleave", LAYER_DOT, handleMouseLeave);

    return () => {
      if (clickTimer) clearTimeout(clickTimer);
      map.off("click", handleClick);
      map.off("dblclick", LAYER_DOT, handleDblClick);
      map.off("mousemove", LAYER_DOT, handleMouseMove);
      map.off("mouseleave", LAYER_DOT, handleMouseLeave);
      if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
      if (map.getLayer(LAYER_COG)) map.removeLayer(LAYER_COG);
      if (map.getLayer(LAYER_DOT)) map.removeLayer(LAYER_DOT);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      initializedRef.current = false;
    };
  }, [map]);

  // Opacity: A = data-driven (follow one), B = blanket dim (selected hidden), default = full
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_DOT)) return;
    if (followedMmsi != null) {
      map.setPaintProperty(LAYER_DOT, "circle-opacity", [
        "case", ["==", ["get", "mmsi"], followedMmsi], 0.95, 0.12,
      ]);
      map.setPaintProperty(LAYER_DOT, "circle-stroke-opacity", [
        "case", ["==", ["get", "mmsi"], followedMmsi], 1, 0.12,
      ]);
      map.setPaintProperty(LAYER_COG,   "text-opacity", [
        "case", ["==", ["get", "mmsi"], followedMmsi], 0.9, 0,
      ]);
      map.setPaintProperty(LAYER_LABEL, "text-opacity", [
        "case", ["==", ["get", "mmsi"], followedMmsi], 1, 0,
      ]);
    } else {
      map.setPaintProperty(LAYER_DOT,   "circle-opacity",       dimOthers ? 0.18 : 0.95);
      map.setPaintProperty(LAYER_DOT,   "circle-stroke-opacity", dimOthers ? 0.18 : 1);
      map.setPaintProperty(LAYER_COG,   "text-opacity",          dimOthers ? 0 : 0.9);
      map.setPaintProperty(LAYER_LABEL, "text-opacity",          dimOthers ? 0 : 1);
    }
  }, [map, dimOthers, followedMmsi]);

  // Hide selected vessel dot (B state — VesselPanel + TrackLayer take over)
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_DOT)) return;
    if (hiddenMmsi != null) {
      map.setFilter(LAYER_DOT,   ["!=", ["get", "mmsi"], hiddenMmsi]);
      map.setFilter(LAYER_LABEL, ["!=", ["get", "mmsi"], hiddenMmsi]);
    } else {
      map.setFilter(LAYER_DOT,   null);
      map.setFilter(LAYER_LABEL, null);
    }
  }, [map, hiddenMmsi]);

  // Update positions whenever currentTime or tracks changes
  useEffect(() => {
    if (!map || !map.getSource(SOURCE)) return;
    const features: GeoJSON.Feature[] = [];
    tracks.forEach((vessel, mmsi) => {
      const pos = interpolate(vessel.points, currentTime);
      if (!pos) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
        properties: { mmsi, name: vessel.name, sog: pos.sog, cog: pos.cog, t: pos.t },
      });
    });
    (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features });
  }, [map, tracks, currentTime]);

  return null;
}
