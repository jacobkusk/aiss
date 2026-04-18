# Archive strategy — WP, D·P og retention

Hvordan aiss.network gemmer maritime positioner på lang sigt: hvad der er rå, hvad der komprimeres, hvornår komprimering kan ske, og hvordan Merkle-signaturer binder det sammen. Læs det her før du ændrer noget i `positions_v2`, `tracks`, eller retention-scripts.

## 1. Tre datalag, én sandhed

aiss.network opererer på samme datastrøm i tre versioner. Det er ikke tre kopier — det er tre udtryk af samme underlæggende observationer.

**Waypoint (WP).** Rå positioner, en række per AIS-transmission, per kilde. Bor i `positions_v2`-partitioner (daglige). Ingen komprimering, ingen tab. Det er det vi ser live. Retention: **kort til medium** (standard 90 dage, permanent for flaggede entities).

**D·P (Douglas-Peucker).** Komprimeret rute-geometri. Én række per entity per segment i `tracks`-tabellen. Beholder perceptuel fidelity — et skib der sejler i lige linje i 6 timer komprimeres fra ~2.000 waypoints til ~15 uden synligt tab. Retention: **permanent** for alle entities.

**Evidens-kæde.** `evidence`-tabellen med append-only hash-chain over alle flushes. Tilsammen med `tracks.merkle_root` og `tracks.segment_hashes[]` udgør det den kryptografiske ryggrad. Retention: **permanent**, umuligt at ændre retroaktivt uden det opdages.

Merkle-signering eksisterer kun på arkiv-laget. Live-laget (`entity_last`, pub/sub, Supabase Realtime) behøver ikke signering — den data er ephemeral og bliver autoritativ *først* når den lander i arkivet.

## 2. D·P-timing — algoritmen kræver en linje

D·P er en linje-forenklings-algoritme. Den kigger på en polyline, finder punktet længst fra den rette linje mellem endepunkterne, og rekurserer hvis afstanden overstiger epsilon. Det betyder:

- D·P kan **ikke** køre på et enkeltstående punkt.
- D·P giver ingen reduktion på 2 punkter (linjen er allerede optimal).
- D·P giver minimal reduktion på 3–5 punkter.
- D·P bliver først meningsfuld ved ~10+ punkter på samme segment.

Konsekvens: raw WP skal altid eksistere indtil D·P er kørt og signeret. Vi kan ikke implementere en "slet rå efter 7 dage"-regel som blinder for om D·P faktisk er færdig. Retention-triggeren skal være *"D·P færdig OG signeret OG min. 90 dage gammel"*, ikke bare "alder".

### Hvornår er et segment komplet?

Et segment er en sammenhængende strækning af bevægelse. D·P komprimerer ét segment ad gangen. Et segment slutter (og er klar til D·P) når én af følgende er sand:

**Natural gap.** Vessel transmitterer ikke i >30 minutter. Det markerer ofte havne-ankomst, lukket transponder, eller forladt tracking-område. Alt før gap'et er et færdigt segment.

**Day-boundary rollup.** For vessels i konstant transmission afsluttes segmentet kl. 00:00 UTC hver dag. Næste dag starter nyt segment. Det giver forudsigelig D·P-cadence og overlap med daglige partitioner.

**Manuel trigger.** `build_dp_tracks(entity_id, start, end)` kan kaldes direkte — fx når en `entity` markeres `permanent`-retention og vi vil komprimere al historik nu.

**Minimum-waypoints-gate.** Selv når et segment er "komplet" efter ovenstående, køres D·P kun hvis segmentet har ≥ 10 waypoints OG ≥ 1 km total rute-længde. Under det er det ikke meningsfuldt — der er ikke nok linje til at glatte. Sådanne mini-segmenter bliver i raw-form og får aldrig en `tracks`-række.

### Den kritiske implikation for retention

Raw kan *ikke* slettes på fast timer.

Raw kan *kun* slettes efter:

1. Segment er markeret færdigt (gap / day-boundary / manuel).
2. D·P er kørt (eller mini-segment-gate har afvist komprimering for evigt).
3. `tracks`-rækken indeholder gyldig `merkle_root` + `segment_hashes` + `raw_merkle_root` + signeret.
4. Retention-vindue udløbet (fx 90 dage siden segment-slut).
5. `entities.retention = 'standard'` (ikke `'permanent'`).

Alle fem betingelser skal være sande. Et nightly script verificerer hver enkelt før det rører rækker i `positions_v2`.

## 3. D·P-signaturen — hvorfor vi kan slette raw senere

Den elegante del: D·P-rækken indfanger *beviset for hvilke rå-punkter den blev udledt af* i selve signaturen.

```
D·P_signature = Sign(
  entity_id +
  epsilon_m +
  algorithm_version +
  raw_merkle_root +         ← fanget i det øjeblik D·P bygges
  dp_coordinates +
  time_range +
  source_ids               ← alle kilder der bidrog til raw
)
```

Når raw er slettet 90 dage senere, er D·P'en stadig verificerbar:

- Hvem har signeret? Vores nøgle, det kan enhver verificere.
- Hvilken algoritme? `algorithm_version = "dp-v2-epsilon-50"` fortæller det præcist.
- Hvilke rå-data byggede den på? `raw_merkle_root` identificerer den rå-batch unikt.
- Er D·P'en uændret? `Hash(felter ovenfor) == stored_signature`.

En tredjepart kan ikke genskabe rå, men de kan verificere at ingen har ændret D·P'en siden signeringen, og de kan se præcis hvilken rå-historik den *oprindeligt* repræsenterede. Det er den rette balance for public evidence: fuld fidelity kort tid, tamper-proof reduktion for altid.

## 4. Versionerede D·P — algoritmer udvikles

Komprimerings-algoritmer forbedres. Det skal arkiv-modellen håndtere uden at rewrite historien.

**Eksempel.** I dag komprimerer vi med epsilon 500m (grov). Om 6 måneder skifter vi til epsilon 50m (fin), fordi close-zoom-visningen kræver det. I dag og tidligere uploadede `.aiss`-filer henviser til `algorithm_version = "dp-v1-epsilon-500"`. Dem rører vi ikke.

Vi kører `build_dp_tracks` igen på samme rå (hvis den stadig eksisterer) og producerer en **ny `tracks`-række** med `algorithm_version = "dp-v2-epsilon-50"`, nyt `raw_merkle_root` (fordi rå er den samme, men Merkle-roden beregnes på bytes — stabil), nyt signatur. Den gamle række forbliver urørt i `tracks`-tabellen.

Begge versioner er gyldige. Begge kan serveres til klienter der anmoder om den opløsning de har brug for. Og hvis nogen mistænker os for at "optimere historien væk", kan de verificere at v1 stadig findes, uændret siden 2026.

Det betyder også: efter raw er slettet, kan vi *ikke længere* genkomprimere. Så valget af algorithm_version ved den første D·P er vigtigt. Politik: **komprimér altid med den bedste tilgængelige version ved first-run**, og hvis algoritmen forbedres signifikant, retro-komprimér alle entities hvor raw endnu eksisterer inden sletning.

## 5. Retention-politik — konkret

Schema-felt der allerede findes:

```
entities.retention in ('standard', 'permanent')
```

Default er `'standard'`. Felter sættes manuelt eller via anomaly-triggers (fx watchlisted MMSI, fundet i spoofing-event, part af investigation).

### Standard retention

- Raw WP i `positions_v2`: **90 dage** efter `positions_v2.t`.
- Betinget af: D·P-række eksisterer for samme (entity_id, segment) ELLER segment er under minimum-waypoints-gate.
- D·P i `tracks`: **permanent**.
- Evidens-kæde i `evidence`: **permanent**.
- Nightly job: `expire_live_vessels` + et kommende `expire_raw_positions` checker alle fem betingelser og sletter.

### Permanent retention

- Raw WP: **permanent, aldrig slettet**.
- D·P: **permanent**.
- Evidens-kæde: **permanent**.
- Brug-cases: ships under investigation, watchlist-MMSI, myndigheds-requests, kunder med opgraderet retention-tier.

### Always-raw-vindue

Uanset retention-setting er rå fra de **seneste 48 timer** aldrig slettet. Det dækker:

- In-progress segmenter som D·P ikke er kørt på endnu.
- Live map-queries der går ned i timebaseret detalje.
- Kort debug-vindue hvis noget ser galt ud i komprimeringen.

Efter 48 timer går segmentet ind i normal retention-logik.

### Mini-segmenter

Et segment med <10 waypoints eller <1 km rute-længde bliver **aldrig** D·P-komprimeret. For `retention = 'standard'` entities slettes raw efter 90 dage uden der nogensinde har eksisteret en `tracks`-række. Det er OK — der er ikke bevis-værdi i at holde fast i et enkelt punkt-observation for evigt. For `permanent` entities forbliver rå.

Rationalet: D·P koster storage (ny række per segment). Hvis komprimeringen ikke rent faktisk reducerer datamængden, er det ren overhead. Mini-segmenter rammer bevidst uden for bordet.

## 6. Retention timeline — konkret eksempel

En busy vessel der sejler kontinuerligt.

```
Dag 0, 08:00 UTC    Vessel begynder transmission. 1. waypoint lander i
                    positions_v2_20260501 (antag dato). entity_last opdateres.

Dag 0, 08:00–23:59  Vessel sender hvert 5–10 s. Ca. 8.000 waypoints akkumuleret
                    i positions_v2_20260501. entity_last opdateres konstant.
                    Live-lag pusher via Supabase Realtime.

Dag 1, 00:00 UTC    Day-boundary rollup. Segmentet for Dag 0 markeres komplet.
                    Nye waypoints fra nu går i positions_v2_20260502 som del af
                    nyt segment.

Dag 1, 03:00 UTC    Nightly job compress_completed_segments kører.
                    Læser Dag 0's 8.000 waypoints, bygger D·P med
                    epsilon 50m → ~180 punkter, beregner raw_merkle_root,
                    signerer, INSERT i tracks-tabellen.

Dag 3, 00:00 UTC    Always-raw-vindue er udløbet (48 t siden segment-slut).
                    Dag 0's rå bliver *berettiget* til sletning, men holdes
                    stadig (90 dages standard retention).

Dag 90, 00:00 UTC   Nightly retention-script verificerer:
                      ✓ Segment markeret komplet (ja, dag 1)
                      ✓ tracks-række eksisterer med gyldig signatur
                      ✓ raw_merkle_root matcher
                      ✓ entities.retention = 'standard'
                      ✓ 90+ dage siden segment-slut
                    Sletter Dag 0's rå fra positions_v2_20260501.

Dag 90+             tracks-rækken forbliver. Enhver verifier kan:
                      - se D·P-geometrien
                      - se raw_merkle_root fra dag 0
                      - verificere signaturen
                      - bekræfte at komprimeringen ikke er ændret.
                    De kan ikke genskabe de 8.000 rå-punkter, men
                    kompression og provenance er bevisbar.
```

## 7. Implementerings-status 2026-04-17

**På plads:**

- `positions_v2`-partitioner + RLS + indexes.
- `tracks`-tabel med kolonner: `merkle_root`, `segment_hashes[]`, `epsilon_m`, `permanent_address`, `algorithm_version` (måske — check), `raw_point_count`, `compressed_point_count`.
- `entities.retention` felt med `'standard'` / `'permanent'` check-constraint.
- `build_dp_tracks` RPC eksisterer.
- `compress_completed_segments` listet som pg_cron-job i CLAUDE.md.

**Mangler (blocker for aisstream):**

- D·P-signatur over `raw_merkle_root` er ikke implementeret. Nuværende `tracks`-rækker har `merkle_root` men ikke signaturen med `algorithm_version + epsilon + raw_merkle_root` som beskrevet i §3.
- Minimum-waypoints-gate (10 waypoints / 1 km) er ikke dokumenteret i `build_dp_tracks`. Skal verificeres.
- Always-raw-48h-vindue er ikke implementeret. Der er ingen `expire_raw_positions`-funktion — kun `expire_live_vessels` som rammer `entity_last`, ikke rå.
- Retention-verifier der tjekker alle fem betingelser før sletning eksisterer ikke.
- Versionerede D·P — vi har `algorithm_version`-feltet, men ingen retro-komprimerings-flow.

**Fase 0 arbejde (før aisstream):**

1. Audit eksisterende `tracks`-rækker: har de alle en `merkle_root`? Er den signeret? Kan vi verificere signaturen med vores nøgle?
2. Implementér D·P-signaturen som beskrevet i §3 — skal alle nye `tracks`-rækker have den.
3. Skriv `expire_raw_positions` RPC med alle fem retention-betingelser.
4. Test kontinuerligt på Pi-data i en uge: raw → D·P → signatur → verificér → *simuler* sletning (dry-run) → verificér D·P stadig holder.
5. Først når det kører stabilt, åbn for aisstream fase 1.

## 8. Do NOT

- Slet aldrig rå på fast timer. Altid `D·P færdig AND signeret AND alder AND retention = standard AND ikke i always-raw-vindue`.
- Komprimér aldrig en raw-batch uden først at beregne `raw_merkle_root` og lock'e det i signaturen.
- Overskriv aldrig en eksisterende `tracks`-række. Forbedret algoritme = ny række. Gammel forbliver.
- Brug ikke Merkle på live-laget. Det tilføjer kompleksitet uden bevis-værdi — live data bliver autoritativ først ved arkiv-landing.
- Komprimér ikke mini-segmenter (<10 wp eller <1 km). Ren overhead uden gevinst.
- Undlad ikke at teste D·P-pipelinen kontinuerligt før aisstream-fase 1. Ellers akkumulerer vi rå der aldrig bliver komprimeret korrekt, og 90-dages retention bliver et problem i stedet for en feature.
