-- upsert_vessel_static — canonical write path for Type 5 static AIS data.
-- See supabase/functions-sql/upsert_vessel_static.sql for the live source.

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
  IF p_mmsi IS NULL OR p_mmsi < 1 OR p_mmsi > 999999999 THEN
    RETURN NULL;
  END IF;

  v_mmsi_padded := lpad(p_mmsi::text, 9, '0');

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

  v_name := NULLIF(btrim(regexp_replace(COALESCE(p_shipname, ''), '@+$', '')), '');
  IF v_name IS NOT NULL THEN
    v_merge := v_merge || jsonb_build_object('vessel_name', v_name);
  END IF;

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
