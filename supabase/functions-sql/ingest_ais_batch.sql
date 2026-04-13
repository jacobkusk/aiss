CREATE OR REPLACE FUNCTION public.ingest_ais_batch(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  row_data       JSONB;
  v_mmsi         BIGINT;
  v_lat          FLOAT;
  v_lon          FLOAT;
  v_speed_kn     FLOAT;
  v_course       FLOAT;
  v_ts           TIMESTAMPTZ;
  v_entity_id    UUID;
  v_last_lat     FLOAT;
  v_last_lon     FLOAT;
  v_last_t       TIMESTAMPTZ;
  v_last_speed   FLOAT;
  v_last_bearing FLOAT;
  v_dist_m       FLOAT;
  v_dt_sec       FLOAT;
  v_gap_sec      FLOAT;
  v_course_delta FLOAT;
  v_is_stopped   BOOLEAN;
  v_was_stopped  BOOLEAN;
  v_accepted     INT := 0;
  v_rejected     INT := 0;
  v_vessel_name  TEXT;
  v_vessel_type  INT;
  v_heading      FLOAT;
  v_pt           JSONB;
  v_buf_len      INT;
  v_last_flush   TIMESTAMPTZ;
BEGIN
  FOR row_data IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_mmsi        := (row_data->>'mmsi')::BIGINT;
    v_lat         := (row_data->>'lat')::FLOAT;
    v_lon         := (row_data->>'lon')::FLOAT;
    v_speed_kn    := COALESCE((row_data->>'sog')::FLOAT, (row_data->>'speed')::FLOAT, 0);
    v_course      := COALESCE((row_data->>'cog')::FLOAT, (row_data->>'course')::FLOAT, 0);
    v_heading     := (row_data->>'heading')::FLOAT;
    v_ts          := COALESCE((row_data->>'timestamp')::TIMESTAMPTZ, now());
    v_vessel_name := NULLIF(row_data->>'vessel_name', '');
    v_vessel_type := (row_data->>'vessel_type')::INT;

    -- Grundlæggende validering
    IF v_lat = 0 AND v_lon = 0 THEN v_rejected := v_rejected + 1; CONTINUE; END IF;
    IF v_lat < -90 OR v_lat > 90 OR v_lon < -180 OR v_lon > 180 THEN v_rejected := v_rejected + 1; CONTINUE; END IF;
    IF v_mmsi < 100000000 OR v_mmsi > 999999999 THEN v_rejected := v_rejected + 1; CONTINUE; END IF;

    -- Land-check
    IF is_on_land(v_lon, v_lat) THEN
      v_rejected := v_rejected + 1; CONTINUE;
    END IF;

    -- Find eller opret entity
    SELECT entity_id INTO v_entity_id
    FROM entities WHERE domain_meta->>'mmsi' = v_mmsi::TEXT AND entity_type = 'vessel' LIMIT 1;

    IF v_entity_id IS NULL THEN
      INSERT INTO entities (entity_type, display_name, domain_meta)
      VALUES ('vessel', v_vessel_name, jsonb_build_object('mmsi', v_mmsi, 'vessel_name', v_vessel_name, 'vessel_type', v_vessel_type, 'source', 'rtlsdr'))
      RETURNING entity_id INTO v_entity_id;
    ELSE
      IF v_vessel_name IS NOT NULL THEN
        UPDATE entities SET
          domain_meta = domain_meta || jsonb_build_object('vessel_name', v_vessel_name, 'vessel_type', v_vessel_type),
          display_name = v_vessel_name
        WHERE entity_id = v_entity_id
          AND (display_name IS NULL OR display_name != v_vessel_name);
      END IF;
    END IF;

    SELECT lat, lon, t, speed, bearing
    INTO v_last_lat, v_last_lon, v_last_t, v_last_speed, v_last_bearing
    FROM entity_last WHERE entity_id = v_entity_id;

    IF v_last_t IS NOT NULL THEN
      v_dist_m   := ST_Distance(ST_MakePoint(v_lon, v_lat)::GEOGRAPHY, ST_MakePoint(v_last_lon, v_last_lat)::GEOGRAPHY);
      v_dt_sec   := EXTRACT(EPOCH FROM (v_ts - v_last_t));

      IF v_dt_sec > 0 AND v_dist_m / v_dt_sec > 30 THEN
        v_rejected := v_rejected + 1; CONTINUE;
      END IF;
      IF v_dist_m < 2 AND v_dt_sec < 30 THEN
        v_rejected := v_rejected + 1; CONTINUE;
      END IF;

      v_is_stopped  := v_speed_kn < 0.5;
      v_was_stopped := (v_last_speed / 0.514444) < 0.5;
      v_course_delta := ABS(v_course - v_last_bearing);
      IF v_course_delta > 180 THEN v_course_delta := 360 - v_course_delta; END IF;

      IF (NOT v_was_stopped AND v_is_stopped) THEN NULL;
      ELSIF (v_was_stopped AND NOT v_is_stopped) THEN NULL;
      ELSIF (NOT v_is_stopped AND v_course_delta > 10) THEN NULL;
      ELSIF (NOT v_is_stopped AND v_dt_sec < 60) THEN v_rejected := v_rejected + 1; CONTINUE;
      ELSIF (v_is_stopped AND v_dt_sec < 120) THEN v_rejected := v_rejected + 1; CONTINUE;
      END IF;
    END IF;

    -- Update live position
    INSERT INTO entity_last (entity_id, lat, lon, alt, speed, bearing, t, source)
    VALUES (v_entity_id, v_lat, v_lon, 0, v_speed_kn * 0.514444, v_course, v_ts, 'rtlsdr')
    ON CONFLICT (entity_id) DO UPDATE SET
      lat = EXCLUDED.lat, lon = EXCLUDED.lon, alt = EXCLUDED.alt,
      speed = EXCLUDED.speed, bearing = EXCLUDED.bearing,
      t = EXCLUDED.t, source = EXCLUDED.source, updated_at = now();

    -- Write to entity_buffer with real SOG/COG/HDG so waypoints show immediately
    v_pt := jsonb_build_object(
      'lon', v_lon, 'lat', v_lat,
      't', EXTRACT(EPOCH FROM v_ts)::float,
      'sog', CASE WHEN v_speed_kn > 0 THEN v_speed_kn ELSE NULL END,
      'cog', CASE WHEN v_course > 0 THEN v_course ELSE NULL END,
      'hdg', v_heading
    );

    INSERT INTO entity_buffer (entity_id, points, last_flushed_at)
    VALUES (v_entity_id, jsonb_build_array(v_pt), NULL)
    ON CONFLICT (entity_id) DO UPDATE SET
      points = entity_buffer.points || v_pt;

    -- Flush when 10+ points accumulated
    SELECT jsonb_array_length(points), last_flushed_at
    INTO v_buf_len, v_last_flush
    FROM entity_buffer WHERE entity_id = v_entity_id;

    IF v_buf_len >= 10
       OR (v_last_flush IS NOT NULL AND v_last_flush < now() - INTERVAL '5 minutes')
    THEN
      PERFORM flush_entity(v_entity_id);
    END IF;

    v_accepted := v_accepted + 1;
  END LOOP;

  RETURN jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
END;
$function$
;
