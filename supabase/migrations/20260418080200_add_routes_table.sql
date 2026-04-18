-- Plotter P0 delta, step 3/8 — user-planned routes.
--
-- Owned by auth.users. Per-row visibility: private / friends / public.
-- When a route has been sailed, `completed_track_id` links it to a track in
-- the existing `tracks` table so the planned vs. actual comparison is one
-- query away.
--
-- RLS model: owner can do anything with own rows; public can read rows where
-- visibility='public'. Friends-visibility is enforced at the API layer for
-- now (MVP has no friends-graph yet — keep DB policy simple).
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.routes (
  route_id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name               text        NOT NULL,

  geom               geometry(LineString, 4326) NOT NULL,
  waypoints          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{lon, lat, name, estimated_arrival, notes}, ...]

  vessel_profile     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- {draft_m, air_draft_m, beam_m, length_m, max_speed_kn}
  -- Snapshotted at plan-time so later vessel edits don't invalidate the route.

  planned_start      timestamptz NULL,
  estimated_duration interval    NULL,

  visibility         text        NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','friends','public')),

  route_type         text        NOT NULL DEFAULT 'planned'
    CHECK (route_type IN ('planned','completed','template')),

  completed_track_id uuid        NULL REFERENCES public.tracks(track_id) ON DELETE SET NULL,
  -- FK to the tracks row produced when this route was sailed. Nullable until
  -- that happens. ON DELETE SET NULL because old tracks can be purged while
  -- keeping the route record intact.

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.routes IS
  'User-planned navigation routes. Owned by auth.users, per-row visibility. Links to completed tracks when sailed.';
COMMENT ON COLUMN public.routes.vessel_profile IS
  'Snapshot of vessel dimensions at plan-time so route stays reproducible.';

CREATE INDEX IF NOT EXISTS routes_owner_idx
  ON public.routes (owner_id);

CREATE INDEX IF NOT EXISTS routes_geom_idx
  ON public.routes USING GIST (geom);

CREATE INDEX IF NOT EXISTS routes_public_idx
  ON public.routes (visibility)
  WHERE visibility != 'private';

CREATE INDEX IF NOT EXISTS routes_owner_updated_idx
  ON public.routes (owner_id, updated_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_routes_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS routes_set_updated_at ON public.routes;
CREATE TRIGGER routes_set_updated_at
  BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.tg_routes_set_updated_at();

-- RLS — owner gets full access, public gets read on public rows.
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY routes_owner_all
  ON public.routes
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY routes_public_read
  ON public.routes
  FOR SELECT
  TO public
  USING (visibility = 'public');
