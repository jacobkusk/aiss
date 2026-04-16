-- Called from app code for historical time-range queries by MMSI.
-- Thins to 1-min / 5-min / 15-min / 60-min buckets based on span.
-- Emits per-point dead-reckoning prediction_score (0 = perfect, 1 = bad)
-- for anomaly coloring, plus aggregate stats (max_speed p95, avg_speed > 0.5 kn).

CREATE OR REPLACE FUNCTION public.get_vessel_track_range(
  p_mmsi bigint,
  p_start timestamp with time zone,
  p_end timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_entity_id   uuid;
  v_start_epoch float := extract(epoch from p_start);
  v_end_epoch   float := extract(epoch from p_end);
  v_span_days   float := (extract(epoch from p_end) - extract(epoch from p_start)) / 86400.0;
  v_bucket_sec  int;
  result        jsonb;
BEGIN
  -- Resolve entity from MMSI
  SELECT entity_id INTO v_entity_id
  FROM entities
  WHERE (domain_meta->>'mmsi')::bigint = p_mmsi
  LIMIT 1;

  IF v_entity_id IS NULL THEN
    RETURN jsonb_build_object(
      'type', 'FeatureCollection',
      'features', '[]'::jsonb,
      'stats', jsonb_build_object('max_speed', null, 'avg_speed_moving', null)
    );
  END IF;

  -- Choose thinning bucket based on span
  v_bucket_sec := CASE
    WHEN v_span_days <=  3  THEN    60   -- 1-min buckets  (≤ 3 days)
    WHEN v_span_days <= 14  THEN   300   -- 5-min buckets  (≤ 2 weeks)
    WHEN v_span_days <= 60  THEN   900   -- 15-min buckets (≤ 2 months)
    ELSE                          3600   -- 60-min buckets (> 2 months)
  END;

  WITH
  thinned AS (
    SELECT DISTINCT ON (floor(t / v_bucket_sec))
      lon, lat, t,
      (sensors->>'sog_kn')::float   AS sog,
      (sensors->>'cog')::float      AS cog,
      (sensors->>'hdg')::float      AS hdg,
      sensors->>'source'            AS src
    FROM positions_v2
    WHERE entity_id = v_entity_id
      AND t >= v_start_epoch
      AND t <= v_end_epoch
    ORDER BY floor(t / v_bucket_sec), t
  ),

  -- Dead-reckoning prediction score (same logic as get_vessel_track)
  scored AS (
    SELECT
      lon, lat, t, sog, cog, hdg, src,
      LAG(lon) OVER (ORDER BY t) AS prev_lon,
      LAG(lat) OVER (ORDER BY t) AS prev_lat,
      LAG(sog) OVER (ORDER BY t) AS prev_sog,
      LAG(cog) OVER (ORDER BY t) AS prev_cog,
      LAG(t)   OVER (ORDER BY t) AS prev_t
    FROM thinned
  ),

  prediction_scored AS (
    SELECT
      lon, lat, t, sog, cog, hdg, src,
      CASE
        WHEN prev_t IS NULL                       THEN NULL
        WHEN (t - prev_t) < 5                     THEN NULL
        WHEN prev_sog IS NULL OR prev_sog < 0.5   THEN NULL
        WHEN (t - prev_t) > 86400                 THEN NULL  -- wider gap tolerance for historical
        ELSE LEAST(1.0,
          ST_DistanceSphere(
            ST_MakePoint(
              prev_lon + (prev_sog * 0.514444 * (t - prev_t))
                         * sin(radians(prev_cog))
                         / (cos(radians(prev_lat)) * 111320.0),
              prev_lat + (prev_sog * 0.514444 * (t - prev_t))
                         * cos(radians(prev_cog))
                         / 111320.0
            ),
            ST_MakePoint(lon, lat)
          ) / NULLIF(prev_sog * 0.514444 * (t - prev_t), 0)
        )
      END AS prediction_score
    FROM scored
  ),

  point_features AS (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'geometry', jsonb_build_object(
        'type', 'Point',
        'coordinates', jsonb_build_array(lon, lat)
      ),
      'properties', jsonb_build_object(
        'mmsi',             p_mmsi,
        'speed',            sog,
        'heading',          hdg,
        'course',           cog,
        'recorded_at',      to_timestamp(t),
        'sources',          1,
        'source_type',      COALESCE(src, 'ais'),
        'prediction_score', ROUND(COALESCE(prediction_score, 0)::numeric, 3),
        'prediction_color', CASE
          WHEN prediction_score IS NULL OR prediction_score <= 0.15 THEN '#00e676'
          WHEN prediction_score <= 0.33                             THEN '#ffeb3b'
          WHEN prediction_score <= 0.50                             THEN '#ff9800'
          ELSE                                                           '#f44336'
        END
      )
    ) AS feature
    FROM prediction_scored
    ORDER BY t
  ),

  speed_stats AS (
    SELECT
      ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY sog)::numeric, 1) AS max_speed,
      ROUND(AVG(sog) FILTER (WHERE sog > 0.5)::numeric, 1)                  AS avg_speed_moving
    FROM prediction_scored
    WHERE sog IS NOT NULL AND sog > 0 AND sog <= 45
  )

  SELECT jsonb_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE((SELECT jsonb_agg(feature) FROM point_features), '[]'::jsonb),
    'stats',    (SELECT jsonb_build_object(
                  'max_speed',        max_speed,
                  'avg_speed_moving', avg_speed_moving
                ) FROM speed_stats)
  ) INTO result;

  RETURN result;
END;
$function$;
