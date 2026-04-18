# Fase 0 — Test plan før aisstream åbnes

**Status:** draft, 2026-04-17
**Formål:** Bevise at D·P-pipeline, signatur, retention og live-udsendelse virker **kontinuerligt på eksisterende Pi-data** i 7 døgn — *før* vi åbner for aisstream. Hvis noget fejler her, fejler det 1000× værre ved 10k msg/s.

> **Kontekst:** Se [`ARCHIVE-STRATEGY.md`](./ARCHIVE-STRATEGY.md) for arkiv-modellen (WP → D·P → .aiss), [`LIVE-NETWORK.md`](./LIVE-NETWORK.md) for dual-stack live-lag, og [`AISSTREAM-READINESS.md`](./AISSTREAM-READINESS.md) for ingest-vejen. Denne test-plan er *operationelt go/no-go* mellem dem og aisstream fase 1.

## TL;DR

Syv check-punkter. Alle skal være grønne i 7 døgn sammenhængende før vi åbner aisstream.

| # | Check | Blocker for |
|---|---|---|
| T1 | Audit af eksisterende `tracks`-rækker — har vi overhovedet nogen? Er de signerede? | D·P arkiv-model |
| T2 | D·P-generering kører kontinuerligt på Pi-data — hvert døgn ruller nye segmenter ind i `tracks` | Retention af rå positioner |
| T3 | D·P-signatur binder `raw_merkle_root` + `algorithm_version` + `epsilon_m` korrekt | Sikker sletning af rå |
| T4 | `expire_raw_positions` RPC skrevet og dry-run verificeret | Cost-control ved global skala |
| T5 | Supabase Realtime subscription på `entity_last` leverer live updates < 500 ms | Live-lag (plottere, app) |
| T6 | Cross-source dedup håndteret (selv med kun én kilde nu — design-test) | Aisstream som 2. kilde |
| T7 | `MAX_SPEED_MS` kalibreret per `entity_type` (SAR-fly, hydrofoil) | Færre false-positive teleportation |

Før alle 7 er grønne: **ikke aisstream**. Ikke engang Øresund.

---

## T1 — Audit af `tracks`-tabellen

**Spørgsmål:** Har vi overhovedet D·P-data lige nu? Er det signeret? Er det verificerbart?

**Hvad jeg forventer:** Vi har formentlig få eller ingen signerede rækker — `track-builder` eksisterer som scaffolding men er ikke Fase 0-deploy'et per `ARCHITECTURE-ROADMAP.md`. Det skal bekræftes.

**Kommandoer (SQL-console):**

```sql
-- hvor mange tracks-rows?
SELECT count(*) FROM tracks;

-- hvor mange har merkle_root?
SELECT count(*) FROM tracks WHERE merkle_root IS NOT NULL;

-- per-entity dækning
SELECT entity_id,
       count(*) AS track_count,
       min(time_range_start) AS first,
       max(time_range_end) AS last,
       bool_and(merkle_root IS NOT NULL) AS all_signed
FROM tracks
GROUP BY entity_id
ORDER BY track_count DESC
LIMIT 20;

-- hvor gamle er rå positioner vs. nyeste track?
SELECT
  (SELECT min(t) FROM positions_v2 WHERE t > now() - interval '7 days') AS oldest_raw,
  (SELECT max(t) FROM positions_v2) AS newest_raw,
  (SELECT max(time_range_end) FROM tracks) AS newest_track;
```

**Go-kriterier:**
- Hvis `tracks` er tom → byg `track-builder` først (se T2). Denne audit fastlægger bare baseline.
- Hvis `tracks` har rækker uden `merkle_root` → **de skal mærkes som legacy og gen-signeres** før vi stoler på dem. Ikke slet.

**Dokumenteres i:** `docs/audits/2026-04-17-tracks-audit.md` (baseline-målingen).

---

## T2 — D·P-generering kontinuerligt

**Spørgsmål:** Kan vi løbende rulle segmenter fra `positions_v2` ind i `tracks` som signerede D·P-linjer *uden at det stopper eller driver*?

**Trigger-logik (per `ARCHIVE-STRATEGY.md`):**
- Segment lukkes når: (a) gap > 30 min, ELLER (b) dagsgrænse ved midnat UTC, ELLER (c) manuel trigger.
- Et segment kan D·P-komprimeres når: ≥10 waypoints OG ≥1 km rutelængde.
- Segmenter der *ikke* opfylder mindstemålene gemmes som raw-only og rulles aldrig til D·P. De holdes i `positions_v2_historical` på `standard` retention.

**Implementation-plan:**

1. **Skriv `compress_completed_segments()` RPC** (den findes i `supabase/functions-sql/` som navn, men skal auditeres):
   ```sql
   -- pseudo-signatur:
   -- input: entity_id (optional, null = alle)
   -- logic:
   --   for hver entity med positioner >30 min ubrugt siden sidste compression:
   --     find segment (start..end) afgrænset af gaps
   --     check ≥10 WP + ≥1 km → skip hvis for småt
   --     kør Douglas-Peucker med ε=50m
   --     beregn raw_merkle_root over alle rå WP i segmentet
   --     indsæt row i `tracks` med signatur (se T3)
   --     persistér segment_hashes[], gap_intervals
   ```
2. **pg_cron hvert 10. min** — ikke hvert minut, for at undgå race med ingest.
3. **Observability:** log per-run count, duration, errors til `ingest_stats` (med `source_name='dp_builder'`). Ikke til edge logs — de roterer for hurtigt.

**Go-kriterier (kør i 7 døgn):**
- Mindst 95 % af entities med >10 WP/døgn får et nyt `tracks`-row per døgn.
- Ingen run tager > 60 s (på Nano-DB med 381 entities).
- Ingen duplikater: `UNIQUE (entity_id, time_range_start, time_range_end, algorithm_version)`.
- `ingest_stats`-counter for `dp_builder` viser kontinuerlig flow.

**Red flag:** Hvis `compress_completed_segments` begynder at retry'e samme segment igen og igen → idempotens er brudt, fix det før vi skalerer.

---

## T3 — D·P-signatur bundet til raw

**Spørgsmål:** Når vi signerer en D·P, kan vi bagefter *bevise* præcis hvilken rå data den er bygget på, selv efter rå er slettet?

**Kontrakt (fra `CLAUDE.md` + `ARCHIVE-STRATEGY.md`):**

```
D·P signature = Sign(
  entity_id              ::uuid
  epsilon_m              ::int
  algorithm_version      ::text    -- fx "dp-v1-ε50m"
  raw_merkle_root        ::bytea   -- Merkle over rå WP i segmentet
  dp_coordinates         ::bytea   -- serialiseret LineStringM
  time_range_start       ::timestamptz
  time_range_end         ::timestamptz
  source_ids             ::uuid[]  -- hvilke ingest-kilder bidrog
)
```

**Hvorfor alle felterne:**
- `raw_merkle_root` → beviser data-oprindelsen. Selv uden råen kan man verificere at D·P er afledt af præcis *disse* waypoints (forudsat Merkle-beviset er gemt i `evidence` eller `.aiss`-filen).
- `algorithm_version` → når vi senere laver `dp-v2-ε20m`, beholder vi den gamle. Begge er gyldige.
- `epsilon_m` → så man ikke skal gætte hvilken komprimering der blev brugt.
- `source_ids` → multi-source corroboration er del af arkivet, ikke kun hot-stien.

**Verify-sti:**
```
verify(track_row) =
  1. recompute raw_merkle_root from positions_v2 (eller .aiss raw-side)
  2. check signature over de 7 felter
  3. hvis rå er slettet → brug evidence-kædens Merkle-bevis
```

**Go-kriterier:**
- En `tracks`-row genereret i uge 1 skal stadig verificere i uge 7, også efter rå er slettet.
- `pgcrypto`-baseret signing-key ligger i `vault.secrets`, ikke i kode.
- Unit-test: genererer track, sletter rå, verificerer via Merkle-bevis i `evidence`.

**Implementation-ordre:**
1. Tilføj felter til `tracks`: `algorithm_version text`, `raw_merkle_root bytea`, `signature bytea`, `signed_at timestamptz`. Migration.
2. Skriv `sign_track(track_id)` RPC. Henter alle nødvendige felter, genererer signatur.
3. `compress_completed_segments` kalder `sign_track` umiddelbart efter INSERT.
4. Skriv `verify_track(track_id)` RPC — retur `{ok: bool, reason: text}`.

---

## T4 — `expire_raw_positions` RPC

**Spørgsmål:** Kan vi sikkert slette rå waypoints når de er overflødiggjort af en signeret D·P?

**Fem-betingelses-check (fra `ARCHIVE-STRATEGY.md`):**

En rå `positions_v2`-row kan slettes hvis *alle* fem holder:

1. `entities.retention = 'standard'` (ikke `permanent`).
2. Rå-rowen er del af et segment der har en signeret `tracks`-row med `algorithm_version = current` og `signature IS NOT NULL`.
3. `tracks`-rowens `signed_at` > 24 timer siden (cooling-periode for anomaly-review).
4. Rå-rowens `t` < now() - 90 days.
5. Der er ingen aktive `anomalies` med `evidence_ref` der peger på rowen.

**Implementation:**

```sql
CREATE OR REPLACE FUNCTION expire_raw_positions(dry_run boolean DEFAULT true, batch_size int DEFAULT 10000)
RETURNS TABLE (partition_name text, rows_eligible bigint, rows_deleted bigint, skipped_anomaly bigint) ...
```

- Dry-run er DEFAULT. Ingen overrasklingssletning.
- Arbejder partition-ad-gangen — sletter aldrig fra `positions_v2_historical` før D·P-dækning er 100 %.
- Outputter til `heal_log` med `action='expire_raw'`.

**Go-kriterier:**
- Dry-run udført på Pi-data viser konservativ tal (størstedelen af 90-dage-gammel data er dækket).
- Våd kørsel på én test-partition sletter kun forventede rækker.
- `verify_track()` for alle berørte entities er stadig OK efter sletning.
- Ingen `anomalies`-rows mister deres `evidence_ref`.

**Red flag:** Hvis dry-run rapporterer 100 % dækning på en partition hvor D·P-rækker ikke findes → check #2 er knækket, sluk pg_cron, debug.

---

## T5 — Supabase Realtime på `entity_last`

**Spørgsmål:** Kan vi levere live-updates til klienter (browser, plotter, app) med latency < 500 ms fra ingest til skærm?

**Test-opsætning:**

1. Enable Realtime replication på `entity_last`:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE entity_last;
   ```
2. Klient (browser-script eller Node):
   ```ts
   supabase
     .channel("live-vessels")
     .on("postgres_changes",
         { event: "*", schema: "public", table: "entity_last" },
         (payload) => console.log(Date.now(), payload))
     .subscribe();
   ```
3. Mål: timestamp fra `ingest_stats` (server-side receive) → timestamp for payload arrival i klient.

**Go-kriterier (over 48 t måling):**
- p50 latency < 300 ms.
- p99 latency < 1500 ms.
- Nul disconnect-storms (< 1 reconnect / 10 min).
- Ved 1000 entities updated på 10 s: ingen drops.

**Skaleringstjek:**
- Realtime WebSocket-kapacitet i Nano/Small compute: ~200 samtidige connections. Nok til Fase 1-2, *ikke* til Fase 4+.
- Dokumentér i resultat-noten: "ved Fase 4 skift til NATS geohash channels per `LIVE-NETWORK.md §4`".

**Red flag:** Hvis p99 > 3 s eller drops > 1 % → vi har ikke en live-protokol, vi har en batch. Fix før plotter-integration.

---

## T6 — Cross-source dedup

**Spørgsmål:** Hvad sker der når samme skib kommer ind fra 2 kilder samtidigt? I dag har vi kun Pi. Med aisstream bliver det reelt.

**Scenarie:**
- `pi4_rtlsdr` modtager MMSI 219123456 kl 12:00:00.12 på position (55.67, 12.59).
- `aisstream` leverer samme MMSI kl 12:00:00.08 på position (55.67, 12.59) — 40 ms tidligere.

**Ønsket adfærd:**
- Begge WP gemmes i `positions_v2` (multi-source corroboration er kernedata — *ikke* dedup'es væk).
- `entity_last` opdateres én gang med `source_count = 2`, `sources = [pi_id, aisstream_id]`.
- `ingest_positions_v2` RPC håndterer samtidighed uden duplikat-key-konflikt (source_id er del af PK).

**Design-test (uden aisstream):**

1. Simulér 2. kilde ved at køre to paralleller af eksisterende collector-script med forskellige `source_id`.
2. Send samme payload fra begge i 1 min.
3. Verificér:
   ```sql
   SELECT entity_id, t, count(*) OVER (PARTITION BY entity_id, t) AS source_count
   FROM positions_v2 WHERE t > now() - interval '1 min';
   ```
   Forventet: 2 rækker per (entity, t), begge gemt.
4. Verificér `entity_last.source_count = 2`, `sources`-array har 2 unikke IDs.

**Go-kriterier:**
- Begge rækker persisterer (multi-source = kernedata).
- `entity_last.source_count` opdateres korrekt (max over recent window).
- Ingen duplicate-key-fejl i edge-logs.
- `get_live_vessels` returnerer én række per entity, ikke to.

**Red flag:** Hvis `source_count` forbliver 1 → corroboration-logikken er ikke i ingest. Det er per `corroboration-scorer` i roadmappen, men kan først aktiveres efter T6.

---

## T7 — `MAX_SPEED_MS` kalibrering per entity_type

**Spørgsmål:** Er 30 m/s (58 kn) teleportation-tærskelen for konservativ?

**Observation:** 193 `teleportation`-rejects på 48 t fra Pi. Størstedelen er formentlig legitime — hydrofoil (40 kn), SAR-fly (80 m/s), militære RIB'er (100+ kn kortvarigt).

**Plan:**
- Udvid `ingest-positions` til at læse `entities.entity_type` + `domain_meta.ship_type` og bruge per-type tærskel:

  | entity_type / ship_type | MAX_SPEED_MS |
  |---|---|
  | default vessel | 30 |
  | high-speed craft (HSC ship_type 40-49) | 50 |
  | aircraft | 300 |
  | SAR | 100 |
  | drone | 50 |
  | unknown | 40 |

- Alle rejects over typetærsklen skrives fortsat til `anomalies` (severity: `warn` under type-max, `critical` over).
- Backfill `ship_type` fra AIS message type 5/24 (kræver `ais-collect`-enrichment — se `ARCHITECTURE-ROADMAP.md` Fase 0 #1).

**Go-kriterier:**
- `teleportation`-rejects falder med ≥50 % på kendte hydrofoil-ruter (Øresund: Flying Falcon, HH Ferries hurtigbåde).
- Ingen nye `critical`-anomalier for plausibel skibstrafik.

**Red flag:** Hvis rejects stiger → backfill af `ship_type` er forkert eller tabellen over tærskler er for stram.

---

## 7-døgns kontinuerlig observation

Under hele testperioden: dette dashboard-query skal være grønt hvert døgn.

```sql
-- 24-timers sundhed (kør hver morgen)
SELECT
  -- T2: D·P kører
  (SELECT count(*) FROM tracks WHERE created_at > now() - interval '24 hours') AS new_tracks_24h,

  -- T3: alle nye er signeret
  (SELECT count(*) FROM tracks
   WHERE created_at > now() - interval '24 hours' AND signature IS NULL) AS unsigned_24h,

  -- T5: ingest-flow
  (SELECT sum(accepted) FROM ingest_stats WHERE ts > now() - interval '24 hours') AS accepted_24h,

  -- T7: teleport-rate
  (SELECT count(*) FROM anomalies
   WHERE anomaly_type = 'teleportation' AND ts > now() - interval '24 hours') AS teleport_24h,

  -- rpc-health
  (SELECT count(*) FROM rpc_health
   WHERE ts > now() - interval '24 hours' AND ok = false) AS rpc_fails_24h;
```

**Ønskede værdier 7 døgn i træk:**
- `new_tracks_24h` > 0 (D·P kører)
- `unsigned_24h` = 0 (signatur kører)
- `accepted_24h` > 10.000 (ingest-flow sundt)
- `teleport_24h` < 50 efter T7 (kalibrering virker)
- `rpc_fails_24h` = 0

---

## Testnote-template

Hver dag skriver vi én kort note:

```
## 2026-04-XX — dag N/7

new_tracks_24h: ___
unsigned_24h: ___
accepted_24h: ___
teleport_24h: ___
rpc_fails_24h: ___

Noter: ___
Go-no-go i morgen: ___
```

Gemmes i `docs/audits/fase-0-diary.md`.

---

## Hvornår åbner vi aisstream?

Når alle 7 checks har været grønne **7 døgn i træk**.

Hvis vi fejler på dag 4: reset. Fiks, kør igen fra dag 1. Ingen forkortede tests — vi lærte i EDGE-FUNCTION-RUNBOOK-postmortem at kort-tid-testing skjuler præcis de fejl der dukker op under load.

## Do NOT

- Ikke åbn aisstream før alle 7 er grønne.
- Ikke slet rå `positions_v2`-rækker manuelt under testperioden — kun via `expire_raw_positions(dry_run=false)` efter T4 er grøn.
- Ikke ændr `MAX_SPEED_MS` globalt — kun per entity_type (T7).
- Ikke kør `compress_completed_segments` på partitioner der stadig modtager writes (race).
- Ikke bump pg_cron til hvert minut før T2 er stabil — 10 min er rigeligt ved Pi-volumen.
