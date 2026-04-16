// ingest-positions — Supabase Edge Function (v8)
// Append-only ingest with full-accounting rejection observability.
//
// Normalise → validate → INSERT positions_v2 + UPSERT entity_last via
// ingest_positions_v2 RPC. Rejections are classified per reason and
// persisted to ingest_stats.reject_reasons so PI rejection rate is visible
// in SQL, not just in the Edge Function console.
//
// Changes vs v7:
//   - Teleportation rejects → write_anomalies_batch RPC. The intra-batch
//     anti-teleportation check already catches impossible hops (MMSI hijack,
//     spoofing, GPS glitch). Up to v7 we just threw the offending row away
//     and bumped a counter. Now we keep the evidence: prev lat/lon/t, next
//     lat/lon/t, computed speed m/s, dt seconds — written to the anomalies
//     table as severity='warn'. Best-effort: a failing anomaly log never
//     breaks the main ingest path.
//
// Changes vs v6:
//   - Fix: supabase-js rpc() returns a PostgrestBuilder (PromiseLike), not
//     a real Promise, so `.catch()` is undefined. Wrapped ensure_partition
//     calls in try/catch instead — this was the root cause of the 500
//     storm observed Apr 16 11:50+ UTC.
//
// Changes vs v2:
//   - Widened MMSI range: 1 ≤ mmsi ≤ 999_999_999
//     (accepts base stations 00MID…, SAR aircraft 111MID…, AtoN 99MID…,
//     SART/MOB/EPIRB 97xMID…, which pyais strips leading zeros from.)
//   - Zero-pads MMSI to 9 digits so entities.domain_meta.mmsi is consistent.
//   - Per-reason counters: mmsi_invalid, invalid_coords, out_of_bounds,
//     null_island, teleportation, duplicate_within_batch.
//   - Passes p_edge_rejected + p_edge_reasons to the RPC for persistence.
//   - Top-level try/catch surfaces unhandled exceptions in the HTTP body.
//
// Deno runtime.

import { createClient } from "npm:@supabase/supabase-js@2"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawPosition {
  mmsi?: unknown; MMSI?: unknown
  lat?: unknown; latitude?: unknown; Latitude?: unknown
  lon?: unknown; longitude?: unknown; Longitude?: unknown; lng?: unknown
  speed?: unknown; sog?: unknown; SOG?: unknown
  course?: unknown; cog?: unknown; COG?: unknown
  heading?: unknown; HDG?: unknown; hdg?: unknown
  rot?: unknown; ROT?: unknown
  nav_status?: unknown; status?: unknown
  timestamp?: unknown; t?: unknown
  shipname?: unknown; vessel_name?: unknown; name?: unknown
  ship_type?: unknown; type_and_cargo?: unknown
  country?: unknown; imo?: unknown
}

interface NormalizedRow {
  mmsi: number            // numeric form (leading zeros stripped)
  mmsi_str: string        // 9-digit zero-padded canonical form
  lat: number
  lon: number
  t: number               // unix epoch seconds
  sog: number | null      // knots (original)
  cog: number | null
  hdg: number | null
  vessel_name: string | null
}

type RejectReason =
  | "mmsi_invalid"
  | "invalid_coords"
  | "out_of_bounds"
  | "null_island"
  | "teleportation"
  | "duplicate_within_batch"

// Evidence row for the anomalies table — populated on teleportation rejects.
interface TeleportEvidence {
  mmsi: number
  anomaly_type: "teleportation"
  severity: "warn"
  details: {
    prev_lat: number
    prev_lon: number
    prev_t: number
    lat: number
    lon: number
    t: number
    dist_m: number
    dt_s: number
    speed_ms: number
    max_speed_ms: number
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SPEED_MS = 30              // ~58 knots — hard reject on intra-batch hops
const NULL_ISLAND_THRESHOLD = 0.001
const DEDUP_WINDOW_SEC = 1           // same MMSI within 1 s and < 10 m → dup
const DEDUP_DIST_M = 10

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function haversine(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function padMmsi(n: number): string {
  return String(Math.trunc(n)).padStart(9, "0")
}

// ---------------------------------------------------------------------------
// Normalise + validate
// ---------------------------------------------------------------------------

function normalizeAndValidate(
  raw: RawPosition,
  prevByMmsi: Map<number, { lat: number; lon: number; t: number }>,
  bump: (reason: RejectReason) => void,
  anomalies: TeleportEvidence[],
): NormalizedRow | null {
  const mmsi = toNum(raw.mmsi ?? raw.MMSI)
  // Widened range — accept base stations, AtoN, SAR aircraft, beacons.
  if (mmsi == null || !Number.isFinite(mmsi) || mmsi < 1 || mmsi > 999999999) {
    bump("mmsi_invalid")
    return null
  }

  const lat = toNum(raw.lat ?? raw.latitude ?? raw.Latitude)
  const lon = toNum(raw.lon ?? raw.longitude ?? raw.Longitude ?? raw.lng)
  if (lat == null || lon == null) {
    bump("invalid_coords")
    return null
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    bump("out_of_bounds")
    return null
  }
  if (Math.abs(lat) < NULL_ISLAND_THRESHOLD && Math.abs(lon) < NULL_ISLAND_THRESHOLD) {
    bump("null_island")
    return null
  }

  // Timestamp: accept unix seconds, unix ms, or ISO string
  let t: number
  const rawT = raw.t ?? raw.timestamp
  if (rawT == null) {
    t = Date.now() / 1000
  } else if (typeof rawT === "string") {
    t = new Date(rawT).getTime() / 1000
  } else {
    const num = Number(rawT)
    t = num > 1e12 ? num / 1000 : num
  }

  // Intra-batch anti-teleportation + dedup
  const prev = prevByMmsi.get(mmsi)
  if (prev) {
    const dist = haversine(prev.lon, prev.lat, lon, lat)
    const dtSec = Math.abs(t - prev.t)

    // Dual-channel duplicate: same MMSI, near-same spot, near-same time.
    // Drop silently as "duplicate" rather than teleport.
    if (dtSec <= DEDUP_WINDOW_SEC && dist <= DEDUP_DIST_M) {
      bump("duplicate_within_batch")
      return null
    }

    // Only flag teleportation when we have real forward motion to compare.
    if (dtSec > 0 && dist / dtSec > MAX_SPEED_MS) {
      bump("teleportation")
      anomalies.push({
        mmsi,
        anomaly_type: "teleportation",
        severity: "warn",
        details: {
          prev_lat: prev.lat,
          prev_lon: prev.lon,
          prev_t: prev.t,
          lat,
          lon,
          t,
          dist_m: Math.round(dist),
          dt_s: Math.round(dtSec * 10) / 10,
          speed_ms: Math.round((dist / dtSec) * 10) / 10,
          max_speed_ms: MAX_SPEED_MS,
        },
      })
      return null
    }
  }

  const sog = toNum(raw.speed ?? raw.sog ?? raw.SOG)
  const cog = toNum(raw.course ?? raw.cog ?? raw.COG)
  const hdg = toNum(raw.heading ?? raw.HDG ?? raw.hdg)
  const vessel_name = (raw.shipname ?? raw.vessel_name ?? raw.name ?? null) as string | null

  prevByMmsi.set(mmsi, { lat, lon, t })

  return {
    mmsi,
    mmsi_str: padMmsi(mmsi),
    lat, lon, t, sog, cog, hdg,
    vessel_name: vessel_name ? String(vessel_name).trim().replace(/@+$/, "").trim() || null : null,
  }
}

// ---------------------------------------------------------------------------
// Edge Function entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  try {
    return await handle(req)
  } catch (e) {
    const err = e as Error
    console.error("[ingest-positions] FATAL:", err.message, err.stack)
    return new Response(JSON.stringify({
      error: "unhandled",
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 8),
    }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})

async function handle(req: Request): Promise<Response> {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-source",
      },
    })
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 })
  }

  // Auth
  const apiKey = req.headers.get("x-api-key") ?? req.headers.get("apikey")
  const expectedKey = Deno.env.get("INGEST_API_KEY")
  if (expectedKey && apiKey !== expectedKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sourceName = req.headers.get("x-source") ?? "pi4_rtlsdr"

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const rawRows: RawPosition[] = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>).positions)
      ? (body as Record<string, unknown>).positions as RawPosition[]
      : []

  if (rawRows.length === 0) {
    return Response.json({ error: "No positions in payload" }, { status: 400 })
  }

  // --- Per-reason counters ---
  const reasons: Record<RejectReason, number> = {
    mmsi_invalid: 0,
    invalid_coords: 0,
    out_of_bounds: 0,
    null_island: 0,
    teleportation: 0,
    duplicate_within_batch: 0,
  }
  const bump = (reason: RejectReason) => { reasons[reason]++ }

  // --- Normalise + validate all rows ---
  const prevByMmsi = new Map<number, { lat: number; lon: number; t: number }>()
  const valid: NormalizedRow[] = []
  const anomalies: TeleportEvidence[] = []

  for (const raw of rawRows) {
    const row = normalizeAndValidate(raw, prevByMmsi, bump, anomalies)
    if (row) valid.push(row)
  }

  const edgeRejected =
    reasons.mmsi_invalid + reasons.invalid_coords + reasons.out_of_bounds +
    reasons.null_island + reasons.teleportation + reasons.duplicate_within_batch

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  )

  // Best-effort anomaly logging. Teleportation rejects are evidence, not noise —
  // keep the prev/next pair for later analysis (spoofing, MMSI hijack, GPS glitch).
  // A failing anomaly log must NEVER break the main ingest path.
  if (anomalies.length > 0) {
    try {
      const { error: anomErr } = await supabase.rpc("write_anomalies_batch", {
        p_rows: anomalies,
        p_source_name: sourceName,
      })
      if (anomErr) {
        console.error("[ingest-positions] anomaly log error:", anomErr.message)
      }
    } catch (e) {
      console.error("[ingest-positions] anomaly log exception:", (e as Error).message)
    }
  }

  // Early exit: nothing valid — still log the batch so rejection rate is visible.
  if (valid.length === 0) {
    const { error: logErr } = await supabase.rpc("ingest_positions_v2", {
      p_rows: [],
      p_source_name: sourceName,
      p_edge_rejected: edgeRejected,
      p_edge_reasons: reasons,
    })
    if (logErr) console.error("[ingest-positions] empty-batch log error:", logErr.message)

    console.log(
      `[ingest-positions] source=${sourceName} batch=${rawRows.length} accepted=0 ` +
      `edge_rejected=${edgeRejected} reasons=${JSON.stringify(reasons)}`
    )
    return Response.json({
      accepted: 0,
      rejected: edgeRejected,
      edge_rejected: edgeRejected,
      rpc_rejected: 0,
      reject_reasons: reasons,
      anomalies_logged: anomalies.length,
      source: sourceName,
    })
  }

  // Ensure partition for today and tomorrow (cheap idempotent call).
  // NOTE: supabase-js rpc() returns a PostgrestBuilder (PromiseLike), NOT a Promise,
  // so `.catch()` does not exist on it. Must wrap in try/catch instead.
  const today = new Date()
  const tomorrow = new Date(today.getTime() + 86400000)
  try { await supabase.rpc("ensure_partition", { p_date: today.toISOString().slice(0, 10) }) } catch { /* idempotent */ }
  try { await supabase.rpc("ensure_partition", { p_date: tomorrow.toISOString().slice(0, 10) }) } catch { /* idempotent */ }

  // Build RPC rows — pass numeric mmsi (RPC pads internally) but include padded
  // form for debugging round-trip consistency.
  const rpcRows = valid.map(row => ({
    mmsi: row.mmsi,
    mmsi_str: row.mmsi_str,
    lat: row.lat,
    lon: row.lon,
    t: row.t,
    sog: row.sog,
    cog: row.cog,
    hdg: row.hdg,
    vessel_name: row.vessel_name,
  }))

  const { data: rpcResult, error: rpcError } = await supabase.rpc("ingest_positions_v2", {
    p_rows: rpcRows,
    p_source_name: sourceName,
    p_edge_rejected: edgeRejected,
    p_edge_reasons: reasons,
  })

  if (rpcError) {
    console.error("[ingest-positions] RPC error:", rpcError.message)
    return Response.json({ error: "Storage failed", detail: rpcError.message }, { status: 500 })
  }

  const result = rpcResult as {
    accepted?: number
    rejected?: number
    reject_reasons?: Record<string, number>
    error?: string
  } | null

  if (result?.error) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  const rpcAccepted = result?.accepted ?? valid.length
  const rpcRejected = result?.rejected ?? 0
  const totalRejected = edgeRejected + rpcRejected

  console.log(
    `[ingest-positions] source=${sourceName} batch=${rawRows.length} ` +
    `accepted=${rpcAccepted} edge_rejected=${edgeRejected} rpc_rejected=${rpcRejected} ` +
    `anomalies=${anomalies.length} reasons=${JSON.stringify(reasons)}`
  )

  return new Response(JSON.stringify({
    accepted: rpcAccepted,
    rejected: totalRejected,
    edge_rejected: edgeRejected,
    rpc_rejected: rpcRejected,
    reject_reasons: reasons,
    rpc_reject_reasons: result?.reject_reasons ?? {},
    anomalies_logged: anomalies.length,
    source: sourceName,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
