-- Plotter P0 delta, step 1/8 — static geometry table for seamarks, harbors,
-- anchorages, hazards and other chart features consumed by oceaneye.blue.
--
-- Why a separate table (not `entities`):
-- `entities` is designed for things that move — it has no `geom` column and
-- its life-cycle is tied to position streams. Features are static (or change
-- rarely via NtM) and carry Point/LineString/Polygon geometry. Keeping them
-- split mirrors shared/ARCHITECTURE.md and PLOTTER.md §"Datamodel".
--
-- Versioning model: features are immutable once `valid_until` is set. A NtM
-- update creates a new row and points `superseded_by` at it. The active view
-- is always `valid_until IS NULL`. This is the same pattern OSM uses and the
-- same pattern tracks/evidence use elsewhere in aiss — write once, never
-- mutate.
--
-- Additive only: no existing tables touched.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public.features (
  feature_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid        NULL REFERENCES public.entities(entity_id) ON DELETE SET NULL,
  -- Optional link — e.g. an AtoN MMSI may have both an `entities` row (for
  -- live broadcasts) and a `features` row (for the static chart symbol).

  feature_type  text        NOT NULL
    CHECK (feature_type IN (
      'lateral_buoy','cardinal_buoy','safe_water_buoy','isolated_danger_buoy',
      'special_buoy','mooring_buoy',
      'lighthouse','daymark','sector_light',
      'harbor','marina','anchorage','bridge','lock','ferry_terminal',
      'hazard','wreck','rock','obstruction',
      'restricted_zone','cable_area','pipeline_area','fishing_zone',
      'separation_zone','military_area','cable_landing',
      'waypoint'
    )),

  geom          geometry(Geometry, 4326) NOT NULL,
  -- Point for buoys/lights/hazards; LineString for cable runs;
  -- Polygon for zones/harbors. Validated implicitly by PostGIS.

  properties    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Seamark:   {iala_shape, color, topmark, light_character, sector_angles}
  -- Harbor:    {name, vhf_channel, amenities, prices_url, approach_depth_m}
  -- Anchorage: {holding_quality, bottom_type, protected_from, max_depth_m}
  -- Hazard:    {severity, depth_below_surface_m, description}
  -- Bridge:    {clearance_m, opening_schedule, vhf_channel}

  source        text        NOT NULL
    CHECK (source IN (
      'sdfi_enc','kartverket_enc','traficom_enc','lantmateriet',
      'openstreetmap','openseamap',
      'ais_aton','crowd',
      'efs','ufs','nts','nfs','baz','an','gan','avisos','oglasi','hhs','lnm','nms',
      'manual','import'
    )),
  source_ref    text        NULL,  -- upstream identifier (e.g. OSM node id, SDFI handle)
  confidence    real        NOT NULL DEFAULT 1.0
    CHECK (confidence BETWEEN 0 AND 1),

  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_until   timestamptz NULL,           -- NULL = currently active
  superseded_by uuid        NULL REFERENCES public.features(feature_id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.features IS
  'Static chart features (seamarks, harbors, anchorages, hazards). Canonical per shared/PLOTTER.md §Datamodel. Versioned via valid_until/superseded_by — never mutate.';
COMMENT ON COLUMN public.features.valid_until IS
  'NULL = currently active. When set, the row is frozen and superseded_by points at the replacement.';
COMMENT ON COLUMN public.features.properties IS
  'Type-specific JSON. Schema per feature_type documented in shared/PLOTTER.md §Datamodel.';

-- Indexes — the access patterns are (1) bbox spatial query for rendering,
-- (2) filter by feature_type, (3) active-features-only queries.
CREATE INDEX IF NOT EXISTS features_geom_idx
  ON public.features USING GIST (geom);

CREATE INDEX IF NOT EXISTS features_type_idx
  ON public.features (feature_type);

CREATE INDEX IF NOT EXISTS features_source_idx
  ON public.features (source);

CREATE INDEX IF NOT EXISTS features_active_idx
  ON public.features (feature_type, valid_from DESC)
  WHERE valid_until IS NULL;

CREATE INDEX IF NOT EXISTS features_entity_idx
  ON public.features (entity_id)
  WHERE entity_id IS NOT NULL;

-- updated_at trigger (keeps it accurate without trusting client writes)
CREATE OR REPLACE FUNCTION public.tg_features_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS features_set_updated_at ON public.features;
CREATE TRIGGER features_set_updated_at
  BEFORE UPDATE ON public.features
  FOR EACH ROW EXECUTE FUNCTION public.tg_features_set_updated_at();

-- RLS — public read (chart features are public by definition), writes via
-- service role / RPC only. Same pattern as anomalies/ingest_sources.
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;

CREATE POLICY features_public_read
  ON public.features
  FOR SELECT
  TO public
  USING (true);
