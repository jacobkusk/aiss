"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";

const SOURCE = "historical-vessels";
const LAYER_DOT = "historical-dots";
const LAYER_LABEL = "historical-labels";

interface HoverData {
  x: number; y: number;
  mmsi: number; name: string | null;
  sog: number | null; cog: number | null; heading: number | null;
  lat: number; lon: number; updated_at: string | null;
}

interface Props {
  time: Date;
  windowMinutes?: number;
  onVesselClick: (vessel: {
    mmsi: number; name: string | null;
    lat: number; lon: number;
    sog: number | null; cog: number | null; heading: number | null;
    updated_at: string | null;
  }) => void;
  onHover: (data: HoverData | null) => void;
  hiddenMmsi?: number | null;
}

export default function HistoricalLayer({ time, windowMinutes = 10, onVesselClick, onHover, hiddenMmsi }: Props) {
  const map = useMap();
  const initializedRef = useRef(false);

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
        "circle-opacity": 0.9,
      },
    });

    map.addLayer({
      id: LAYER_LABEL,
      type: "symbol",
      source: SOURCE,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#f5d57a",
        "text-halo-color": "#020a12",
        "text-halo-width": 1.5,
      },
    });

    const handleClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOT] });
      if (!features.length) return;
      const p = features[0].properties as any;
      onVesselClick({
        mmsi: p.mmsi,
        name: p.name || null,
        lat: (features[0].geometry as GeoJSON.Point).coordinates[1],
        lon: (features[0].geometry as GeoJSON.Point).coordinates[0],
        sog: p.sog ?? null,
        cog: p.cog ?? null,
        heading: p.heading ?? null,
        updated_at: p.recorded_at ?? null,
      });
    };
    map.on("click", LAYER_DOT, handleClick);

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOT] });
      if (!features.length) { onHover(null); map.getCanvas().style.cursor = ""; return; }
      map.getCanvas().style.cursor = "pointer";
      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      onHover({
        x: e.originalEvent.clientX, y: e.originalEvent.clientY,
        mmsi: p.mmsi, name: p.name || null,
        sog: p.sog ?? null, cog: p.cog ?? null, heading: p.heading ?? null,
        lat: coords[1], lon: coords[0],
        updated_at: p.recorded_at ?? null,
      });
    };
    const handleMouseLeave = () => { onHover(null); map.getCanvas().style.cursor = ""; };
    map.on("mousemove", LAYER_DOT, handleMouseMove);
    map.on("mouseleave", LAYER_DOT, handleMouseLeave);

    return () => {
      map.off("click", LAYER_DOT, handleClick);
      map.off("mousemove", LAYER_DOT, handleMouseMove);
      map.off("mouseleave", LAYER_DOT, handleMouseLeave);
      if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
      if (map.getLayer(LAYER_DOT)) map.removeLayer(LAYER_DOT);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      initializedRef.current = false;
    };
  }, [map]);

  // Hide selected vessel dot
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_DOT)) return;
    if (hiddenMmsi != null) {
      map.setFilter(LAYER_DOT, ["!=", ["get", "mmsi"], hiddenMmsi]);
      map.setFilter(LAYER_LABEL, ["!=", ["get", "mmsi"], hiddenMmsi]);
    } else {
      map.setFilter(LAYER_DOT, null);
      map.setFilter(LAYER_LABEL, null);
    }
  }, [map, hiddenMmsi]);

  // Fetch when time changes
  useEffect(() => {
    if (!map) return;
    async function fetch() {
      const { data, error } = await supabase.rpc("get_vessels_at_time", {
        p_time: time.toISOString(),
        p_window_minutes: windowMinutes,
      });
      if (error || !data || !map) return;
      const geojson = typeof data === "string" ? JSON.parse(data) : data;
      (map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(geojson);
    }
    fetch();
  }, [map, time, windowMinutes]);

  return null;
}
