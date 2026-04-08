# AISS — Ocean Evidence Protocol

> **aiss.network** — Åbent, gratis, ingen konto.
> Havets tamper-proof vidne. Live AIS-kort med permanent evidenskæde.

---

## Hvad er AISS

AISS er ikke et AIS-værktøj. Det er et **maritimtvidnesystem** — kryptografisk sikret, permanent bevisførelse for havets trafik.

De tekniske komponenter er kendte: PostGIS, Douglas-Peucker, Merkle-træer, MultiLineString. Det nye er kombinationen anvendt på et specifikt juridisk og maritimtvidneproblem.

### Hvad der adskiller AISS

1. **Signerede huller som bevis** — et hul i sporet er ikke en fejl, det er en dokumenteret fact der ikke kan udfyldes retroaktivt
2. **Permanent evidenskæde** — ingen cleanup, ingen retention, aldrig slettet
3. **Multi-source med kildeattribution** — aisstream, AISHub, radar, satellit, plotter crowd — alle sporbare til kilde
4. **Crowd-sourcet observation i evidensmodel** — 47 uafhængige observatører der ser samme skib = stærk corroboration
5. **`.aiss` som open evidence standard** — et format myndigheder, forsikring og retter kan stole på

---

## Arkitektur

### De 5 tabeller

| Tabel | Type | Formål |
|---|---|---|
| `ais_string` | `MultiLineStringM` | Komplet spor per skib, for evigt |
| `ais_line_events` | append-only | SHA-256 hash-kæde, Bitcoin-forankret |
| `vessel_readings` | JSONB | Sensordata, schema-fri |
| `ais_last` | row per MMSI | Seneste position (live prik) |
| `ais_tail` | JSONB array | 20 nyeste punkter (gul hale) |

### Huller er information

```
Segment 1:  ●────●────●────●
                          [hul — signal tabt]
Segment 2:                      ●────●────●
                [havn — AIS slukket]
Segment 3:                                  ●────●
```

`merged_track` er **ikke en tabel** — det er en query. Afledte views gemmes aldrig som primær kilde. Bevislinjen holdes ren.

### Datakilder

| Kilde | Type | Status |
|---|---|---|
| aisstream.io | Terrestrisk AIS | Aktiv |
| AISHub | Worldwide HTTP poll | Aktiv |
| RTL-SDR | Egen modtagelse | Planlagt |
| Satellit-AIS | S-AIS | Planlagt |
| Passiv radar | Position uden MMSI | Planlagt |
| OpenCPN/Orca/Garmin | Plotter crowd upload | Planlagt |
| Soft-AIS/GPS | App ombord | Planlagt |

### Storage

Kompressionsforhold ~700x via Douglas-Peucker:
Et år med 500.000 skibe ≈ **275 GB**. Rå AIS ville være ~180 TB.

---

## Tech Stack

- **Framework:** Next.js (App Router)
- **Sprog:** TypeScript
- **Map:** MapLibre GL JS
- **Database:** Supabase / PostgreSQL + PostGIS (`grugesypzsebqcxcdseu`)
- **Collector:** Node.js + PM2 på Mac mini (`/Users/jacobkusk/aiss-collector`)

---

## Kørsel

```bash
npm install
npm run dev    # localhost:3001
npm run build
npm run lint
```

Kræver `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## .aiss container-format

```
Magic:    0x41 0x49 0x53 0x53  ("AISS")
Version:  1 byte
Header:   mmsi, vessel_name, created_at, merkle_root
Segments: [{gap_before_sec, source, points:[lon,lat,t,sog,cog,hdg]}, ...]
Chain:    merkle events (offline verifikation)
```

En `.aiss`-fil er hele skibets tamper-proof historik i ét objekt. Kan emailes til en advokat. Verificeres offline. GPX er kompatibilitetsformatet udadtil.

---

## Forretningsmodel

**aiss.network** — gratis, åben. Bygger netværket og troværdigheden.

**waveo.blue** — betalt. Søfartsstyrelsen, forsikring, fiskeri, advokater. Watchlists, sager, geofence alerts, eksport af `.aiss` som juridisk dokument.
