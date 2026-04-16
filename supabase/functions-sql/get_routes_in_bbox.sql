-- Called from app code. Returns compressed tracks whose track_display
-- intersects the given bbox. Filters out global/batch tracks that span
-- more than 5 degrees to keep the map responsive.

CREATE OR REPLACE FUNCTION public.get_routes_in_bbox(
  min_lon double precision,
  min_lat double precision,
  max_lon double precision,
  max_lat double precision
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COALESCE(
    jsonb_build_object(
      'type', 'FeatureCollection',
      'features', jsonb_agg(
        jsonb_build_object(
          'type', 'Feature',
          'properties', jsonb_build_object(
            'mmsi', (e.domain_meta->>'mmsi')::bigint,
            'name', e.display_name,
            'pts',  t.compressed_point_count
          ),
          'geometry', ST_AsGeoJSON(t.track_display::geometry)::jsonb
        )
      )
    ),
    '{"type":"FeatureCollection","features":[]}'::jsonb
  )
  FROM tracks t
  JOIN entities e ON e.entity_id = t.entity_id
  WHERE t.track_display && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    AND t.compressed_point_count > 0
    AND t.source = 'batch-auto'  -- kun automatiske tracks, ikke historiske
    -- Track må ikke spænde mere end 5 grader (filtrerer globale tracks)
    AND (ST_XMax(t.track_display::geometry) - ST_XMin(t.track_display::geometry)) < 5
    AND (ST_YMax(t.track_display::geometry) - ST_YMin(t.track_display::geometry)) < 5
$function$;
