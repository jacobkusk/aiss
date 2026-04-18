# AISS — System Architecture Roadmap

**Status:** Draft v0.3 — 2026-04-17 (opdateret for 300k-vessel mål + dual-stack live/arkiv)
**Scope:** Intern arkitektur for **aiss.network** (data protokol-produktet). waveo.blue og vier.blue er separate produkter med egne repos, egne databaser og egen fase-plan — de er consumers via API.
**Principle:** `.aiss`-protokollen er kontrakten. Systemer kommunikerer via signerede packets og versionerede APIer — aldrig delte databaser, aldrig cross-DB joins.

> **Kanoniske referencer:** `~/Ventures/shared/ARCHITECTURE.md` (tabelmodel), `shared/AISS-API-CONTRACT.md` (public API), `shared/AISS.md` (vision). Denne roadmap er aiss.network-specifik fasning og bindes til kanon — ikke en erstatning.
>
> **Specialiseret referencer (2026-04-17):**
> - [`ARCHIVE-STRATEGY.md`](./ARCHIVE-STRATEGY.md) — WP/D·P/evidence-chain, D·P-timing, retention, signatur, sikker rå-sletning.
> - [`LIVE-NETWORK.md`](./LIVE-NETWORK.md) — dual-stack live + arkiv, geohash pub/sub, plotter-protokoller, 5M-bruger fanout-matematik.
> - [`AISSTREAM-READINESS.md`](./AISSTREAM-READINESS.md) — ingest-path for aisstream, faseplan 1-5, downsampling-strategi.
> - [`FASE-0-TEST-PLAN.md`](./FASE-0-TEST-PLAN.md) — 7 checks i 7 døgn før aisstream åbnes.
> - [`audits/2026-04-17-tracks-audit.md`](./audits/2026-04-17-tracks-audit.md) — baseline-audit der udløste Fase 0-redesign.

## v0.3 ændringer (2026-04-17)

Tre indsigter flyttede roadmappen:

1. **Mål er 300.000 skibe**, ikke "nogle få tusind i Øresund". Det skift kræver at vi dimensionerer arkitekturen fra dag ét til downsampling + partitioner + direkte Postgres-path + geohash fanout — ikke som Fase 3-udvidelse.
2. **aiss.network er både arkivformat OG live-netværk.** Ikke to systemer — samme data, tre aksess-mønstre (hot/warm/cold). Plottere, apps og abonnenter kan suge live, bidrage tilbage, og alle bidrag signeres til arkivet.
3. **Fase 0 er dybere end antaget.** Nuværende `tracks`-tabel er "full rewrite" (én row per entity, overskrives). ARCHIVE-STRATEGY kræver append-only segmenter med signatur. Migration + nye RPC'er skal ske **før** aisstream overhovedet åbnes. Se audit-filen.

---

## Product Constellation — hvor aiss.network passer ind

Før vi taler systemer internt i aiss.network er det vigtigt at forstå hvor det sidder. Hele venturet består af tre produkter (+ fremtidige) der deler protokol men ikke database:

```
                    ┌────────────────────────┐
Collectors ────────▶│   aiss.network         │◀──── "free to read, trusted to write"
(PI, AISHub,        │   Protocol + open API  │      Supabase: grugesypzsebqcxcdseu
 AISStream,         │   Port 3000             │
 ADS-B, radar,      └────────┬───────────────┘
 cameras, sat)              │
                            │ public REST + WebSocket + .aiss
                            │
              ┌─────────────┼─────────────┬────────────────┐
              ▼             ▼             ▼                ▼
      ┌─────────────┐ ┌────────────┐ ┌─────────────┐ ┌─────────────┐
      │ waveo.blue  │ │ vier.blue  │ │ (fremtidige │ │ Tredjepart  │
      │ Port 3001   │ │ Port 3002  │ │  produkter) │ │ (plottere,  │
      │ Egen DB     │ │ Egen DB    │ │             │ │  apps, osv.)│
      │ Pro / vault │ │ Social     │ │             │ │             │
      └─────────────┘ └────────────┘ └─────────────┘ └─────────────┘
```

**Regler der allerede er låst i `PROJECTS.md` og som dette dokument respekterer:**
- Separate Supabase-projekter for evigt. Ingen cross-DB joins.
- Porte låst: 3000 = aiss.network, 3001 = waveo.blue, 3002 = vier.blue.
- Stack identisk på tværs: Next.js 16, TypeScript, Supabase, Tailwind.
- Delte typer kommer i fremtidigt `packages/aiss-types/`.
- Ingen beslutning i ét produkt der bryder et andet.

Roadmappen nedenfor handler **kun** om aiss.network's internlige arkitektur. waveo.blue og vier.blue har egne roadmaps.

---

## Principper fra shared/ARCHITECTURE.md som dette dokument overholder

Vi respekterer fem arkitekturbeslutninger der allerede er truffet og dokumenteret:

**1. Domain-agnostic fra dag ét.** `entities.entity_type` kan være `vessel | aircraft | vehicle | person | animal | package`. `domain_meta` JSONB bærer alt domænespecifikt. ADS-B og pakketracking er ikke "Fase 2-udvidelse" — de er samme arkitektur, nye collector-typer.

**2. Write everything, validate at ingest, filter at view.** Ingen smart filtering ved ingest (skip-stationary, anti-teleport-som-kriterium osv.). Vi gemmer alt der passerer minimal fysik- og formatvalidering. Filtering og aggregation sker i read-path eller i `aiss-ui-api`.

**3. Multi-source corroboration er kernedata.** Samme entity set af 3 kilder = 3 rækker i `positions`, ikke 1 dedupet række. `source_count` og corroboration score er del af read-pathen.

**4. Tre lag af sandhed.** `evidence` (rå, signeret) er det bedste vi har. `strings` (Douglas) er komprimeret rute — geografisk korrekt, tidsmæssigt grov. Interpolation lever kun i UI og gemmes aldrig. `.aiss`-filer indeholder evidence eller Douglas, aldrig interpolation.

**5. Vault-model fra dag ét.** `entities.visibility` (`public`/`private`), `owner_id`, `retention` (`standard`/`permanent`), og `ingest_sources.public_delay_hours` (0/24/999) er i skemaet fra start. Client-side kryptering af `positions.raw` kommer senere, men row-level security med visibility-kontrol er der fra Fase 0.

---

## Systemer i aiss.network (steady state)

Domain-agnostic, protocol-first. Nummereringen matcher Phase-kolonnen nedenfor.

| # | System | Role | Phase |
|---|---|---|---|
| 1 | `ingest-gateway` | Signed-packet receiver, rate limit, per-source auth | 0 |
| 2 | `ais-collect` | RTL-SDR + AISStream + AISHub → signed `.aiss` | 0 |
| 3 | `core-api` | Protocol API (read + write RPC surface) | 0 |
| 4 | `aiss-ui-api` | BFF for aiss.network web + fremtidig app + player | 0 |
| 5 | `aiss.network` | Tynd web-frontend | 0 |
| 6 | `track-builder` | Baggrundsjob: positions → `strings` (Douglas, signeret) | 1 |
| 7 | `evidence-builder` | Baggrundsjob: positions → `evidence` (Merkle-kæde) | 1 |
| 8 | `corroboration-scorer` | Baggrundsjob: source_count + position spread → entity_last | 1 |
| 9 | `spoof-detector` | Baggrundsjob: fysik + source conflict → `anomalies` | 1 |
| 10 | `control-plane` | Health, alerts, auto-heal, audit på tværs af services | 1 |
| 11 | `public-api` | Offentlig REST + WebSocket (`api.aiss.network/v1`) | 1-2 |
| 12 | `adsb-collect` | 1090 MHz flytrafik → signed `.aiss` | 2 |
| 13 | `radar-collect` | Passive radar (DVB-T/FM) → signed `.aiss` | 2 |
| 14 | `optical-collect` | Kameraer + YOLO/CV → signed `.aiss` | 2 |
| 15 | `mil-gateway` | Separat netværk, vault-kilder, delay-switch | 3 |
| 16 | `satellite-collect` | Sentinel-1 + xView3 dark ship → signed `.aiss` | 3 |
| 17 | `push-api` | Ekstern skriveadgang (plottere, apps) | 3 |
| 18 | Region-N cells | Multi-datacenter replikering | 3 |

Læg mærke til at `background workers` (#6-#9) er separate systemer — ikke dele af `core-api`. De deler database i Fase 0-1 men har hver egen deploy, egen failure mode, egen RUNBOOK.md. Det gør at når spoof-detekteren fejler, dør evidence-byggeren ikke med den.

---

## Data model — én gang, gør det rigtigt

Følger `shared/ARCHITECTURE.md` præcis. 7 tabeller, ikke 18. Hver tabel har én grund til at eksistere.

| Tabel | Formål | Skalering |
|---|---|---|
| `entities` | Én række per ting der bevæger sig | ~500k for maritime, +flere for luft/pakker |
| `positions` | Append-only rå observationer, partitioneret daglig | 240M/dag ved fuld skala |
| `entity_last` | Live cache, én række per entity | ~500k |
| `strings` | Daglig Douglas-komprimeret rute per entity | ~500k/dag |
| `evidence` | Append-only hash-kæde, aldrig slettet | ~500k/dag |
| `anomalies` | Spoof, teleportation, source conflict | ~50k/dag |
| `ingest_sources` | Registrerede datakilder + delay switch | Håndterbart |

Vault-felter (`visibility`, `owner_id`, `retention`, `public_delay_hours`) er i skemaet fra Fase 0. RLS-policies enforcerer `visibility = 'public'` for anon og owner-only for private. Ingen feature-flag, ingen "vi tilføjer det senere".

---

## Fase 0 — Foundation (nu → 3 måneder)

**Mål:** Lay protokollen, de fem kerne-systemer med rene grænser, et data-model der kan bære vault fra dag ét, **og en bevisbar arkiv-pipeline (WP → D·P → signatur → sikker sletning) før aisstream åbnes.**

**Systems:** `ingest-gateway`, `ais-collect`, `core-api`, `aiss-ui-api`, `aiss.network`, `track-builder` (rykket frem fra Fase 1).

### v0.3 addendum — arkiv-pipeline er Fase 0, ikke Fase 1

Baseret på `audits/2026-04-17-tracks-audit.md`: nuværende `tracks` er full-rewrite. Før aisstream (som skaber 10× så mange entities på én dag) kan åbnes skal arkiv-pipelinen virke kontinuerligt i 7 døgn. Konkret:

- **Migration:** `tracks` → append-only. Tilføj `algorithm_version`, `signature`, `signed_at`, `raw_merkle_root`, `time_range_start/end`, `source_ids[]`. Gamle 288 rows mærkes `legacy-full-rewrite-v0`.
- **Ny RPC `build_segment_track(entity_id, time_start, time_end, algorithm_version, epsilon_m)`** — append-only segment. Kræver ≥10 WP + ≥1 km. Trigger: gap > 30 min, dagsskifte, manuel.
- **Ny RPC `sign_track(track_id)`** — signerer over 7 felter med `pgcrypto`, key i `vault.secrets`. Companion `verify_track(track_id)`.
- **Ny RPC `expire_raw_positions(dry_run, batch_size)`** — 5-betingelses-check før sletning (se `ARCHIVE-STRATEGY.md §3`).
- **Ny pg_cron `dp-segment-builder`** — hvert 10. min kalder builder + signerer resultatet. Park gammel `compress-ais-segments` (lad rows bestå som legacy).
- **Realtime subscription** på `entity_last` aktiveres og testes som forberedelse til live-netværk (se `LIVE-NETWORK.md §4`).

Se `FASE-0-TEST-PLAN.md` for de 7 go/no-go checks der skal være grønne i 7 døgn før aisstream fase 1.

### Øvrige Fase 0-ændringer

- **`ingest-gateway` bliver til.** PI stopper med at kalde `ingest-positions` edge function direkte. Den pusher i stedet signerede `.aiss`-packets til gateway. Gateway validerer signatur, rate-limiter, forwarder til `core-api`'s write-RPC.
- **`core-api` bliver formaliseret.** Nuværende edge functions (`ingest-positions`, `health`, `get_live_vessels*`, `get_vessel_track*`) grupperes bag stabilt RPC-interface. Bruger stadig Supabase underneath, men som implementation-detail, ikke som kontrakt.
- **`aiss-ui-api` bygges nyt.** Alle frontend-læsninger går herigennem. Cacher aggressivt, laver UI-aggregation (track interpolation, farvning, cluster-logik). Frontend rammer aldrig Supabase direkte igen.
- **`aiss.network`-siten refaktoreres til tynd klient.** Supabase client fjernes fra browser-bundle. Alle kald går til `aiss-ui-api`.
- **Data model konsolideres.** Eksisterende overlap (positions_v2 + strings + tracks osv.) rettes mod kanoniske 7 tabeller fra `shared/ARCHITECTURE.md`. Vault-felter tilføjes.

**Exit-kriterier (udvidet med SERVICE-STANDARDS + arkiv-pipeline):**

1. `ingest-gateway` — top-level catch, per-reason counters, 4-lags observability, egen RUNBOOK.md.
2. `ais-collect` — arver `PI-OPS.md` disciplin, pusher signerede `.aiss`, RUNBOOK.md opdateret.
3. `core-api` — alle RPC'er auditeret for `.catch`-anti-pattern, RLS-checklist kørt på hver partition, per-reason reject_reasons persisteres.
4. `aiss-ui-api` — lag 1-2-3 observability fra dag ét, cache-invalidation dokumenteret.
5. `aiss.network` — Supabase-klient fjernet fra client-bundle. Egen `/health`-side er lag 1 for hele stack'en.
6. **Smoke test efter hver deploy** af hvert system via pg_net eller direct curl.
7. Data migration kørt: ingen orphan-tabeller, vault-felter på plads, 7 kanoniske tabeller.
8. **Arkiv-pipeline kører kontinuerligt i 7 døgn grønt** per `FASE-0-TEST-PLAN.md` før aisstream åbnes.
9. **Realtime-lag verificeret** p50 < 300 ms, p99 < 1500 ms på `entity_last` — blocker for plotter-integration.

## Fase 1 — Pull background workers apart + aiss:full (3-12 måneder)

**Mål:** Flyt det tunge arbejde ud af hot-pathen så ingest aldrig blokeres af baggrundsprocesser. Lever `aiss:full`-formatet.

**Systems:** `track-builder`, `evidence-builder`, `corroboration-scorer`, `spoof-detector`, `control-plane`, `public-api`.

- **`track-builder`** kører hvert 5. min: positions → segmenteret MultiLineStringM → `strings`. Gap-markering (>5 min = nyt segment). Idempotent, kan genkøres.
- **`evidence-builder`** kører hvert 15. min: batch af ~100 positions → SHA-256-kæde → `evidence` med `validation_meta` (sources, corroboration score, anomalier, sender-kvalitet). Producerer `aiss:full`-filer.
- **`corroboration-scorer`** kører hvert 5. min: tæller unikke kilder per 10-min vindue per entity. Opdaterer `entity_last.source_count`. Markerer position spread > 1000m som `source_conflict`.
- **`spoof-detector`** kører hvert minut: fysik-check (speed, turn rate, on_land), source conflict, identitets-spoof (samme MMSI to steder samtidig). Skriver til `anomalies`.
- **`control-plane`** konsoliderer nuværende `health`, `alert-health`, `auto-heal`, `rpc_health`. Implementerer 4-lags observability-blueprintet på tværs af alle services. Egen dashboard i `aiss.network/ops` (admin-only).
- **`public-api`** eksponerer `api.aiss.network/v1` fra `AISS-API-CONTRACT.md`. Rate limits per tier (Free/Havn/Kyst/Myndighed). WebSocket stream for live positioner. `aiss:nav` (free) vs `aiss:full` (keyed, signeret, Merkle-forankret).

Exit: `aiss:full`-filer verificerer offline via enhver Merkle-verifier. Track builder overhaler 30 dages backlog uden at forsinke live ingest. Spoof detector finder kendte test-scenarier (implanted duplicate MMSI).

## Fase 2 — Nye domæner (12-24 måneder)

**Mål:** Bevis protokollen ved at tilføje nye datakilder uden at røre kerne.

- **`adsb-collect`** — 1090 MHz receiver → same signed `.aiss`-flow. `entity_type = 'aircraft'`. Er det protokollen er designet til; hvis core skal ændres, er protokollen forkert.
- **`radar-collect`** — DVB-T/FM passive radar (RSPDuo + blah2). Første POC i Øresund. L4-lag i waveo.blue er consumer. Kritisk for den nordiske dome.
- **`optical-collect`** — Pi + YOLO i havneindløb. Producerer `vessel_sightings`-style observationer som signed `.aiss` med confidence score.

Hver af disse skal være et 2-ugers projekt, ikke 2-måneders. Hvis det tager 2 måneder, er `.aiss`-protokollen designet forkert.

## Fase 3 — Scale-out (når customers/krise tvinger det)

- **`mil-gateway`** — separat netværk, vault-kilder. Data diode mellem åben og lukket side. `public_delay_hours = 999` for alle militære kilder som default.
- **`satellite-collect`** — Sentinel-1 SAR + xView3 dark ship detections. Importeres som `.aiss` med `source = 'sentinel1'`, `source_count` korreleret med AIS i samme tidsvindue → stærk dark-ship evidens.
- **`push-api`** — ekstern skriveadgang for plottere, apps, tredjepart. API-nøgler, kvoter, revocation.
- **Region-N cells** — aktiv/aktiv replikering. Første: Nordeuropa + US-East. Evidence-kæder cross-signer periodisk.

Ingen bygges før der er konkret behov. YAGNI til det punkt hvor et rigtigt use case banker på.

---

## Hvad Fase 2-3 IKKE er

For at være klar over scope-afgrænsning mellem aiss.network og søsterprodukterne:

- **aiss.network bygger ikke harbor monitoring UI.** Det er waveo.blue's Harbor Monitor. aiss.network eksponerer data; waveo visualiserer.
- **aiss.network bygger ikke Vessel Passport / Trip Log.** Det er vier.blue. aiss.network eksponerer vessel-data + `.aiss`-nav-filer; vier bygger den sociale oplevelse.
- **aiss.network bygger ikke geofencing / watchlists / B2G tiers.** Det er waveo.blue.
- **aiss.network bygger ikke community / forums / feeds.** Det er vier.blue.

aiss.network er udelukkende dataprotokollen, evidence-infrastrukturen og det åbne lag (kort + docs + API).

---

## Plans already in motion — where they land

### `CLAUDE.md`'s "Næste build"-liste

| # | Plan | System | Fase |
|---|---|---|---|
| 1 | `ship_type` backfill | Ingest-enrichment worker under `core-api` (læser AIS msg 5/24 → `entities.domain_meta`) | 0 |
| 2 | Båd-ikoner med COG-rotation | `aiss-ui-api` leverer type + bearing; `aiss.network` renderer | 0 |
| 3 | LINE layer implementation | Regler i `aiss-ui-api` (`VESSEL_TYPE_RULES` serversidet); frontend tynd | 1 |
| 4 | OpenFreeMap vector tiles | `aiss.network` kun — ingen backend-ændring | 0 |
| 5 | Lock-mode + play (scrubber 1x/10x/100x) | `aiss-ui-api` time-windowed endpoint; `aiss.network` + fremtidig `player` bruger samme | 1 |
| 6 | Record (MediaRecorder → .webm/GIF) | Ren frontend i `aiss.network` / `player` | 1 |
| 7 | PI rejection debugging | Løses af Fase 0 (`ingest-gateway` + per-reason counters). Ikke et fix — arkitektonisk konsekvens | 0 |

### D·P signatur — kontrakt for `track-builder`

Planen i `CLAUDE.md` (`D·P signatur = Sign(entity_id + epsilon + algorithm_version + raw_merkle_root + dp_coordinates)`) er **API-kontrakten for `track-builder`-servicet**, ikke et feature. Formaliseres i Fase 1:

- `track-builder` læser positions, bygger Douglas med ε ≈ 50m for arkiv.
- Signerer resultatet med reference til raw Merkle root fra `evidence`.
- Nye `algorithm_version` co-eksisterer med gamle — begge gyldige, begge signerede. Raw kan slettes bagefter uden at invalidere D·P.

Denne kontrakt er hvorfor `track-builder` er et eget system: bevisbar, versioneret, idempotent. Passer dårligt sammen med ingest; passer perfekt sammen med `evidence-builder`.

### Eksisterende driftdisciplin

`EDGE-FUNCTION-RUNBOOK.md` + `PI-OPS.md` er promoveret til `SERVICE-STANDARDS.md`. Gælder **ethvert** system i denne arkitektur, ikke kun edge functions. Se det separate dokument for detaljer.

### vier.blue's aiss-migration

Fra `VIER.md`: vier har en månedsgammel halvfærdig implementation med sit eget AIS-layer. Den skal ned og erstattes af kald til `public-api`. Det er vier's problem at refaktorere, men vores forpligtelse er at `public-api` leverer det vier skal bruge:

- `GET /v1/vessels/:mmsi` (Vessel Passport data)
- `GET /v1/positions/:mmsi/track` (Trip Log visualisering)
- `GET /v1/files/nav/:mmsi` (deling med andre sejlere)
- `POST /v1/stations` (brugerens GPS som station)

Disse skal være i Fase 1's `public-api` launch, ikke senere.

### waveo.blue's afhængigheder

Fra `WAVEO.md`: waveo starter først når aiss har multi-source (Fase 1 stable). waveo bruger:

- `GET /positions?bbox=` (dashboard map)
- `GET /routes?bbox=` (rutevisning)
- `GET /alerts?bbox=` (geofence triggers)
- `GET /vessels/:mmsi/risk` (risk scoring — kommer fra anomalies + corroboration)
- `GET /files/full/:mmsi` (Pro/B2G kunder — kræver `aiss:full`)
- WebSocket stream

Risk scoring-endpointet er ikke defineret endnu. Det er et kalkuleret aggregat over `anomalies`-tabellen + corroboration score. Skal formaliseres i Fase 1.

---

## Tekniske valg — låst og åbent

**Låst (per `PROJECTS.md` + `COWORK-GLOBAL-INSTRUCTIONS.txt`):**
- Next.js 16, TypeScript, Supabase, Tailwind.
- Separate Supabase-projekter per produkt.
- MapLibre (ikke Cesium, deck.gl, Three.js) for aiss.network kort.
- Dark theme (#060D1A), ingen auth på public site.

**Åbne beslutninger (flag for ADR):**

1. **Queue mellem gateway og core.** Kandidater: NATS JetStream, Supabase Realtime, Postgres LISTEN/NOTIFY, external (SQS). Anbefaling: NATS for decoupling med mulighed for senere multi-region fan-out.
2. **Hvor skal collectors køre.** PI'en er klar; fremtidige collectors (radar, optical) skal sandsynligvis være Fly.io eller self-hosted på Pi-klynge.
3. **`.aiss`-packet størrelse.** Påvirker gateway memory + queue message size. Scaffolding har ingen cap; skal sættes.
4. **Signing key rotation.** `ingest_sources` skal have `keys[]` med validity windows.
5. **`aiss:full` key distribution.** Hvordan får Pro/B2G kunder deres API-key til at hente signerede filer? Stripe checkout → webhook → auto-provisioning?
6. **Anomaly-to-alert pipeline.** `anomalies`-tabellen er datalaget. Hvordan når en anomaly frem som alert til waveo.blue? Supabase Realtime channel per entity? Push via webhook til waveo's Supabase?

Disse skrives som separate ADR'er i `docs/adr/` når de skal træffes.

---

## Observability og reliability

Se `SERVICE-STANDARDS.md`. Opsummeret: hvert system skal have top-level catch, per-reason counters, 4-lags observability, RUNBOOK.md, og smoke test efter hver deploy. Standarderne blev destilleret fra `EDGE-FUNCTION-RUNBOOK.md` og `PI-OPS.md` og er ikke valgfrie.

---

## First commit efter denne roadmap

```
aiss/
├── services/
│   ├── ingest-gateway/
│   ├── ais-collect/              (fra scripts/pi/ + ingest edge fns)
│   ├── core-api/                 (fra supabase/functions/ + sql)
│   └── aiss-ui-api/              (ny — BFF for aiss.network)
├── apps/
│   └── aiss.network/             (fra src/app/ — tynd klient)
├── protocol/
│   └── aiss/v1/                  (fra src/formats/aiss/v1/)
├── packages/
│   └── aiss-types/               (delte typer mellem aiss, waveo, vier)
├── docs/
│   ├── ARCHITECTURE-ROADMAP.md   (dette dokument)
│   ├── SERVICE-STANDARDS.md
│   ├── EDGE-FUNCTION-RUNBOOK.md
│   ├── PI-OPS.md
│   └── adr/                      (åbne beslutninger efterhånden)
└── SYSTEMS.md                    (pointers til hvert service's README)
```

Intet kode flyttes i første commit. Kun folders, `SYSTEMS.md`, og en tom `RUNBOOK.md` per service. **Boundaries before deployments.**
