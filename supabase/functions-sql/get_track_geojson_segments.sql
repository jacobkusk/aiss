-- get_track_geojson_segments — multi-segment read-path for the D·P map overlay.
--
-- Called by src/components/map/TrackLayer.tsx when D·P mode is on. Returns an
-- ORDERED list of all tracks (segments) for the entity that overlap the time
-- window, plus their signature status and raw_merkle_hex.
--
-- Why a separate function from get_track_geojson:
--   The original get_track_geojson picks the single newest row per entity
--   (LIMIT 1 on compressed_at DESC). That was fine when `tracks` was
--   "one row per entity, ON CONFLICT DO UPDATE".
--
--   After the 2026-04-17 migration to append-only segmented tracks,
--   `tracks` holds many rows per entity (one per (entity_id,
--   time_range_start, algorithm_version)). A 24h view for a vessel can
--   span 5-30 segments. LIMIT 1 was showing only the most recent one.
--
-- Gap rendering policy:
--   This RPC does NOT emit gap_intervals. Clients classify gaps from the
--   time deltas between consecutive D·P points using the GAP thresholds
--   in src/lib/trackRules.ts. Inter-segment boundaries are always "blank"
--   (no line) because build_segment_track splits on gap_sec = 1800 s,
--   which is beyond GAP.LONG_SEC (1200 s).
--
-- Fallback:
--   If an entity has no tracks for the requested algorithm_version yet,
--   falls back to the single legacy-full-rewrite-v0 row (if present) so
--   history stays visible while segmented backfill runs.

CREATE OR REPLACE FUNCTION public.get_track_geojson_segments(
  p_mmsi              bigint,
  p_start             double precision DEFAULT NULL,
  p_end               double precision DEFAULT NULL,
  p_algorithm_version text             DEFAULT 'dp-v1-e50m'
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH entity AS (
    SELECT entity_id FROM entities
    WHERE (domain_meta->>'mmsi')::bigint = p_mmsi
    LIMIT 1
  ),
  eligible AS (
    SELECT t.track_id, t.track, t.algorithm_version,
           t.time_range_start, t.time_range_end,
           encode(t.raw_merkle_root, 'hex') AS raw_merkle_hex,
           t.signature IS NOT NULL AS signed
    FROM tracks t
    JOIN entity e ON e.entity_id = t.entity_id
    WHERE t.algorithm_version = p_algorithm_version
      AND (p_start IS NULL OR t.time_range_end   >= to_timestamp(p_start))
      AND (p_end   IS NULL OR t.time_range_start <= to_timestamp(p_end))
  ),
  fallback AS (
    SELECT t.track_id, t.track, t.algorithm_version,
           NULL::timestamptz AS time_range_start, NULL::timestamptz AS time_range_end,
           NULL::text        AS raw_merkle_hex,
           FALSE             AS signed
    FROM tracks t
    JOIN entity e ON e.entity_id = t.entity_id
    WHERE t.algorithm_version = 'legacy-full-rewrite-v0'
      AND NOT EXISTS (SELECT 1 FROM eligible)
    ORDER BY t.compressed_at DESC
    LIMIT 1
  ),
  chosen AS (
    SELECT * FROM eligible
    UNION ALL
    SELECT * FROM fallback
  ),
  dumped AS (
    SELECT c.track_id, c.algorithm_version, c.raw_merkle_hex, c.signed,
           (ST_DumpPoints(c.track::geometry)).geom AS geom
    FROM chosen c
  ),
  filtered AS (
    SELECT track_id, algorithm_version, raw_merkle_hex, signed, geom
    FROM dumped
    WHERE ST_M(geom) IS NOT NULL
      AND (p_start IS NULL OR ST_M(geom) >= p_start)
      AND (p_end   IS NULL OR ST_M(geom) <= p_end)
  ),
  segmented AS (
    SELECT
      track_id, algorithm_version, raw_merkle_hex, signed,
      jsonb_agg(
        jsonb_build_array(ST_X(geom), ST_Y(geom), ST_Z(geom), ST_M(geom))
        ORDER BY ST_M(geom)
      ) AS coords,
      min(ST_M(geom)) AS t_start,
      max(ST_M(geom)) AS t_end
    FROM filtered
    GROUP BY track_id, algorithm_version, raw_merkle_hex, signed
    HAVING count(*) >= 2
  )
  SELECT jsonb_build_object(
    'mmsi', p_mmsi,
    'algorithm_version', p_algorithm_version,
    'segments', COALESCE(
      (SELECT jsonb_agg(
         jsonb_build_object(
           'track_id',          track_id,
           'algorithm_version', algorithm_version,
           'raw_merkle_hex',    raw_merkle_hex,
           'signed',            signed,
           'coords',            coords,
           't_start',           t_start,
           't_end',             t_end
         ) ORDER BY t_start
       ) FROM segmented),
      '[]'::jsonb
    )
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_track_geojson_segments(bigint, double precision, double precision, text)
  TO anon, authenticated, service_role;
