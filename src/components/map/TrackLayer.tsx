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
const LAYER_CHEVRON = "track-chevron";

function geoOffset(lon: number, lat: number, bearingDeg: number, distDeg: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  return [
    lon + distDeg * Math.sin(rad) / Math.cos((lat * Math.PI) / 180),
    lat + distDeg * Math.cos(rad),
  ];
}

function makeChevron(lon: number, lat: number, bearingDeg: number): GeoJSON.Feature {
  const apex = geoOffset(lon, lat, bearingDeg, 0.00020);
  const back = (bearingDeg + 180) % 360;
  const left  = geoOffset(apex[0], apex[1], (back - 35 + 360) % 360, 0.00015);
  const right = geoOffset(apex[0], apex[1], (back + 35) % 360, 0.00015);
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [left, apex, right] },
    properties: { type: "chevron" },
  };
}

interface WaypointHover { x: number; y: number; mmsi: number | null; speed: number | null; course: number | null; heading: number | null; recorded_at: string | null; lat: number; lon: number; }

interface Props {
  selectedMmsi: number | null;
  onClear: () => void;
  onHover: (data: WaypointHover | null) => void;
}

export default function TrackLayer({ selectedMmsi, onClear, onHover }: Props) {
  const map = useMap();
  const initializedRef = useRef(false);

  // Initialize layers once
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

    // Outer diffuse glow
    map.addLayer({
      id: LAYER_RING,
      type: "circle",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "speed"]],
      paint: {
        "circle-radius": 14,
        "circle-color": "#00e676",
        "circle-opacity": 0.12,
        "circle-blur": 1,
      },
    });

    // Inner tight glow
    map.addLayer({
      id: LAYER_RING + "-inner",
      type: "circle",
      source: SOURCE,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "speed"]],
      paint: {
        "circle-radius": 8,
        "circle-color": "#00e676",
        "circle-opacity": 0.25,
        "circle-blur": 0.8,
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
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "speed"]],
      layout: {
        "text-field": ["concat", ["to-string", ["get", "speed"]], " kn"],
        "text-size": 10,
        "text-offset": [1.2, 0],
        "text-anchor": "left",
      },
      paint: {
        "text-color": "#00e676",
        "text-halo-color": "#020a12",
        "text-halo-width": 1.5,
      },
    });

    // COG dot: small white dot offset outside the green ring in course direction
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

    // Chevron — pure WebGL vector line geometry
    map.addLayer({
      id: LAYER_CHEVRON,
      type: "line",
      source: SOURCE,
      filter: ["==", ["get", "type"], "chevron"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#2ba8c8", "line-width": 2, "line-opacity": 0.9 },
    });

    // Click empty area → clear
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
      [LAYER_CHEVRON, LAYER_COG, LAYER_SOG, LAYER_RING + "-inner", LAYER_RING, LAYER_DOTS, LAYER_LINE].forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      initializedRef.current = false;
    };
  }, [map]);

  // Fetch track when selectedMmsi changes
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
      console.log("[track]", selectedMmsi, data?.features?.length ?? 0);
      if (error || !data || !map) return;

      const geojson = typeof data === "string" ? JSON.parse(data) : data;

      // Separate points (waypoints) from lines
      const points: GeoJSON.Feature[] = (geojson.features ?? []).filter(
        (f: GeoJSON.Feature) => f.geometry?.type === "Point"
      );

      // Sort points by recorded_at
      points.sort((a: GeoJSON.Feature, b: GeoJSON.Feature) => {
        const ta = (a.properties as any)?.recorded_at ?? "";
        const tb = (b.properties as any)?.recorded_at ?? "";
        return ta < tb ? -1 : 1;
      });

      // Build line from the actual waypoints so line and dots always match
      const lineCoords = points.map((f) => (f.geometry as GeoJSON.Point).coordinates);
      const features: GeoJSON.Feature[] = [...points];
      if (lineCoords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: lineCoords },
          properties: { type: "line" },
        });

        // Chevrons as LineString vector geometry at first and last waypoint
        for (const pt of [points[0], points[points.length - 1]]) {
          const course = (pt.properties as any)?.course;
          if (course == null) continue;
          const [lon, lat] = (pt.geometry as GeoJSON.Point).coordinates;
          features.push(makeChevron(lon, lat, Number(course)));
        }
      }

      (map.getSource(SOURCE) as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features });
    }

    fetchTrack();
  }, [map, selectedMmsi]);

  return null;
}
