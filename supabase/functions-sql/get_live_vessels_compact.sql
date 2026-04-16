-- Called from app code. Compact form of get_live_vessels — flat columns,
-- already-converted to knots, freshness bucketed (100 → 5 over 4h), and
-- includes vessel name from entities.display_name or domain_meta.vessel_name.
-- Returns up to 6 hours of live vessels ordered by most-recent first.

CREATE OR REPLACE FUNCTION public.get_live_vessels_compact()
 RETURNS TABLE(
   mmsi bigint,
   lat double precision,
   lon double precision,
   sog double precision,
   cog double precision,
   heading double precision,
   freshness integer,
   ship_type integer,
   prev_lat double precision,
   prev_lon double precision,
   updated_epoch_sec bigint,
   name text
 )
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    (e.domain_meta->>'mmsi')::BIGINT,
    el.lat,
    el.lon,
    (el.speed / 0.514444)::DOUBLE PRECISION,
    el.bearing::DOUBLE PRECISION,
    el.bearing::DOUBLE PRECISION,
    -- Smooth fade: 100 → 0 over 4 hours
    CASE
      WHEN (NOW() - el.updated_at) < INTERVAL '5 minutes' THEN 100
      WHEN (NOW() - el.updated_at) < INTERVAL '30 minutes' THEN 75
      WHEN (NOW() - el.updated_at) < INTERVAL '1 hour' THEN 50
      WHEN (NOW() - el.updated_at) < INTERVAL '2 hours' THEN 30
      WHEN (NOW() - el.updated_at) < INTERVAL '4 hours' THEN 15
      ELSE 5
    END::INT,
    0::INT,
    NULL::DOUBLE PRECISION,
    NULL::DOUBLE PRECISION,
    EXTRACT(EPOCH FROM el.updated_at)::BIGINT,
    NULLIF(COALESCE(e.display_name, e.domain_meta->>'vessel_name'), '')
  FROM entity_last el
  LEFT JOIN entities e ON el.entity_id = e.entity_id
  WHERE el.entity_id IS NOT NULL
    AND e.domain_meta->>'mmsi' IS NOT NULL
    AND el.updated_at > NOW() - INTERVAL '6 hours'
  ORDER BY el.updated_at DESC NULLS LAST;
END;
$function$;
