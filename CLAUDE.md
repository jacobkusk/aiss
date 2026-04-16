# aiss.network

Landing page + live map + API docs for aiss.network — the open maritime evidence protocol.

> **Kanonisk arkitektur og API-kontrakt ligger i `~/Ventures/shared/`** (`ARCHITECTURE.md`, `AISS-API-CONTRACT.md`, `AISS.md`, `GLOSSARY.md`). Denne fil beskriver aiss.network-specifikke konventioner og "do NOT"-regler. Ved uoverensstemmelse: `shared/` vinder.

## Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS
- MapLibre GL JS (globe + flat map, NO other map lib)
- Supabase client for public reads
- Deployed on Vercel

## Supabase

- Project: `grugesypzsebqcxcdseu` (eu-west-1)
- This is the aiss.network database (separate from vier.blue — `orkydlnqeurgcwaljnte`)
- PostGIS enabled

### Core tables (the only schema)

| Table | Purpose |
|---|---|
| `entities` | One row per vessel / drone / sensor. `entity_id` uuid, `entity_type` text, `display_name`, `domain_meta` jsonb (holds MMSI, ship_type, callsign, etc.) |
| `entity_last` | Latest position per entity — the live dot. `lat`, `lon`, `speed`, `bearing`, `t`, `source`, `source_count`, `sensors` jsonb |
| `positions_v2` | Raw positions, partitioned **daily** (`positions_v2_YYYYMMDD`). RLS on. Policy must be added per partition |
| `positions_v2_historical` | Rolled-up older positions |
| `tracks` | Compressed Douglas-Peucker track per entity, signed: `merkle_root`, `segment_hashes[]`, `gap_intervals`, `epsilon_m`, `encrypted_dek`, `permanent_address` |
| `strings` | Per-entity-per-date `MultiLineStringM` — the persistent track line shown on the map |
| `evidence` | Append-only hash chain: `hash`, `prev_hash`, `pts` jsonb. Tamper-proof bevisførelse |
| `ingest_sources` | Registered collectors (pi4_rtlsdr, aisstream, aishub …). `is_active` flag, `config` jsonb |
| `ingest_stats` | Per-flush: `accepted`, `rejected`, `batch_ms` — the PI heartbeat |
| `heal_log` | Self-healing actions taken by scheduled checks |
| `rpc_health` | Per-RPC latency/ok history, populated by `run_rpc_health_checks` |
| `alert_state` | Alert debouncing |

Live SQL functions live in `supabase/functions-sql/` (one file per function, 1:1 with DB). Core set: `ingest_positions_v2` (write path), `get_live_vessels*` / `get_vessel_track*` / `get_tracks_in_range` / `get_vessels_at_time` / `get_track_geojson` (read path), `expire_live_vessels` / `compress_completed_segments` / `run_rpc_health_checks` (maintenance, directly on pg_cron), `ensure_partition` / `cleanup_heal_log` (maintenance, called from `auto-heal` edge function — and `ensure_partition` also from ingest edges), `get_ingest_health` / `get_rpc_health` / `get_system_stats` / `check_ingest_health` / `check_name_coverage` (diagnostics), `predict_position` / `build_dp_tracks` / `search_vessels` / `get_routes_in_bbox` / `rls_auto_enable` (utilities).

Edge Functions (`supabase/functions/`) — all with top-level try/catch per `docs/EDGE-FUNCTION-RUNBOOK.md` §1.2:

| Function | Version | JWT | Purpose |
|---|---|---|---|
| `ingest-positions` | v7 | no | Primary ingest: normalise → validate → `ingest_positions_v2` RPC, per-reason rejection counters. |
| `ingest-ais` | v5 | no | Legacy redirect — normalises and forwards into `ingest_positions_v2` RPC. PI points at `ingest-positions`; kept for backwards compat with any external caller still using the old name. |
| `health` | v3 | no | Public read-only heartbeat — returns `ok/stale/down` plus 5min/1h/30min counts. |
| `alert-health` | v5 | no | pg_cron every 5 min — emails via Resend on Pi/RPC outages + recovery. Individual try/catch on fetch + upsert. |
| `auto-heal` | v2 | no | pg_cron every 5 min — probes ingest-positions, ensures partitions, can redeploy from `edge_function_store` if 500'ing. |

## File Structure

```
aiss/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx         # landing
│   │   ├── map/page.tsx     # live map (WP layer)
│   │   ├── health/          # pi/ingest status pages
│   │   ├── docs/            # API + protocol docs
│   │   └── api/             # route handlers
│   ├── components/
│   │   ├── CopyButton.tsx
│   │   └── map/
│   │       ├── Map.tsx              # MapLibre root
│   │       ├── MapContext.tsx
│   │       ├── GlobeMapToggle.tsx
│   │       ├── ThemeToggle.tsx
│   │       ├── Sidebar.tsx
│   │       ├── TimeSlider.tsx       # time machine
│   │       ├── Tooltip.tsx
│   │       ├── TrackLayer.tsx       # WP layer — see lib/trackRules.ts
│   │       ├── ReplayLayer.tsx
│   │       ├── RoutesLayer.tsx
│   │       ├── VesselLayer.tsx
│   │       ├── VesselPanel.tsx
│   │       ├── VesselSearch.tsx
│   │       └── MaritimeOverlays.tsx
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── trackRules.ts            # single source of truth for WP/LINE/D·P
│   ├── adapters/      # .aiss protocol scaffolding — not yet wired
│   ├── core/          # .aiss protocol scaffolding — not yet wired
│   └── formats/aiss/  # .aiss file format schema — not yet wired
├── supabase/
│   ├── functions/         # edge functions (Deno)
│   └── functions-sql/     # live SQL/plpgsql functions
├── scripts/pi/            # Raspberry Pi collector (rtl_ais → Supabase)
└── docs/                  # project docs (PI-OPS, self-healing, …)
```

JetBrains Mono loades via `next/font/google` — ingen lokale font-filer i `public/`.

## Design Rules

- Dark theme: space-dark background (#060D1A), NOT white
- Font: JetBrains Mono for data, system sans for UI
- Globe uses MapLibre `projection: 'globe'`
- Aqua (#2BA8C8) for tracked vessels, white for others
- No auth required — public site, no login
- Mobile: sidebar collapses to bottom sheet
- Performance: use MapLibre clustering at low zoom

## The 3-layer map model

All rules live in `src/lib/trackRules.ts`. Read that file before touching map visuals.

1. **WP** — raw CRC-verified AIS fixes. Drawn today. See `trackRules.ts`.
2. **LINE** — interpreted track with vessel-type rules. **Not yet implemented** — blocked on populating `entities.domain_meta.ship_type` (currently null for ~99 % of vessels).
3. **D·P** — compressed LINE (future). Each compressed track stores `merkle_root` + `algorithm_version` so a re-compression becomes a new signed version alongside the old one, not a replacement.

## Brand

- Tagline: "Free to read. Trusted to write."
- Two-sided model: free reads, authenticated writes
- `.aiss` file format: magic bytes `AISS`, Merkle-root signed, per-recipient encryption. Scaffolded in `src/adapters/`, `src/core/`, `src/formats/aiss/v1/`. **Do NOT delete as dead code** — it is the implementation target for `aiss:full`.

## Edge Function rules (MANDATORY)

Lært på den hårde måde 2026-04-16 — 500-storm i `ingest-positions` v5/v6. Se `docs/EDGE-FUNCTION-RUNBOOK.md` for postmortem og debugging-sekvens.

1. **Aldrig `.catch()` eller `.finally()` på supabase-js chains.** `supabase.rpc()`, `.from().select()`, `.storage.from().upload()` returnerer en `PostgrestBuilder` som er `PromiseLike` — men ikke et rigtigt `Promise`. `.catch()` er `undefined` og crasher i runtime, ikke compile-time.
   ```ts
   // NO  — TypeError: supabase.rpc(...).catch is not a function
   await supabase.rpc("foo").catch(() => {})
   // YES
   try { await supabase.rpc("foo") } catch { /* reason */ }
   ```
2. **Top-level try/catch i `Deno.serve`.** Hver edge function skal returnere `{ error, message, stack }` i HTTP-body på uventet fejl — Supabase's logs-panel viser kun request-summaries, ikke `console.error` output. Uden body er vi blinde udefra.
3. **Per-reason counters fra dag ét.** Aldrig bare én `rejected`-tæller — altid split i reasons (`mmsi_invalid`, `invalid_coords`, `duplicate_within_batch`, …). Persistér til `ingest_stats.reject_reasons`. En samlet procent er ubrugelig til diagnostik.
4. **`pg_net.http_post` er diagnostik-kanalen.** Når en funktion 500'er og sandboxen ikke kan curle udefra: fyr requesten fra Postgres og læs `net._http_response.content`. Det var det eneste der afslørede `TypeError: supabase.rpc(...).catch is not a function`.
5. **Smoke test efter deploy.** Før man siger "det er fixet": én `pg_net`-call med realistisk payload, læs `status_code + content`. Ikke bare stare på logs.

## RLS checklist (MANDATORY for every DB change)

Run this after every migration, new table, or new partition:

```sql
-- 1. Tables with RLS enabled but NO policies (= broken for anon)
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relrowsecurity = true
  AND n.nspname = 'public'
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname
  )
ORDER BY c.relname;

-- 2. Test as anon
SET ROLE anon;
-- <run your query here>
RESET ROLE;
```

Rules:
- New tables that frontend reads → `CREATE POLICY <t>_public_read ON <t> FOR SELECT TO public USING (true);`
- **Partitions do NOT inherit policies from parent** → add policy to each new `positions_v2_YYYYMMDD`. `ensure_partition` does this automatically; verify it did
- New RPC functions → test as `SET ROLE anon` before shipping
- If it works in SQL console but returns empty from browser → it's RLS

## Do NOT

- Use any map library other than MapLibre (no Cesium, no deck.gl, no Three.js)
- Create new Supabase projects
- Add auth/login to the public site
- Change the dark theme to light
- Touch the PI collector (`scripts/pi/ais_to_supabase.py`) unless asked
- Delete anything in `src/adapters/`, `src/core/`, `src/formats/` — `.aiss` protocol scaffolding

## Deploy

```bash
npm run build
vercel --prod
```

Env vars in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
Domain: `aiss.network` (port 3000 locally — locked, see `AGENTS.md`).

## D·P signatur — næste build

Sign D·P ved generering med reference til raw Merkle root:

```
D·P signatur = Sign(
  entity_id +
  epsilon +
  algorithm_version +
  raw_merkle_root +    ← bevis for hvilke raw data den bygger på
  dp_coordinates
)
```

Verificerbar selv efter raw er slettet. Forbedret algoritme → ny version tilføjes, gammel beholdes. Begge versioner gyldige — to kompressioner af de samme verificerede rådata. Tæt på `.aiss`-format filosofien: bevisbar historik, ikke overskrivning.

Epsilon til arkiv: ~50 m (ikke 500 m). Ét spor ser korrekt ud ved alle zoom-niveauer.

## Næste build — prioriteret liste

1. **ship_type backfill** — uden det ingen LINE-lag, ingen båd-ikoner, ingen farvedifferentiering per type. Blocker for 2 og 3.
2. **Båd-ikoner** — SVG silhuetter set oppefra, roterer med COG. Typer fra `domain_meta.ship_type`.
3. **LINE layer implementation** — efter `ship_type` er på plads. Rules ligger klar i `trackRules.ts → VESSEL_TYPE_RULES`.
4. **OpenFreeMap** — skift `Map.tsx` fra Carto raster til OpenFreeMap vector tiles.
5. **Lock-mode + play** — lås skib i centrum, scrubber timeRange 1x/10x/100x.
6. **Record** — MediaRecorder API → `.webm`/GIF af kort-canvas.
7. **PI rejection debugging** — PI viser ~33 % rejected i `ingest_stats`. Find ud af hvorfor (duplikater? RLS på ny partition? ugyldige koordinater?).
