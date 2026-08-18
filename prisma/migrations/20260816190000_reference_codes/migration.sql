-- Reference codes. Implementation plan Part C.5, architecture §5.2.
--
-- Hand-written and verified with `prisma migrate deploy` plus
-- `prisma migrate diff` — `prisma migrate dev` cannot run against this schema
-- (docs/decisions.md M1-06 §9).

-- ===========================================================================
-- 1. contributions: one column becomes two.
-- ===========================================================================
--
-- Part C.5 stores the reference split — `["MTH", "4K7B2X"]` — so the tag and
-- the code can be styled separately on the pay screen. Nothing has ever been
-- written to `reference_code`, so nothing is lost by replacing it.
--
-- Unique on the **pair**: a banking app's reference field receives the whole
-- string, and that whole string has to reconcile to exactly one contribution.
-- Uniqueness on the code alone would make the tag decorative; uniqueness on
-- neither would make reconciliation a guess.

ALTER TABLE "contributions" DROP COLUMN "reference_code";

ALTER TABLE "contributions" ADD COLUMN "ref_prefix" TEXT;
ALTER TABLE "contributions" ADD COLUMN "ref_code" TEXT;

CREATE UNIQUE INDEX "contributions_ref_prefix_ref_code_key"
  ON "contributions" ("ref_prefix", "ref_code");

-- ===========================================================================
-- 2. events: the code on the trust panel.
-- ===========================================================================
--
-- The public page tells a contributor to type isipheko.co.za/check into the
-- browser themselves and enter this code — never to use a number on the page,
-- because if the page were fake the number would be too (§10). M1-08 shipped
-- the first six characters of the slug as a stopgap with a comment saying this
-- task owns it; this is that.

ALTER TABLE "events" ADD COLUMN "ref_prefix" TEXT;
ALTER TABLE "events" ADD COLUMN "ref_code" TEXT;

-- Backfill, so the columns can be NOT NULL. Derived from the row rather than
-- from random(): a volatile expression in an UPDATE can evaluate once for the
-- whole statement, which would give every existing event the same code and
-- fail the unique index. md5 of the id is deterministic per row, and its hex
-- alphabet (0-9, A-F) is a subset of Crockford's.
--
-- These are development rows. Every event created from here on gets a real
-- code from the generator.
UPDATE "events"
SET
  "ref_prefix" = COALESCE(
    NULLIF(UPPER(SUBSTRING(REGEXP_REPLACE("title", '[^A-Za-z]', '', 'g') FROM 1 FOR 3)), ''),
    'UMC'
  ),
  "ref_code" = UPPER(SUBSTRING(MD5("id") FROM 1 FOR 6))
WHERE "ref_code" IS NULL;

ALTER TABLE "events" ALTER COLUMN "ref_prefix" SET NOT NULL;
ALTER TABLE "events" ALTER COLUMN "ref_code" SET NOT NULL;

CREATE UNIQUE INDEX "events_ref_prefix_ref_code_key"
  ON "events" ("ref_prefix", "ref_code");
