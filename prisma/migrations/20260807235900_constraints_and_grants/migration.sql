-- Constraints and privileges that Prisma cannot express.
--
-- This migration is where three CLAUDE.md rules stop being guidance and become
-- something the database refuses to do:
--
--   rule 1  a bereavement event cannot carry a target
--   rule 3  the ledger is append-only
--   rule 12 a collection has no money path
--
-- Written by hand and not generated. If a future `prisma migrate dev` offers to
-- drop anything below, the answer is no.

-- ===========================================================================
-- 1. Bereavement — no target. CLAUDE.md rule 1.
-- ===========================================================================
--
-- The database layer of the three (database, type system, runtime render
-- guard). It is the only one that still holds when a row is written by a
-- migration, a script, or somebody at a psql prompt at two in the morning.
--
-- Getting this wrong on a real funeral is not recoverable, which is why it is a
-- constraint and not a validation.

ALTER TABLE "events"
  ADD CONSTRAINT "events_bereavement_has_no_target"
  CHECK ("archetype_group" <> 'bereavement' OR "target_amount_cents" IS NULL);

-- ===========================================================================
-- 2. The denormalised group cannot drift from its key.
-- ===========================================================================
--
-- `archetype_group` exists because a CHECK constraint cannot perform a lookup,
-- and rule 1 has to be enforceable in pure SQL. A denormalised column that is
-- allowed to disagree with its source is worse than no column: it would let an
-- event claim to be a wedding while carrying the funeral group, or the reverse
-- — which would hand a bereaved family a progress bar.
--
-- This is the mapping. It is duplicated in the archetype config (M1-04); these
-- two are the same fact and a test asserts they agree.

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

-- ===========================================================================
-- 3. One parent, never two, never none.
-- ===========================================================================
--
-- A contribution belongs to an event or to a collection (Part D2.8). A
-- standalone collection has no event, so `event_id` is nullable — and without
-- this constraint, "nullable" quietly becomes "orphaned".

ALTER TABLE "contributions"
  ADD CONSTRAINT "contributions_belong_to_exactly_one_parent"
  CHECK (num_nonnulls("event_id", "collection_id") = 1);

-- A ledger chain belongs to an event or to a standalone collection. Each has
-- its own sequence starting at 1, so a chain must have exactly one owner or
-- `sequence_no` means nothing.
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_belong_to_exactly_one_chain"
  CHECK (num_nonnulls("event_id", "collection_id") = 1);

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_sequence_starts_at_one"
  CHECK ("sequence_no" >= 1);

-- ===========================================================================
-- 4. Money. CLAUDE.md rule 7 — integer cents, ZAR, never negative.
-- ===========================================================================
--
-- Direction is carried by `direction` on the ledger, not by the sign of the
-- amount. A negative amount_cents would mean the same thing twice and could
-- disagree with itself.

ALTER TABLE "events"
  ADD CONSTRAINT "events_target_is_positive"
  CHECK ("target_amount_cents" IS NULL OR "target_amount_cents" > 0);

ALTER TABLE "contributions"
  ADD CONSTRAINT "contributions_amount_is_not_negative"
  CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0);

ALTER TABLE "collection_members"
  ADD CONSTRAINT "collection_members_amount_is_not_negative"
  CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0);

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_is_not_negative"
  CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0);

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_is_positive"
  CHECK ("amount_cents" > 0);

-- A cash contribution without an amount is not a contribution.
ALTER TABLE "contributions"
  ADD CONSTRAINT "contributions_cash_has_an_amount"
  CHECK ("type" <> 'cash' OR "amount_cents" IS NOT NULL);

-- ===========================================================================
-- 5. At most one active bank account per organiser.
-- ===========================================================================
--
-- Architecture §4.2 puts a `bank_account_id` on `organisers` for this. A partial
-- unique index gives the same guarantee without a circular foreign key between
-- the two tables.

CREATE UNIQUE INDEX "bank_accounts_one_active_per_organiser"
  ON "bank_accounts" ("organiser_id")
  WHERE "status" = 'active';

-- ===========================================================================
-- 6. Privileges.
-- ===========================================================================
--
-- Everything to this point runs as isipheko_owner, which owns every table.
-- isipheko_app is what the application connects as.
--
-- The default is SELECT and INSERT. UPDATE and DELETE are granted per table,
-- explicitly, below.
--
-- That ordering is deliberate and is the point of the whole section. Granting
-- everything and then revoking from the ledger would leave the guarantee
-- depending on somebody remembering to revoke again, every time a table is
-- added. Here, a new table arrives append-only and stays that way until a
-- migration says otherwise in a line a reviewer can see.

GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA "public" TO "isipheko_app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "isipheko_app";

-- The same posture for anything created later. This is the part that rots if it
-- is left out: without it, a table created by a future migration inherits
-- nothing, somebody fixes it with a blanket GRANT ALL, and the ledger guarantee
-- quietly dies in a migration nobody read closely.
ALTER DEFAULT PRIVILEGES FOR ROLE "isipheko_owner" IN SCHEMA "public"
  GRANT SELECT, INSERT ON TABLES TO "isipheko_app";
ALTER DEFAULT PRIVILEGES FOR ROLE "isipheko_owner" IN SCHEMA "public"
  GRANT USAGE, SELECT ON SEQUENCES TO "isipheko_app";

-- Mutable tables, named one at a time.
--
-- `ledger_entries` and `audit_log` are absent from this list, and that absence
-- is the entire mechanism. Both are append-only; corrections to the ledger are
-- new `reversal` entries (CLAUDE.md rule 3).
GRANT UPDATE, DELETE ON
  "organisers",
  "bank_accounts",
  "events",
  "need_items",
  "need_claims",
  "witnesses",
  "contributions",
  "collections",
  "collection_members",
  "payouts"
  TO "isipheko_app";

-- Belt and braces. If a later blanket grant ever does land in this schema, these
-- two statements are what a reviewer will look for, and they will still be here.
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entries" FROM "isipheko_app";
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM "isipheko_app";

-- Migration history is the owner's business. The application has no reason to
-- read it and no business writing it.
REVOKE ALL ON "_prisma_migrations" FROM "isipheko_app";
