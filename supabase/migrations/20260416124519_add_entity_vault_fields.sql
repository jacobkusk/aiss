-- Adds the vault / visibility fields to `entities` per shared/ARCHITECTURE.md.
-- Purpose: every entity can be public (default, same as today) or private
-- (client-encrypted, owner-only), and can opt into `permanent` retention so
-- it survives normal retention policies. Defaults keep ALL existing rows
-- behaving exactly as before — no consumer changes required.
--
-- owner_id is intentionally NOT a foreign key to auth.users today: we have
-- no auth-backed owners yet, and adding the FK later is cheaper than ripping
-- one out. We DO add an index now so the advisor does not flag it as an
-- unindexed FK-in-waiting when the FK eventually arrives.

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS visibility text
    NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public','private'));

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS owner_id uuid NULL;

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS retention text
    NOT NULL DEFAULT 'standard'
    CHECK (retention IN ('standard','permanent'));

CREATE INDEX IF NOT EXISTS entities_owner_id_idx
  ON public.entities(owner_id)
  WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS entities_visibility_idx
  ON public.entities(visibility)
  WHERE visibility <> 'public';

COMMENT ON COLUMN public.entities.visibility IS
  'public (default) = readable by anon. private = owner-only, payload client-encrypted.';
COMMENT ON COLUMN public.entities.owner_id IS
  'Nullable owner uuid. FK to auth.users is deferred until auth is wired.';
COMMENT ON COLUMN public.entities.retention IS
  'standard = normal retention rules apply. permanent = never auto-deleted.';
