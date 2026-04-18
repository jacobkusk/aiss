# Live network — dual-stack arkitektur

aiss.network er både et bevis-arkiv OG et live maritime netværk. Begge dele læser fra samme datastrøm. Det her dokument beskriver live-siden: hvordan rå positioner bliver leveret push-based med <2 s latens til klienter — apps, map-besøgende, plottere — uden at bryde arkiv-modellen beskrevet i [`ARCHIVE-STRATEGY.md`](./ARCHIVE-STRATEGY.md).

## 1. Tre lag, ikke tre systemer

Live og arkiv er ikke adskilte systemer. Det er to adgangsmønstre på samme datastrøm.

```
     aisstream / PI / app / plotter / sat
                     ↓
              ingest-positions
                     ↓
       [én validering, ét skrivepunkt]
                     ↓
     ┌───────────────┼──────────────────┐
     ↓               ↓                  ↓
 HOT/LIVE         WARM/QUERY         COLD/ARKIV
 ──────────       ───────────        ───────────
 entity_last     positions_v2        tracks (D·P)
 pub/sub          SQL/REST API       evidence (hash-kæde)
 WebSocket       historiske queries   .aiss-filer
 <2 s latens      sekunder            permanent, signeret
```

Én position rammer systemet. `ingest-positions` Edge Function validerer og skriver til `positions_v2` + `entity_last`. Postgres WAL fanger skriften. Supabase Realtime (eller senere NATS) pusher den som WebSocket-event til alle abonnenter. Samme skriveoperation, tre konsumenter.

Merkle-signering er strikt på arkiv-laget. Live-data bliver autoritativ *først* ved landing i `tracks` — ikke i live-strømmen. Det er det rigtige trade-off: live skal være hurtigt, arkiv skal være bevisbart.

## 2. Pub/sub — fanout-regnestykket

Write-siden skalerer godt (Postgres håndterer 100k/s på Large tier med TimescaleDB). Det er *fanout* der er det svære problem ved millioner af klienter.

**Fanout-math.** Hvis 500.000 brugere er online samtidig og hver ser 100 både i deres viewport der opdaterer hvert 5. sekund, skal systemet pushe **10 millioner beskeder/s**. Det er ikke Postgres' job.

Løsningen er **geohash-baseret pub/sub**:

- Verden opdeles i ~5 km × 5 km ruder (geohash-precision 5).
- Hver position publiceres til kanalen for sin rude: `geo.u4pr8.vessels`.
- Hver klient subscriber til sin egen rude + 8 naboruder (altså 9 kanaler) baseret på map viewport.
- En båd i Øresund sender én gang → kun ~500 klienter i nærheden får beskeden. Ikke alle 5M.

Det gør fanout til **O(klienter med viewport-overlap)**, ikke O(totale klienter). Den model skalerer til millioner samtidige brugere på én pub/sub-server.

## 3. Pub/sub — tre kandidater

**A. Supabase Realtime** — det vi får gratis med vores plan. Postgres WAL → WebSocket.

- Pro: ingen ekstra infrastruktur, bruger eksisterende RLS, gratis med plan.
- Pro: klienten subscriber til `entity_last`-tabel-changes og får diffs.
- Con: max ~10.000 samtidige forbindelser per projekt.
- Con: ikke geohash-aware out-of-box — klienten får alle changes og filtrerer client-side.
- Con: ingen regional sharding.

**Brug-case: fase 1–3.** Op til et par tusinde samtidige klienter. Perfekt match.

**B. NATS JetStream** — moderne, simpel pub/sub med subject hierarchies.

- Pro: subjects som `geo.u4pr8.>` giver gratis geohash-routing.
- Pro: millioner af subscribers, ingen hard-limit.
- Pro: persistence (JetStream) hvis klient går offline kortvarigt.
- Pro: deploy på Fly.io for ~$20/mdr i starten.
- Con: vi skal køre det. Supabase gør det ikke for os.
- Con: brokers der limfarver mellem Postgres WAL og NATS subjects skal bygges.

**Brug-case: fase 4+.** Når klient-antallet overstiger ~5.000.

**C. Cloudflare Durable Objects + WebSocket** — stateless edge pub/sub.

- Pro: en Durable Object per geohash → automatisk sharding, global fanout.
- Pro: klienter connecter til nærmeste Cloudflare edge (sub-100 ms alt globalt).
- Pro: ingen broker-operation — det er managed.
- Con: dyrere per besked end NATS.
- Con: vendor lock-in.

**Brug-case: fase 5+.** Hvis vi vil have rigtig global performance uden at køre NATS-klynger selv.

## 4. Transport-migration — samme data, anden kanal

Et vigtigt aspekt: vi kan skifte fra A → B → C uden at ændre write-path eller datamodel. Postgres forbliver truth. Pub/sub er bare delivery-lag:

```
Fase 1–3:        ingest-positions → Postgres → Supabase Realtime → klienter
Fase 4:          ingest-positions → Postgres → [WAL → NATS broker] → klienter
Fase 5:          ingest-positions → Postgres → NATS → Cloudflare DO → klienter
```

Klienter behøver ikke bemærke skiftet. De ændrer WebSocket-endpoint, protokollen er stadig "subscribe til en geohash, få positions-events".

## 5. Plottere — protokol-gateway

Plottere er marine chart-plottere (Raymarine, Garmin, B&G, Simrad, Navionics). De taler faste protokoller og forventer AIS-input i et bestemt format. Vi bygger protokol-gateways.

### Plottere → os (opt-in crowd-contribution)

En plotter-ejer kan opte ind og sende sin egen position til os, samme som PI og aisstream.

**Via MQTT.** Moderne plottere (Raymarine Axiom, B&G Zeus) understøtter MQTT natively. De publisher på `aiss/submit/<plotter_id>` med payload `{"mmsi": ..., "lat": ..., "lon": ..., ...}`. Vores MQTT broker forwarder til `ingest-positions` Edge Function.

**Via companion-app.** For plottere uden MQTT-support: en telefon-app læser NMEA 0183 fra plotteren over Bluetooth eller WiFi, og forwarder til os via HTTPS. Telefonen har ofte bedre dataforbindelse end plotteren.

Hver opt-in plotter registreres som `ingest_sources.plotter_<brand>_<hw_id>` med egen API key. Samme cross-source merge, samme evidens-model, samme signatur.

### Os → plottere (live AIS-feed ud)

Plottere forventer AIS-data som NMEA 0183 VDM-sætninger, typisk over TCP eller UDP.

**TCP server på port 10110** som emulerer en lokal AIS-receiver. Klienten (plotteren) connecter, angiver fx en bounding box, og modtager `!AIVDM,1,1,,A,...*XX`-sætninger for alle vessels i området. Det er præcis hvad fx dAISy og AIS-Catcher giver dem — plotteren tror det er en RTL-SDR.

**MQTT-output.** Samme broker, forskellige topics: `aiss/vessels/<geohash>/<mmsi>`. Plottere subscriber til relevante geohashes.

**REST API.** `GET /v1/vessels?bbox=...&since=...` for apps og custom integrations.

### Re-encoding

Rå AIS fra transponderen kommer som NMEA 0183 VDM. Det er dét rtl_ais allerede spytter ud. For positioner vi modtager fra aisstream eller vores egen app er datamodellen JSON — vi skal *re-encode* til VDM før plottere kan bruge det. Det er en af de protokol-gateway-opgaver der ligger foran os.

## 6. Latens-budgetter

For at leve op til "live maritime netværk" skal vi holde styr på latens end-to-end. Fra AIS-transmission til skærm:

```
Transponder transmit     0 ms
RF → receiver            ~5 ms
Receiver decode          50–100 ms
UDP til collector        5 ms
Validering (edge)        2–5 ms
Postgres WAL write       1 ms
Supabase Realtime push   10–50 ms
WebSocket to browser     20–100 ms
Map re-render            16 ms (1 frame)
                         ─────────────
TOTAL                    ~110–280 ms   (realistisk)
```

Det er *langt* under det 2-sekunders target brugeren forventer. Der er masser af budget selv ved skala.

Ved fase 5 med NATS-geohash pub/sub kan vi holde samme profil for globale klienter hvis vi placerer NATS-noder regionalt.

## 7. Geohash — implementation

Jeg foreslår at tilføje `geohash` kolonne til `entity_last` (og muligvis `positions_v2`) som auto-beregnes fra `(lat, lon)`:

```sql
ALTER TABLE entity_last ADD COLUMN geohash_5 text
  GENERATED ALWAYS AS (ST_GeoHash(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 5))
  STORED;

CREATE INDEX entity_last_geohash_idx ON entity_last (geohash_5);
```

Det giver os:

- Query `WHERE geohash_5 LIKE 'u4pr%'` hurtigt (første 4 chars matcher ~20 km boks).
- Pub/sub-channel-navn kan genereres direkte fra kolonnen uden extra computation.
- Aggregations-queries per geohash til clustering på map.

Ikke nødvendigt for fase 1 (små områder, client-side filter er fint). Tilføj ved fase 3, så er vi klar til pub/sub-migration ved fase 4.

## 8. Skaleringstabel — live-siden

| Fase | Samtidige klienter | Pub/sub | Fanout-rate | Plotter-integration |
|---|---|---|---|---|
| 1 | <50 (interne tests) | Supabase Realtime | <10 msg/s pr klient | ikke endnu |
| 2 | <500 | Supabase Realtime | <50 msg/s pr klient | beta — TCP/NMEA server |
| 3 | <5.000 | Supabase Realtime + client-side bbox-filter | <200 msg/s pr klient | produktion |
| 4 | <50.000 | **NATS med geohash-kanaler** | O(synlige både) pr klient | MQTT broker publicly exposed |
| 5 | >50.000 (op til 5M) | NATS + regional sharding ELLER Cloudflare DO | O(synlige både) pr klient | global MQTT + TCP/NMEA per region |

## 9. Dual-stack — konkret eksempel

Én position kommer ind fra aisstream for MMSI 219024123 kl. 14:32:15 UTC.

```
t=0 ms     aisstream WS message: {"MessageType":"PositionReport",
           "Message":{"PositionReport":{"UserID":219024123,
           "Latitude":55.6723,"Longitude":12.5821,"Sog":12.3,"Cog":45}}}

t=+50 ms   collector parser → normaliseret row.

t=+55 ms   collector buffer (1000 msg / 2 s).

t=+1050 ms flush til POST /functions/v1/ingest-positions med batch af ~500 pos.

t=+1060 ms ingest-positions validerer. Writer til positions_v2_20260501 (INSERT).
           Writer til entity_last (UPSERT on conflict).
           Writer til evidence (hash chain append).

t=+1062 ms Postgres WAL fanger 3 skriver.

t=+1090 ms Supabase Realtime noticer entity_last change for entity_id XYZ.
           Pusher event til alle 23 klienter der subscriber til den entity
           ELLER til geohash u4pr8-området.

t=+1130 ms Klient #7 (bruger i København's havn) modtager WebSocket message.
           Map-layer opdaterer dot-position.

t=+1146 ms Browser re-renderer frame. Bruger ser skibet flytte sig.

---

Senere samme aften:

t=+next_day compress_completed_segments kører. Hvis ikke længere
            transmitteret i 30 min, bliver dagens segment komprimeret
            til D·P. tracks-række oprettes med merkle_root + signatur.

90 dage senere: raw slettes. D·P forbliver. Verificerbar for evigt.
```

Én datapakke. Tre formålsbestemmelser: live delivery, arkiv-byggesten, evidens-kæde-led. Ingen kopiering. Én valideringslinje.

## 10. Do NOT

- Byg ikke klient-kode der poller `GET /vessels?since=` hvert 5. sekund. Det skalerer ikke. Subscribe til Realtime/NATS i stedet.
- Publicér ikke rå ikke-validerede aisstream-beskeder direkte til pub/sub. De skal gennem `ingest-positions`-validering først — ellers får klienter null-island og teleporterede skibe.
- Send ikke fanout-beskeder med hele `positions_v2`-rækken. Send delta: `{mmsi, lat, lon, t, sog, cog}`. Klienten har allerede alt andet fra startup-query.
- Eksponér ikke MQTT broker uden auth. Hver plotter har egen API key og egen `source_id`.
- Gør ikke live-laget til "sandhed". Arkivet er sandheden. Live er en visning af den sandhed mens den er fersk.
