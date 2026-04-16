-- Batch-log anomalies from the ingest pipeline. Called by edge functions when
-- a row is rejected for a reason that is itself evidence (teleportation,
-- impossible speed, future timestamps, etc.) — not for protocol errors like
-- malformed MMSI or missing coords.
--
-- Takes a jsonb array of rows, each with:
--   mmsi         bigint  required  — looked up against entities.domain_meta.mmsi_int
--   anomaly_type text    required  — e.g. 'teleportation'
--   severity     text    optional  — 'info' | 'warn' | 'error' | 'critical', default 'info'
--   details      jsonb   optional  — free-form evidence (prev/current pos, speed, dt, …)
--   detected_at  text    optional  — iso timestamp, default now()
--
-- p_source_name is looked up once against ingest_sources.name for every row
-- in the batch. Returns the count of rows actually inserted.
--
-- Rows without a matching entity still get logged (entity_id NULL) — useful
-- for MMSI we've never seen accepting a position, which is itself a signal.
--
-- SECURITY DEFINER: edge functions use service_role which already bypasses
-- RLS, but defining it this way keeps the contract clean if we later call
-- it from anon-facing paths.

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
$function$
;
