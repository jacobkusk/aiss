-- Plotter P0 delta, step 4/8 — community reports.
--
-- A single table for all crowd-sourced reports, discriminated by `report_type`:
-- anchor reports, harbor reviews, hazard reports, passage reports. Keeping
-- them in one table (rather than one per type) matches shared/PLOTTER.md
-- §"community_reports" and lets the `/reports/nearby` endpoint return a
-- single stream ordered by recency regardless of type.
--
-- The `data` jsonb carries type-specific payloads — schema documented per
-- type in shared/PLOTTER.md.
--
-- RLS model: reporter owns own rows (can update/delete). Public can read.
-- `confirmed_by`/`disputed_by` are aggregate counters — updated via RPC
-- (not yet written) so anon can't inflate them.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.community_reports (
  report_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  report_type      text        NOT NULL
    CHECK (report_type IN (
      'anchor_report',
      'harbor_review',
      'hazard_report',
      'passage_report',
      'bridge_report',
      'fuel_report',
      'pumpout_report'
    )),

  reporter_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vessel_id        uuid        NULL REFERENCES public.entities(entity_id) ON DELETE SET NULL,
  feature_id       uuid        NULL REFERENCES public.features(feature_id) ON DELETE SET NULL,
  -- feature_id is the preferred link when the report is about a known feature
  -- (this marina, this hazard). When a report is about a novel location, use
  -- lon/lat only and feature_id stays NULL.

  lon              double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  lat              double precision NOT NULL CHECK (lat BETWEEN  -90 AND  90),
  reported_at      timestamptz NOT NULL DEFAULT now(),

  data             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- anchor_report:  {depth_m, bottom_type, holding, wind_dir, wind_kn,
  --                  duration_hrs, swell, notes}
  -- harbor_review:  {rating, price_per_night, amenities, notes, photos_ref}
  -- hazard_report:  {hazard_type, severity, description,
  --                  depth_below_surface_m, still_there}
  -- passage_report: {vessel_draft_m, min_depth_m, passage_time_min,
  --                  conditions}
  -- bridge_report:  {clearance_m_observed, opening_worked, wait_min}
  -- fuel_report:    {type, price_per_l, availability}
  -- pumpout_report: {working, price, notes}

  photos           text[]      NOT NULL DEFAULT ARRAY[]::text[],
  -- URLs into Supabase Storage bucket 'community-photos'. Upload flow is a
  -- separate edge function (`upload-report-photo`).

  confirmed_by     integer     NOT NULL DEFAULT 0 CHECK (confirmed_by >= 0),
  disputed_by      integer     NOT NULL DEFAULT 0 CHECK (disputed_by >= 0),

  expires_at       timestamptz NULL,
  -- e.g. hazard reports default to now() + interval '6 months' unless
  -- someone confirms them again. Set by cleanup-expired-reports scheduled
  -- task.

  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.community_reports IS
  'Crowd-sourced anchor reports, harbor reviews, hazard reports and passage reports. One table discriminated on report_type per shared/PLOTTER.md.';
COMMENT ON COLUMN public.community_reports.data IS
  'Type-specific payload. Schema per report_type documented in shared/PLOTTER.md §community_reports.';

-- Spatial index — reports are queried by bbox for map rendering and by
-- proximity for nearby-report streams.
CREATE INDEX IF NOT EXISTS reports_geom_idx
  ON public.community_reports
  USING GIST (ST_MakePoint(lon, lat));

CREATE INDEX IF NOT EXISTS reports_type_time_idx
  ON public.community_reports (report_type, reported_at DESC);

CREATE INDEX IF NOT EXISTS reports_feature_idx
  ON public.community_reports (feature_id, reported_at DESC)
  WHERE feature_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reports_reporter_idx
  ON public.community_reports (reporter_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS reports_expires_idx
  ON public.community_reports (expires_at)
  WHERE expires_at IS NOT NULL;

-- RLS — reporter owns row, public reads all.
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY reports_public_read
  ON public.community_reports
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY reports_reporter_insert
  ON public.community_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY reports_reporter_update
  ON public.community_reports
  FOR UPDATE
  TO authenticated
  USING (reporter_id = auth.uid())
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY reports_reporter_delete
  ON public.community_reports
  FOR DELETE
  TO authenticated
  USING (reporter_id = auth.uid());
