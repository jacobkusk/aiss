"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapContext } from "./MapContext";

const STYLES = {
  dark:  "https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json",
  light: "https://tiles.openfreemap.org/styles/positron",
  map:   "https://tiles.openfreemap.org/styles/liberty",
} as const;

export type MapTheme = "dark" | "light" | "map";

const CUSTOM = ["track", "vessel", "routes", "focus", "endpoint", "maritime"];
const isCustomId = (id: string) => CUSTOM.some(p => id.startsWith(p));

// Toggle base style labels — kun lag med source-layer "place" eller "poi" fra vector tiles
// Aldrig rør layers uden source-layer (det er vores custom geojson layers)
const LABEL_SOURCE_LAYERS = [
  "place", "place_label", "poi", "poi_label",
  "transportation_name", "water_name", "waterway",
];
function applyLabels(m: maplibregl.Map, show: boolean) {
  if (!m.isStyleLoaded()) return;
  const vis = show ? "visible" : "none";
  m.getStyle()?.layers?.forEach(layer => {
    const sourceLayer = (layer as any)["source-layer"];
    if (!sourceLayer) return; // custom geojson layers har ingen source-layer
    if (!LABEL_SOURCE_LAYERS.some(sl => sourceLayer.includes(sl))) return;
    try { m.setLayoutProperty(layer.id, "visibility", vis); } catch {}
  });
}

function applyFog(m: maplibregl.Map) {
  try {
    (m as any).setFog({
      "color": "#111820",
      "high-color": "#0a1220",
      "horizon-blend": 0.04,
      "space-color": "#060c14",
      "star-intensity": 0.5,
    });
  } catch {}
}

interface Props {
  children?: React.ReactNode;
  theme?: MapTheme;
  showLabels?: boolean;
}

export default function Map({ children, theme = "dark", showLabels = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const showLabelsRef = useRef(showLabels);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);

  // Toggle labels when prop changes
  useEffect(() => {
    if (!map || !map.isStyleLoaded()) return;
    applyLabels(map, showLabels);
  }, [map, showLabels]);

  // Theme switch — rebuild map entirely to avoid transformStyle issues
  const themeRef = useRef(theme);
  useEffect(() => {
    if (!map) return;
    if (themeRef.current === theme) return;
    themeRef.current = theme;

    // Save custom sources/layers
    const style = map.getStyle();
    const customSources: Record<string, maplibregl.SourceSpecification> = {};
    Object.entries(style.sources ?? {}).forEach(([id, src]) => {
      if (isCustomId(id)) customSources[id] = src as maplibregl.SourceSpecification;
    });
    const customLayers = (style.layers ?? []).filter(l => isCustomId(l.id));

    map.setStyle(STYLES[theme], {
      transformStyle: (_prev, next) => ({
        ...next,
        sources: { ...next.sources, ...customSources },
        layers:  [...(next.layers ?? []), ...customLayers],
      }),
    });

    map.once("style.load", () => {
      applyLabels(map, showLabelsRef.current);
      applyFog(map);
    });
  }, [map, theme]);

  // Init map
  useEffect(() => {
    if (!containerRef.current) return;

    const m = new maplibregl.Map({
      attributionControl: false,
      container: containerRef.current,
      style: STYLES[theme],
      center: [12.5, 55.7],
      zoom: 7,
      minZoom: 1.2,
      maxZoom: 19,
      renderWorldCopies: true,
    } as maplibregl.MapOptions);

    (window as any).__map = m;
    m.dragRotate.disable();
    m.touchZoomRotate.disableRotation();
    m.getCanvasContainer().addEventListener("contextmenu", e => e.stopPropagation(), true);

    m.on("load", () => {
      applyLabels(m, showLabelsRef.current);
      applyFog(m);
      themeRef.current = theme;
      setMap(m);
    });

    return () => { m.remove(); setMap(null); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MapContext.Provider value={map}>
      <div style={{ position: "absolute", inset: 0, background: "#060c14" }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      </div>
      {map && children}
    </MapContext.Provider>
  );
}
