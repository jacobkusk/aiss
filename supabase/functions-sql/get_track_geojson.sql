-- Three overloads called from app code:
--   1. by entity_id  → returns an array of [lon, lat, z, m] coords
--   2. by mmsi       → returns { coords, gaps } for the full track
--   3. by mmsi + [p_start, p_end] → same shape, time-windowed with gaps
--      trimmed to the overlap
-- All overloads read the most recently compressed track for the entity.

-- Overload 1: by entity_id
CREATE OR REPLACE FUNCTION public.get_track_geojson(p_entity_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH latest_track AS (
    SELECT track
    FROM tracks
    WHERE entity_id = p_entity_id
    ORDER BY compressed_at DESC
    LIMIT 1
  ),
  pts AS (
    SELECT (ST_DumpPoints(track::geometry)).geom AS geom
    FROM latest_track
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_array(ST_X(geom), ST_Y(geom), ST_Z(geom), ST_M(geom))
      ORDER BY ST_M(geom)
    ),
    '[]'::jsonb
  )
  FROM pts
  WHERE ST_M(geom) IS NOT NULL
$function$;

-- Overload 2: by mmsi — includes gap_intervals
CREATE OR REPLACE FUNCTION public.get_track_geojson(p_mmsi bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH entity AS (
    SELECT entity_id FROM entities
    WHERE (domain_meta->>'mmsi')::bigint = p_mmsi
    LIMIT 1
  ),
  latest_track AS (
    SELECT t.track, t.gap_intervals
    FROM tracks t
    JOIN entity e ON e.entity_id = t.entity_id
    ORDER BY t.compressed_at DESC
    LIMIT 1
  ),
  pts AS (
    SELECT (ST_DumpPoints(track::geometry)).geom AS geom
    FROM latest_track
  ),
  coords AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_array(ST_X(geom), ST_Y(geom), ST_Z(geom), ST_M(geom))
        ORDER BY ST_M(geom)
      ),
      '[]'::jsonb
    ) AS coordinates
    FROM pts
    WHERE ST_M(geom) IS NOT NULL
  )
  SELECT jsonb_build_object(
    'coords', (SELECT coordinates FROM coords),
    'gaps',   (SELECT COALESCE(gap_intervals, '[]'::jsonb) FROM latest_track)
  )
$function$;

-- Overload 3: by mmsi + time window (epoch seconds)
CREATE OR REPLACE FUNCTION public.get_track_geojson(
  p_mmsi bigint,
  p_start double precision DEFAULT NULL::double precision,
  p_end double precision DEFAULT NULL::double precision
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH entity AS (
    SELECT entity_id FROM entities
    WHERE (domain_meta->>'mmsi')::bigint = p_mmsi LIMIT 1
  ),
  latest_track AS (
    SELECT t.track, t.gap_intervals FROM tracks t
    JOIN entity e ON e.entity_id = t.entity_id
    ORDER BY t.compressed_at DESC LIMIT 1
  ),
  pts AS (
    SELECT (ST_DumpPoints(track::geometry)).geom AS geom FROM latest_track
  ),
  filtered AS (
    SELECT geom FROM pts
    WHERE ST_M(geom) IS NOT NULL
      AND (p_start IS NULL OR ST_M(geom) >= p_start)
      AND (p_end   IS NULL OR ST_M(geom) <= p_end)
  )
  SELECT COALESCE(
    jsonb_build_object(
      'coords', jsonb_agg(
        jsonb_build_array(ST_X(geom), ST_Y(geom), ST_Z(geom), ST_M(geom))
        ORDER BY ST_M(geom)
      ),
      -- Filtrer gaps til kun dem der overlapper med tidsvinduet
      'gaps', (
        SELECT COALESCE(
          jsonb_agg(g ORDER BY (g->0)::numeric),
          '[]'::jsonb
        )
        FROM latest_track lt,
          jsonb_array_elements(lt.gap_intervals) g
        WHERE (p_start IS NULL OR (g->1)::numeric >= p_start)
          AND (p_end   IS NULL OR (g->0)::numeric <= p_end)
      )
    ),
    '{"coords":[],"gaps":[]}'::jsonb
  ) FROM filtered
$function$;
