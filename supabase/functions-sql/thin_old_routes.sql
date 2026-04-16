-- Called by pg_cron job `thin-old-routes` every hour.
-- Angle-based thinning on vessel_routes older than 24h — drops points in
-- straight segments (bearing change < 3°), keeps curves. Minimum 20%
-- reduction required before writing back.

CREATE OR REPLACE FUNCTION public.thin_old_routes()
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  cutoff timestamptz := now() - interval '24 hours';
  thinned int := 0;
  r record;
  pts geometry[];
  kept geometry[];
  prev_bearing float;
  curr_bearing float;
  angle_diff float;
  dx float; dy float;
  STRAIGHT_THRESHOLD float := 3;
  n int;
  new_line geometry;
BEGIN
  FOR r IN
    SELECT id, route, point_count
    FROM vessel_routes
    WHERE end_time < cutoff
      AND point_count > 20
    LIMIT 200
  LOOP
    BEGIN
      SELECT array_agg((dp).geom ORDER BY (dp).path[1])
      INTO pts
      FROM ST_DumpPoints(r.route) dp;

      n := array_length(pts, 1);
      IF n IS NULL OR n < 3 THEN CONTINUE; END IF;

      kept := ARRAY[pts[1]];
      prev_bearing := NULL;

      FOR i IN 2..n-1 LOOP
        dx := ST_X(pts[i]) - ST_X(pts[i-1]);
        dy := ST_Y(pts[i]) - ST_Y(pts[i-1]);
        curr_bearing := degrees(atan2(dx, dy));

        IF prev_bearing IS NOT NULL THEN
          angle_diff := abs(curr_bearing - prev_bearing);
          IF angle_diff > 180 THEN angle_diff := 360 - angle_diff; END IF;
          -- Keep point if direction is changing (curve)
          IF angle_diff >= STRAIGHT_THRESHOLD THEN
            kept := array_append(kept, pts[i]);
          END IF;
        END IF;

        prev_bearing := curr_bearing;
      END LOOP;

      kept := array_append(kept, pts[n]);

      IF array_length(kept, 1) < 2 THEN CONTINUE; END IF;

      -- Only update if significant reduction (>20%)
      IF array_length(kept, 1)::float / n < 0.8 THEN
        new_line := ST_SetSRID(ST_MakeLine(kept), 4326);
        UPDATE vessel_routes SET route = new_line, point_count = ST_NPoints(new_line) WHERE id = r.id;
        thinned := thinned + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'thin skip route id=%: %', r.id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('routes_thinned', thinned);
END;
$function$;
