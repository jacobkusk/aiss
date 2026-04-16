-- Authenticated RPC for phone-GPS uploads. Requires auth.uid() — will
-- raise if called as anon. Derives a pseudo-MMSI in the 900M range
-- from the user's UUID, writes a LineString to vessel_routes with
-- 5-min time-mark checkpoints, and upserts vessels_live with the
-- latest point so the user shows up on the live map.
--
-- Note: vessel_routes and vessels_live are legacy tables not listed in
-- CLAUDE.md's core schema. This RPC is the only writer. If phone-GPS
-- upload becomes a real feature, consider migrating to entities +
-- positions_v2 + entity_last so it joins the rest of the pipeline.

CREATE OR REPLACE FUNCTION public.upload_gps_track(p_points jsonb, p_device_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id uuid;
  v_mmsi int;
  v_route geometry;
  v_marks jsonb := '[]'::jsonb;
  v_count int;
  v_start timestamptz;
  v_end timestamptz;
  v_avg_speed float;
  v_last record;
  prev_mark_t bigint := 0;
  pt jsonb;
  MARK_INTERVAL int := 300; -- 5 minutes
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Derive pseudo-MMSI from user UUID (900M-999M range, outside real MMSI)
  v_mmsi := 900000000 + (('x' || left(replace(v_user_id::text, '-', ''), 8))::bit(32)::int % 100000000);
  IF v_mmsi < 900000000 THEN v_mmsi := v_mmsi + 900000000; END IF;

  v_count := jsonb_array_length(p_points);
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Need at least 2 points';
  END IF;
  IF v_count > 10000 THEN
    RAISE EXCEPTION 'Max 10000 points per batch';
  END IF;

  -- Build LineString from sorted points
  WITH sorted AS (
    SELECT
      (p->>'lon')::float as lon,
      (p->>'lat')::float as lat,
      (p->>'t')::bigint as t,
      (p->>'speed')::float as speed,
      (p->>'heading')::float as heading
    FROM jsonb_array_elements(p_points) as p
    ORDER BY (p->>'t')::bigint ASC
  )
  SELECT
    ST_SetSRID(ST_MakeLine(array_agg(ST_MakePoint(lon, lat) ORDER BY t)), 4326),
    to_timestamp(min(t)),
    to_timestamp(max(t)),
    avg(speed) FILTER (WHERE speed IS NOT NULL AND speed > 0)
  INTO v_route, v_start, v_end, v_avg_speed
  FROM sorted;

  -- Build sparse time marks (first, last, every 5 min)
  FOR pt IN
    SELECT p FROM jsonb_array_elements(p_points) as p
    ORDER BY (p->>'t')::bigint ASC
  LOOP
    IF prev_mark_t = 0
       OR ((pt->>'t')::bigint - prev_mark_t) >= MARK_INTERVAL
    THEN
      v_marks := v_marks || jsonb_build_array(jsonb_build_object(
        'lon', round((pt->>'lon')::numeric, 5),
        'lat', round((pt->>'lat')::numeric, 5),
        't', (pt->>'t')::bigint
      ));
      prev_mark_t := (pt->>'t')::bigint;
    END IF;
  END LOOP;
  -- Always add last point
  pt := p_points->>(v_count - 1);
  IF (pt->>'t')::bigint <> prev_mark_t THEN
    v_marks := v_marks || jsonb_build_array(jsonb_build_object(
      'lon', round((pt->>'lon')::numeric, 5),
      'lat', round((pt->>'lat')::numeric, 5),
      't', (pt->>'t')::bigint
    ));
  END IF;

  -- Insert route
  INSERT INTO vessel_routes (mmsi, route, time_marks, point_count, start_time, end_time, avg_speed, source, user_id)
  VALUES (v_mmsi, v_route, v_marks, ST_NPoints(v_route), v_start, v_end, v_avg_speed, 'phone_gps', v_user_id);

  -- Update live position (last point)
  SELECT
    (p->>'lat')::float as lat,
    (p->>'lon')::float as lon,
    (p->>'speed')::float as speed,
    (p->>'heading')::float as heading
  INTO v_last
  FROM jsonb_array_elements(p_points) as p
  ORDER BY (p->>'t')::bigint DESC
  LIMIT 1;

  INSERT INTO vessels_live (mmsi, position, lat, lon, speed, heading, source, name, user_id, updated_at)
  VALUES (
    v_mmsi,
    ST_SetSRID(ST_MakePoint(v_last.lon, v_last.lat), 4326)::geography,
    v_last.lat, v_last.lon, v_last.speed, v_last.heading,
    'phone_gps', COALESCE(p_device_name, 'Phone'), v_user_id, NOW()
  )
  ON CONFLICT (mmsi) DO UPDATE SET
    position = EXCLUDED.position, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
    speed = EXCLUDED.speed, heading = EXCLUDED.heading,
    source = EXCLUDED.source, name = COALESCE(EXCLUDED.name, vessels_live.name),
    user_id = EXCLUDED.user_id, updated_at = NOW();

  RETURN jsonb_build_object(
    'ok', true,
    'point_count', ST_NPoints(v_route),
    'time_marks', jsonb_array_length(v_marks),
    'mmsi', v_mmsi,
    'start_time', v_start,
    'end_time', v_end
  );
END;
$function$;
