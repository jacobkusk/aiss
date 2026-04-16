# AISS — Ocean Evidence Protocol

> **aiss.network** — Åbent, gratis, ingen konto.
> Havets tamper-proof vidne. Live AIS-kort med permanent evidenskæde.

---

## Hvad er AISS

AISS er ikke et AIS-værktøj. Det er et **maritimt vidnesystem** — kryptografisk sikret, permanent bevisførelse for havets trafik.

De tekniske komponenter er kendte: PostGIS, Douglas-Peucker, Merkle-træer, MultiLineString, per-recipient envelope encryption. Det nye er kombinationen anvendt på et specifikt juridisk og maritimt vidneproblem.

### Hvad der adskiller AISS

1. **Signerede huller som bevis** — et hul i sporet er ikke en fejl, det er en dokumenteret fact der ikke kan udfyldes retroaktivt
2. **Permanent evidenskæde** — hash-kædet, aldrig slettet, aldrig overskrevet
3. **Multi-source med kildeattribution** — aisstream, AISHub, RTL-SDR, satellit, plotter crowd — alle sporbare til kilde
4. **Crowd-sourcet observation i evidensmodel** — N uafhængige observatører der ser samme skib = stærk corroboration
5. **`.aiss` som open evidence standard** — et format myndigheder, forsikring og retter kan stole på

---

## Arkitektur

### Tabeller

> Kanonisk skema er beskrevet i `~/Ventures/shared/ARCHITECTURE.md`. Tabellerne herunder er aiss.network's implementering af det skema.

| Tabel | Indhold | Rolle |
|---|---|---|
| `entities` | én række per skib / sensor / drone | identitet + `domain_meta` (MMSI, ship_type, callsign …) + vault-felter `visibility` / `owner_id` / `retention` |
| `entity_last` | seneste position per entity | live dot på kortet |
| `positions_v2` | rå fixes, partitioneret per dag | bevismateriale, aldrig rørt efter indsæt |
| `positions_v2_historical` | ældre rullede positioner | langtidsarkiv |
| `tracks` | Douglas-Peucker-komprimeret spor | `merkle_root`, `segment_hashes[]`, `encrypted_dek`, `permanent_address`, `epsilon_m`, `jurisdiction` |
| `strings` | `MultiLineStringM` per entity per dato | linjen du ser på kortet |
| `evidence` | append-only hash-kæde (`hash`, `prev_hash`, `pts`, `validation_meta`) | tamper-proof audit trail |
| `anomalies` | append-only log af detekterede inkonsistenser | spoof-kandidater, source-konflikter, null-island fixes — bevis om beviset |
| `ingest_sources` + `ingest_stats` | registrerede collectors og deres flush-statistik | `accepted` / `rejected` per batch, `public_delay_hours` per kilde |
| `heal_log`, `rpc_health`, `alert_state` | selvhelende drift | systemet holder sig selv i live |

### Huller er information

```
Segment 1:  ●────●────●────●
                          [hul — signal tabt]
Segment 2:                      ●────●────●
                [havn — AIS slukket]
Segment 3:                                  ●────●
```

`tracks.gap_intervals` gemmer hullerne eksplicit. Et hul er aldrig interpoleret bort. Afledte visualiseringer (LINE, D·P) er queries, ikke primær kilde — bevislinjen holdes ren.

### Datakilder

| Kilde | Type | Status |
|---|---|---|
| RTL-SDR (Raspberry Pi) | Terrestrisk AIS | **Aktiv** (`pi4_rtlsdr`) |
| aisstream.io | Terrestrisk AIS, stream | Konfigureret, inaktiv |
| AISHub | Worldwide HTTP poll | Konfigureret, inaktiv |
| Satellit-AIS | S-AIS | Planlagt |
| Passiv radar | Position uden MMSI | Planlagt |
| OpenCPN / Orca / Garmin | Plotter crowd upload | Planlagt |
| Soft-AIS / GPS | App ombord | Planlagt |

### Storage

Kompressionsforhold ~700× via Douglas-Peucker. Et år med 500 000 skibe ≈ **275 GB**. Rå AIS ville være ~180 TB.

---

## Tech stack

- **Framework:** Next.js 16 (App Router)
- **Sprog:** TypeScript
- **Map:** MapLibre GL JS (globe + flat, intet andet kortbibliotek)
- **Database:** Supabase / PostgreSQL + PostGIS (`grugesypzsebqcxcdseu`, eu-west-1)
- **Collector:** Raspberry Pi 4 + RTL-SDR → Supabase RPC (`scripts/pi/ais_to_supabase.py`)
- **Edge Functions:** Deno (`supabase/functions/`)

---

## Kørsel

```bash
npm install
npm run dev      # localhost:3000 (port 3000 er låst til aiss)
npm run build
npm run lint
```

Kræver `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## `.aiss` container-format

```
Magic:    0x41 0x49 0x53 0x53  ("AISS")
Version:  1 byte
Header:   entity_id, merkle_root, created_at, recipient_keys (ECDH-P256)
Segments: [{gap_before_sec, source, points:[lon,lat,t,sog,cog,hdg]}, ...]
Chain:    merkle events (offline verifikation)
Payload:  encrypted with per-recipient envelope
```

En `.aiss`-fil er hele skibets tamper-proof historik i ét objekt. Kan emailes til en advokat, verificeres offline. Scaffolding findes i `src/adapters/`, `src/core/`, `src/formats/aiss/v1/` — endnu ikke wired ind i runtime, men skemaet ligger fast.

---

## Forretningsmodel

**aiss.network** — gratis, åben. Bygger netværket og troværdigheden.

**waveo.blue** — betalt. Søfartsstyrelsen, forsikring, fiskeri, advokater. Watchlists, sager, geofence alerts, eksport af `.aiss` som juridisk dokument.

**vier.blue** — demo + privat-klient-visning af `.aiss` data. Bruger aiss.network API, ingen egen AIS-pipeline.
