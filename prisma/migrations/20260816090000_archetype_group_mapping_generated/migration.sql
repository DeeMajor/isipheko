-- GENERATED FILE — DO NOT EDIT.
--
-- Written by scripts/archetype-constraint.ts from the archetype config in
-- src/domain/archetype/archetypes.ts. Edit the config, run `pnpm archetype:sql`,
-- commit the result. A unit test fails if this file and the config disagree.
--
-- Why generated: `archetype_group` is denormalised because a CHECK constraint
-- cannot perform a lookup, and CLAUDE.md rule 1 — no target on a bereavement
-- event — has to be enforceable in pure SQL. A denormalised column allowed to
-- disagree with its source is worse than no column: it would let an event claim
-- to be a wedding while carrying the funeral group, or the reverse, which hands
-- a bereaved family a progress bar.
--
-- M1-02 wrote this mapping by hand and M1-04 would have written it by hand a
-- second time. Generation removes the second copy rather than testing that the
-- two copies agree (docs/decisions.md M1-02 §12).
--
-- The constraints below replace the identically-named ones added by
-- 20260807235900_constraints_and_grants. That migration has been applied and
-- cannot be edited — Prisma checksums it — so the replacement is a new
-- migration. It is a no-op today by construction: the generated mapping is the
-- same mapping. From here it is generated, and that is the point.

ALTER TABLE "events"
  DROP CONSTRAINT IF EXISTS "events_archetype_matches_group";

ALTER TABLE "events"
  ADD CONSTRAINT "events_archetype_matches_group"
  CHECK ("archetype_group" = CASE "archetype"
    WHEN 'umshado'    THEN 'union'::"archetype_group"
    WHEN 'umembeso'   THEN 'union'::"archetype_group"
    WHEN 'umngcwabo'  THEN 'bereavement'::"archetype_group"
    WHEN 'umbuyiso'   THEN 'remembrance'::"archetype_group"
    WHEN 'imbeleko'   THEN 'arrival'::"archetype_group"
    WHEN 'graduation' THEN 'achievement'::"archetype_group"
    WHEN 'itiye'      THEN 'gathering'::"archetype_group"
  END);

ALTER TABLE "collections"
  DROP CONSTRAINT IF EXISTS "collections_archetype_matches_group";

ALTER TABLE "collections"
  ADD CONSTRAINT "collections_archetype_matches_group"
  CHECK ("occasion_archetype_group" = CASE "occasion_archetype"
    WHEN 'umshado'    THEN 'union'::"archetype_group"
    WHEN 'umembeso'   THEN 'union'::"archetype_group"
    WHEN 'umngcwabo'  THEN 'bereavement'::"archetype_group"
    WHEN 'umbuyiso'   THEN 'remembrance'::"archetype_group"
    WHEN 'imbeleko'   THEN 'arrival'::"archetype_group"
    WHEN 'graduation' THEN 'achievement'::"archetype_group"
    WHEN 'itiye'      THEN 'gathering'::"archetype_group"
  END);
