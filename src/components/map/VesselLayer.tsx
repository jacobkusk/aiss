"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";

// Compact row: [mmsi, lat, lon, speed_kn, cog, heading, nav_status, ship_type, prev_lat, prev_lon, updated_epoch_sec, name]
type Row = [number, number, number, number, number, number, number, number | null, number, number, number, string];

interface HoverData { x: number; y: number; mmsi: number; name: string | null; sog: number | null; cog: number | null; heading: number | null; lat: number; lon: number; updated_at: string | null; }

interface VesselData {
  mmsi: number;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  updated_at: string | null;
}

interface Props {
  onVesselClick: (vessel: VesselData) => void;
  onVesselUpdate?: (vessel: VesselData) => void;
  selectedMmsi?: number | null;
  onHover: (data: HoverData | null) => void;
  hiddenMmsi?: number | null;
}

const SOURCE = "vessels";
const LAYER_DOT = "vessel-dots";
const LAYER_COG = "vessel-cog";
const LAYER_LABEL = "vessel-labels";

export default function VesselLayer({ onVesselClick, onVesselUpdate, selectedMmsi, onHover, hiddenMmsi }: Props) {
  const map = useMap();
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const selectedMmsiRef = useRef(selectedMmsi);
  const onVesselUpdateRef = useRef(onVesselUpdate);
  useEffect(() => { selectedMmsiRef.current = selectedMmsi; }, [selectedMmsi]);
  useEffect(() => { onVesselUpdateRef.current = onVesselUpdate; }, [onVesselUpdate]);

  useEffect(() => {
    if (!map) return;

    // Add source
    map.addSource(SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    // Dot layer — green circle for all vessels
    map.addLayer({
      id: LAYER_DOT,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7, 14, 10],
        "circle-color": "#00e676",
        "circle-stroke-width": 0,
        "circle-opacity": 0.9,
      },
    });

    // COG direction dot — small dot on perimeter pointing in direction of travel
    map.addLayer({
      id: LAYER_COG,
      type: "symbol",
      source: SOURCE,
      filter: ["all", [">=", ["number", ["get", "cog"], -1], 0], [">=", ["number", ["get", "sog"], 0], 0.5]],
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

    // Name label — name if available, MMSI as fallback
    map.addLayer({
      id: LAYER_LABEL,
      type: "symbol",
      source: SOURCE,
      layout: {
        "text-field": ["concat", "⌐ ", ["coalesce", ["get", "name"], ["to-string", ["get", "mmsi"]]]],
        "text-size": 11,
        "text-offset": [0.8, 0],
        "text-anchor": "left",
      },
      paint: {
        "text-color": "#c8dce8",
      },
    });

    // Click handler
    const handleClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOT] });
      if (!features.length) return;
      const p = features[0].properties as any;
      console.log("[vessel] click mmsi:", p.mmsi);
      onVesselClick({
        mmsi: p.mmsi,
        name: p.name || null,
        lat: (features[0].geometry as GeoJSON.Point).coordinates[1],
        lon: (features[0].geometry as GeoJSON.Point).coordinates[0],
        sog: p.sog ?? null,
        cog: p.cog ?? null,
        heading: p.heading ?? null,
        updated_at: p.updated_at ?? null,
      });
    };

    map.on("click", LAYER_DOT, handleClick);
    map.getCanvas().style.cursor = "";

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_DOT] });
      if (!features.length) { onHover(null); map.getCanvas().style.cursor = ""; return; }
      map.getCanvas().style.cursor = "pointer";
      const p = features[0].properties as any;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      onHover({
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
        mmsi: p.mmsi,
        name: p.name || null,
        sog: p.sog ?? null,
        cog: p.cog ?? null,
        heading: p.heading ?? null,
        lat: coords[1],
        lon: coords[0],
        updated_at: p.updated_at ?? null,
      });
    };
    const handleMouseLeave = () => { onHover(null); map.getCanvas().style.cursor = ""; };

    map.on("mousemove", LAYER_DOT, handleMouseMove);
    map.on("mouseleave", LAYER_DOT, handleMouseLeave);

    async function fetchVessels() {
      const { data, error } = await supabase.rpc("get_live_vessels_compact");
      if (error || !data) { console.log("[vessels] error:", error?.message); return; }

      const rows = data as Row[];
      console.log("[vessels] fetched:", rows.length);

      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: rows.map((r) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r[2], r[1]] },
          properties: {
            mmsi: r[0],
            name: r[11] || null,
            sog: r[3],
            cog: r[4],
            heading: r[5],
            updated_at: r[10] ? new Date(r[10] * 1000).toISOString() : null,
            stale: r[10] ? (Date.now() / 1000 - r[10]) > 1800 : false,
          },
        })),
      };

      (map?.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(geojson);

      // Opdater selectedVessel løbende hvis den valgte båd er i ny data
      if (selectedMmsiRef.current != null && onVesselUpdateRef.current) {
        const match = rows.find((r) => r[0] === selectedMmsiRef.current);
        if (match) {
          onVesselUpdateRef.current({
            mmsi: match[0],
            name: match[11] || null,
            lat: match[1],
            lon: match[2],
            sog: match[3],
            cog: match[4],
            heading: match[5],
            updated_at: match[10] ? new Date(match[10] * 1000).toISOString() : null,
          });
        }
      }
    }

    fetchVessels();
    timerRef.current = setInterval(fetchVessels, 10_000);

    return () => {
      clearInterval(timerRef.current);
      map.off("click", LAYER_DOT, handleClick);
      map.off("mousemove", LAYER_DOT, handleMouseMove);
      map.off("mouseleave", LAYER_DOT, handleMouseLeave);
      if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
      if (map.getLayer(LAYER_COG)) map.removeLayer(LAYER_COG);
      if (map.getLayer(LAYER_DOT)) map.removeLayer(LAYER_DOT);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [map]);

  // Dim all other vessels when one is selected
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_DOT)) return;
    if (selectedMmsi != null) {
      map.setPaintProperty(LAYER_DOT, "circle-color", [
        "case", ["==", ["get", "mmsi"], selectedMmsi], "#00e676", "#4a5568",
      ]);
      map.setPaintProperty(LAYER_DOT, "circle-opacity", [
        "case", ["==", ["get", "mmsi"], selectedMmsi], 0.9, 0.35,
      ]);
      map.setPaintProperty(LAYER_COG, "text-opacity", [
        "case", ["==", ["get", "mmsi"], selectedMmsi], 0.9, 0,
      ]);
      map.setPaintProperty(LAYER_LABEL, "text-opacity", [
        "case", ["==", ["get", "mmsi"], selectedMmsi], 1, 0,
      ]);
    } else {
      map.setPaintProperty(LAYER_DOT, "circle-color", "#00e676");
      map.setPaintProperty(LAYER_DOT, "circle-opacity", 0.9);
      map.setPaintProperty(LAYER_COG, "text-opacity", 0.9);
      map.setPaintProperty(LAYER_LABEL, "text-opacity", 1);
    }
  }, [map, selectedMmsi]);

  // Hide the selected vessel's dot so track waypoints render cleanly
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

  return null;
}
