# T1 — Tracks audit, 2026-04-17

Baseline før Fase 0-test kickoff. Kørt mod `grugesypzsebqcxcdseu` kl 13:30 UTC.

## Findings

### 1. `tracks`-tabellen er ikke klar til ARCHIVE-STRATEGY

| Metric | Value |
|---|---|
| Total rows | **288** |
| Rows with `merkle_root` | **0** |
| Unique entities | **288** (en:en) |
| Oldest created_at | 2026-04-09 17:14 |
| Newest created_at | 2026-04-15 10:57 |

**Tolkning:** `tracks` har præcis én row per entity. Ingen er signeret. Ingen ny track oprettet siden 2026-04-15 (2 døgn).

### 2. Nuværende D·P-arkitektur er "full rewrite", ikke "append segment"

`build_dp_tracks(epsilon, gap_sec, max_knots)`:
- Læser **HELE** `positions_v2` hver gang.
- Gør Douglas-Peucker over entire history per entity.
- INSERT … ON CONFLICT (entity_id) DO UPDATE → **overskriver altid** den eksisterende track.
- Ingen segmentering til nye rows. Ingen historik. Ingen signatur.

`compress_completed_segments(idle_minutes, epsilon_m)`:
- Leder efter rows med `compressed_at IS NULL`.
- Men `build_dp_tracks` sætter `compressed_at = now()` ved INSERT — så der findes aldrig sådanne rows.
- pg_cron kalder den hvert 2. minut, returnerer "0 rows" hver gang.
- **Dead code path.**

### 3. Schema mangler felter fra ARCHIVE-STRATEGY

Eksisterende kolonner i `tracks`:
```
track_id, entity_id, track, source, source_domain, latency_class,
gap_metadata, segment_hashes[], merkle_root, permanent_address,
encryption_algorithm, encrypted_dek, jurisdiction, created_at,
raw_point_count, compressed_point_count, compressed_at, epsilon_m,
updated_at, track_display, gap_intervals
```

Mangler for at ARCHIVE-STRATEGY skal virke:
- `algorithm_version text` — hvilken D·P-version
- `signature bytea` + `signed_at timestamptz` — den faktiske signatur
- `raw_merkle_root bytea` — Merkle over rå WP (forskellig fra `merkle_root` der pt er NULL overalt)
- `time_range_start`, `time_range_end` timestamptz — segmentgrænser
- `source_ids uuid[]` — multi-source corroboration (`source` er én text)

### 4. positions_v2-flow sundt, men med en historisk entity

| Metric | Value |
|---|---|
| Positions seneste 24 t | 19.485 |
| Entities seneste 24 t | 87 |
| Nyeste position | 2026-04-17 13:30 (live) |
| Entity_last aktive | 19 |
| Entities total | 385 |

**Fund:** Én entity har 2355 positioner dateret **1895-1898** → "Spray (J. Slocum 1895–1898)", MMSI 999000001, reconstructed-from-logbook demo. **Ikke et bug** — men en realistisk edge-case for arkiv-modellen (en 128 år gammel vessel-record).

### 5. pg_cron er aktiv men ikke-produktiv for D·P

Aktive jobs:
| jobid | jobname | schedule | status |
|---|---|---|---|
| 7 | compress-ais-segments | */2 * * * * | **0 rows hver kørsel** (dead) |
| 9 | aiss-health-check | */5 * * * * | OK |
| 10 | rpc-health-check | */5 * * * * | OK |
| 11 | auto-heal | */5 * * * * | OK |
| 12 | expire-live-vessels | */5 * * * * | OK |

Der er **ingen cron-job** der kører `build_dp_tracks` → tracks er stale fra 2 dage siden.

## Beslutninger afledt af audit

### Beslutning 1: Redesign `tracks` — append-only, versioneret, segmenteret

Ændre fra "ON CONFLICT DO UPDATE" til "én row per (entity_id, time_range_start, algorithm_version)". PK ændres. Dette er en migration, ikke en minor edit.

### Beslutning 2: Skriv nyt `track-builder` RPC (navngiv så den ikke clasher)

Forslag: `build_segment_track(entity_id, time_start, time_end, algorithm_version, epsilon_m)`. Idempotent. Kan kaldes fra ingest-trigger eller cron.

Gammel `build_dp_tracks` og `compress_completed_segments` parkeres (ikke slet) indtil det nye path kører i 7 døgn grønt.

### Beslutning 3: De 288 eksisterende rows mærkes legacy

```sql
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS algorithm_version text;
UPDATE tracks SET algorithm_version = 'legacy-full-rewrite-v0' WHERE algorithm_version IS NULL;
```

De slettes **ikke** — de er historisk bevismateriale for at arkiv-modellen blev ændret.

### Beslutning 4: Signing-pipeline er forudsætning for `expire_raw_positions`

T4 i FASE-0-TEST-PLAN.md er **blocked** af T2 + T3 — vi kan ikke slette rå før vi har signerede tracks. Ingen sletning af `positions_v2` før T2+T3 er grønne i 7 døgn.

## Næste skridt

1. Skriv migration der tilføjer de manglende kolonner.
2. Skriv nyt `build_segment_track` RPC.
3. Skriv `sign_track` RPC (`pgcrypto` + key fra `vault.secrets`).
4. Start ny pg_cron der kører den nye builder på rullende basis.
5. Mål i 7 døgn per T2-kriterierne i FASE-0-TEST-PLAN.md.

Audit-afslutning — alt noteret, ingen data ændret.
