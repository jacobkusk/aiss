# AISstream go/no-go — 2026-04-17

Readiness-review før vi åbner for aisstream som anden ingest-kilde ved siden af `pi4_rtlsdr`. Svar: **ja, helt til globalt feed (~300.000 skibe)**. Det kræver trinvis opgradering af compute + ordentlig collector-arkitektur — men det er et løst problem, ikke et umuligt.

> **Relaterede dokumenter (læs sammen):**
> - [`ARCHIVE-STRATEGY.md`](./ARCHIVE-STRATEGY.md) — WP/D·P/evidence-chain, D·P-timing, retention, signatur over `raw_merkle_root`, sikker rå-sletning.
> - [`LIVE-NETWORK.md`](./LIVE-NETWORK.md) — dual-stack live + arkiv, geohash pub/sub, plotter-protokoller, fanout-matematik til 5M brugere.
>
> Denne fil dækker kun *ingest-vejen* (fra aisstream ind i DB). Hvad der sker bagefter (komprimering, signering, udsendelse live) ligger i de to andre.

## TL;DR

| Spørgsmål | Svar |
|---|---|
| Kan vi håndtere 300.000 både? | **Ja.** Realistisk globalt feed er ~10k msg/s sustained, ikke 60k. Postgres kan det trivielt på Medium/Large compute. |
| Skal vi starte småt? | Ja — men det handler om *operationel læring*, ikke om at infrastrukturen ikke kan. Starter med Øresund, ender ved globalt. |
| Er collector-koden skrevet? | Nej. Kun `pi4_rtlsdr`. Skal bygges — se §4. |
| Token? | Ikke i repo, vault, `ingest_sources.config` eller git. Skal ligge som Supabase Edge secret eller Fly/Railway env. |
| Største risiko | At bygge collector uden downsampling og uden reconnect. AISstream dropper WebSocket uden varsel; officielle eksempler har *ingen* reconnect. |

## 1. De rigtige tal for aisstream

Jeg startede med at smide et worst-case-tal ud ("60k msg/s, kan ikke lade sig gøre"). Det er forkert. Her er de faktiske tal:

- **Unikke MMSI'er aktive globalt på et døgn:** ~400.000. Typisk ~200.000 samtidigt synlige.
- **ITU-spec for AIS Class A transmissions:**
  - 2 s når skibet er i fart >23 kn
  - 6 s ved 0–14 kn
  - 10 s ved 0–14 kn under kursændring
  - **3 min** når ankret/moored
- **Class B (mindre fartøjer):** 30 s – 3 min.
- **Reel målt rate fra aisstream's globale feed:** ~3.000–15.000 msg/s, gennemsnit omkring **8–10k msg/s**. Spikes kan gå til 30k, men det er ikke vedvarende.

Størrelsen af pakken: 50–100 bytes JSON per position. 10k msg/s × 100 byte = **~1 MB/s netværk**. Det er ingenting over moderne infrastruktur.

Det er volumetrisk sammenligneligt med, hvad MarineTraffic, VesselFinder og Spire kører på commodity-hardware hver dag. Det er et **løst problem**.

## 2. Arkitektur der når 300.000 både

Den afgørende indsigt: **300.000 skibe ≠ 300.000 writes/s til DB**. Vi downsampler ved ingest.

### Downsampling-strategi

Vi behøver ikke gemme *hver eneste* PositionReport for hvert skib. For live-map + track-rendering er 1 position per skib per **15–30 s** langt nok. Collectoren:

1. Modtager rå WebSocket-stream fra aisstream.
2. Holder en in-memory map: `mmsi → last_sent_timestamp + last_sent_lat/lon`.
3. Dropper indgående beskeder hvis:
   - Same MMSI, same position (<10 m) sendt inden for 15 s → **drop** (stationære skibe sender stadig).
   - Same MMSI sendt inden for 2 s → **drop** (duplikat fra forskellige base stations).
4. Alt andet går i batch-buffer.

Effekt på write-rate:

| Strategi | Bevaret rate |
|---|---|
| Ingen downsampling | ~10k/s |
| 1 pos / MMSI / 15 s | ~3.000/s |
| 1 pos / MMSI / 30 s | ~1.500/s |
| 1 pos / MMSI / 60 s (arkiv-mode) | ~500/s |

**1.500–3.000 writes/s er helt normalt for Postgres.** Supabase Medium (8 GB RAM, 4 vCPU) kører det uden at svede.

For `.aiss`-protokollens forensiske krav: vi kan beholde **rå fidelity i cold storage** (S3/R2) separat, mens hot DB kører downsamplet. Det er standardpraksis i AIS-arkivering. Den fulde retention-politik (hvornår rå slettes, hvornår D·P tager over, hvornår `.aiss`-filer genereres) står i [`ARCHIVE-STRATEGY.md`](./ARCHIVE-STRATEGY.md).

### Write-path til høj throughput

Nuværende Pi-path går via Edge Function → RPC → INSERT. Det er fint for 1k msg/time. For 10k msg/s er det ikke vejen — Edge Functions har ikke dimensioneringen.

Ved fase 3+ skifter collectoren til **direkte Postgres-forbindelse** via Supabase's pooler (PgBouncer transaction mode):

```
aisstream WS
     ↓ (JSON parse + downsample)
collector buffer (1000 positions / 2s timeout)
     ↓ (COPY FROM stdin)
Postgres pooler :6543
     ↓
positions_v2 partition
```

- `COPY FROM stdin` kan skrive **50.000–100.000 rækker/s** på én session.
- `entity_last` opdateres via parallel UPSERT-batch hvert 5. sekund.
- Edge Function-path beholdes for PI og andre "små" kilder, så public-facing surface er uændret.

### entity_last med 300.000 entities

- 300k rækker × ~200 bytes = ~60 MB total. Fits i RAM.
- PRIMARY KEY på `entity_id` (uuid) — UPSERT-on-conflict er O(log n).
- Ved batched UPSERT af 1000 entities ad gangen: ~10 ms per batch. 1500/s = 1,5 batches/s. Trivielt.

### Partition-strategi ved fase 4+

Daglige partitioner (nuværende model) bliver for store når vi rammer fase 4–5:

- Fase 4 (Europa, 80k vessels, ~2.000 writes/s): **~170 mio rækker/dag** → ~40 GB/dag. Håndterbart, men queries på `(entity_id, t)` begynder at tage tid.
- Fase 5 (globalt, 300k vessels, ~1.500 writes/s efter downsampling): **~130 mio rækker/dag** → ~30 GB/dag.

Skift til **time-partitioner** når dagspartition > 50 GB. Så bliver hver partition 1–2 GB, queries bliver hurtige, og vi kan dropppe gamle partitioner pr. time uden lock-contention.

## 3. DB-tilstand lige nu (grugesypzsebqcxcdseu)

Målt 2026-04-17:

### Kapacitet

- Total DB: **71 MB**.
- Største dags-partition: `positions_v2_20260415` med **22.826 rækker / 7,3 MB**.
- Aktive entities: **381** (~18 med live-dot).
- PI accept-rate seneste 6 t: **~0,20 msg/s** (peak 0,33). Lille bagage.
- Edge batch-latency: **avg 4 ms, max 828 ms**.
- `max_connections = 60`, `shared_buffers = 28 MB` → **Nano/Micro compute**. Det er ikke nok til fase 3+.

### Rejections seneste 48 t

| Kilde | Grund | Antal |
|---|---|---|
| pi4_rtlsdr | teleportation | 193 |
| pi4_rtlsdr | duplicate_within_batch | 30 |
| pi4_rtlsdr | mmsi_invalid | 1 |
| andre | 0 |

Teleportation er signal, ikke fejl (logget til `anomalies` via v8). Valideringen er sund.

### Partitioner + RLS

Alle 10 daglige partitioner + `positions_v2_historical` har `positions_v2_public_read` policy. `ensure_partition` virker og kører fra `auto-heal`-cron.

Indexes per partition: `(entity_id, t)`, `(lon, lat)`, `(source_id, t)`. Alle relevante query-veje er dækket.

### RPC-helbred (seneste time)

Alle OK: `get_live_vessels`, `get_tracks_in_range`, `entity_last`, `positions_v2` — 12/12 hver.

### Advisors

- 🟡 Partitioner mangler PRIMARY KEY. Ikke blokker for ingest, men fix før vi når fase 3.
- 🟢 Ingen sikkerhedsfejl.

### Hvad vi har på plads

- Validerings-RPC filtrerer og skriver teleport til `anomalies`.
- Edge v8 er robust (top-level try/catch, ingen `.catch()` på PostgrestBuilder).
- Per-reason counters er instrumenterede — vi ser belastningen live via `ingest_stats` + `rpc_health`.
- Partition-pipeline + RLS-propagering virker.

## 4. Skaleringsplan — trinvis til globalt

| Fase | Bounding box | Vessels i sigte | Rå msg/s | Writes/s efter downsample | Supabase compute | Ingest-path |
|---|---|---|---|---|---|---|
| 1 | Øresund `[[55.3,12.2],[56.2,13.3]]` | ~500 | 20 | 15 | **Nano (nu)** | Edge Function |
| 2 | DK `[[54,8],[58,15.5]]` | ~3.000 | 100 | 80 | **Nano → Small** | Edge Function |
| 3 | Nord+Østersø `[[51,-5],[66,30]]` | ~15.000 | 500 | 400 | **Small** | Edge Function |
| 4 | Europa `[[35,-10],[70,35]]` | ~80.000 | 2.500 | 2.000 | **Medium** | **Direkte Postgres via pooler** |
| 5 | Global | **~300.000** | ~10.000 | **~1.500 (30s downsample)** | **Large** | Direkte Postgres + time-partitioner |

Hver fase kører 24–48 t med go/no-go på:

- `avg_batch_ms` < 50 ms
- `edge_rejected` + `rpc_rejected` < 1 %
- `max_connections` < 70 % brugt
- DB vokser lineært uden spikes
- Ingen `rpc_health` fails

## 5. Collector-arkitektur

### Hvor skal den køre

**Ikke** på Pi'en (RTL-SDR'en bruger dens netværk). **Ikke** som Edge Function (150 s timeout dræber long-lived WebSocket).

Anbefaling: **Fly.io eller Railway**, Python eller TypeScript (Deno). Én lille worker, altid kørende. Deploy med `fly launch` / `railway up`. Cost: ~$5/mdr indtil fase 4.

### Hvad den gør

```python
async def run():
    while True:
        try:
            async with connect(WS_URL) as ws:
                await ws.send(json.dumps({
                    "APIKey": AISSTREAM_KEY,
                    "BoundingBoxes": BBOXES,
                    "FilterMessageTypes": [
                        "PositionReport",
                        "StandardClassBPositionReport",
                        "ExtendedClassBPositionReport",
                        "ShipStaticData",
                    ],
                }))
                async for msg in ws:
                    handle(json.loads(msg))   # downsample + buffer
        except Exception as e:
            log.warning("ws drop: %s — reconnect in %ds", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)
```

Separat task flusher buffer hvert 2. sekund:

```python
async def flusher():
    while True:
        await asyncio.sleep(2.0)
        batch = drain_buffer(max=1000)
        if batch:
            await post_to_ingest(batch)   # fase 1-3
            # eller direkte COPY til pooler ved fase 4+
```

### Batch-disciplin

- **Buffer-size:** max 1000 positions ELLER 2 s timeout.
- **Max concurrent POSTs:** 2.
- **Backoff ved 5xx:** exp 1s → 2s → 4s → 8s → 30s max.
- **429:** sov 60 s.
- **WS reconnect:** 5 s + jitter. 3 fejl i streg → alarm via `alert-health`.
- **Lokal dedup:** `mmsi + floor(t / WINDOW)` → drop duplikater.

## 6. Token

Ikke fundet i `.env.local`, `vault.secrets`, `ingest_sources.config` eller git-history. Du har sagt den er gemt — så ligger den i Vercel env, password manager eller på Pi'en.

Regler:

- **Aldrig** i `NEXT_PUBLIC_*` (eksponeret til browser).
- **Aldrig** i `ingest_sources.config` (læses af anon via RLS).
- **Ja:** Fly.io/Railway secret, Supabase Edge secret, eller `vault.secrets` hvis det er et Edge-path.

Sig hvor den ligger, så sætter jeg resten op.

## 7. Rækkefølge for næste skridt

Før vi åbner — se `FASE-0-TEST-PLAN.md` (seperat dokument) for hvad der skal verificeres kontinuerligt på Pi-data *først*: D·P, signatur, retention, Realtime-subscription, cross-source dedup.

1. **Fase 0 — D·P/signatur/retention kører kontinuerligt på Pi-data i 7 døgn.** Se test-plan.
2. **Find token.** Hvor?
3. **Fly.io / Railway account** (hvis ikke allerede oprettet).
4. **Skriv `scripts/aisstream/collector.py`** — WS + downsample + buffer + POST til `ingest-positions`.
5. **Migration:** `UPDATE ingest_sources SET is_active=true, config='{"bbox":[[55.3,12.2],[56.2,13.3]],"deploy":"fly","downsample_s":15}' WHERE name='aisstream';`
6. **Fase 1 — Øresund, 24 t.** Læs `ingest_stats` + `anomalies` næste morgen.
7. **Kalibrér `MAX_SPEED_MS`.** Aisstream har bredere vessel-typer end Pi; 30 m/s (58 kn) er for lavt for SAR-fly og hydrofoil. Hæv til 50–80 m/s eller differentier per `entity_type`.
8. **Fase 2–3** efter tabellen i §4.
9. **Før fase 4:** compute-upgrade til Medium, skriv direkte Postgres-path, time-partitioner.
10. **Før fase 5:** compute-upgrade til Large, verificér cold-storage-path for rå fidelity, skift pub/sub til NATS per `LIVE-NETWORK.md §4`.

## 8. Do NOT

- Gå ikke direkte til globalt feed uden at have kørt fase 1–3 først. Ikke fordi infrastrukturen ikke kan, men fordi vi ikke har set tail-behavior, reconnect-mønstre og reject-rates endnu.
- Put ikke token i `NEXT_PUBLIC_*`. Commit den ikke.
- Skriv ikke collector som evig-loop Edge Function — WS overlever ikke 150 s timeout.
- Ingen single-row inserts. Alt batched.
- Drop ikke validering: `MAX_SPEED_MS`, `null_island`, `duplicate_within_batch` skal stadig køre, også på aisstream-path. Bredere kildesurface = mere spoofing.
