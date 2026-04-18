-- Returns raw positions within [p_start, p_end] (optionally bbox-filtered),
-- joined with entity names + MMSI. Called from MomentVesselLayer2.tsx which
-- pre-loads a ±window around the scrub-time and interpolates client-side.
--
-- bbox params are optional (all DEFAULT NULL). When all four non-null, the
-- per-partition scan adds a lon/lat BETWEEN filter that hits the
-- (lon, lat) btree index on each positions_v2_YYYYMMDD partition — keeps
-- payload small when user zooms into e.g. Øresund.
--
-- SECURITY DEFINER because partitions have per-partition RLS policies and
-- the anon role would otherwise need policies added on every new daily
-- partition; definer-mode side-steps that entirely (read-only anyway).

DROP FUNCTION IF EXISTS public.get_tracks_in_range(timestamp with time zone, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_tracks_in_range(
  p_start   timestamp with time zone,
  p_end     timestamp with time zone,
  p_min_lon double precision DEFAULT NULL,
  p_min_lat double precision DEFAULT NULL,
  p_max_lon double precision DEFAULT NULL,
  p_max_lat double precision DEFAULT NULL
)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSON;
  v_sql TEXT;
  v_parts TEXT[];
  v_part TEXT;
  v_bbox_clause TEXT := '';
BEGIN
  -- Dynamically find partitions that exist for the requested date range
  SELECT array_agg(c.relname ORDER BY c.relname)
  INTO v_parts
  FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  JOIN pg_class p ON p.oid = i.inhparent
  WHERE p.relname = 'positions_v2';

  IF v_parts IS NULL OR array_length(v_parts, 1) = 0 THEN
    RETURN json_build_object('points', '[]'::json);
  END IF;

  -- Optional bbox filter — only applied if all four params are non-null.
  IF p_min_lon IS NOT NULL AND p_min_lat IS NOT NULL
     AND p_max_lon IS NOT NULL AND p_max_lat IS NOT NULL THEN
    v_bbox_clause := format(
      ' AND lon BETWEEN %s AND %s AND lat BETWEEN %s AND %s',
      p_min_lon, p_max_lon, p_min_lat, p_max_lat
    );
  END IF;

  -- Build dynamic UNION ALL over all existing partitions
  v_sql := '';
  FOREACH v_part IN ARRAY v_parts LOOP
    IF v_sql != '' THEN v_sql := v_sql || ' UNION ALL '; END IF;
    v_sql := v_sql || format(
      'SELECT entity_id, lat, lon, t FROM %I WHERE t BETWEEN %s AND %s',
      v_part,
      extract(epoch from p_start),
      extract(epoch from p_end)
    ) || v_bbox_clause;
  END LOOP;

  -- Main query: join positions with entities for names + mmsi
  v_sql := format('
    WITH pos AS (%s)
    SELECT json_build_object(
      ''points'', coalesce(
        json_agg(
          json_build_object(
            ''mmsi'', (e.domain_meta->>''mmsi'')::BIGINT,
            ''name'', COALESCE(e.display_name, e.domain_meta->>''vessel_name''),
            ''lat'', p.lat,
            ''lon'', p.lon,
            ''sog'', (el.sensors->>''sog_kn'')::DOUBLE PRECISION,
            ''cog'', (el.sensors->>''cog'')::DOUBLE PRECISION,
            ''t'', p.t::BIGINT
          ) ORDER BY p.t
        ) FILTER (WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL AND e.domain_meta->>''mmsi'' IS NOT NULL),
        ''[]''::json
      )
    )
    FROM pos p
    LEFT JOIN entities e ON p.entity_id = e.entity_id
    LEFT JOIN entity_last el ON p.entity_id = el.entity_id
  ', v_sql);

  EXECUTE v_sql INTO v_result;
  RETURN v_result;
END;
$function$
;

GRANT EXECUTE ON FUNCTION public.get_tracks_in_range(
  timestamp with time zone, timestamp with time zone,
  double precision, double precision, double precision, double precision
) TO anon, authenticated;
