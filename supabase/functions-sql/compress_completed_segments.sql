-- Called by pg_cron job `compress-ais-segments` every 2 minutes.
-- Douglas-Peucker on tracks whose updated_at is older than p_idle_minutes.
-- Writes the simplified 2D line to tracks.track_display; leaves the
-- original MULTILINESTRINGZM in tracks.track untouched.

CREATE OR REPLACE FUNCTION public.compress_completed_segments(p_idle_minutes integer DEFAULT 2, p_epsilon_m double precision DEFAULT 10.0)
 RETURNS TABLE(track_id uuid, entity_id uuid, raw_points integer, compressed_points integer, ratio double precision)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_epsilon_deg        FLOAT;
  rec                  RECORD;
  v_raw_count          INT;
  v_compressed_count   INT;
  v_display_geom       GEOMETRY;
BEGIN
  -- 1° ≈ 85km ved 56°N
  v_epsilon_deg := p_epsilon_m / 85000.0;

  FOR rec IN
    SELECT t.track_id, t.entity_id, t.track
    FROM tracks t
    WHERE t.compressed_at IS NULL
      AND t.updated_at < now() - (p_idle_minutes || ' minutes')::INTERVAL
      AND t.track IS NOT NULL
  LOOP
    v_raw_count := ST_NPoints(ST_GeometryN(rec.track, 1));

    IF v_raw_count < 3 THEN
      -- For kort til at komprimere — marker blot som behandlet
      UPDATE tracks SET
        compressed_at = now(),
        raw_point_count = v_raw_count,
        compressed_point_count = v_raw_count,
        epsilon_m = p_epsilon_m,
        track_display = ST_Force2D(rec.track)
      WHERE tracks.track_id = rec.track_id;
      CONTINUE;
    END IF;

    -- Douglas-Peucker på 2D (XY) — gem i track_display
    -- Original track med M-timestamps rørtes ikke
    v_display_geom := ST_Multi(
      ST_SimplifyPreserveTopology(
        ST_Force2D(ST_GeometryN(rec.track, 1)),
        v_epsilon_deg
      )
    );
    v_compressed_count := ST_NPoints(v_display_geom);

    UPDATE tracks SET
      track_display = v_display_geom,
      raw_point_count = v_raw_count,
      compressed_point_count = v_compressed_count,
      compressed_at = now(),
      epsilon_m = p_epsilon_m
      -- track (MULTILINESTRINGZM) røres ikke
    WHERE tracks.track_id = rec.track_id;

    track_id          := rec.track_id;
    entity_id         := rec.entity_id;
    raw_points        := v_raw_count;
    compressed_points := v_compressed_count;
    ratio             := round((1.0 - v_compressed_count::FLOAT / v_raw_count) * 100) / 100;
    RETURN NEXT;
  END LOOP;
END;
$function$;
