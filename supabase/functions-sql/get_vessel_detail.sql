-- Single-roundtrip payload for /vessel/[mmsi] detail page.
--
-- Returns:
--   entity   (mmsi, imo, name, type, flag, dimensions, callsign, domain_meta)
--   last     (lat, lon, sog_kn, cog, heading, nav_status, t, age_sec, source,
--             source_count, sensors)
--   voyage   (destination, eta, draught, nav_status)
--   evidence (merkle_root hex, epsilon_m, segment_count, raw_pts, dp_pts,
--             has_signed_tracks, last_signed_at, gap_intervals, source_domain,
--             latency_class, permanent_address)
--   stats    (fixes_24h, fixes_7d, avg_sog_kn_7d, max_sog_kn_7d,
--             first_seen, days_tracked)
--   sources  (name, type, n, last_seen — per source in last hour)
--   charts   (speed_ts 30m×48h, cog_hist 16bins×7d, heatmap dow×hr×7d,
--             cumulative daily NM×7d, activity at-sea/port, msg_types)
--   events   (nav_status changes, departure/arrival speed transitions)
--
-- RLS: SECURITY DEFINER so internal aggregates work for anon.

CREATE OR REPLACE FUNCTION public.get_vessel_detail(p_mmsi BIGINT)
 RETURNS JSONB
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entity_id UUID;
  v_entity    RECORD;
  v_last      RECORD;
  v_track     RECORD;
  v_stats     RECORD;
  v_sources   JSONB;
  v_speed_ts  JSONB;
  v_cog_hist  JSONB;
  v_heatmap   JSONB;
  v_cumul     JSONB;
  v_activity  JSONB;
  v_events    JSONB;
  v_msg_types JSONB;
  v_result    JSONB;
BEGIN
  -- 1) Resolve entity_id from MMSI
  SELECT e.entity_id, e.display_name, e.entity_type, e.domain_meta,
         e.created_at, e.updated_at
  INTO   v_entity
  FROM   entities e
  WHERE  (e.domain_meta->>'mmsi')::BIGINT = p_mmsi
  LIMIT  1;

  IF v_entity.entity_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found', 'mmsi', p_mmsi);
  END IF;

  v_entity_id := v_entity.entity_id;

  -- 2) Latest fix + live freshness
  SELECT el.lat, el.lon, el.speed, el.bearing, el.t, el.updated_at,
         el.source, el.source_count, el.sensors,
         EXTRACT(EPOCH FROM (NOW() - el.updated_at))::INT AS age_sec
  INTO   v_last
  FROM   entity_last el
  WHERE  el.entity_id = v_entity_id;

  -- 3) Track / evidence row
  SELECT t.raw_point_count, t.compressed_point_count, t.epsilon_m,
         t.merkle_root, t.segment_hashes, t.permanent_address,
         t.compressed_at, t.created_at AS track_created_at,
         t.gap_intervals, t.source_domain, t.latency_class,
         COALESCE(array_length(t.segment_hashes, 1), 0) AS segment_count
  INTO   v_track
  FROM   tracks t
  WHERE  t.entity_id = v_entity_id
  ORDER  BY t.updated_at DESC NULLS LAST
  LIMIT  1;

  -- 4) Aggregate stats (7d window)
  BEGIN
    SELECT
      count(*) FILTER (WHERE t > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours')) AS fixes_24h,
      count(*) AS fixes_7d,
      avg( (sensors->>'sog_kn')::NUMERIC )
        FILTER (WHERE (sensors->>'sog_kn') IS NOT NULL) AS avg_sog_kn_7d,
      max( (sensors->>'sog_kn')::NUMERIC )
        FILTER (WHERE (sensors->>'sog_kn') IS NOT NULL) AS max_sog_kn_7d,
      min(to_timestamp(t))  AS first_seen,
      max(to_timestamp(t))  AS last_fix_ts
    INTO v_stats
    FROM positions_v2
    WHERE entity_id = v_entity_id
      AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days');
  EXCEPTION WHEN OTHERS THEN
    v_stats := NULL;
  END;

  -- 5) Source breakdown (last hour)
  BEGIN
    SELECT jsonb_agg(row_to_json(s)) INTO v_sources
    FROM (
      SELECT
        COALESCE(isrc.name, pv.source_id::TEXT) AS name,
        COALESCE(isrc.source_type, 'unknown')   AS type,
        count(*) AS n,
        max(to_timestamp(pv.t)) AS last_seen
      FROM positions_v2 pv
      LEFT JOIN ingest_sources isrc ON isrc.source_id = pv.source_id
      WHERE pv.entity_id = v_entity_id
        AND pv.t > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour')
      GROUP BY isrc.name, isrc.source_type, pv.source_id
      ORDER BY n DESC
      LIMIT 8
    ) s;
  EXCEPTION WHEN OTHERS THEN
    v_sources := '[]'::jsonb;
  END;

  -- 6) CHARTS: Speed timeseries (30-min buckets, 48h)
  BEGIN
    SELECT jsonb_agg(row_to_json(b) ORDER BY b.bucket) INTO v_speed_ts
    FROM (
      SELECT
        (EXTRACT(EPOCH FROM date_trunc('hour', to_timestamp(t))
          + INTERVAL '30 min' * FLOOR(EXTRACT(MINUTE FROM to_timestamp(t)) / 30)))::BIGINT AS bucket,
        ROUND(avg((sensors->>'sog_kn')::NUMERIC), 2) AS avg_sog,
        ROUND(max((sensors->>'sog_kn')::NUMERIC), 2) AS max_sog,
        count(*) AS n
      FROM positions_v2
      WHERE entity_id = v_entity_id
        AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '48 hours')
        AND (sensors->>'sog_kn') IS NOT NULL
      GROUP BY 1
    ) b;
  EXCEPTION WHEN OTHERS THEN
    v_speed_ts := '[]'::jsonb;
  END;

  -- 7) CHARTS: COG histogram (16 bins × 22.5°, 7d)
  BEGIN
    SELECT jsonb_agg(row_to_json(b) ORDER BY b.bin_deg) INTO v_cog_hist
    FROM (
      SELECT
        (FLOOR((sensors->>'cog')::NUMERIC / 22.5) * 22.5)::INT AS bin_deg,
        count(*) AS n
      FROM positions_v2
      WHERE entity_id = v_entity_id
        AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
        AND (sensors->>'cog') IS NOT NULL
      GROUP BY 1
    ) b;
  EXCEPTION WHEN OTHERS THEN
    v_cog_hist := '[]'::jsonb;
  END;

  -- 8) CHARTS: Reception heatmap (dow × hour, 7d)
  BEGIN
    SELECT jsonb_agg(row_to_json(h)) INTO v_heatmap
    FROM (
      SELECT
        EXTRACT(DOW FROM to_timestamp(t))::INT  AS dow,
        EXTRACT(HOUR FROM to_timestamp(t))::INT AS hr,
        count(*) AS n
      FROM positions_v2
      WHERE entity_id = v_entity_id
        AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
      GROUP BY 1, 2
    ) h;
  EXCEPTION WHEN OTHERS THEN
    v_heatmap := '[]'::jsonb;
  END;

  -- 9) CHARTS: Cumulative distance (daily NM, 7d — Haversine)
  BEGIN
    SELECT jsonb_agg(row_to_json(d) ORDER BY d.day) INTO v_cumul
    FROM (
      WITH ordered AS (
        SELECT lat, lon, t,
               LAG(lat) OVER (ORDER BY t) AS prev_lat,
               LAG(lon) OVER (ORDER BY t) AS prev_lon,
               date_trunc('day', to_timestamp(t))::DATE AS day
        FROM positions_v2
        WHERE entity_id = v_entity_id
          AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
        ORDER BY t
      )
      SELECT day,
        ROUND(SUM(
          CASE WHEN prev_lat IS NOT NULL THEN
            60.0 * degrees(acos(LEAST(1.0, GREATEST(-1.0,
              sin(radians(lat)) * sin(radians(prev_lat)) +
              cos(radians(lat)) * cos(radians(prev_lat)) *
              cos(radians(lon - prev_lon))
            ))))
          ELSE 0 END
        )::NUMERIC, 1) AS nm
      FROM ordered
      GROUP BY day
    ) d;
  EXCEPTION WHEN OTHERS THEN
    v_cumul := '[]'::jsonb;
  END;

  -- 10) CHARTS: At-sea vs at-port activity (7d, speed threshold 0.5 kn)
  BEGIN
    SELECT jsonb_build_object(
      'at_sea_pct',  ROUND(100.0 * count(*) FILTER (WHERE (sensors->>'sog_kn')::NUMERIC > 0.5) / GREATEST(count(*), 1), 1),
      'at_port_pct', ROUND(100.0 * count(*) FILTER (WHERE (sensors->>'sog_kn')::NUMERIC <= 0.5) / GREATEST(count(*), 1), 1),
      'at_sea_fixes',  count(*) FILTER (WHERE (sensors->>'sog_kn')::NUMERIC > 0.5),
      'at_port_fixes', count(*) FILTER (WHERE (sensors->>'sog_kn')::NUMERIC <= 0.5),
      'total_fixes', count(*)
    ) INTO v_activity
    FROM positions_v2
    WHERE entity_id = v_entity_id
      AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
      AND (sensors->>'sog_kn') IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    v_activity := '{"at_sea_pct":0,"at_port_pct":0,"at_sea_fixes":0,"at_port_fixes":0,"total_fixes":0}'::jsonb;
  END;

  -- 11) EVENTS: Nav status changes + departure/arrival speed transitions (7d)
  BEGIN
    SELECT jsonb_agg(row_to_json(ev) ORDER BY ev.t DESC) INTO v_events
    FROM (
      WITH changes AS (
        SELECT t,
               sensors->>'nav_status' AS nav_status,
               (sensors->>'sog_kn')::NUMERIC AS sog,
               LAG(sensors->>'nav_status') OVER (ORDER BY t) AS prev_nav,
               LAG((sensors->>'sog_kn')::NUMERIC) OVER (ORDER BY t) AS prev_sog
        FROM positions_v2
        WHERE entity_id = v_entity_id
          AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
        ORDER BY t
      )
      SELECT to_timestamp(t) AS t,
        CASE
          WHEN nav_status IS DISTINCT FROM prev_nav AND nav_status IS NOT NULL
            THEN 'nav_status_change'
          WHEN prev_sog <= 0.5 AND sog > 2
            THEN 'departure'
          WHEN prev_sog > 2 AND sog <= 0.5
            THEN 'arrival'
          ELSE NULL
        END AS event_type,
        CASE
          WHEN nav_status IS DISTINCT FROM prev_nav AND nav_status IS NOT NULL
            THEN jsonb_build_object('from', prev_nav, 'to', nav_status)
          WHEN prev_sog <= 0.5 AND sog > 2
            THEN jsonb_build_object('speed_kn', sog)
          WHEN prev_sog > 2 AND sog <= 0.5
            THEN jsonb_build_object('speed_kn', sog)
          ELSE NULL
        END AS detail
      FROM changes
      WHERE (nav_status IS DISTINCT FROM prev_nav AND nav_status IS NOT NULL)
         OR (prev_sog <= 0.5 AND sog > 2)
         OR (prev_sog > 2 AND sog <= 0.5)
      LIMIT 20
    ) ev;
  EXCEPTION WHEN OTHERS THEN
    v_events := '[]'::jsonb;
  END;

  -- 12) AIS message type breakdown (sensors->>'msg_type', 7d)
  BEGIN
    SELECT jsonb_agg(row_to_json(m) ORDER BY m.n DESC) INTO v_msg_types
    FROM (
      SELECT
        COALESCE(sensors->>'msg_type', 'unknown') AS msg_type,
        count(*) AS n
      FROM positions_v2
      WHERE entity_id = v_entity_id
        AND t > EXTRACT(EPOCH FROM NOW() - INTERVAL '7 days')
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 10
    ) m;
  EXCEPTION WHEN OTHERS THEN
    v_msg_types := '[]'::jsonb;
  END;

  -- ═══ Build result ═══
  v_result := jsonb_build_object(
    'entity', jsonb_build_object(
      'entity_id',   v_entity_id,
      'mmsi',        p_mmsi,
      'name',        NULLIF(COALESCE(v_entity.display_name,
                                     v_entity.domain_meta->>'vessel_name'), ''),
      'entity_type', v_entity.entity_type,
      'type_text',   v_entity.domain_meta->>'vessel_type',
      'flag',        v_entity.domain_meta->>'flag',
      'imo',         v_entity.domain_meta->>'imo',
      'callsign',    v_entity.domain_meta->>'callsign',
      'length_m',    (v_entity.domain_meta->>'length_m')::NUMERIC,
      'beam_m',      (v_entity.domain_meta->>'beam_m')::NUMERIC,
      'ship_type',   (v_entity.domain_meta->>'ship_type')::INT,
      'first_seen',  v_entity.created_at,
      'last_static', v_entity.updated_at,
      'domain_meta', v_entity.domain_meta
    ),
    'last', CASE WHEN v_last.t IS NOT NULL THEN jsonb_build_object(
      'lat',          v_last.lat,
      'lon',          v_last.lon,
      'speed_kn',     COALESCE( (v_last.sensors->>'sog_kn')::NUMERIC,
                                (v_last.speed / 0.514444)::NUMERIC ),
      'cog',          COALESCE( (v_last.sensors->>'cog')::NUMERIC,
                                v_last.bearing::NUMERIC ),
      'heading',      (v_last.sensors->>'hdg')::NUMERIC,
      'nav_status',   v_last.sensors->>'nav_status',
      't',            v_last.t,
      'age_sec',      v_last.age_sec,
      'source',       v_last.source,
      'source_count', COALESCE(v_last.source_count, 1),
      'sensors',      v_last.sensors
    ) ELSE NULL END,
    'voyage', jsonb_build_object(
      'destination',  v_entity.domain_meta->>'destination',
      'eta',          v_entity.domain_meta->>'eta',
      'draught_m',    (v_entity.domain_meta->>'draught')::NUMERIC,
      'nav_status',   v_last.sensors->>'nav_status'
    ),
    'evidence', CASE WHEN v_track.raw_point_count IS NOT NULL THEN jsonb_build_object(
      'has_track',         true,
      'merkle_root_hex',   CASE WHEN v_track.merkle_root IS NOT NULL
                                THEN encode(v_track.merkle_root, 'hex') END,
      'epsilon_m',         v_track.epsilon_m,
      'segment_count',     v_track.segment_count,
      'raw_points',        v_track.raw_point_count,
      'dp_points',         v_track.compressed_point_count,
      'compressed_at',     v_track.compressed_at,
      'last_signed_at',    CASE WHEN v_track.merkle_root IS NOT NULL
                                THEN v_track.compressed_at END,
      'gap_intervals',     v_track.gap_intervals,
      'source_domain',     v_track.source_domain,
      'latency_class',     v_track.latency_class,
      'permanent_address', v_track.permanent_address
    ) ELSE jsonb_build_object('has_track', false) END,
    'stats', jsonb_build_object(
      'fixes_24h',     COALESCE(v_stats.fixes_24h, 0),
      'fixes_7d',      COALESCE(v_stats.fixes_7d, 0),
      'avg_sog_kn_7d', v_stats.avg_sog_kn_7d,
      'max_sog_kn_7d', v_stats.max_sog_kn_7d,
      'first_seen',    COALESCE(v_stats.first_seen, v_entity.created_at),
      'last_fix_ts',   v_stats.last_fix_ts,
      'days_tracked',  GREATEST(1, EXTRACT(DAY FROM (NOW() - v_entity.created_at))::INT)
    ),
    'sources', COALESCE(v_sources, '[]'::jsonb),
    'charts', jsonb_build_object(
      'speed_ts',   COALESCE(v_speed_ts, '[]'::jsonb),
      'cog_hist',   COALESCE(v_cog_hist, '[]'::jsonb),
      'heatmap',    COALESCE(v_heatmap, '[]'::jsonb),
      'cumulative', COALESCE(v_cumul, '[]'::jsonb),
      'activity',   COALESCE(v_activity, '{}'::jsonb),
      'msg_types',  COALESCE(v_msg_types, '[]'::jsonb)
    ),
    'events', COALESCE(v_events, '[]'::jsonb),
    'generated_at', NOW()
  );

  RETURN v_result;
END;
$function$;

-- Allow anonymous users to call it.
GRANT EXECUTE ON FUNCTION public.get_vessel_detail(BIGINT) TO anon, authenticated;
