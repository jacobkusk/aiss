# aisstream collector

Fase 1 (Øresund) collector for `aisstream.io` → aiss `ingest-positions` Edge Function.

> Kontekst: `docs/AISSTREAM-READINESS.md`, `docs/FASE-0-TEST-PLAN.md`.
> Denne collector matcher `scripts/pi/ais_to_supabase.py` i stil og instrumentering.

## Hvad den gør

```
aisstream WebSocket
       │   (PositionReport / ClassB / ExtendedClassB / ShipStaticData)
       ▼
collector.py
  ├─ per-MMSI downsample (15s vindue, 10m distance-tærskel)
  ├─ batch-buffer (1000 positions ELLER 2s timeout)
  └─ POST → ingest-positions  (x-source: aisstream)
       ▼
positions_v2 + entity_last + (teleportation → anomalies)
```

- **Én WS-connection.** Reconnect med eksponentiel backoff (2→4→8…→60s). 10 reconnects i streg = exit 2.
- **Downsampling:** `mmsi → last_sent(t, lat, lon)`. Samme MMSI inden for 15s og <10m bevægelse → drop. Resultatet er ca 1.500–3.000 writes/s ved globalt feed; Øresund fase 1 er ~15/s.
- **Batch-POST:** max 1000 positions per call, flushes hver 2s. Samme endpoint + edge-funktion som Pi-collector bruger — ingen speciel aisstream-sti i backend.
- **Instrumentering:** stats-log hver 60s med accepted/rejected/anomalies/reasons. Samme reject_reasons-struktur som Pi-scriptet, så `ingest_stats`-dashboard virker uændret.

## Hvorfor *ikke* på Pi'en eller som Edge Function

- **Pi:** RTL-SDR'en bruger Pi'ens netværk og USB. En parallel 1 MB/s WS-stream gør de to collectors til naboer fra helvede.
- **Edge Function:** Supabase Edge har 150s timeout. AIS-WebSockets holder i timevis. Edge-pathen kører kun som POST-receiver.

→ Deploy som lille worker på Fly.io eller Railway. Fly.toml er inkluderet. ~$5/mdr indtil vi når fase 4.

## Setup

### 1. Secrets der skal sættes

| Navn | Hvor lever den | Nødvendig |
|---|---|---|
| `AISSTREAM_API_KEY` | Fly/Railway secret | Ja — WS-auth |
| `SUPABASE_ANON_KEY` | Fly/Railway secret | Ja — Authorization header til edge |
| `INGEST_API_KEY` | Fly/Railway secret | Kun hvis edge-funktionen kører med matching `INGEST_API_KEY` env (i dag: nej) |

**Aldrig** `NEXT_PUBLIC_*`. **Aldrig** i `ingest_sources.config` (læses af anon via RLS). **Aldrig** i git.

### 2. Fly.io (anbefalet — primary_region `arn` er tættest på Øresund)

```bash
cd scripts/aisstream/
fly launch --name aiss-aisstream --no-deploy --copy-config
fly secrets set \
  AISSTREAM_API_KEY="..." \
  SUPABASE_ANON_KEY="eyJ..."
fly deploy
fly logs          # verificér "subscribed bboxes=..." + stats-linjer hver 60s
fly scale count 1 # aldrig mere end 1 — dup-ingest under samme x-source
```

### 3. Railway-alternativ

Railway accepterer samme Dockerfile. Sæt samme secrets via Railway UI og deploy fra `scripts/aisstream/`. Ingen port-eksponering nødvendig (dette er en worker, ikke en webservice).

### 4. Aktivér aisstream i DB

```sql
UPDATE ingest_sources
SET is_active = true,
    config = jsonb_build_object(
      'bbox',           jsonb_build_array(jsonb_build_array(55.3,12.2), jsonb_build_array(56.2,13.3)),
      'deploy',         'fly',
      'downsample_s',   15,
      'description',    'aisstream.io WebSocket — Øresund fase 1'
    )
WHERE name = 'aisstream';
```

> `config`-feltet er kun dokumentation — den faktiske kørende config ligger i Fly/Railway env. DB-config skal *aldrig* indeholde hemmeligheder.

### 5. Go/no-go efter 24 timer

Kør fase-0 dashboard:

```sql
SELECT
  (SELECT count(*) FROM tracks WHERE created_at > now() - interval '24 hours') AS new_tracks_24h,
  (SELECT count(*) FROM tracks WHERE created_at > now() - interval '24 hours' AND signature IS NULL) AS unsigned_24h,
  (SELECT sum(accepted) FROM ingest_stats WHERE ts > now() - interval '24 hours' AND source_name = 'aisstream') AS aisstream_accepted_24h,
  (SELECT sum(accepted) FROM ingest_stats WHERE ts > now() - interval '24 hours' AND source_name = 'pi4_rtlsdr') AS pi_accepted_24h,
  (SELECT count(*) FROM anomalies WHERE anomaly_type='teleportation' AND detected_at > now() - interval '24 hours') AS teleport_24h,
  (SELECT count(*) FROM rpc_health WHERE checked_at > now() - interval '24 hours' AND ok = false) AS rpc_fails_24h;
```

Ønskede værdier:
- `aisstream_accepted_24h` > 1.000 (Øresund ~15/s = ~1.3M/døgn i worst case før downsample; efter 15s downsample er ~50k/døgn realistisk)
- `unsigned_24h = 0`
- `teleport_24h < 50` (sanity check på per-type MAX_SPEED kalibrering)
- `rpc_fails_24h = 0`

Hvis det hele er grønt efter 24t → fortsæt til fase 2 (DK-bbox). Fase-tabel i `docs/AISSTREAM-READINESS.md §4`.

## Smoke-test lokalt

```bash
export AISSTREAM_API_KEY="din-key"
export SUPABASE_ANON_KEY="eyJ..."
export AISSTREAM_BBOX='[[55.3,12.2],[56.2,13.3]]'
pip install -r requirements.txt
python collector.py
```

Forventet output (med gyldig key):
```
HH:MM:SS INFO aisstream collector starting. bbox=[[55.3, 12.2], [56.2, 13.3]] downsample=15s flush=2.0s max_buf=1000
HH:MM:SS INFO connecting to wss://stream.aisstream.io/v0/stream …
HH:MM:SS INFO subscribed bboxes=[[[55.3, 12.2], [56.2, 13.3]]] types=['PositionReport', ...]
HH:MM+60s INFO stats received=N downsampled=M posted=X accepted=Y edge_rej=0 rpc_rej=0 anom=0 reasons={}
```

Ctrl-C → clean shutdown med final stats.

## Retention / expire_raw_positions

Se `supabase/functions-sql/expire_raw_positions.sql` (deployet 2026-04-18).
Defaults: `dry_run=true`, `retention_days=7`. Kør dry-run først:

```sql
SELECT * FROM expire_raw_positions(p_dry_run := true, p_retention_days := 7);
```

Når vi er tilfredse med dækning → sæt op som pg_cron:

```sql
SELECT cron.schedule(
  'expire-raw-positions',
  '0 3 * * *',   -- hver nat kl 03 UTC
  $$SELECT expire_raw_positions(p_dry_run := false, p_retention_days := 7)$$
);
```

Hæves gradvist: 7 → 14 → 30 dage når T4-verify-logikken er bekræftet på to partitioner og fase 2+ er stabil.

## Do NOT

- Kør ikke to aisstream-collectors mod samme source_id. Én `x-source: aisstream` ad gangen.
- Overskriv ikke `INGEST_API_KEY` kun på collectoren uden at matche edge-env (edge afviser 401).
- Skift ikke downsample_s til <5 uden at have skaleret Supabase compute først (Nano kan ikke tage 3k writes/s).
- Gå ikke direkte til globalt bbox fra fase 1 — følg trappen i `docs/AISSTREAM-READINESS.md §4`.
