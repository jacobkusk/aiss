"use client";

// Rendér orange prikker for alle både på et specifikt tidspunkt — smooth
// under drag.
//
// Strategi: pre-load et ±6 timers vindue af raw positioner rundt om det
// valgte tidspunkt — OG kun inden for kortets viewport (+30 % margin).
// Under drag interpolér vi client-side mellem punkter → instantaneous,
// ingen netværk. Kun når brugeren drager ud af vinduet (eller panner ud
// af loaded bbox) trigger vi en re-load af RPC'en.
//
// Hvorfor ikke bare kalde RPC'en pr. frame (som tidligere iteration):
// hver RPC koster 150-300 ms over netværk, og kortet re-tessellerer for hver
// setData. Ved kontinuert drag giver det et hakkende billede. Interpolation
// giver 60 fps uden at røre serveren.
//
// Hvorfor bbox-filter: hvis brugeren kun kigger på Øresund, er der ingen
// grund til at loade både fra Atlanten. 30 % margin giver plads til at
// panne rundt uden at trigge ny load med det samme.
//
// Hvorfor 12-timers tids-vindue (og ikke 72): 72 t = ~66k punkter = 6-10
// MB JSON, som ramte anon statement_timeout. 12 timer bbox-filtreret er
// <2 MB selv ved globalt zoom-out, langt under enhver timeout.

import { useEffect, useRef, useState } from "react";
import { useMap } from "./MapContext";
import { supabase } from "@/lib/supabase";

type MLGeoJSONSource = { setData: (data: GeoJSON.FeatureCollection) => void };

interface Props {
  atTime: number | null;     // epoch ms; null = skjul lag
  // Total vinduesstørrelse i timer (±halvdelen om atTime). Default 12 t.
  windowHours?: number;
}

interface Point {
  t: number;       // epoch seconds
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
}
type TrackMap = Map<number, { name: string | null; points: Point[] }>;

type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

const SOURCE = "moment-vessels-2";
const LAYER_DOT = "moment-vessel-dots-2";
const LAYER_COG = "moment-vessel-cog-2";
const LAYER_LABEL = "moment-vessel-labels-2";

// Reload RPC'en når atTime er inden for denne margin af vinduets kant.
// 30 min buffer giver brugeren god runway til at scrubbe før næste load.
const RELOAD_MARGIN_MIN = 30;
// Max 1 reload pr. 2 sekunder — ellers hamre vi serveren hvis brugeren
// hopper rundt med dato-vælger eller panner hurtigt.
const MIN_RELOAD_GAP_MS = 2000;
// Hvor meget skal vi loade udover det synlige viewport — 30 % i hver retning
// betyder vi henter en boks 1.6x større end det brugeren ser. Rigeligt til
// at panne lidt rundt uden at trigge ny load.
const BBOX_OVERSIZE = 0.3;

// Binary search + lineær interpolation. Returnerer null hvis tidspunktet
// ligger > 10 min uden for trackens endepunkter (båden var ikke aktiv da).
function interpolate(points: Point[], tMs: number): Point | null {
  if (!points.length) return null;
  const t = tMs / 1000;
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

// Udvid en bbox med procent i hver retning. 0.3 = 30 % mere i hver side.
function expandBbox(b: Bbox, frac: number): Bbox {
  const dx = (b.maxLon - b.minLon) * frac;
  const dy = (b.maxLat - b.minLat) * frac;
  return {
    minLon: b.minLon - dx,
    minLat: b.minLat - dy,
    maxLon: b.maxLon + dx,
    maxLat: b.maxLat + dy,
  };
}

// Er inner fuldt indeholdt i outer?
function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return outer.minLon <= inner.minLon
    && outer.minLat <= inner.minLat
    && outer.maxLon >= inner.maxLon
    && outer.maxLat >= inner.maxLat;
}

export default function MomentVesselLayer2({ atTime, windowHours = 12 }: Props) {
  const map = useMap();
  const [tracks, setTracks] = useState<TrackMap>(new Map());
  const initializedRef = useRef(false);

  // Hvilket tids- + bbox-vindue vi har loaded lige nu (epoch ms + lon/lat).
  const loadedRangeRef = useRef<{ start: number; end: number } | null>(null);
  const loadedBboxRef = useRef<Bbox | null>(null);
  const lastReloadAtRef = useRef<number>(0);
  const loadingRef = useRef(false);
  const unmountedRef = useRef(false);

  // Bump når kortet panner/zoomer — trigger effect'en til at tjekke om
  // synligt viewport stadig er inde i loadedBboxRef.
  const [viewportVersion, setViewportVersion] = useState(0);

  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  // ── 1. Registrér source + layers én gang ──────────────────────────────
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
        "circle-stroke-width": 0,
        "circle-opacity": 0.95,
      },
    });

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
        "text-color": "#f5d57a",
      },
    });

    return () => {
      try {
        for (const id of [LAYER_LABEL, LAYER_COG, LAYER_DOT]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      } catch { /* map destroyed */ }
      initializedRef.current = false;
    };
  }, [map]);

  // ── 1b. Lyt til kortets pan/zoom → bump viewportVersion ───────────────
  useEffect(() => {
    if (!map) return;
    const onMoveEnd = () => setViewportVersion((v) => v + 1);
    map.on("moveend", onMoveEnd);
    // Trigger én gang ved init så første load har bbox med.
    setViewportVersion((v) => v + 1);
    return () => { map.off("moveend", onMoveEnd); };
  }, [map]);

  // ── 2. Synlighed + clear når atTime = null ────────────────────────────
  useEffect(() => {
    if (!map) return;
    const visible = atTime != null;
    for (const id of [LAYER_DOT, LAYER_COG, LAYER_LABEL]) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
    if (atTime == null) {
      const src = map.getSource(SOURCE) as MLGeoJSONSource | undefined;
      src?.setData({ type: "FeatureCollection", features: [] });
    }
  }, [map, atTime]);

  // ── 3. Load track-vindue rundt om atTime + viewport (kun når nødvendigt) ─
  useEffect(() => {
    if (!map || atTime == null) return;

    // Aktuelt synligt viewport.
    const b = map.getBounds();
    const visibleBbox: Bbox = {
      minLon: b.getWest(),
      minLat: b.getSouth(),
      maxLon: b.getEast(),
      maxLat: b.getNorth(),
    };

    const halfMs = (windowHours / 2) * 3600_000;
    const range = loadedRangeRef.current;
    const loadedBbox = loadedBboxRef.current;
    const marginMs = RELOAD_MARGIN_MIN * 60_000;
    const timeInsideWithMargin = range
      && atTime >= range.start + marginMs
      && atTime <= range.end - marginMs;
    const bboxInside = loadedBbox && bboxContains(loadedBbox, visibleBbox);
    if (timeInsideWithMargin && bboxInside) return;

    const nowPerf = performance.now();
    if (loadingRef.current) return;
    if (nowPerf - lastReloadAtRef.current < MIN_RELOAD_GAP_MS) return;

    const targetStart = atTime - halfMs;
    const targetEnd = atTime + halfMs;
    const targetBbox = expandBbox(visibleBbox, BBOX_OVERSIZE);
    loadingRef.current = true;
    lastReloadAtRef.current = nowPerf;

    (async () => {
      const { data, error } = await supabase.rpc("get_tracks_in_range", {
        p_start:   new Date(targetStart).toISOString(),
        p_end:     new Date(targetEnd).toISOString(),
        p_min_lon: targetBbox.minLon,
        p_min_lat: targetBbox.minLat,
        p_max_lon: targetBbox.maxLon,
        p_max_lat: targetBbox.maxLat,
      });
      if (unmountedRef.current) { loadingRef.current = false; return; }

      if (error) {
        console.error("[moment] get_tracks_in_range failed:", {
          message: error.message,
          code: (error as { code?: string }).code,
          details: (error as { details?: string }).details,
          hint: (error as { hint?: string }).hint,
        });
        loadingRef.current = false;
        return;
      }

      let raw: unknown = data;
      if (typeof raw === "string") { try { raw = JSON.parse(raw as string); } catch { /* keep */ } }
      if (Array.isArray(raw)) raw = raw[0];
      if (typeof raw === "string") { try { raw = JSON.parse(raw as string); } catch { /* keep */ } }
      const obj = raw as { points?: Array<{ mmsi: number; name: string | null; lon: number; lat: number; sog: number | null; cog: number | null; t: number }> } | null;
      const pts = obj?.points ?? [];

      const m: TrackMap = new Map();
      for (const p of pts) {
        if (!m.has(p.mmsi)) m.set(p.mmsi, { name: p.name, points: [] });
        m.get(p.mmsi)!.points.push({ t: p.t, lat: p.lat, lon: p.lon, sog: p.sog, cog: p.cog });
      }
      m.forEach((v) => v.points.sort((a, b) => a.t - b.t));
      loadedRangeRef.current = { start: targetStart, end: targetEnd };
      loadedBboxRef.current = targetBbox;
      setTracks(m);
      loadingRef.current = false;
    })();
  }, [map, atTime, windowHours, viewportVersion]);

  // ── 4. Interpolér og render på hver atTime-ændring (instantaneous) ────
  useEffect(() => {
    if (!map || atTime == null) return;
    const src = map.getSource(SOURCE) as MLGeoJSONSource | undefined;
    if (!src) return;

    const features: GeoJSON.Feature[] = [];
    tracks.forEach((vessel, mmsi) => {
      const pos = interpolate(vessel.points, atTime);
      if (!pos) return;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pos.lon, pos.lat] },
        properties: { mmsi, name: vessel.name, sog: pos.sog, cog: pos.cog, t: pos.t },
      });
    });
    src.setData({ type: "FeatureCollection", features });
  }, [map, atTime, tracks]);

  return null;
}
