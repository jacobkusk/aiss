-- Called from app code (vessel search box). ILIKE-match against
-- display_name, domain_meta.name, and mmsi. Returns up to 12 rows,
-- sorted by most recent position. Includes first_t so the caller
-- can flag historical-only vessels.

CREATE OR REPLACE FUNCTION public.search_vessels(q text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'last_t' DESC NULLS LAST), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'mmsi',         (e.domain_meta->>'mmsi')::bigint,
      'name',         COALESCE(e.display_name, e.domain_meta->>'name'),
      'lat',          p.lat,
      'lon',          p.lon,
      'last_t',       p.t,
      'first_t',      b.first_t,
      'is_historical', (p.t IS NOT NULL AND p.t < 0)
    ) AS row
    FROM entities e
    LEFT JOIN LATERAL (
      SELECT lat, lon, t
      FROM positions_v2
      WHERE entity_id = e.entity_id
      ORDER BY t DESC
      LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT MIN(t) AS first_t
      FROM positions_v2
      WHERE entity_id = e.entity_id
    ) b ON true
    WHERE (e.domain_meta->>'mmsi') IS NOT NULL
      AND (
        e.display_name        ILIKE '%' || q || '%'
        OR (e.domain_meta->>'name') ILIKE '%' || q || '%'
        OR (e.domain_meta->>'mmsi')  ILIKE '%' || q || '%'
      )
    LIMIT 12
  ) sub
$function$;
