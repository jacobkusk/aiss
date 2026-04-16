-- Called from app code: returns a FeatureCollection of land polygons
-- inside a bbox. Used by the map to draw the landmass layer without
-- relying on tile servers.

CREATE OR REPLACE FUNCTION public.get_land_layer(
  min_lon double precision DEFAULT 8.0,
  min_lat double precision DEFAULT 54.5,
  max_lon double precision DEFAULT 15.5,
  max_lat double precision DEFAULT 57.5
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(geom)::jsonb,
        'properties', '{}'::jsonb
      )
    ), '[]'::jsonb)
  )
  FROM land_polygons
  WHERE geom && ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326);
$function$;
