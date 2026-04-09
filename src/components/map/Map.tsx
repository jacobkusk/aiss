"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapContext } from "./MapContext";

const DARK_BASE = "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png";
const DARK_LABELS = "https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png";

interface Props {
  children?: React.ReactNode;
}

export default function Map({ children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const m = new maplibregl.Map({
      attributionControl: false,
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "base": { type: "raster", tiles: [DARK_BASE], tileSize: 256, attribution: "&copy; CARTO" },
          "labels": { type: "raster", tiles: [DARK_LABELS], tileSize: 256 },
        },
        layers: [
          { id: "base", type: "raster", source: "base" },
          { id: "labels", type: "raster", source: "labels" },
        ],
      },
      center: [12.5, 55.7],
      zoom: 7,
    } as maplibregl.MapOptions);

    (window as any).__map = m;

    m.on("load", () => setMap(m));

    return () => {
      m.remove();
      setMap(null);
    };
  }, []);

  return (
    <MapContext.Provider value={map}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {map && children}
    </MapContext.Provider>
  );
}
