-- Plotter P0 delta, step 6/8 — refined harbor features.
--
-- The "refined layer" of the three-layer architecture (shared/PLOTTER.md
-- §"Havnekants-scanning", locked 2026-04-18). Polylines/polygons that
-- represent the current best understanding of a harbor's bolværks-geometry,
-- regenerated nightly from `harbor_observations` by the `harbor-feature-
-- rebuild` scheduled task.
--
-- The plotter reads ONLY this table — never raw observations. Raw is the
-- source of truth; this is the rendered cache.
--
-- Versioned: every regeneration creates a new row with an incremented
-- `version` for the same (harbor_feature_id, feature_kind) combination; the
-- active row is the highest version. This mirrors `features`/tracks versioning
-- — no mutation, only append.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.harbor_features (
  harbor_feature_id uuid       PRIMARY KEY DEFAULT gen_random_uuid(),

  harbor_id        uuid        NULL REFERENCES public.features(feature_id) ON DELETE SET NULL,
  -- The parent harbor feature (feature_type='harbor' or 'marina') that this
  -- refined geometry belongs to. NULL means the harbor isn't in `features`
  -- yet — common early in a new region's lifecycle.

  feature_kind     text        NOT NULL
    CHECK (feature_kind IN (
      'bolvaerk_waterline',    -- quay-edge polyline at waterline
      'bolvaerk_profile',      -- vertical profile (v1.2+ full SLAM)
      'pier_outline',          -- pier / jetty footprint polygon
      'pontoon_line',          -- floating pontoon
      'ramp',                  -- boat ramp
      'entry_gate',            -- harbor entry geometry
      'corner_point'           -- snapped corner / angle breakpoint
    )),

  geom             geometry(Geometry, 4326) NOT NULL,
  -- LineString for bolværk/pontoon, Polygon for pier outline, Point for
  -- corner_point. PostGIS validates implicitly.

  version          integer     NOT NULL DEFAULT 1 CHECK (version >= 1),

  precision_m      real        NOT NULL,
  -- Current best estimate of 1-sigma cross-track error. Drops as more
  -- observations are averaged (CLT). Plotter shows this in HUD when lock-on
  -- targets harbor features.

  observation_count integer    NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  sensor_mix       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {finger_trace: 12, ar_waterline: 48, lidar: 3, visual_slam: 0}
  -- Used to decide which rebuild algorithm to run and to weight observations.

  algorithm        text        NOT NULL,
  -- 'v1.0_median_skeletonize'   MVP: 2D histogram + median skeletonization
  -- 'v1.1_lidar_fusion'         v1.1: LiDAR-anchored bundle adjustment
  -- 'v2.0_slam_mesh'            v1.2: full SLAM mesh reduction
  algorithm_version text       NOT NULL,

  last_rebuild_at  timestamptz NOT NULL DEFAULT now(),
  active           boolean     NOT NULL DEFAULT true,
  -- When `harbor-feature-rebuild` publishes a new version it flips the old
  -- row's `active=false` and inserts the new one. Queries for current
  -- geometry filter `active=true`.

  created_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (harbor_id, feature_kind, version)
);

COMMENT ON TABLE  public.harbor_features IS
  'Refined harbor geometry (bolværks-polylines, piers, pontoons). Regenerated nightly from harbor_observations. Plotter reads this; never reads raw observations directly. Per shared/PLOTTER.md §"Havnekants-scanning" (locked 2026-04-18).';
COMMENT ON COLUMN public.harbor_features.active IS
  'Exactly one row per (harbor_id, feature_kind) should be active=true at any time. Maintained by harbor-feature-rebuild.';
COMMENT ON COLUMN public.harbor_features.precision_m IS
  '1-sigma cross-track error estimate. Exposed to plotter UI for confidence indication.';

CREATE INDEX IF NOT EXISTS harbor_feat_geom_idx
  ON public.harbor_features USING GIST (geom);

CREATE INDEX IF NOT EXISTS harbor_feat_harbor_idx
  ON public.harbor_features (harbor_id, feature_kind, version DESC);

CREATE INDEX IF NOT EXISTS harbor_feat_active_idx
  ON public.harbor_features (feature_kind, last_rebuild_at DESC)
  WHERE active = true;

-- RLS — public read, writes via service role (scheduled task) only.
ALTER TABLE public.harbor_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY harbor_feat_public_read
  ON public.harbor_features
  FOR SELECT
  TO public
  USING (true);
