-- Adds the `anomalies` table required by shared/ARCHITECTURE.md canonical model.
-- Purpose: append-only log of detected inconsistencies in the evidence stream
-- (spoof candidates, null-island fixes, multi-source conflicts, impossible
-- speed/jump, MMSI collisions, etc.). Never deleted — anomalies are evidence
-- about the evidence. Frontend reads a sanitised view; raw rows stay public
-- for now (no PII), tighten later if needed.
--
-- Additive only: no existing tables touched, no policies renamed, no indexes
-- dropped. Safe to deploy while ingest is live.

CREATE TABLE IF NOT EXISTS public.anomalies (
  id              bigserial PRIMARY KEY,
  entity_id       uuid        NULL REFERENCES public.entities(entity_id) ON DELETE SET NULL,
  anomaly_type    text        NOT NULL,
  severity        text        NOT NULL DEFAULT 'info'
                  CHECK (severity IN ('info','warn','error','critical')),
  source_id       uuid        NULL REFERENCES public.ingest_sources(source_id) ON DELETE SET NULL,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  evidence_ref    bigint      NULL  -- optional back-pointer into evidence.id
);

COMMENT ON TABLE public.anomalies IS
  'Append-only log of detected inconsistencies in the evidence stream. Canonical per shared/ARCHITECTURE.md.';

-- Indexes kept minimal: entity lookup + time-ordered scan is the common access
-- pattern. Add GIN on details only if we start querying jsonb keys.
CREATE INDEX IF NOT EXISTS anomalies_entity_id_idx
  ON public.anomalies(entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS anomalies_detected_at_idx
  ON public.anomalies(detected_at DESC);

CREATE INDEX IF NOT EXISTS anomalies_source_id_idx
  ON public.anomalies(source_id)
  WHERE source_id IS NOT NULL;

-- RLS — public read, writes via service role / RPC only.
ALTER TABLE public.anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY anomalies_public_read
  ON public.anomalies
  FOR SELECT
  TO public
  USING (true);
