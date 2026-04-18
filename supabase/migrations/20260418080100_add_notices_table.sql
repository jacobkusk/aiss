-- Plotter P0 delta, step 2/8 — Notices to Mariners.
--
-- Stores official navigation notices from all coastal states: EfS (DK),
-- UFS (SE), Etterretninger (NO), Tiedonantoja (FI), NMs (UK), NfS (DE),
-- BaZ (NL), AN (IT), GAN (FR), Avisos (ES), Oglasi (HR), HHS (GR), LNM (US).
--
-- SOLAS Capitel V requires coastal states to publish these freely online.
-- The UFS-ingestion-pipeline (shared/PLOTTER.md §"Strategisk model") parses
-- them with Claude Haiku and updates `features` — this table is the raw store
-- that makes that pipeline auditable (we keep every notice, every change,
-- so the chart can be re-derived from scratch at any time).
--
-- Extended v1.1 UFS-ingestion-prep fields (locked 2026-04-18):
--   source_country        — ISO 3166-1 alpha-2, required for multi-country roll-up
--   source_issue_number   — upstream issue pointer (e.g. "UFS 15/2026 nr 237")
--   parsed_changes_json   — structured change list from LLM parser
--   safety_critical_flag  — needs manual review before auto-applying to features
--   verification_status   — pending|auto_applied|manual_review|rejected
--
-- Additive only.

CREATE TABLE IF NOT EXISTS public.notices (
  notice_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  authority       text        NOT NULL,
  -- 'dma'   Danish Maritime Authority (EfS)
  -- 'sma'   Swedish Maritime Admin (UFS)
  -- 'kyst'  Norwegian Coastal Admin (Etterretninger)
  -- 'traf'  Finnish Traficom (Tiedonantoja)
  -- 'ukho'  UK Hydrographic Office (NMs)
  -- 'bsh'   German BSH (NfS)
  -- 'rws'   Dutch Rijkswaterstaat (BaZ)
  -- 'iim'   Italian Istituto Idrografico (AN)
  -- 'shom'  French SHOM (GAN)
  -- 'ihm'   Spanish IHM (Avisos)
  -- 'phhi'  Croatian HHI (Oglasi)
  -- 'hnhs'  Greek HNHS
  -- 'noaa'  US NOAA (LNM)

  source_country  text        NOT NULL
    CHECK (source_country ~ '^[A-Z]{2}$'),
  -- ISO 3166-1 alpha-2. Redundant with authority but cheap to filter on.

  notice_number   text        NULL,          -- e.g. 'EfS 2026/15-237'
  source_issue_number text    NULL,          -- upstream issue pointer for dedupe
  source_url      text        NULL,          -- link back to original PDF/HTML

  published_at    date        NOT NULL,
  effective_from  timestamptz NOT NULL,
  effective_until timestamptz NULL,          -- NULL = permanent change

  notice_type     text        NOT NULL
    CHECK (notice_type IN (
      'buoy_moved','buoy_added','buoy_removed',
      'light_changed','light_extinguished','light_new',
      'new_wreck','wreck_removed','new_obstruction','obstruction_removed',
      'dredging','temporary_restriction','temporary_closure',
      'chart_correction','sector_changed','cable_laying','pipeline_work',
      'depth_changed','firing_exercise','diver_operations',
      'other'
    )),

  geom            geometry(Geometry, 4326) NULL,
  -- Not every notice has geometry (e.g. regional firing-exercise notices).

  affected_features uuid[]    NOT NULL DEFAULT ARRAY[]::uuid[],
  -- FK-style array into `features`. Not a real FK because arrays can't FK,
  -- but referential cleanup is handled by the v1.1 ntm-parser.

  summary         text        NOT NULL,              -- short human-readable
  raw_text        text        NULL,                  -- original NtM text
  raw_language    text        NULL,                  -- BCP-47 language tag of raw_text

  parsed_by       text        NULL,
  -- 'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'manual'
  parsed_at       timestamptz NULL,
  confidence      real        NOT NULL DEFAULT 1.0
    CHECK (confidence BETWEEN 0 AND 1),

  parsed_changes_json jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- Structured change-list from LLM parser. Schema:
  -- [{type, target_feature_id|target_ref, field, from, to,
  --   effective_date, safety_critical}]
  -- Empty array = not yet parsed / no structured changes.

  safety_critical_flag boolean NOT NULL DEFAULT false,
  -- TRUE = parser flagged this as safety-critical → requires manual review
  -- before auto-apply to `features`.

  verification_status text    NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN (
      'pending',        -- fresh, not yet reviewed
      'auto_applied',   -- low-risk, LLM-parsed, applied automatically
      'manual_review',  -- safety_critical, waiting on human
      'approved',       -- human-approved, applied to features
      'rejected'        -- human-rejected, not applied
    )),

  applied         boolean     NOT NULL DEFAULT false,
  applied_at      timestamptz NULL,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- A single upstream issue should not produce duplicate rows if re-ingested.
-- Partial unique index so free-form/manual notices without a structured
-- source_issue_number are still allowed. Covers the ntm-parser dedupe path.
CREATE UNIQUE INDEX IF NOT EXISTS notices_authority_issue_uniq
  ON public.notices (authority, source_issue_number)
  WHERE source_issue_number IS NOT NULL;

COMMENT ON TABLE  public.notices IS
  'Notices to Mariners from all coastal states. Raw store + LLM-parsed changes. Drives v1.1 UFS-ingestion-pipeline per shared/PLOTTER.md §"Strategisk model".';
COMMENT ON COLUMN public.notices.parsed_changes_json IS
  'Structured LLM output: array of {type, target_feature_id?, target_ref?, field, from, to, effective_date, safety_critical}.';
COMMENT ON COLUMN public.notices.safety_critical_flag IS
  'TRUE if any parsed change is safety-critical (new hazard, removed aid, depth decrease). Forces manual review before auto-apply.';

CREATE INDEX IF NOT EXISTS notices_geom_idx
  ON public.notices USING GIST (geom);

CREATE INDEX IF NOT EXISTS notices_authority_idx
  ON public.notices (authority, published_at DESC);

CREATE INDEX IF NOT EXISTS notices_country_idx
  ON public.notices (source_country, published_at DESC);

CREATE INDEX IF NOT EXISTS notices_effective_idx
  ON public.notices (effective_from DESC);

CREATE INDEX IF NOT EXISTS notices_unapplied_idx
  ON public.notices (applied, safety_critical_flag)
  WHERE applied = false;

CREATE INDEX IF NOT EXISTS notices_verification_idx
  ON public.notices (verification_status)
  WHERE verification_status IN ('pending','manual_review');

CREATE INDEX IF NOT EXISTS notices_affected_features_idx
  ON public.notices USING GIN (affected_features);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_notices_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notices_set_updated_at ON public.notices;
CREATE TRIGGER notices_set_updated_at
  BEFORE UPDATE ON public.notices
  FOR EACH ROW EXECUTE FUNCTION public.tg_notices_set_updated_at();

-- RLS — notices are public record (SOLAS Capitel V), writes via service role.
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY notices_public_read
  ON public.notices
  FOR SELECT
  TO public
  USING (true);
