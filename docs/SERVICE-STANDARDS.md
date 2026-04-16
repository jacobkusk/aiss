# Service Standards — Universelle Krav Pr. System

**Status:** Draft v0.1 — 2026-04-16
**Scope:** Gælder for ethvert system i ARCHITECTURE-ROADMAP.md, uanset fase.
**Kilde:** Destilleret fra `EDGE-FUNCTION-RUNBOOK.md` (500-stormen 2026-04-16) og `PI-OPS.md` (3-dages crash-loop 2026-04-10/13). Begge postmortems var konsekvenser af ad hoc-disciplin. Hvis disse standarder havde været kodificeret fra start, var ingen af hændelserne sket.

---

## 1. Reliability Contract — gælder ALLE services

### 1.1 Top-level error boundary + body propagation

Hvert service, fra `ingest-gateway` til `aiss-ui-api`, SKAL have en top-level try/catch der:
- Logger stack lokalt.
- Returnerer `{ error, message, stack }` i response body (trimmet stack, første 8 linjer).

Begrundelse: I Supabase's edge function logs så vi kun `POST | 500 | 197ms`. Uden body-propagering var vi blinde udefra. Samme princip gælder Fly/Vercel/k8s — log-aggregatorer svigter altid på det værste tidspunkt. Body'en er altid læsbar via curl/pg_net.

Kilde: `EDGE-FUNCTION-RUNBOOK.md` §1.2. Bliver nu universel regel.

### 1.2 Per-reason counters overalt

Intet service har lov til at eksponere én samlet `rejected`/`failed`/`error`-tæller. Altid splittet i reasons:

```ts
type RejectReason =
  | "mmsi_invalid" | "invalid_coords" | "out_of_bounds"
  | "duplicate_within_batch" | "signature_invalid" | "schema_mismatch"
  | …
```

Persistér per service til `ingest_stats.reject_reasons` (eller tilsvarende jsonb felt).

Begrundelse: "~33 % rejected" på PI'en var tre forskellige årsager blandet sammen. Uden breakdown er diagnostik umulig. Samlet procent er et lagging indicator; per-reason counters er leading.

Kilde: `EDGE-FUNCTION-RUNBOOK.md` §1.3.

### 1.3 Ingen `.catch()` / `.finally()` på PromiseLike-kæder

Supabase-js returnerer `PostgrestBuilder`, ikke `Promise`. `.catch()` er `undefined` og crasher runtime. TypeScript fanger det ikke.

```ts
// NO
await supabase.rpc("foo").catch(() => {})
// YES
try { await supabase.rpc("foo") } catch { /* idempotent */ }
```

Gælder enhver PromiseLike — ikke kun Supabase. Ved tvivl: await i try/catch.

Kilde: `EDGE-FUNCTION-RUNBOOK.md` §1.1.

### 1.4 Smoke test efter deploy — ikke valgfrit

Før et deploy erklæres færdigt:
1. Fyr ét realistisk request (inkl. kendte edge cases).
2. Læs response status + body.
3. Verificér sidestatistik (`ingest_stats`, metrics, counters) fik en ny række med korrekte tal.

`pg_net.http_post` fra Postgres er diagnostik-kanalen når sandbox/CI ikke kan curle udefra.

Kilde: `EDGE-FUNCTION-RUNBOOK.md` §1.4–1.5.

### 1.5 Idempotens overalt på write path

Enhver `ingest-*` service skal håndtere samme pakke to gange uden duplikation. Nøglen er `(source_id, packet_hash)` eller `(entity_id, t, source)`.

---

## 2. Observability Contract — 4-lags model (fra PI-OPS)

Hvert system i arkitekturen SKAL have alle fire lag. Ikke valgfrit. Dette er blueprint for `control-plane` senere, men hvert team implementerer sine egne lag 1–3 nu.

| Lag | Placering | Eksempel på aiss-stacken i dag |
|---|---|---|
| 1. **Live frontend-status** | UI-API → frontend | `/health`-siden der viser "Pi modtager lige nu" |
| 2. **Database-side health check** | SQL-funktion kaldt af control-plane | `check_ingest_health()` med baseline-ratio |
| 3. **Scheduled external probe** | Cowork scheduled task / cron | `ingest-health-check` hver 2. time |
| 4. **Self-healing loop** | Systemd / pg_cron / service sidecar | `pi-repair.sh` + `auto-heal` edge fn |

**Regel:** En hændelse som lag 4 kan løse automatisk, må aldrig eskalere til lag 3. En hændelse som lag 2 kan opdage, må aldrig først bemærkes i lag 1.

Hvert nyt service (`ingest-gateway`, `aiss-ui-api`, …) skal levere alle fire lag som del af sit onboarding.

Kilde: `PI-OPS.md` §6.

---

## 3. Recovery Matrix — pr. service

Hvert service ejer en tabel med formen:

| Fejl | Hvem fikser | Tid | Eskalering |
|---|---|---|---|
| Proces crash | systemd / Vercel restart | <30 sek | — |
| Database uopnåelig | Retry + circuit breaker → lag 3 alert | 5 min | On-call |
| Upstream collector tavs >2 min | Lag 2 `check_ingest_health()` | 2 min | Lag 3 alert |
| Storage fuld | Lag 4 cleanup-job | 5 min | On-call hvis job fejler |
| Total freeze | Watchdog reboot / Fly.io replace | 15 sek | — |

Kopier `PI-OPS.md §11` som skabelon. Ét dokument per service, lever i `/services/<name>/RUNBOOK.md`.

---

## 4. Deploy Checklist — pr. service

For hver deploy:

1. Versionskommentar øverst i hovedfilen (`// <service>@v<N>`). Bumpes manuelt.
2. Pre-deploy smoke test lokalt (curl + assert body).
3. Post-deploy smoke test mod prod-URL (pg_net eller curl).
4. Verifikation af sidestatistik (nye counters, korrekte reasons).
5. Verifikation af lag 2 health check returnerer `OK`.

Fra `CLAUDE.md`: "Før man siger 'det er fixet': én pg_net-call, læs status_code + content. Ikke bare stare på logs."

---

## 5. RLS Checklist — hver DB-ændring

Rå kopi fra `CLAUDE.md`. Tilføjes som required-step i enhver migration PR:

```sql
-- 1. Tables with RLS enabled but NO policies (= broken for anon)
SELECT c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relrowsecurity = true AND n.nspname = 'public'
  AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname);

-- 2. Test as anon
SET ROLE anon;
-- <run your query>
RESET ROLE;
```

Partitioner arver IKKE policies. `ensure_partition()` skal tilføje policy hver gang; verificér at den gjorde det.

---

## 6. "Slet og genbyg"-reglen

Fra `PI-OPS.md §10`: **Hvis noget ikke virker efter 30 minutters fejlfinding, slet og genbyg.**

Lappeløsninger ophober sig. 3-dages crash-loop'en blev løst på 10 minutter ved at slette alt og starte forfra fra en ren specifikation ("systemet skal bare lytte på UDP og sende til Supabase"). Samme princip gælder services — hvis `ingest-gateway` ikke virker efter 30 min, skriv den forfra fra sin API-kontrakt.

Denne regel fungerer KUN fordi kontrakten (i vores tilfælde `.aiss`-protokollen) er veldefineret. Uden en klar kontrakt kan man ikke genbygge.

---

## 7. Hvad denne fil ikke dækker

- Code style / linting — ligger i hvert sprogs konfiguration.
- Test strategy — eget dokument (`TESTING-STRATEGY.md` når det er relevant).
- Incident response format — postmortems følger blameless format, eget dokument.
- Auth / authorization — adresseres i fase 0b med Waveo.
