"use client";

import { useEffect, useRef, MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { supabase } from "@/lib/supabase";
import type { Vessel } from "@/lib/types";

export { OVERLAY_LABELS, DEFAULT_OVERLAYS };

export type Overlays = Record<string, boolean>;
export type MapStyle = "light" | "dark" | "satellite";

const MAP_TILES: Record<MapStyle, { base: string; labels: string }> = {
  light: {
    base: "https://basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
    labels: "https://basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png",
  },
  dark: {
    base: "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
    labels: "https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  },
  satellite: {
    base: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png",
  },
};

interface Props {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  isGlobe: boolean;
  isLive: boolean;
  historicalDate: string | null;
  scrubMinutesAgo: number;
  overlays: Overlays;
  mapStyle: MapStyle;
  onVesselsUpdate: (vessels: Vessel[]) => void;
  onVesselClick: (vessel: Vessel) => void;
  onRouteCountUpdate: (count: number) => void;
  onToggleGlobe: (globe: boolean) => void;
  onToggleOverlay: (key: string) => void;
  onZoomChange?: (zoom: number) => void;
}

// Predict position based on COG and SOG
function predictedPosition(lon: number, lat: number, cogDeg: number, sogKn: number, hoursAhead = 0.5): [number, number] {
  const R = 3440.065;
  const d = sogKn * hoursAhead;
  const cogRad = (cogDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d / R) +
    Math.cos(latRad) * Math.sin(d / R) * Math.cos(cogRad)
  );
  const newLonRad = lonRad + Math.atan2(
    Math.sin(cogRad) * Math.sin(d / R) * Math.cos(latRad),
    Math.cos(d / R) - Math.sin(latRad) * Math.sin(newLatRad)
  );
  return [(newLonRad * 180) / Math.PI, (newLatRad * 180) / Math.PI];
}

function buildPredictions(geojson: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of geojson.features) {
    const p = f.properties ?? {};
    const speed = p.speed ?? 0;
    const heading = p.heading ?? 0;
    if (speed < 2 || heading === 511 || heading === 0) continue;
    const coords = (f.geometry as GeoJSON.Point).coordinates;
    const predicted = predictedPosition(coords[0], coords[1], heading, speed, 0.5);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: [coords, predicted] },
      properties: { mmsi: p.mmsi },
    });
  }
  return { type: "FeatureCollection", features };
}

function vesselFromFeature(f: GeoJSON.Feature): Vessel {
  const p = f.properties ?? {};
  const coords = (f.geometry as GeoJSON.Point).coordinates;
  return {
    mmsi: p.mmsi ?? 0,
    ship_name: p.name ?? null,
    lat: coords[1],
    lon: coords[0],
    sog: p.speed ?? null,
    cog: null,
    heading: p.heading ?? null,
    speed: p.speed ?? null,
    ship_type: p.ship_type ?? null,
    destination: p.destination ?? null,
    source: p.source ?? "ais",
    updated_at: p.updated_at ?? null,
  };
}

// Overlay config
const OVERLAY_LABELS: Record<string, { label: string; color: string }> = {
  seamarks: { label: "Sea Marks", color: "#5a8090" },
  underway: { label: "Underway", color: "#00e676" },
  anchored: { label: "At Anchor", color: "#5a8090" },
  predictions: { label: "Predictions", color: "#ffffff" },
  cargo: { label: "Cargo", color: "#4a8f4a" },
  tanker: { label: "Tanker", color: "#c44040" },
  passenger: { label: "Passenger", color: "#4a90d9" },
  fishing: { label: "Fishing", color: "#d4a017" },
  sailing: { label: "Sailing", color: "#2ba8c8" },
  names: { label: "Names", color: "#8ba8b8" },
};


const DEFAULT_OVERLAYS: Overlays = {
  seamarks: false,
  underway: true,
  anchored: true,
  predictions: false,
  cargo: true,
  tanker: true,
  passenger: true,
  fishing: true,
  sailing: true,
  names: false,
};

// Ship type color mapping
const SHIP_TYPE_COLORS = [
  // Fishing (30-39)
  30, "#d4a017", 31, "#d4a017", 32, "#d4a017", 33, "#d4a017", 34, "#d4a017", 35, "#d4a017",
  36, "#2ba8c8", 37, "#2ba8c8", // Sailing & Pleasure
  38, "#d4a017", 39, "#d4a017",
  // High-speed / WIG (40-49)
  40, "#e07020", 41, "#e07020", 42, "#e07020", 43, "#e07020", 44, "#e07020",
  45, "#e07020", 46, "#e07020", 47, "#e07020", 48, "#e07020", 49, "#e07020",
  // Pilot/Tug/Special (50-59)
  50, "#e07020", 51, "#e07020", 52, "#e07020", 53, "#e07020", 54, "#e07020",
  55, "#e07020", 56, "#e07020", 57, "#e07020", 58, "#8b5cf6", 59, "#e07020",
  // Passenger (60-69)
  60, "#4a90d9", 61, "#4a90d9", 62, "#4a90d9", 63, "#4a90d9", 64, "#4a90d9",
  65, "#4a90d9", 66, "#4a90d9", 67, "#4a90d9", 68, "#4a90d9", 69, "#4a90d9",
  // Cargo (70-79)
  70, "#4a8f4a", 71, "#4a8f4a", 72, "#4a8f4a", 73, "#4a8f4a", 74, "#4a8f4a",
  75, "#4a8f4a", 76, "#4a8f4a", 77, "#4a8f4a", 78, "#4a8f4a", 79, "#4a8f4a",
  // Tanker (80-89)
  80, "#c44040", 81, "#c44040", 82, "#c44040", 83, "#c44040", 84, "#c44040",
  85, "#c44040", 86, "#c44040", 87, "#c44040", 88, "#c44040", 89, "#c44040",
] as (string | number)[];

// Build vessel filter from overlay state
function buildVesselFilter(ov: Overlays): maplibregl.FilterSpecification {
  const conditions: maplibregl.FilterSpecification[] = [["!", ["has", "point_count"]]];

  // Speed filter
  if (ov.underway && !ov.anchored) {
    conditions.push([">=", ["to-number", ["get", "speed"], 0], 0.5]);
  } else if (!ov.underway && ov.anchored) {
    conditions.push(["<", ["to-number", ["get", "speed"], 0], 0.5]);
  } else if (!ov.underway && !ov.anchored) {
    conditions.push(["==", 1, 0]); // hide all
  }

  // Ship type filter
  const typeConditions: maplibregl.FilterSpecification[] = [];
  const st = ["to-number", ["get", "ship_type"], 0] as maplibregl.ExpressionSpecification;
  if (ov.cargo) typeConditions.push(["all", [">=", st, 70], ["<=", st, 79]]);
  if (ov.tanker) typeConditions.push(["all", [">=", st, 80], ["<=", st, 89]]);
  if (ov.passenger) typeConditions.push(["all", [">=", st, 60], ["<=", st, 69]]);
  if (ov.fishing) typeConditions.push(["all", [">=", st, 30], ["<=", st, 35]]);
  if (ov.sailing) typeConditions.push(["any", ["==", st, 36], ["==", st, 37]]);
  // Always include unknown/other types and types not in the toggle list (40-59, 90-99, 0)
  typeConditions.push(["all", [">=", st, 40], ["<=", st, 59]]);
  typeConditions.push([">=", st, 90]);
  typeConditions.push(["==", st, 0]);
  // Include vessels with no ship_type (null → becomes 0)
  if (ov.cargo || ov.tanker || ov.passenger || ov.sailing) {
    typeConditions.push(["==", st, 0]);
  }

  if (typeConditions.length > 0) {
    conditions.push(["any", ...typeConditions] as any);
  }

  return ["all", ...conditions] as any;
}

export default function MapView({
  mapRef,
  isGlobe,
  isLive,
  historicalDate,
  scrubMinutesAgo,
  overlays,
  mapStyle,
  onVesselsUpdate,
  onVesselClick,
  onRouteCountUpdate,
  onToggleGlobe,
  onToggleOverlay,
  onZoomChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const fetchVesselsRef = useRef<(() => void) | null>(null);
  const trackFeaturesRef = useRef<GeoJSON.Feature[]>([]);

  const onVesselsUpdateRef = useRef(onVesselsUpdate);
  const onVesselClickRef = useRef(onVesselClick);
  const onRouteCountUpdateRef = useRef(onRouteCountUpdate);
  const onZoomChangeRef = useRef(onZoomChange);
  onVesselsUpdateRef.current = onVesselsUpdate;
  onZoomChangeRef.current = onZoomChange;
  onVesselClickRef.current = onVesselClick;
  onRouteCountUpdateRef.current = onRouteCountUpdate;

  // Helper: update track display based on scrub position
  const scrubRef = useRef(scrubMinutesAgo);
  scrubRef.current = scrubMinutesAgo;

  function updateTrackDisplay(map: maplibregl.Map) {
    const features = trackFeaturesRef.current;
    const trackSrc = map.getSource("selected-track") as maplibregl.GeoJSONSource | undefined;
    const ghostSrc = map.getSource("ghost-track") as maplibregl.GeoJSONSource | undefined;
    const scrubPosSrc = map.getSource("scrub-position") as maplibregl.GeoJSONSource | undefined;
    if (!trackSrc) return;

    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (features.length === 0) {
      trackSrc.setData(empty);
      if (ghostSrc) ghostSrc.setData(empty);
      if (scrubPosSrc) scrubPosSrc.setData(empty);
      return;
    }

    const allPoints: [number, number][] = features.map((f: any) => f.geometry.coordinates);

    // Ghost line = full track (always visible)
    if (ghostSrc && allPoints.length >= 2) {
      ghostSrc.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: allPoints } }],
      });
    }

    // Filter by scrub time
    const cutoff = scrubRef.current > 0
      ? new Date(Date.now() - scrubRef.current * 60_000).toISOString()
      : null;

    const filtered = cutoff
      ? features.filter((f: any) => f.properties?.recorded_at && f.properties.recorded_at <= cutoff)
      : features;

    const points: [number, number][] = filtered.map((f: any) => f.geometry.coordinates);

    // Orange line = track up to scrub point
    if (points.length >= 2) {
      trackSrc.setData({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } },
          ...filtered,
        ],
      });
    } else if (points.length === 1) {
      trackSrc.setData({ type: "FeatureCollection", features: filtered });
    } else {
      trackSrc.setData(empty);
    }

    // Scrub position marker (ship at scrub time)
    if (scrubPosSrc && cutoff && filtered.length > 0) {
      const lastPoint = filtered[filtered.length - 1] as any;
      // Calculate bearing from previous point to current (actual movement direction)
      let bearing = lastPoint.properties?.heading ?? 0;
      if (filtered.length >= 2) {
        const prev = filtered[filtered.length - 2] as any;
        const [lon1, lat1] = prev.geometry.coordinates;
        const [lon2, lat2] = lastPoint.geometry.coordinates;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const lat1r = lat1 * Math.PI / 180;
        const lat2r = lat2 * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2r);
        const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
        bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      }
      scrubPosSrc.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {
            heading: bearing,
            speed: lastPoint.properties?.speed ?? 0,
          },
          geometry: lastPoint.geometry,
        }],
      });
    } else if (scrubPosSrc) {
      scrubPosSrc.setData(empty);
    }
  }

  // React to scrub changes (single vessel track display)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    updateTrackDisplay(map);
  }, [scrubMinutesAgo]);

  // Sync overlay state to map layers
  const prevOverlaysRef = useRef(overlays);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const ov = overlays;
    try {
      map.setLayoutProperty("openseamap", "visibility", ov.seamarks ? "visible" : "none");
      map.setLayoutProperty("vessel-predictions", "visibility", ov.predictions ? "visible" : "none");
      map.setLayoutProperty("vessel-labels", "visibility", ov.names ? "visible" : "none");
      map.setFilter("ais-vessels", buildVesselFilter(ov));
    } catch {
      // Layers not ready
    }
    prevOverlaysRef.current = ov;
  }, [overlays]);

  // Swap map tiles when style changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      const baseSrc = map.getSource("carto-dark") as any;
      const labelSrc = map.getSource("carto-labels") as any;
      if (baseSrc) baseSrc.setTiles([MAP_TILES[mapStyle].base]);
      if (labelSrc) labelSrc.setTiles([MAP_TILES[mapStyle].labels]);
    } catch { /* not ready */ }
  }, [mapStyle]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const map = new maplibregl.Map({
      attributionControl: false,
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [MAP_TILES[mapStyle].base],
            tileSize: 256,
            attribution: "&copy; CARTO &copy; OpenStreetMap",
          },
          "carto-labels": {
            type: "raster",
            tiles: [MAP_TILES[mapStyle].labels],
            tileSize: 256,
          },
        },
        layers: [
          { id: "carto-dark", type: "raster", source: "carto-dark", minzoom: 0, maxzoom: 19 },
          { id: "carto-labels", type: "raster", source: "carto-labels", minzoom: 0, maxzoom: 19 },
        ],
      },
      center: [12.5, 55.7],
      zoom: 2,
      maxPitch: 85,
    } as maplibregl.MapOptions);

    mapRef.current = map;

    // Build instant wake trails: short line behind each moving vessel based on course+speed
    function buildTrailsFromFeatures(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
      const trailFeatures: GeoJSON.Feature[] = [];
      for (const f of features) {
        const p = f.properties ?? {};
        const speed = p.speed ?? 0;
        if (speed < 0.5) continue;
        const course = p.course ?? p.heading ?? 0;
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
        // Trail length proportional to speed: ~8 min of travel, capped
        const nm = Math.min(speed * (8 / 60), 10); // nautical miles, max 10nm
        const deg = nm / 60; // rough nm to degrees
        const rad = ((course + 180) % 360) * Math.PI / 180; // reverse direction
        const dLat = deg * Math.cos(rad);
        const dLon = deg * Math.sin(rad) / Math.cos(lat * Math.PI / 180);
        trailFeatures.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: [[lon, lat], [lon + dLon, lat + dLat]] },
          properties: { mmsi: p.mmsi },
        });
      }
      return { type: "FeatureCollection", features: trailFeatures };
    }

    async function fetchVessels() {
      const { data, error } = await supabase.rpc("get_live_vessels_compact");
      if (error || !data) return;

      // Compact format: [[mmsi, lat, lon, speed, course, heading, nav_status, ship_type], ...]
      // Convert to GeoJSON
      let geojson: GeoJSON.FeatureCollection;
      if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
        geojson = {
          type: "FeatureCollection",
          features: data.map((r: number[]) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [r[2], r[1]] },
            properties: {
              mmsi: r[0], name: "", ship_type: r[7], speed: r[3],
              course: r[4], heading: r[5], nav_status: r[6],
              destination: "", source: "aisstream",
              prev_lat: r[8], prev_lon: r[9],
            },
          })),
        };
      } else {
        // GeoJSON from get_vessels_at_time or legacy format
        geojson = typeof data === "string" ? JSON.parse(data) : data;
      }
      const features: GeoJSON.Feature[] = geojson?.features ?? [];

      onVesselsUpdateRef.current(features.map(vesselFromFeature));

      // Build trails from prev_lat/prev_lon (instant, no accumulation)
      const trailGeoJSON = buildTrailsFromFeatures(features);

      const src = map.getSource("vessels") as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);

      const predSrc = map.getSource("predictions") as maplibregl.GeoJSONSource | undefined;
      if (predSrc) predSrc.setData(buildPredictions(geojson));

      // Update trails from server-side prev position (instant)
      const trailSrc = map.getSource("trails") as maplibregl.GeoJSONSource | undefined;
      if (trailSrc) trailSrc.setData(trailGeoJSON);
    }

    map.on("load", () => {
      // Globe projection
      try { (map as any).setProjection({ type: "globe" }); } catch {}

      // Dark atmosphere
      try {
        (map as any).setFog({
          color: "#0d1b2a",
          "high-color": "#0a1525",
          "horizon-blend": 0.04,
          "space-color": "#111820",
          "star-intensity": 0.15,
        });
      } catch {}

      // Generate vessel icons via canvas (sync)
      const iconColors: Record<string, string> = {
        cargo: "#4a8f4a", tanker: "#c44040", passenger: "#4a90d9",
        fishing: "#d4a017", sailing: "#2ba8c8", special: "#e07020", unknown: "#4a8f4a",
      };
      // Sharp arrow shape like MarineTraffic — narrow, pointy
      const makeArrow = (color: string, w: number, h: number): ImageData => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);           // tip
        ctx.lineTo(w - 1, h);           // bottom right
        ctx.lineTo(w / 2, h * 0.7);     // notch center
        ctx.lineTo(1, h);               // bottom left
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        return ctx.getImageData(0, 0, w, h);
      };
      const makeCircle = (color: string, size: number): ImageData => {
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        return ctx.getImageData(0, 0, size, size);
      };
      for (const [name, color] of Object.entries(iconColors)) {
        const arrow = makeArrow(color, 12, 20);
        map.addImage(`tri-${name}`, { width: 12, height: 20, data: new Uint8Array(arrow.data.buffer) });
        const circ = makeCircle(color, 10);
        map.addImage(`circ-${name}`, { width: 10, height: 10, data: new Uint8Array(circ.data.buffer) });
      }
      // Orange scrub marker icon
      const scrubArrow = makeArrow("#ff9500", 16, 26);
      map.addImage("tri-scrub", { width: 16, height: 26, data: new Uint8Array(scrubArrow.data.buffer) });

      // Sources
      map.addSource("vessels", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 5,
        clusterRadius: 50,
      });
      map.addSource("predictions", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("ghost-track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("selected-track", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("scrub-position", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("openseamap", {
        type: "raster",
        tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
        tileSize: 256,
      });

      // Layers — ordered bottom to top

      // OpenSeaMap (default OFF)
      map.addLayer({
        id: "openseamap",
        type: "raster",
        source: "openseamap",
        minzoom: 10,
        paint: { "raster-opacity": 0.8 },
        layout: { visibility: "none" },
      });

      // Clusters
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "vessels",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step", ["get", "point_count"],
            "rgba(43, 168, 200, 0.6)", 100,
            "rgba(43, 168, 200, 0.7)", 500,
            "rgba(43, 168, 200, 0.8)",
          ],
          "circle-radius": ["step", ["get", "point_count"], 15, 100, 20, 500, 25],
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "vessels",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 11 },
        paint: { "text-color": "#ffffff" },
      });

      // Vessel trails (short blue tails behind moving vessels)
      map.addLayer({
        id: "vessel-trails",
        type: "line",
        source: "trails",
        paint: {
          "line-color": "#6b8aff",
          "line-width": 1.5,
          "line-opacity": 0.4,
        },
      });

      // Ghost track (full route, faded white)
      map.addLayer({
        id: "ghost-track-line",
        type: "line",
        source: "ghost-track",
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.5,
          "line-opacity": 0.2,
          "line-dasharray": [2, 4],
        },
      });

      // Selected vessel track (yellow line with waypoint dots)
      map.addLayer({
        id: "selected-track-line",
        type: "line",
        source: "selected-track",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#ffd633",
          "line-width": 2.5,
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "selected-track-dots",
        type: "circle",
        source: "selected-track",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": 3,
          "circle-color": "#ffd633",
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
        },
      });

      // Scrub position marker (ship icon at scrub time)
      map.addLayer({
        id: "scrub-position",
        type: "symbol",
        source: "scrub-position",
        layout: {
          "icon-image": "tri-scrub",
          "icon-size": 1.2,
          "icon-rotate": ["to-number", ["get", "heading"], 0],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        } as any,
        paint: {
          "icon-opacity": 1,
        },
      });

      // Vessel icons (MarineTraffic style)
      // Use match with explicit values — more reliable than range comparisons
      const spd = ["to-number", ["get", "speed"], 0];
      const uw = [">", spd, 0.5];
      // Map ship_type to category name
      const typeCategory = [
        "match", ["get", "ship_type"],
        [70,71,72,73,74,75,76,77,78,79], "cargo",
        [80,81,82,83,84,85,86,87,88,89], "tanker",
        [60,61,62,63,64,65,66,67,68,69], "passenger",
        [30,31,32,33,34,35], "fishing",
        [36,37], "sailing",
        [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59], "special",
        "unknown",
      ];
      map.addLayer({
        id: "ais-vessels",
        type: "symbol",
        source: "vessels",
        filter: buildVesselFilter(DEFAULT_OVERLAYS),
        layout: {
          "icon-image": [
            "concat",
            ["case", uw, "tri-", "circ-"],
            typeCategory,
          ] as any,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 8, 0.8, 14, 1.2] as any,
          "icon-rotate": ["case", uw, ["to-number", ["get", "heading"], 0], 0] as any,
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": ["case", uw, 0.95, 0.5] as any,
        },
      } as any);

      // Vessel labels (default OFF)
      map.addLayer({
        id: "vessel-labels",
        type: "symbol",
        source: "vessels",
        filter: ["!", ["has", "point_count"]],
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          visibility: "none",
        },
        paint: {
          "text-color": "#2a4a5a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      });

      // Predicted course lines (default ON)
      map.addLayer({
        id: "vessel-predictions",
        type: "line",
        source: "predictions",
        minzoom: 4,
        paint: {
          "line-color": "#ffffff",
          "line-width": 1.5,
          "line-opacity": 0.5,
          "line-dasharray": [2, 3],
        },
      });

      // Historical routes
      map.addLayer({
        id: "historical-routes",
        type: "line",
        source: "routes",
        paint: { "line-color": "#f59e0b", "line-width": 1.5, "line-opacity": 0.6 },
        layout: { visibility: "none" },
      });

      // Click vessel — show popup + fetch full yellow track with waypoints
      map.on("click", "ais-vessels", async (e) => {
        if (e.features?.[0]) {
          const p = e.features[0].properties;
          const mmsi = p.mmsi;
          onVesselClickRef.current({
            mmsi,
            ship_name: p.name ?? p.ship_name,
            lat: (e.features[0].geometry as GeoJSON.Point).coordinates[1],
            lon: (e.features[0].geometry as GeoJSON.Point).coordinates[0],
            sog: p.speed ?? p.sog,
            cog: p.cog ?? null,
            heading: p.heading,
            speed: p.speed ?? p.sog,
            ship_type: p.ship_type,
            destination: p.destination,
            source: p.source,
          });

          // Fetch vessel track (all available history)
          const { data } = await supabase.rpc("get_vessel_track", { p_mmsi: mmsi, p_minutes: 2880 });
          if (data) {
            const geojson = typeof data === "string" ? JSON.parse(data) : data;
            trackFeaturesRef.current = geojson.features ?? [];
            updateTrackDisplay(map);
          }
        }
      });

      // Click on empty map — clear selection
      map.on("click", (e) => {
        const vessels = map.queryRenderedFeatures(e.point, { layers: ["ais-vessels", "clusters"] });
        if (!vessels.length) {
          // Clear all track layers
          trackFeaturesRef.current = [];
          const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
          const trackSrc = map.getSource("selected-track") as maplibregl.GeoJSONSource | undefined;
          const ghostSrc = map.getSource("ghost-track") as maplibregl.GeoJSONSource | undefined;
          const scrubPosSrc = map.getSource("scrub-position") as maplibregl.GeoJSONSource | undefined;
          if (trackSrc) trackSrc.setData(empty);
          if (ghostSrc) ghostSrc.setData(empty);
          if (scrubPosSrc) scrubPosSrc.setData(empty);
        }
      });

      map.on("click", "clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        const src = map.getSource("vessels") as maplibregl.GeoJSONSource;
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number], zoom });
        });
      });

      // Hover
      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "ais-vessels", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "ais-vessels", () => {
        map.getCanvas().style.cursor = "";
      });

      // Track zoom level
      map.on("zoomend", () => {
        onZoomChangeRef.current?.(Math.round(map.getZoom()));
      });

      // Fetch data
      fetchVesselsRef.current = fetchVessels;
      fetchVessels();
      refreshTimerRef.current = setInterval(fetchVessels, 30_000);
    });

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      map.remove();
      initializedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle projection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try { (map as any).setProjection({ type: isGlobe ? "globe" : "mercator" }); } catch {}
  }, [isGlobe, mapRef]);

  // Switch between live and historical
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const liveLayerIds = ["ais-vessels", "clusters", "cluster-count", "vessel-predictions", "vessel-labels"];

    if (isLive) {
      try {
        for (const id of liveLayerIds) map.setLayoutProperty(id, "visibility", "visible");
        map.setLayoutProperty("historical-routes", "visibility", "none");
      } catch {}
    } else if (historicalDate) {
      try {
        for (const id of liveLayerIds) map.setLayoutProperty(id, "visibility", "none");
        map.setLayoutProperty("historical-routes", "visibility", "visible");
      } catch {}

      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);

      (async () => {
        const { data, error } = await supabase.rpc("get_routes_for_date", { p_date: historicalDate });
        if (error || !data) { onRouteCountUpdateRef.current(0); return; }
        onRouteCountUpdateRef.current(data.length);
        const geojson: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: data
            .filter((r: { geojson: unknown }) => r.geojson)
            .map((r: { mmsi: number; ship_name: string; distance_nm: number; avg_speed: number; geojson: GeoJSON.Geometry }) => ({
              type: "Feature" as const,
              geometry: typeof r.geojson === "string" ? JSON.parse(r.geojson) : r.geojson,
              properties: { mmsi: r.mmsi, ship_name: r.ship_name, distance_nm: r.distance_nm, avg_speed: r.avg_speed },
            })),
        };
        const src = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
        if (src) src.setData(geojson);
      })();
    }
  }, [isLive, historicalDate, mapRef]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ background: "#e8e8e8" }}
      />

      {/* Globe/Map Segmented Control */}
      <div style={{
        position: "absolute",
        top: "12px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        background: "rgba(30, 30, 34, 0.75)",
        backdropFilter: "blur(12px)",
        borderRadius: "7px",
        padding: "2px",
        zIndex: 10,
      }}>
        <button
          onClick={() => { try { (mapRef.current as any)?.setProjection({ type: "globe" }); mapRef.current?.jumpTo({ zoom: 2 }); } catch {} onToggleGlobe(true); }}
          style={{
            padding: "5px 14px", fontSize: "11px", fontWeight: 600, border: "none",
            cursor: "pointer", transition: "all 0.2s",
            borderRadius: "5px",
            background: isGlobe ? "rgba(255, 255, 255, 0.9)" : "transparent",
            color: isGlobe ? "#1c1c1e" : "rgba(255, 255, 255, 0.6)",
            boxShadow: isGlobe ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}
        >Globe</button>
        <button
          onClick={() => { try { (mapRef.current as any)?.setProjection({ type: "mercator" }); } catch {} onToggleGlobe(false); }}
          style={{
            padding: "5px 14px", fontSize: "11px", fontWeight: 600, border: "none",
            cursor: "pointer", transition: "all 0.2s",
            borderRadius: "5px",
            background: !isGlobe ? "rgba(255, 255, 255, 0.9)" : "transparent",
            color: !isGlobe ? "#1c1c1e" : "rgba(255, 255, 255, 0.6)",
            boxShadow: !isGlobe ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}
        >Map</button>
      </div>

    </div>
  );
}
