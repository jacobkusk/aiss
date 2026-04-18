-- Plotter P0 delta, step 7/8 — buoy / lock-on scans.
--
-- Every time a plotter user's phone "locks on" to a known feature (buoy,
-- lighthouse, bridge, AIS vessel, harbor, hazard…) we record it here. This
-- drives three things:
--
-- 1. Crowd-verification of feature positions — N scans from different
--    bearings triangulate the real-world position better than any single
--    authority record. Aggregated nightly.
--
-- 2. Confidence decay — a buoy that hasn't been scanned in 6 months while
--    neighbours get scanned daily becomes a candidate for a "might be gone"
--    flag.
--
-- 3. Gamification — Harbor Hero / Scout badges based on scan count, variety,
--    firsts-of-season, etc.
--
-- Three capture methods (shared/PLOTTER.md §"Aktiv bøje-scan"):
--   passive           — GPS track passes within ~50m, no user action
--   active_lock_on    — user pointed phone, reticle auto-locked, 2s steady
--   ar_scan           — v1.1+ with on-device CV confirming visual target
--
-- This table is append-only — never mutate. Aggregates live in
-- `features.properties.verification_stats` (updated nightly).
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.buoy_scans (
  scan_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  feature_id       uuid        NULL REFERENCES public.features(feature_id) ON DELETE SET NULL,
  -- NULL for scans of AIS vessels (entity_id takes over) or unknown targets
  -- (candidate for new-feature promotion).

  entity_id        uuid        NULL REFERENCES public.entities(entity_id) ON DELETE SET NULL,
  -- NON-NULL for scans of AIS vessels / other moving entities.

  reporter_id      uuid        NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Anonymous-mode scans have reporter_id NULL. Counted but non-attributable.

  scan_method      text        NOT NULL
    CHECK (scan_method IN ('passive','active_lock_on','ar_scan')),

  target_type      text        NOT NULL
    CHECK (target_type IN (
      'buoy','lighthouse','daymark','bridge','harbor','marina',
      'anchorage','hazard','wreck','rock','ais_vessel','oceaneye_vessel',
      'windfarm','platform','cable_sign','other'
    )),
  -- Redundant with features.feature_type when feature_id is set, but stored
  -- for queries that only touch buoy_scans and for scans with NULL feature_id.

  scanned_at       timestamptz NOT NULL DEFAULT now(),

  -- Phone pose at moment of lock. Enough to reconstruct the target-bearing
  -- ray for crowd-triangulation without needing the full track.
  lon              double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  lat              double precision NOT NULL CHECK (lat BETWEEN  -90 AND  90),
  heading_deg      real        NULL CHECK (heading_deg BETWEEN 0 AND 360),
  pitch_deg        real        NULL CHECK (pitch_deg BETWEEN -90 AND 90),
  roll_deg         real        NULL CHECK (roll_deg BETWEEN -180 AND 180),

  bearing_to_target_deg real   NULL CHECK (bearing_to_target_deg BETWEEN 0 AND 360),
  -- Computed bearing from phone to target at lock moment. For passive scans
  -- this is approximated from the closest-approach point.

  distance_to_target_m real    NULL,
  -- Lateral distance at lock. Null if unknown (passive fallback).

  hold_duration_ms integer     NULL CHECK (hold_duration_ms IS NULL OR hold_duration_ms >= 0),
  -- How long the reticle stayed over the target. >=2000 counts as a
  -- confirmed scan in MVP — shorter is recorded but weighted lower.

  device_info      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {model, os, app_version, gps_accuracy_m, compass_accuracy_deg}

  details          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Method-specific extras:
  -- passive:        {gps_track_segment_id, closest_approach_m}
  -- active_lock_on: {reticle_px:[x,y], screen_size:[w,h]}
  -- ar_scan:        {cv_confidence, visual_anchor_hash}

  scan_geom        geometry(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- A scan must identify at least one target.
  CONSTRAINT buoy_scans_has_target CHECK (feature_id IS NOT NULL OR entity_id IS NOT NULL OR target_type = 'other')
);

COMMENT ON TABLE  public.buoy_scans IS
  'Lock-on scan events (buoys, lights, AIS vessels, harbors…). Append-only. Drives crowd-verification, confidence-decay and Harbor Hero gamification. Per shared/PLOTTER.md §"Aktiv bøje-scan" (locked 2026-04-18).';
COMMENT ON COLUMN public.buoy_scans.scan_method IS
  'passive=GPS-track-based, active_lock_on=reticle-projection (MVP), ar_scan=on-device CV (v1.1+).';

CREATE INDEX IF NOT EXISTS buoy_scans_feature_idx
  ON public.buoy_scans (feature_id, scanned_at DESC)
  WHERE feature_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS buoy_scans_entity_idx
  ON public.buoy_scans (entity_id, scanned_at DESC)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS buoy_scans_reporter_idx
  ON public.buoy_scans (reporter_id, scanned_at DESC)
  WHERE reporter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS buoy_scans_geom_idx
  ON public.buoy_scans USING GIST (scan_geom);

CREATE INDEX IF NOT EXISTS buoy_scans_method_time_idx
  ON public.buoy_scans (scan_method, scanned_at DESC);

CREATE INDEX IF NOT EXISTS buoy_scans_target_type_idx
  ON public.buoy_scans (target_type, scanned_at DESC);

-- RLS — public read (verification is a public good). Authenticated users
-- insert. Anonymous scans inserted via service role after token exchange.
ALTER TABLE public.buoy_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY buoy_scans_public_read
  ON public.buoy_scans
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY buoy_scans_reporter_insert
  ON public.buoy_scans
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid() OR reporter_id IS NULL);
