-- write_anomalies_batch — batch-log anomalies from the ingest pipeline.
-- See supabase/functions-sql/write_anomalies_batch.sql for the live source.
--
-- Edge-function contract: pass p_rows as jsonb array, p_source_name as the
-- collector's ingest_sources.name ('pi4_rtlsdr', 'aisstream', …). Rows with
-- unknown MMSI are still inserted (entity_id NULL) — the fact that we
-- received a signal from an unregistered vessel is itself evidence.
--
-- Access: service_role only. Not exposed to anon/authenticated; the frontend
-- reads anomalies directly via the table's public_read RLS policy.

CREATE OR REPLACE FUNCTION public.write_anomalies_batch(
  p_rows jsonb,
  p_source_name text DEFAULT NULL
)
 RETURNS int
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_id uuid;
  v_inserted int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN 0;
  END IF;

  IF p_source_name IS NOT NULL THEN
    SELECT source_id INTO v_source_id
    FROM ingest_sources
    WHERE name = p_source_name
    LIMIT 1;
  END IF;

  WITH input AS (
    SELECT
      NULLIF(elem->>'mmsi','')::bigint                       AS mmsi,
      elem->>'anomaly_type'                                  AS anomaly_type,
      COALESCE(NULLIF(elem->>'severity',''), 'info')         AS severity,
      COALESCE(elem->'details', '{}'::jsonb)                 AS details,
      COALESCE(
        NULLIF(elem->>'detected_at','')::timestamptz,
        now()
      )                                                      AS detected_at
    FROM jsonb_array_elements(p_rows) AS elem
    WHERE elem->>'anomaly_type' IS NOT NULL
  ),
  resolved AS (
    SELECT
      i.anomaly_type,
      i.severity,
      i.details,
      i.detected_at,
      e.entity_id
    FROM input i
    LEFT JOIN entities e
      ON (e.domain_meta->>'mmsi_int')::bigint = i.mmsi
  ),
  ins AS (
    INSERT INTO anomalies (entity_id, anomaly_type, severity, source_id, details, detected_at)
    SELECT entity_id, anomaly_type, severity, v_source_id, details, detected_at
    FROM resolved
    RETURNING 1
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.write_anomalies_batch(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_anomalies_batch(jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_anomalies_batch(jsonb, text) TO service_role;
