// ingest-ais — Supabase Edge Function
// Modtager AIS-positioner fra Pi, normaliserer, validerer, gemmer via ingest_ais_batch RPC
// Deno runtime — ingen Node.js imports

import { createClient } from "npm:@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawAisPosition {
  mmsi?: unknown
  MMSI?: unknown
  lat?: unknown
  latitude?: unknown
  Latitude?: unknown
  lon?: unknown
  longitude?: unknown
  Longitude?: unknown
  speed?: unknown
  sog?: unknown
  SOG?: unknown
  course?: unknown
  cog?: unknown
  COG?: unknown
  heading?: unknown
  HDG?: unknown
  rot?: unknown
  ROT?: unknown
  nav_status?: unknown
  status?: unknown
  timestamp?: unknown
  shipname?: unknown
  vessel_name?: unknown
  ship_type?: unknown
  type_and_cargo?: unknown
  country?: unknown
  imo?: unknown
}

interface NormalizedPosition {
  mmsi: string
  lat: number
  lon: number
  alt: number           // AIS = 0 altid
  t: number             // unix ms
  speed_ms: number      // m/s (konverteret fra knob)
  sog_kn: number        // original knob (gemmes i domain_fields)
  bearing: number       // COG grader
  heading: number
  rot: number
  nav_status: unknown
  vessel_name: string | null
  vessel_type: number | null
  imo: number | null
  flag: string | null
}

interface RejectedPosition {
  index: number
  mmsi: unknown
  reason: string
}

// ---------------------------------------------------------------------------
// Konstanter
// ---------------------------------------------------------------------------

const MAX_SPEED_MS = 30          // ~58 knob — absolutt grænse for AIS
const MIN_MOVEMENT_M = 5         // under 5m = stationary, skip
const NULL_ISLAND_THRESHOLD = 0.001

// ---------------------------------------------------------------------------
// Hjælpefunktioner
// ---------------------------------------------------------------------------

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isValidMmsi(mmsi: unknown): boolean {
  if (typeof mmsi !== "number" && typeof mmsi !== "string") return false
  return /^\d{9}$/.test(String(mmsi))
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v)
  return isNaN(n) ? fallback : n
}

// ---------------------------------------------------------------------------
// Normalisering — håndter alle kendte felt-konventioner fra AIS-decoders
// ---------------------------------------------------------------------------

function normalize(raw: RawAisPosition, idx: number): NormalizedPosition | { error: string; index: number } {
  const mmsi = raw.mmsi ?? raw.MMSI
  const lat = toNum(raw.lat ?? raw.latitude ?? raw.Latitude)
  const lon = toNum(raw.lon ?? raw.longitude ?? raw.Longitude)
  const sog_kn = toNum(raw.speed ?? raw.sog ?? raw.SOG)
  const cog = toNum(raw.course ?? raw.cog ?? raw.COG)
  const heading = toNum(raw.heading ?? raw.HDG, 511)
  const rot = toNum(raw.rot ?? raw.ROT, -128)
  const nav_status = raw.nav_status ?? raw.status ?? null
  const t = raw.timestamp ? new Date(raw.timestamp as string).getTime() : Date.now()

  if (!isValidMmsi(mmsi)) {
    return { error: "invalid_mmsi", index: idx }
  }

  return {
    mmsi: String(mmsi),
    lat,
    lon,
    alt: 0,
    t,
    speed_ms: sog_kn * 0.514444,
    sog_kn,
    bearing: cog,
    heading,
    rot,
    nav_status,
    vessel_name: (raw.shipname ?? raw.vessel_name ?? null) as string | null,
    vessel_type: raw.ship_type != null ? toNum(raw.ship_type) : raw.type_and_cargo != null ? toNum(raw.type_and_cargo) : null,
    imo: raw.imo != null ? toNum(raw.imo) : null,
    flag: (raw.country ?? null) as string | null,
  }
}

// ---------------------------------------------------------------------------
// Validering — kører på hvert punkt individuelt
// Anti-teleportation kræver forrige punkt for samme MMSI
// ---------------------------------------------------------------------------

function validate(
  pos: NormalizedPosition,
  idx: number,
  prevByMmsi: Map<string, NormalizedPosition>
): { ok: true } | { ok: false; reason: string } {
  // Null Island
  if (Math.abs(pos.lat) < NULL_ISLAND_THRESHOLD && Math.abs(pos.lon) < NULL_ISLAND_THRESHOLD) {
    return { ok: false, reason: "null_island" }
  }

  // Koordinat-grænser
  if (pos.lat < -90 || pos.lat > 90 || pos.lon < -180 || pos.lon > 180) {
    return { ok: false, reason: "invalid_coordinates" }
  }

  // Anti-teleportation — sammenlign med forrige punkt for dette MMSI i batchen
  const prev = prevByMmsi.get(pos.mmsi)
  if (prev) {
    const dist = haversine(prev.lon, prev.lat, pos.lon, pos.lat)
    const dtSec = (pos.t - prev.t) / 1000

    if (dtSec > 0) {
      const impliedSpeed = dist / dtSec
      if (impliedSpeed > MAX_SPEED_MS) {
        return { ok: false, reason: "teleportation" }
      }
    }

    if (dist < MIN_MOVEMENT_M) {
      return { ok: false, reason: "stationary" }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Edge Function entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Auth — tjek API key header
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("apikey")
  const expectedKey = Deno.env.get("INGEST_API_KEY")
  if (expectedKey && apiKey !== expectedKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // Acceptér { positions: [...] } eller direkte array
  const rawPositions: RawAisPosition[] = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>).positions)
      ? (body as Record<string, unknown>).positions as RawAisPosition[]
      : []

  if (rawPositions.length === 0) {
    return new Response(JSON.stringify({ error: "No positions in payload" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  // ---------------------------------------------------------------------------
  // Normaliser alle positioner
  // ---------------------------------------------------------------------------

  const normalized: NormalizedPosition[] = []
  const rejected: RejectedPosition[] = []

  for (let i = 0; i < rawPositions.length; i++) {
    const result = normalize(rawPositions[i], i)
    if ("error" in result) {
      rejected.push({ index: i, mmsi: rawPositions[i].mmsi ?? rawPositions[i].MMSI, reason: result.error })
    } else {
      normalized.push(result)
    }
  }

  // ---------------------------------------------------------------------------
  // Validér — anti-teleportation bruger forrige punkt per MMSI i denne batch
  // ---------------------------------------------------------------------------

  const prevByMmsi = new Map<string, NormalizedPosition>()
  const valid: NormalizedPosition[] = []

  for (let i = 0; i < normalized.length; i++) {
    const pos = normalized[i]
    const result = validate(pos, i, prevByMmsi)

    if (!result.ok) {
      rejected.push({ index: i, mmsi: pos.mmsi, reason: result.reason })
    } else {
      valid.push(pos)
      prevByMmsi.set(pos.mmsi, pos)
    }
  }

  if (valid.length === 0) {
    console.log(`[ingest-ais] all ${rawPositions.length} positions rejected:`, rejected)
    return new Response(JSON.stringify({
      accepted: 0,
      rejected: rejected.length,
      rejected_reasons: rejected,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  // ---------------------------------------------------------------------------
  // Storage — kald ingest_ais_batch RPC som håndterer:
  //   - find/opret entity
  //   - append til åben track (gap-detektion i SQL)
  //   - opdatér entity_last
  // Sender normaliserede rows — SQL-funktionen forventer:
  //   mmsi, lat, lon, sog (knob), cog, timestamp (ISO), vessel_name, vessel_type
  // ---------------------------------------------------------------------------

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  )

  const rpcRows = valid.map(pos => ({
    mmsi: pos.mmsi,
    lat: pos.lat,
    lon: pos.lon,
    sog: pos.sog_kn,                             // knob — SQL konverterer
    cog: pos.bearing,
    timestamp: new Date(pos.t).toISOString(),
    vessel_name: pos.vessel_name,
    vessel_type: pos.vessel_type,
    imo: pos.imo,
    country: pos.flag,
  }))

  const { data: rpcResult, error: rpcError } = await supabase.rpc("ingest_ais_batch", {
    p_rows: rpcRows,
  })

  if (rpcError) {
    console.error("[ingest-ais] ingest_ais_batch error:", rpcError)
    return new Response(JSON.stringify({
      error: "Storage failed",
      detail: rpcError.message,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }

  const result = rpcResult as { accepted: number; rejected: number } | null

  console.log(
    `[ingest-ais] batch=${rawPositions.length} normalized=${normalized.length}`,
    `pre_rejected=${rejected.length} sql_accepted=${result?.accepted ?? "?"} sql_rejected=${result?.rejected ?? "?"}`
  )

  // Log afviste for debugging
  if (rejected.length > 0) {
    console.log("[ingest-ais] pre-rejected:", JSON.stringify(rejected))
  }

  return new Response(JSON.stringify({
    accepted: result?.accepted ?? valid.length,
    rejected: rejected.length + (result?.rejected ?? 0),
    pre_validation_rejected: rejected,
    source: "pi_ais",
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
})
