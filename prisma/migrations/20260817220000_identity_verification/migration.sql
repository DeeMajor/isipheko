-- Identity verification (M3-01, architecture §7).
--
-- Nothing in this product could be verified until now. `canPublish` carries no
-- verification clause and `canShare` refuses everybody, both deliberately —
-- a check against a status nothing ever sets is a gate that always passes
-- (M1-07 §5, M2-09 §8). These two tables are what finally sets it.
--
-- Two tables rather than one, and the split is the guarantee:
--
--   * `identity_consents` is **insert-only**. It gets no UPDATE and no DELETE,
--     like `ledger_entries` and `audit_log`, so a consent cannot be back-dated
--     or reworded afterwards by the code that wrote it.
--   * `identity_verifications` needs UPDATE, because a pending check becomes a
--     verified or failed one. It carries a NOT NULL foreign key to a consent,
--     so "consent before any check" is a property of the schema rather than an
--     ordering somebody has to remember in application code.
--
-- **Neither table holds an ID number in plaintext, and neither holds an image.**
-- What an attempt carries is `SHA256(number + pepper)` with the pepper outside
-- the database (§7.3); the plaintext exists for the length of one provider call
-- and nowhere else. There is no column a photograph could go in, which is how
-- "never persisted" is kept.
--
-- The hash is on the attempt rather than only on the organiser because the
-- answer arrives **later, on a poll, with the plaintext long gone** — and it is
-- promoted to `organisers.id_number_hash` only when a check passes. Writing it
-- to the organiser at the start instead would let a mistyped digit park somebody
-- else's identity against this account until the check came back, and the real
-- owner would be refused for as long as it sat there.

-- ===========================================================================
-- 1. identity_consents — the lawful basis, timestamped
-- ===========================================================================
--
-- POPIA s11 requires a lawful basis and consent is the practical one here. A
-- record saying only *that* somebody consented does not answer *to what*, and
-- the wording will change — so the copy key, its version and a hash of the exact
-- text on screen are all stored. The words themselves live in src/copy/verify.ts
-- and are in the repository's history.

CREATE TABLE "identity_consents" (
  "id"              TEXT NOT NULL,
  "organiser_id"    TEXT NOT NULL,

  "copy_key"        TEXT NOT NULL,
  "copy_version"    TEXT NOT NULL,
  "copy_hash"       TEXT NOT NULL,

  -- Hashed wherever they appear (CLAUDE.md rule 8).
  "ip_hash"         TEXT,
  "user_agent_hash" TEXT,

  "consented_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "identity_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "identity_consents_organiser_id_consented_at_idx"
  ON "identity_consents" ("organiser_id", "consented_at");

ALTER TABLE "identity_consents"
  ADD CONSTRAINT "identity_consents_organiser_id_fkey"
  FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 2. identity_verifications — one attempt
-- ===========================================================================

CREATE TYPE "identity_check_status" AS ENUM ('pending', 'verified', 'failed');

CREATE TABLE "identity_verifications" (
  "id"                 TEXT NOT NULL,
  "organiser_id"       TEXT NOT NULL,
  "consent_id"         TEXT NOT NULL,

  "provider"           TEXT NOT NULL,
  -- The vendor's opaque handle. Never an ID number, never a person.
  "provider_reference" TEXT,

  -- SHA-256 of the number with a pepper held outside the database. Not unique
  -- here: two attempts on the same number are two attempts, and the uniqueness
  -- that matters — one identity, one account — belongs to
  -- `organisers.id_number_hash`, which this is promoted into on success.
  "id_number_hash"     TEXT,

  "status"             "identity_check_status" NOT NULL DEFAULT 'pending',
  -- A code, never a provider's prose: a vendor's message routinely quotes the
  -- value it was given, and this column is read in logs (rule 8). Same posture
  -- as notifications.last_error_code.
  "failure_reason"     TEXT,

  -- Booleans and nulls only — what was checked, and what matched.
  "checks"             JSONB,

  -- The floor between two provider calls, whoever is asking. The pending page
  -- reloads itself; two tabs open on it must not double somebody's bill.
  "last_polled_at"     TIMESTAMP(3),

  "started_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"       TIMESTAMP(3),

  CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- A terminal check has an answer and a time; a pending one has neither. Without
-- this a row could sit "verified" with no completion time and the page would
-- have nothing to put on the badge but the word.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_terminal_is_complete"
  CHECK (
    ("status" = 'pending'  AND "completed_at" IS NULL AND "failure_reason" IS NULL)
    OR ("status" = 'verified' AND "completed_at" IS NOT NULL AND "failure_reason" IS NULL)
    OR ("status" = 'failed'   AND "completed_at" IS NOT NULL AND "failure_reason" IS NOT NULL)
  );

CREATE INDEX "identity_verifications_organiser_id_started_at_idx"
  ON "identity_verifications" ("organiser_id", "started_at");

ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_organiser_id_fkey"
  FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT rather than CASCADE: deleting a consent that a check relies on would
-- leave a verified organiser with no record of what they agreed to.
ALTER TABLE "identity_verifications"
  ADD CONSTRAINT "identity_verifications_consent_id_fkey"
  FOREIGN KEY ("consent_id") REFERENCES "identity_consents"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- 3. Grants
-- ===========================================================================
--
-- M1-02's default privileges give a new table SELECT and INSERT only, which is
-- exactly right for `identity_consents` and is why no grant for it appears here.
-- That absence is the mechanism, in the same way `ledger_entries` and
-- `audit_log` are absent from the mutable list in
-- 20260807235900_constraints_and_grants.
--
-- `identity_verifications` gets UPDATE and nothing more: a pending check has to
-- be able to become a verified or failed one, and a completed check is evidence
-- with a retention period (§7.3), so nothing here may delete it.

GRANT UPDATE ON "identity_verifications" TO "isipheko_app";

-- Belt and braces, and the line a reviewer will look for.
REVOKE UPDATE, DELETE, TRUNCATE ON "identity_consents" FROM "isipheko_app";
REVOKE DELETE, TRUNCATE ON "identity_verifications" FROM "isipheko_app";
