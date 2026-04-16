"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";

// Compact row: [mmsi, lat, lon, speed_kn, cog, heading, freshness, ship_type, prev_lat, prev_lon, updated_epoch_sec, name]
type Row = [number, number, number, number, number, number, number, number | null, number | null, number | null, number, string];

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

    // Dot layer — green circle, opacity driven by freshness
    map.addLayer({
      id: LAYER_DOT,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 10, 7, 14, 10],
        // Fresh vessels are green, stale vessels fade to grey
        "circle-color": [
          "interpolate", ["linear"], ["get", "freshness"],
          0, "#4a5568",   // grey when stale
          30, "#4a5568",
          50, "#66bb6a",  // dull green
          100, "#00e676", // bright green when fresh
        ],
        "circle-stroke-width": 0,
        // Opacity driven by freshness: 100 -> 0.95, 10 -> 0.5 (more visible for old data)
        "circle-opacity": [
          "interpolate", ["linear"], ["get", "freshness"],
          0, 0.4,
          10, 0.5,
          50, 0.7,
          100, 0.95,
        ],
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
        // COG dot fades with freshness too
        "text-opacity": [
          "interpolate", ["linear"], ["get", "freshness"],
          0, 0,
          30, 0,
          50, 0.4,
          100, 0.9,
        ],
      },
    });

    // Name label — name if available, MMSI as fallback
    map.addLayer({
      id: LAYER_LABEL,
      type: "symbol",
      source: SOURCE,
      layout: {
        "text-field": ["concat", "─ ", ["coalesce", ["get", "name"], ["to-string", ["get", "mmsi"]]]],
        "text-size": 11,
        "text-offset": [0.8, 0],
        "text-anchor": "left",
      },
      paint: {
        "text-color": "#c8dce8",
        // Labels fade with freshness (increased min opacity for old vessels)
        "text-opacity": [
          "interpolate", ["linear"], ["get", "freshness"],
          0, 0.3,
          10, 0.4,
          50, 0.65,
          100, 1,
        ],
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

      const rows = data as any[];
      console.log("[vessels] fetched:", rows.length, "data sample:", rows[0]);

      const geojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: rows.map((r) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.lon, r.lat] },
          properties: {
            mmsi: r.mmsi,
            name: r.name || null,
            sog: r.sog,
            cog: r.cog,
            heading: r.heading,
            freshness: r.freshness ?? 100,
            updated_at: r.updated_epoch_sec ? new Date(r.updated_epoch_sec * 1000).toISOString() : null,
            stale: (r.freshness ?? 100) < 30,
          },
        })),
      };

      (map?.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(geojson);

      // Opdater selectedVessel løbende hvis den valgte båd er i ny data
      if (selectedMmsiRef.current != null && onVesselUpdateRef.current) {
        const match = rows.find((r) => r.mmsi === selectedMmsiRef.current);
        if (match) {
          onVesselUpdateRef.current({
            mmsi: match.mmsi,
            name: match.name || null,
            lat: match.lat,
            lon: match.lon,
            sog: match.sog,
            cog: match.cog,
            heading: match.heading,
            updated_at: match.updated_epoch_sec ? new Date(match.updated_epoch_sec * 1000).toISOString() : null,
          });
        }
      }
    }

    fetchVessels();
    timerRef.current = setInterval(fetchVessels, 10_000);

    return () => {
      clearInterval(timerRef.current);
      try {
        map.off("click", LAYER_DOT, handleClick);
        map.off("mousemove", LAYER_DOT, handleMouseMove);
        map.off("mouseleave", LAYER_DOT, handleMouseLeave);
        if (map.getLayer(LAYER_LABEL)) map.removeLayer(LAYER_LABEL);
        if (map.getLayer(LAYER_COG)) map.removeLayer(LAYER_COG);
        if (map.getLayer(LAYER_DOT)) map.removeLayer(LAYER_DOT);
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch {
        // Map was already destroyed by parent — nothing to clean up
      }
    };
  }, [map]);

  // Dim all other vessels when one is selected (respects freshness for non-selected)
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
      // Reset to freshness-driven opacity
      map.setPaintProperty(LAYER_DOT, "circle-color", [
        "interpolate", ["linear"], ["get", "freshness"],
        0, "#4a5568", 30, "#4a5568", 50, "#66bb6a", 100, "#00e676",
      ]);
      map.setPaintProperty(LAYER_DOT, "circle-opacity", [
        "interpolate", ["linear"], ["get", "freshness"],
        0, 0.4, 10, 0.5, 50, 0.7, 100, 0.95,
      ]);
      map.setPaintProperty(LAYER_COG, "text-opacity", [
        "interpolate", ["linear"], ["get", "freshness"],
        0, 0, 30, 0, 50, 0.4, 100, 0.9,
      ]);
      map.setPaintProperty(LAYER_LABEL, "text-opacity", [
        "interpolate", ["linear"], ["get", "freshness"],
        0, 0.3, 10, 0.4, 50, 0.65, 100, 1,
      ]);
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
