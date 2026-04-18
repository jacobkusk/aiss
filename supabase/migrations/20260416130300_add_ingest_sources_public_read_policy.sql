-- ingest_sources has RLS enabled but no policy — anon reads return empty.
-- Table contains source names, types, locations and config (no secrets).
-- Safe for public read. Writes stay service-role only.

CREATE POLICY ingest_sources_public_read
  ON public.ingest_sources
  FOR SELECT
  TO public
  USING (true);
