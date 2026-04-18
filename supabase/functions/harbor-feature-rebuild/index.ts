// harbor-feature-rebuild — Supabase Edge Function (v0, shell)
//
// Nightly aggregation of raw harbor_observations → refined harbor_features.
// Locked 2026-04-18 per shared/PLOTTER.md §"Havnekants-scanning".
//
// Status: SHELL. Full algorithm wired up in Uge 11-12 of solo-sprint. This
// file exists now so the scheduled task, deploy pipeline and monitoring can
// be stood up in parallel with the MVP UI work.
//
// Triggered nightly via pg_cron (02:00 UTC) — same pattern as auto-heal.
//
// ═══════════════════════════════════════════════════════════════════════
// Pipeline when fully implemented:
//
//  1. SELECT harbor_observations WHERE ingestion_status IN ('pending',
//     'reprocessing') ORDER BY observed_at.
//  2. Group by target harbor_feature_id (or spatial-cluster orphans).
//  3. For each group, pick algorithm based on sensor_mix:
//       - finger_trace + ar_waterline only      → v1.0_median_skeletonize
//       - any lidar observations present        → v1.1_lidar_fusion (v1.1)
//       - visual_slam present                   → v2.0_slam_mesh (v1.2)
//  4. Run chosen algorithm → (geom, precision_m, sensor_mix, counts).
//  5. Compare vs current active harbor_features row. If change exceeds
//     precision threshold, insert new version (version+1, active=true) and
//     flip old row to active=false in a single transaction.
//  6. UPDATE harbor_observations SET ingestion_status='processed',
//     refined_into = array_append(refined_into, new_harbor_feature_id).
//  7. Emit summary → heal_log.
//
// Algorithm v1.0_median_skeletonize (MVP):
//   - Rasterise all observation points onto 1×1 m grid.
//   - Median-filter to kill outliers.
//   - 2D skeletonization to extract centerline.
//   - Douglas-Peucker simplify to ε=0.3 m.
//   - Estimate precision as 1.4826 × MAD across contributing obs.
// ═══════════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

interface RebuildResult {
  harbor_id: string | null
  feature_kind: string
  status: "ok" | "skipped" | "failed"
  observations_in: number
  precision_m: number | null
  detail: string
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req)
  } catch (e) {
    const err = e as Error
    console.error("[harbor-feature-rebuild] FATAL:", err.message, err.stack)
    return new Response(JSON.stringify({
      error: "unhandled",
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 8),
    }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})

async function handle(_req: Request): Promise<Response> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const started = Date.now()
  const results: RebuildResult[] = []

  // ───────────────────────────────────────────────────────────────────
  // Step 1 — find pending observations.
  // Per CLAUDE.md edge-function-rules: never `.catch()` on supabase-js
  // chains (PostgrestBuilder is PromiseLike, not Promise). Use try/catch.
  // ───────────────────────────────────────────────────────────────────
  let pending: Array<{
    observation_id: string
    harbor_feature_id: string | null
    sensor_type: string
  }> = []

  try {
    const { data, error } = await supabase
      .from("harbor_observations")
      .select("observation_id, harbor_feature_id, sensor_type")
      .in("ingestion_status", ["pending", "reprocessing"])
      .order("observed_at", { ascending: true })
      .limit(10_000)

    if (error) throw error
    pending = data ?? []
  } catch (e) {
    const err = e as Error
    console.error("[harbor-feature-rebuild] step1 fetch pending failed:", err.message)
    return new Response(JSON.stringify({
      error: "step1_fetch_pending_failed",
      message: err.message,
    }), { status: 500, headers: { "Content-Type": "application/json" } })
  }

  if (pending.length === 0) {
    return ok({
      duration_ms: Date.now() - started,
      processed: 0,
      results: [],
      note: "no pending observations",
    })
  }

  // ───────────────────────────────────────────────────────────────────
  // Step 2 — group by harbor_feature_id (null-group = orphans, handled
  // separately with spatial clustering in v1.1+).
  // ───────────────────────────────────────────────────────────────────
  const byHarbor = new Map<string, typeof pending>()
  for (const obs of pending) {
    const key = obs.harbor_feature_id ?? "__orphans__"
    if (!byHarbor.has(key)) byHarbor.set(key, [])
    byHarbor.get(key)!.push(obs)
  }

  // ───────────────────────────────────────────────────────────────────
  // Step 3 — TODO (Uge 11-12): run algorithm per group.
  // Shell just marks observations as 'processed' so pipeline clears.
  // ───────────────────────────────────────────────────────────────────
  for (const [harborKey, obs] of byHarbor) {
    results.push({
      harbor_id: harborKey === "__orphans__" ? null : harborKey,
      feature_kind: "bolvaerk_waterline",
      status: "skipped",
      observations_in: obs.length,
      precision_m: null,
      detail: "shell: algorithm not yet implemented (Uge 11-12)",
    })
  }

  // ───────────────────────────────────────────────────────────────────
  // Step 4 — write summary to heal_log (reuse the existing table for
  // scheduled-task observability).
  // ───────────────────────────────────────────────────────────────────
  try {
    await supabase.from("heal_log").insert({
      check_name: "harbor_feature_rebuild",
      status: "ok",
      detail: JSON.stringify({
        duration_ms: Date.now() - started,
        groups: byHarbor.size,
        pending_observations: pending.length,
        results,
      }),
    })
  } catch (e) {
    // Non-fatal — log and continue
    console.error("[harbor-feature-rebuild] heal_log insert failed:", (e as Error).message)
  }

  return ok({
    duration_ms: Date.now() - started,
    processed: pending.length,
    groups: byHarbor.size,
    results,
  })
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}
