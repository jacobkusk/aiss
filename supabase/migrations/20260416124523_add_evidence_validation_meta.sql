-- Adds `validation_meta jsonb` to `evidence` per shared/ARCHITECTURE.md.
-- Purpose: attach per-flush validation attestation (e.g. which checks ran,
-- corroboration counts, anomaly refs) directly on the evidence row without
-- breaking the hash chain (pts + prev_hash + hash are unchanged).
--
-- Additive only. Default `{}` so existing rows are valid. No GIN index yet
-- — add one when we actually query on a jsonb key.

ALTER TABLE public.evidence
  ADD COLUMN IF NOT EXISTS validation_meta jsonb
    NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.evidence.validation_meta IS
  'Optional per-flush validation attestation (checks run, corroboration count, anomaly refs). Does not participate in hash chain.';
