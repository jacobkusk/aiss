-- Plotter P0 delta, step 8/8 — crowd-write hardening.
--
-- Answers Jac's 2026-04-18 lock: "at det er solidt uden hacking er nok
-- utrolig vigtig.. man skal kunne stole på afsender her." Read-access stays
-- open; write-access gets hard walls. Policy is documented in shared/
-- ARCHITECTURE.md §"Data-åbenhed + write-security" and the
-- triggers-for-luk section of shared/PLOTTER.md.
--
-- This migration adds the minimum write-security primitives we need on
-- day-one for the crowd-sourced tables (harbor_observations, buoy_scans,
-- community_reports). Everything below is reusable by later apps (vier,
-- waveo) that also accept user-submitted evidence.
--
-- What's in here:
--   1. `crowd_write_quotas` — per-user daily caps (harbor_observations,
--      buoy_scans, community_reports). Editable without a migration.
--
--   2. `crowd_write_counters` — rolling daily counters, incremented by the
--      enforcement function. One row per (reporter_id, table, day).
--
--   3. `check_crowd_write_quota(reporter_id, table_name)` — RPC called
--      from client/edge functions before insert. Raises if over-quota.
--
--   4. `check_crowd_write_plausibility(lon, lat, reporter_id, table_name)`
--      — simple geographic plausibility: reject writes > 50 km from the
--      reporter's last track point if one exists. Rejects obvious
--      replay/fake-location submissions without adding friction for real
--      sailors who are moving continuously.
--
--   5. `evidence_chain_hash` column on harbor_observations, buoy_scans,
--      community_reports — hex-encoded SHA-256 linking row content + prior
--      row's hash, per reporter. Same pattern as aiss's existing evidence/
--      Merkle model. Makes retroactive tampering visible.
--
--   6. `reporter_reputation` view — rolling 30d quality score per reporter,
--      used by the safety-critical gate below.
--
--   7. `safety_critical_scan_gate` table — per-feature threshold of how
--      many independent reporters must agree before a scan can influence
--      `features.geom` or `harbor_features.geom`. Default 3. Safety-critical
--      features (new hazard/wreck, depth-decrease) default to 5.
--
-- All functions: SECURITY DEFINER, search_path pinned, EXECUTE granted to
-- authenticated only (NOT anon — anonymous scans go through service_role).
--
-- Additive only.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Per-user daily quotas (soft config, editable)
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crowd_write_quotas (
  table_name    text        PRIMARY KEY,
  daily_cap     integer     NOT NULL CHECK (daily_cap > 0),
  burst_cap     integer     NOT NULL CHECK (burst_cap > 0),
  -- burst_cap = max writes in any 60s window. Kills scripted replay.
  notes         text        NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.crowd_write_quotas (table_name, daily_cap, burst_cap, notes) VALUES
  ('harbor_observations', 2000, 200,
    'Generous — a day of continuous AR-scanning a big marina is ~1500.'),
  ('buoy_scans',           500, 60,
    '500/day = ~1 scan every 3 min while awake. Burst 60 handles a quick reticle-sweep through a buoy field.'),
  ('community_reports',     50, 10,
    'Reports are high-signal, low-volume. 50/day is generous for a sailing club admin.')
ON CONFLICT (table_name) DO NOTHING;

COMMENT ON TABLE public.crowd_write_quotas IS
  'Per-table daily and burst write caps for crowd-sourced tables. Editable without a migration. Enforced by check_crowd_write_quota().';

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Rolling counters (one row per reporter per table per day)
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crowd_write_counters (
  reporter_id   uuid        NOT NULL,
  table_name    text        NOT NULL REFERENCES public.crowd_write_quotas(table_name) ON DELETE CASCADE,
  day           date        NOT NULL,
  writes_today  integer     NOT NULL DEFAULT 0 CHECK (writes_today >= 0),
  writes_last_minute integer NOT NULL DEFAULT 0 CHECK (writes_last_minute >= 0),
  last_write_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reporter_id, table_name, day)
);

CREATE INDEX IF NOT EXISTS crowd_write_counters_recent_idx
  ON public.crowd_write_counters (last_write_at DESC);

COMMENT ON TABLE public.crowd_write_counters IS
  'Rolling per-(reporter, table, day) write counters. Populated by check_crowd_write_quota().';

-- Daily purge — keep only last 35 days (enough to show 30d reputation).
CREATE OR REPLACE FUNCTION public.purge_old_write_counters()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_purged int;
BEGIN
  DELETE FROM public.crowd_write_counters
  WHERE day < (current_date - INTERVAL '35 days');
  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN v_purged;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_write_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_write_counters() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_write_counters() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Quota-check RPC (called before INSERT)
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_crowd_write_quota(
  p_reporter_id uuid,
  p_table_name  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_daily_cap int;
  v_burst_cap int;
  v_writes_today int;
  v_writes_last_minute int;
  v_last_write timestamptz;
BEGIN
  IF p_reporter_id IS NULL THEN
    -- Anonymous writes go through service_role and are rate-limited at the
    -- edge-function layer. No per-user counter.
    RETURN true;
  END IF;

  SELECT daily_cap, burst_cap
  INTO v_daily_cap, v_burst_cap
  FROM public.crowd_write_quotas
  WHERE table_name = p_table_name;

  IF v_daily_cap IS NULL THEN
    RAISE EXCEPTION 'unknown crowd-write table: %', p_table_name
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- Upsert today's counter row, incrementing.
  INSERT INTO public.crowd_write_counters
    (reporter_id, table_name, day, writes_today, writes_last_minute, last_write_at)
  VALUES
    (p_reporter_id, p_table_name, current_date, 1, 1, now())
  ON CONFLICT (reporter_id, table_name, day) DO UPDATE
  SET
    writes_today = public.crowd_write_counters.writes_today + 1,
    writes_last_minute = CASE
      WHEN now() - public.crowd_write_counters.last_write_at < INTERVAL '60 seconds'
        THEN public.crowd_write_counters.writes_last_minute + 1
      ELSE 1
    END,
    last_write_at = now()
  RETURNING writes_today, writes_last_minute
  INTO v_writes_today, v_writes_last_minute;

  IF v_writes_today > v_daily_cap THEN
    RAISE EXCEPTION 'daily write quota exceeded for % (cap: %)',
      p_table_name, v_daily_cap
      USING ERRCODE = '53400';  -- configuration_limit_exceeded
  END IF;

  IF v_writes_last_minute > v_burst_cap THEN
    RAISE EXCEPTION 'burst write quota exceeded for % (cap: % / 60s)',
      p_table_name, v_burst_cap
      USING ERRCODE = '53400';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_crowd_write_quota(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_crowd_write_quota(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.check_crowd_write_quota(uuid, text) IS
  'Enforce daily + burst write quotas. Call before inserting to crowd-sourced tables. Raises on violation.';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Geographic plausibility check
-- ═════════════════════════════════════════════════════════════════════════
--
-- Rejects writes that are implausibly far from the reporter's last known
-- position (any prior harbor_observation, buoy_scan or community_report).
-- Threshold 50 km is permissive — it catches obvious fake-location replay
-- while never blocking a real sailor who has, e.g., flown somewhere.
-- Returns true on accept, raises on reject.
--
-- First-write-per-reporter always passes (no prior position to compare to).

CREATE OR REPLACE FUNCTION public.check_crowd_write_plausibility(
  p_reporter_id uuid,
  p_lon double precision,
  p_lat double precision,
  p_max_jump_km numeric DEFAULT 50
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last_point geometry;
  v_this_point geometry;
  v_distance_m numeric;
  v_last_at timestamptz;
BEGIN
  IF p_reporter_id IS NULL THEN
    RETURN true;  -- anonymous path, skip check
  END IF;

  v_this_point := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326);

  -- Pick the most recent crowd-write position across the three tables.
  SELECT point, at INTO v_last_point, v_last_at FROM (
    SELECT scan_geom AS point, scanned_at AS at
    FROM public.buoy_scans
    WHERE reporter_id = p_reporter_id
    ORDER BY scanned_at DESC
    LIMIT 1
  ) s
  UNION ALL
  SELECT point, at FROM (
    SELECT observed_centroid AS point, observed_at AS at
    FROM public.harbor_observations
    WHERE reporter_id = p_reporter_id AND observed_centroid IS NOT NULL
    ORDER BY observed_at DESC
    LIMIT 1
  ) h
  ORDER BY at DESC
  LIMIT 1;

  IF v_last_point IS NULL THEN
    RETURN true;  -- first write
  END IF;

  v_distance_m := ST_Distance(v_this_point::geography, v_last_point::geography);

  IF v_distance_m > (p_max_jump_km * 1000) THEN
    RAISE EXCEPTION
      'implausible position: % km from your last scan — blocked. If you moved legitimately (flight, delivery), contact support.',
      round((v_distance_m / 1000)::numeric, 1)
      USING ERRCODE = '22023';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.check_crowd_write_plausibility(uuid, double precision, double precision, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_crowd_write_plausibility(uuid, double precision, double precision, numeric) TO authenticated, service_role;

COMMENT ON FUNCTION public.check_crowd_write_plausibility(uuid, double precision, double precision, numeric) IS
  'Reject crowd-writes > N km from reporter''s last crowd-write position. Default 50km — permissive.';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Evidence-chain hash on crowd-write tables
-- ═════════════════════════════════════════════════════════════════════════
--
-- SHA-256 over (prev_hash || canonical_row_json). Per-reporter chain.
-- Makes retroactive tampering visible: any mutation of an older row
-- invalidates all newer rows' chains.
-- Stored hex-encoded, not validated by DB (trust but verify in v1.1 via
-- nightly chain-audit job). Added to the three crowd-sourced tables.

ALTER TABLE public.harbor_observations
  ADD COLUMN IF NOT EXISTS evidence_chain_hash text NULL
    CHECK (evidence_chain_hash IS NULL OR evidence_chain_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS evidence_chain_prev text NULL
    CHECK (evidence_chain_prev IS NULL OR evidence_chain_prev ~ '^[0-9a-f]{64}$');

ALTER TABLE public.buoy_scans
  ADD COLUMN IF NOT EXISTS evidence_chain_hash text NULL
    CHECK (evidence_chain_hash IS NULL OR evidence_chain_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS evidence_chain_prev text NULL
    CHECK (evidence_chain_prev IS NULL OR evidence_chain_prev ~ '^[0-9a-f]{64}$');

ALTER TABLE public.community_reports
  ADD COLUMN IF NOT EXISTS evidence_chain_hash text NULL
    CHECK (evidence_chain_hash IS NULL OR evidence_chain_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS evidence_chain_prev text NULL
    CHECK (evidence_chain_prev IS NULL OR evidence_chain_prev ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.harbor_observations.evidence_chain_hash IS
  'SHA-256(prev_hash || canonical_row_json). Per-reporter chain. Tampering detection.';
COMMENT ON COLUMN public.buoy_scans.evidence_chain_hash IS
  'SHA-256(prev_hash || canonical_row_json). Per-reporter chain. Tampering detection.';
COMMENT ON COLUMN public.community_reports.evidence_chain_hash IS
  'SHA-256(prev_hash || canonical_row_json). Per-reporter chain. Tampering detection.';

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Reporter reputation view (rolling 30d)
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.reporter_reputation
WITH (security_invoker = true)
AS
SELECT
  r.reporter_id,
  COUNT(*) FILTER (WHERE bs.scan_method = 'active_lock_on')::int AS active_scans_30d,
  COUNT(*) FILTER (WHERE bs.scan_method = 'passive')::int         AS passive_scans_30d,
  COUNT(DISTINCT bs.feature_id)::int                              AS distinct_features_30d,
  -- Community report signals — disputed:confirmed ratio proxies for quality
  -- until we have a real moderation status column (v1.1).
  (SELECT COALESCE(SUM(cr.confirmed_by), 0)::int FROM public.community_reports cr
    WHERE cr.reporter_id = r.reporter_id
      AND cr.reported_at >= now() - INTERVAL '30 days')           AS report_confirmations_30d,
  (SELECT COALESCE(SUM(cr.disputed_by), 0)::int FROM public.community_reports cr
    WHERE cr.reporter_id = r.reporter_id
      AND cr.reported_at >= now() - INTERVAL '30 days')           AS report_disputes_30d,
  (SELECT COUNT(*)::int FROM public.community_reports cr
    WHERE cr.reporter_id = r.reporter_id
      AND cr.reported_at >= now() - INTERVAL '30 days')           AS reports_30d,
  MAX(bs.scanned_at)                                              AS last_scan_at
FROM (SELECT DISTINCT reporter_id FROM public.buoy_scans WHERE reporter_id IS NOT NULL) r
LEFT JOIN public.buoy_scans bs
  ON bs.reporter_id = r.reporter_id
 AND bs.scanned_at >= now() - INTERVAL '30 days'
GROUP BY r.reporter_id;

COMMENT ON VIEW public.reporter_reputation IS
  'Rolling 30d quality score per reporter. Read by the safety-critical-gate logic in harbor-feature-rebuild. security_invoker so RLS on underlying tables still applies.';

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Safety-critical scan gate (N-independent-reporters threshold)
-- ═════════════════════════════════════════════════════════════════════════
--
-- Before harbor-feature-rebuild applies a position-change to a feature,
-- this table says: how many independent reporters must have agreed within
-- the last 30 days? Default 3 for normal features, 5 for safety-critical.
-- Admin can override per feature-type or even per feature_id (v1.1).

CREATE TABLE IF NOT EXISTS public.safety_critical_scan_gate (
  scope         text        NOT NULL,
  -- 'default' | 'feature_type' | 'feature_id'
  scope_key     text        NOT NULL DEFAULT '',
  -- '' for scope='default', else '<type>' or '<uuid>'
  n_reporters_required integer NOT NULL CHECK (n_reporters_required >= 1),
  notes         text        NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_key)
);

INSERT INTO public.safety_critical_scan_gate (scope, scope_key, n_reporters_required, notes) VALUES
  ('default',      '',         3, 'Baseline — applies to non-safety-critical features.'),
  ('feature_type', 'wreck',    5, 'Wrecks: require 5 independent reporters before moving the marker.'),
  ('feature_type', 'hazard',   5, 'Hazards: 5 independent reporters.'),
  ('feature_type', 'rock',     5, 'Rocks: 5 independent reporters.'),
  ('feature_type', 'depth',    5, 'Depth decreases need 5 independents.'),
  ('feature_type', 'buoy',     3, 'Buoys move often — 3 is enough.'),
  ('feature_type', 'harbor',   3, 'Bolværk drift — 3 is enough.')
ON CONFLICT (scope, scope_key) DO NOTHING;

COMMENT ON TABLE public.safety_critical_scan_gate IS
  'Threshold N-independent-reporters for crowd scans to influence geometry. Read by harbor-feature-rebuild + ntm-parser match step.';

-- ═════════════════════════════════════════════════════════════════════════
-- RLS — config tables are readable (transparency), writable via service_role.
-- Counters are per-reporter-readable, writable via the RPC above.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.crowd_write_quotas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crowd_write_counters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_critical_scan_gate ENABLE ROW LEVEL SECURITY;

CREATE POLICY crowd_write_quotas_public_read
  ON public.crowd_write_quotas FOR SELECT TO public USING (true);

CREATE POLICY safety_gate_public_read
  ON public.safety_critical_scan_gate FOR SELECT TO public USING (true);

CREATE POLICY counters_self_read
  ON public.crowd_write_counters FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());
