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

interface WaypointHover { x: number; y: number; mmsi: number | null; speed: number | null; course: number | null; heading: number | null; recorded_at: string | null; lat: number; lon: number; }

interface Props {
  selectedMmsi: number | null;
  onClear: () => void;
  onHover: (data: WaypointHover | null) => void;
}

export default function TrackLayer({ selectedMmsi, onClear, onHover }: Props) {
  const map = useMap();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!map || initializedRef.current) return;
    initializedRef.current = true;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource(SOURCE, { type: "geojson", data: empty });

    map.addLayer({
      id: LAYER_LINE,
      type: "line",
      source: SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      paint: { "line-color": "#2ba8c8", "line-width": 1.5, "line-opacity": 0.7 },
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
        "circle-stroke-color": "#00e676",
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
        "text-offset": [-1.2, 0],
        "text-anchor": "right",
      },
      paint: {
        "text-color": "#00e676",
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
      [LAYER_COG, LAYER_SOG, LAYER_RING, LAYER_DOTS, LAYER_LINE].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      initializedRef.current = false;
    };
  }, [map]);

  useEffect(() => {
    if (!map || !selectedMmsi) {
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
        (f: GeoJSON.Feature) => f.geometry?.type === "Point"
      );

      points.sort((a: GeoJSON.Feature, b: GeoJSON.Feature) => {
        const ta = (a.properties as any)?.recorded_at ?? "";
        const tb = (b.properties as any)?.recorded_at ?? "";
        return ta < tb ? -1 : 1;
      });

      points.forEach((f, i) => { (f.properties as any).seq = i + 1; });

      const lineCoords = points.map((f) => (f.geometry as GeoJSON.Point).coordinates);
      const features: GeoJSON.Feature[] = [...points];
      if (lineCoords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: lineCoords },
          properties: { type: "line" },
        });
      }

      (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features });
    }

    fetchTrack();
  }, [map, selectedMmsi]);

  return null;
}
