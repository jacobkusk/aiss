// ntm-parser — Supabase Edge Function (v0, shell)
//
// Ingests Notices to Mariners from all coastal states (EfS/UFS/NtM/GAN/
// Avvisi/AN/NMs) via the UFS-ingestion-pipeline locked 2026-04-18 per
// shared/PLOTTER.md §"Strategisk model: vi bliver søkortet".
//
// Status: SHELL. First real wiring in v1.1 (august-oktober 2026). This
// shell exists now so the `notices` table schema can be validated end-to-end
// with a dry-run, and so the scheduled task + cron + monitoring are ready
// the day we flip the LLM calls on.
//
// Triggered via pg_cron daily (06:00 UTC). On-demand run triggered by
// POSTing {source_country, source_issue_number, source_url} — used for
// historical backlog passes over weekends.
//
// ═══════════════════════════════════════════════════════════════════════
// Pipeline when fully implemented:
//
//  1. Discovery — list new upstream issues per authority:
//       - DMA   (Danish EfS, weekly PDFs)
//       - SMA   (Swedish UFS, weekly HTML+PDF)
//       - KYST  (Norwegian Etterretninger, weekly HTML)
//       - Traficom (Finnish Tiedonantoja)
//       - UKHO  (UK weekly NMs)
//       - BSH   (German NfS)
//       - RWS   (Dutch BaZ)
//       - IIM   (Italian AN)
//       - SHOM  (French GAN)
//       - IHM   (Spanish Avisos)
//       - PHHI  (Croatian Oglasi)
//       - HNHS  (Greek)
//       - NOAA  (US LNM)
//     Each authority has its own adapter that returns a list of
//     {source_issue_number, source_url, published_at} tuples.
//
//  2. Dedupe — skip any (authority, source_issue_number) already in
//     `notices` with verification_status != 'pending'.
//
//  3. Fetch — pull the raw PDF/HTML. Store raw_text + raw_language.
//
//  4. LLM parse (Claude Haiku 4.5) — prompt:
//     """
//     Extract all factual changes from this notice as structured JSON:
//     [{
//       type: buoy_moved|buoy_added|buoy_removed|light_changed|...,
//       target_ref: upstream id or free-text description,
//       field: position|light_character|depth|status,
//       from: <old value>,
//       to:   <new value>,
//       effective_date: ISO 8601,
//       safety_critical: boolean
//     }]
//     """
//     Haiku cost at this scale is ~$5/month globally.
//
//  5. Match — for each parsed change, try to find the target_feature_id in
//     `features` using (source, source_ref, geom proximity). Attach to
//     notices.affected_features.
//
//  6. Decide verification_status:
//       - no safety_critical_flag + all targets matched → 'auto_applied'
//       - safety_critical_flag or unmatched target      → 'manual_review'
//     Apply the 'auto_applied' ones: UPDATE features (version, valid_until,
//     superseded_by) atomically. Send Slack ping for 'manual_review' ones.
//
//  7. Summary → heal_log.
// ═══════════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

interface ParseResult {
  authority: string
  source_issue_number: string | null
  status: "ok" | "skipped" | "dedup" | "failed"
  changes_parsed: number
  safety_critical: boolean
  detail: string
}

Deno.serve(async (req: Request) => {
  try {
    return await handle(req)
  } catch (e) {
    const err = e as Error
    console.error("[ntm-parser] FATAL:", err.message, err.stack)
    return new Response(JSON.stringify({
      error: "unhandled",
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 8),
    }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
})

async function handle(req: Request): Promise<Response> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const started = Date.now()

  // POST body with explicit targets for backlog passes; GET triggers the
  // scheduled discovery of all authorities.
  let targets: Array<{
    authority?: string
    source_country?: string
    source_issue_number?: string
    source_url?: string
  }> = []

  if (req.method === "POST") {
    try {
      const body = await req.json().catch(() => ({}))
      if (Array.isArray(body)) targets = body
      else if (body && typeof body === "object") targets = [body]
    } catch (e) {
      return bad("invalid_body", (e as Error).message)
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // v1.1 TODO: discovery step for each authority when targets.length === 0.
  // Shell just returns early with a status note.
  // ───────────────────────────────────────────────────────────────────
  if (targets.length === 0) {
    return ok({
      duration_ms: Date.now() - started,
      status: "shell",
      note: "ntm-parser v0 shell — discovery + LLM parsing land in v1.1 (august-oktober 2026). Schema and scheduled-task scaffolding in place now.",
      authorities_planned: [
        "dma","sma","kyst","traf","ukho","bsh","rws",
        "iim","shom","ihm","phhi","hnhs","noaa",
      ],
    })
  }

  // ───────────────────────────────────────────────────────────────────
  // Dedupe against already-processed notices. Even the shell should do
  // this so on-demand calls behave correctly.
  // ───────────────────────────────────────────────────────────────────
  const results: ParseResult[] = []
  for (const t of targets) {
    if (!t.authority || !t.source_issue_number) {
      results.push({
        authority: t.authority ?? "?",
        source_issue_number: t.source_issue_number ?? null,
        status: "failed",
        changes_parsed: 0,
        safety_critical: false,
        detail: "authority and source_issue_number are required",
      })
      continue
    }

    try {
      const { data: existing, error: selErr } = await supabase
        .from("notices")
        .select("notice_id, verification_status")
        .eq("authority", t.authority)
        .eq("source_issue_number", t.source_issue_number)
        .maybeSingle()

      if (selErr) throw selErr

      if (existing && existing.verification_status !== "pending") {
        results.push({
          authority: t.authority,
          source_issue_number: t.source_issue_number,
          status: "dedup",
          changes_parsed: 0,
          safety_critical: false,
          detail: `already ${existing.verification_status}`,
        })
        continue
      }

      // Insert a placeholder row so downstream tooling can see pipeline
      // state. Full LLM parse lands in v1.1.
      const { error: insErr } = await supabase.from("notices").upsert({
        authority: t.authority,
        source_country: (t.source_country ?? "").toUpperCase(),
        source_issue_number: t.source_issue_number,
        source_url: t.source_url ?? null,
        published_at: new Date().toISOString().slice(0, 10),
        effective_from: new Date().toISOString(),
        notice_type: "other",
        summary: "[ntm-parser v0 shell] placeholder — awaiting v1.1 LLM parse",
        parsed_changes_json: [],
        safety_critical_flag: false,
        verification_status: "pending",
      }, { onConflict: "authority,source_issue_number" })

      if (insErr) throw insErr

      results.push({
        authority: t.authority,
        source_issue_number: t.source_issue_number,
        status: "ok",
        changes_parsed: 0,
        safety_critical: false,
        detail: "placeholder upserted (shell)",
      })
    } catch (e) {
      const err = e as Error
      results.push({
        authority: t.authority ?? "?",
        source_issue_number: t.source_issue_number ?? null,
        status: "failed",
        changes_parsed: 0,
        safety_critical: false,
        detail: err.message,
      })
    }
  }

  try {
    await supabase.from("heal_log").insert({
      check_name: "ntm_parser",
      status: "ok",
      detail: JSON.stringify({
        duration_ms: Date.now() - started,
        targets: targets.length,
        results,
      }),
    })
  } catch (e) {
    console.error("[ntm-parser] heal_log insert failed:", (e as Error).message)
  }

  return ok({ duration_ms: Date.now() - started, results })
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

function bad(error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  })
}
