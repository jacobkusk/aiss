-- Plotter P0 delta, step 5/8 — raw harbor observations.
--
-- The "raw layer" of the three-layer architecture from shared/PLOTTER.md
-- §"Havnekants-scanning" (locked 2026-04-18).
--
-- Each row is one scan pass: a user held their phone up 10-20m from a
-- harbor edge while their boat drifted past. ARKit/ARCore delivered phone
-- pose; light edge-detection picked the waterline; projection math gave
-- 3D world-space points. MVP variant uses finger-trace on screen instead
-- of CV — same shape of output.
--
-- **This table is immutable and kept forever.** Storage is cheap (a few KB
-- per scan) and the data only gets more valuable because future algorithms
-- (LiDAR v1.1, full SLAM v1.2, photogrammetry v2.0) can be re-run against
-- the same raw observations without another field trip.
--
-- Generic `payload` jsonb carries the per-sensor data so we don't lock
-- ourselves to today's iPhone 16 sensor suite. The `sensor_type` discriminates
-- how to parse `payload`.
--
-- The refined representation — nightly-regenerated polylines consumed by the
-- plotter — lives in `harbor_features` (next migration).
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.harbor_observations (
  observation_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- SET NULL instead of CASCADE: the observation is public-goods data that
  -- survives the user deleting their account (same posture as OSM edits).

  harbor_feature_id uuid       NULL REFERENCES public.features(feature_id) ON DELETE SET NULL,
  -- The harbor polygon/point this scan belongs to. Optional because a scan
  -- can precede the harbor being in `features`.

  observed_at      timestamptz NOT NULL DEFAULT now(),

  sensor_type      text        NOT NULL
    CHECK (sensor_type IN (
      'finger_trace',      -- MVP: user dragged finger along waterline on screen
      'ar_waterline',      -- v1.1: ARKit/ARCore + edge detection
      'lidar',             -- v1.1 (iPhone Pro): direct ranging
      'visual_slam',       -- v1.2: full vertical profile from SLAM mesh
      'photogrammetry',    -- v2.0: multi-pass 3D reconstruction
      'import'             -- one-off imports from external surveys
    )),

  device_info      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {model, os, app_version, ar_framework_version, has_lidar}
  -- Needed for quality-weighting and for re-deriving features when a new
  -- refinement pass wants to know which sensors were available.

  -- Spatial rollup — cheap indexable reference for bbox queries.
  -- The real geometry lives in `payload` as either a LineString (waterline
  -- trace) or an array of 3D points. These two columns are derived and
  -- stored redundantly for speed.
  observed_geom    geometry(LineString, 4326) NULL,
  observed_centroid geometry(Point, 4326) NULL,

  point_count      integer     NOT NULL DEFAULT 0 CHECK (point_count >= 0),
  track_length_m   real        NULL,
  observed_distance_m real     NULL,       -- how far from waterline the user stood
  duration_s       real        NULL,       -- total scan time

  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Sensor-specific. Schema per sensor_type:
  --
  -- finger_trace:
  --   { points:[{lon,lat,ts}], screen_poses:[{x,y,ts}], phone_pose:{...} }
  --
  -- ar_waterline:
  --   { points:[{lon,lat,alt,ts,confidence}],
  --     phone_poses:[{lon,lat,heading,pitch,roll,ts}],
  --     camera_intrinsics:{...} }
  --
  -- lidar:
  --   { points:[{lon,lat,alt,ts,range_m}],
  --     phone_poses:[...] }
  --
  -- visual_slam:
  --   { mesh_ref, anchor_points:[{lon,lat,alt}],
  --     features_hash }
  --
  -- photogrammetry:
  --   { image_bundle_ref, solved_cameras:[...], sparse_cloud_ref }

  refined_into     uuid[]      NOT NULL DEFAULT ARRAY[]::uuid[],
  -- FK-style array of harbor_features this observation has contributed to.
  -- Updated by `harbor-feature-rebuild` scheduled task.

  ingestion_status text        NOT NULL DEFAULT 'pending'
    CHECK (ingestion_status IN ('pending','processed','rejected','reprocessing')),
  ingestion_error  text        NULL,

  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.harbor_observations IS
  'Raw harbor-edge scan observations. IMMUTABLE, kept forever — refined versions regenerated nightly into harbor_features. Per shared/PLOTTER.md §"Havnekants-scanning" (locked 2026-04-18).';
COMMENT ON COLUMN public.harbor_observations.sensor_type IS
  'Discriminates payload schema. Future sensor types added here as new rows — old rows never rewritten.';
COMMENT ON COLUMN public.harbor_observations.payload IS
  'Sensor-specific raw data. Schema per sensor_type documented in column source + shared/PLOTTER.md.';

CREATE INDEX IF NOT EXISTS harbor_obs_geom_idx
  ON public.harbor_observations USING GIST (observed_geom);

CREATE INDEX IF NOT EXISTS harbor_obs_centroid_idx
  ON public.harbor_observations USING GIST (observed_centroid);

CREATE INDEX IF NOT EXISTS harbor_obs_harbor_idx
  ON public.harbor_observations (harbor_feature_id, observed_at DESC)
  WHERE harbor_feature_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS harbor_obs_reporter_idx
  ON public.harbor_observations (reporter_id, observed_at DESC)
  WHERE reporter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS harbor_obs_pending_idx
  ON public.harbor_observations (ingestion_status, observed_at)
  WHERE ingestion_status IN ('pending','reprocessing');

CREATE INDEX IF NOT EXISTS harbor_obs_sensor_time_idx
  ON public.harbor_observations (sensor_type, observed_at DESC);

-- RLS — scans are public good, public can read. Reporter can insert.
-- Updates/deletes via service role only (observations are immutable —
-- fix via reprocessing, not mutation).
ALTER TABLE public.harbor_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY harbor_obs_public_read
  ON public.harbor_observations
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY harbor_obs_reporter_insert
  ON public.harbor_observations
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());
