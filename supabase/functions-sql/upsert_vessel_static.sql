-- Upsert vessel static data (Type 5 payload: ship_type, callsign, imo,
-- destination, shipname) onto the entities row keyed by MMSI.
--
-- Until now only Type 1/2/3 position reports wrote to entities — via
-- ingest_positions_v2, which only populated mmsi, mmsi_int, vessel_name,
-- classified_as. That left domain_meta.ship_type null for all 348 vessels,
-- blocking LINE layer, ship icons, and per-type colouring. This RPC is
-- the canonical write path for any static-field enrichment.
--
-- Behaviour:
--   * UPDATE-first against the partial unique idx on (domain_meta->>'mmsi')
--     WHERE entity_type='vessel'. This is the hot path — entity almost
--     always exists from a prior position report.
--   * INSERT fallback for the rare case where Type 5 arrives before any
--     position. Includes ON CONFLICT for race safety with ingest_positions_v2.
--   * Merge semantics: only non-null fields are merged in; prior values
--     for fields not in this call are preserved (idempotent).
--   * AIS conventions: ship_type 0 and IMO 0 are "not available" → dropped.
--   * shipname stripped of trailing '@' padding before storage.
--
-- Access: service_role only. PI collector calls via REST /rpc/.

CREATE OR REPLACE FUNCTION public.upsert_vessel_static(
  p_mmsi bigint,
  p_ship_type int DEFAULT NULL,
  p_callsign text DEFAULT NULL,
  p_imo bigint DEFAULT NULL,
  p_destination text DEFAULT NULL,
  p_shipname text DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mmsi_padded text;
  v_merge       jsonb := '{}'::jsonb;
  v_name        text;
  v_entity_id   uuid;
BEGIN
  -- Guard: MMSI must be in the same widened range the edge accepts.
  IF p_mmsi IS NULL OR p_mmsi < 1 OR p_mmsi > 999999999 THEN
    RETURN NULL;
  END IF;

  v_mmsi_padded := lpad(p_mmsi::text, 9, '0');

  -- Build merge patch — only include fields that have real values.
  -- AIS convention: ship_type 0 = "not available", IMO 0 = "unknown" → drop.
  IF p_ship_type IS NOT NULL AND p_ship_type BETWEEN 1 AND 99 THEN
    v_merge := v_merge || jsonb_build_object('ship_type', p_ship_type);
  END IF;

  IF p_callsign IS NOT NULL AND length(btrim(p_callsign)) > 0 THEN
    v_merge := v_merge || jsonb_build_object('callsign', btrim(p_callsign));
  END IF;

  IF p_imo IS NOT NULL AND p_imo > 0 THEN
    v_merge := v_merge || jsonb_build_object('imo', p_imo);
  END IF;

  IF p_destination IS NOT NULL AND length(btrim(p_destination)) > 0 THEN
    v_merge := v_merge || jsonb_build_object('destination', btrim(p_destination));
  END IF;

  -- Normalise shipname: AIS pads with '@' and trailing spaces. Trim both.
  v_name := NULLIF(btrim(regexp_replace(COALESCE(p_shipname, ''), '@+$', '')), '');
  IF v_name IS NOT NULL THEN
    v_merge := v_merge || jsonb_build_object('vessel_name', v_name);
  END IF;

  -- Fast path: row already exists (most common — entity was created by a
  -- prior Type 1/2/3 position report via ingest_positions_v2).
  UPDATE entities
  SET domain_meta = domain_meta || v_merge,
      display_name = COALESCE(v_name, display_name),
      updated_at   = now()
  WHERE entity_type = 'vessel'
    AND (domain_meta->>'mmsi') = v_mmsi_padded
  RETURNING entity_id INTO v_entity_id;

  IF v_entity_id IS NOT NULL THEN
    RETURN v_entity_id;
  END IF;

  -- Slow path: no entity yet — Type 5 arrived before any position.
  -- Insert with ON CONFLICT against the partial unique idx_entities_vessel_mmsi
  -- to handle the race where a concurrent ingest_positions_v2 inserted first.
  INSERT INTO entities (entity_type, display_name, domain_meta)
  VALUES (
    'vessel',
    v_name,
    jsonb_build_object(
      'mmsi',          v_mmsi_padded,
      'mmsi_int',      p_mmsi,
      'classified_as', 'vessel'
    ) || v_merge
  )
  ON CONFLICT ((domain_meta->>'mmsi')) WHERE entity_type = 'vessel'
  DO UPDATE
    SET domain_meta = entities.domain_meta || EXCLUDED.domain_meta,
        display_name = COALESCE(EXCLUDED.display_name, entities.display_name),
        updated_at   = now()
  RETURNING entity_id INTO v_entity_id;

  RETURN v_entity_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_vessel_static(bigint, int, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_vessel_static(bigint, int, text, bigint, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_vessel_static(bigint, int, text, bigint, text, text) TO service_role;
