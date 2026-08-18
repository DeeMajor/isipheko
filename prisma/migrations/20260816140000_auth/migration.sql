-- Organiser authentication: one-time codes and revocable sessions.
--
-- Written by hand, like 20260807235900. `prisma migrate dev` cannot run against
-- this schema: it applies every migration to a shadow database first, and the
-- `REVOKE ALL ON "_prisma_migrations"` in that migration fails there, because
-- the shadow database has no such table. The migration is applied and cannot be
-- edited, so hand-written SQL verified by `prisma migrate deploy` is the
-- workflow for this repository. See docs/decisions.md M1-06.
--
-- Neither table appears in architecture §4.2 — it never covered auth.

-- ===========================================================================
-- 1. The organiser's name arrives at setup, not at sign-in.
-- ===========================================================================
--
-- The record is created by the first successful verification, when all we hold
-- is a phone number. Asking for a name on the sign-in form would mean asking
-- only for numbers we do not recognise, which answers "is this number
-- registered?" for anybody who cares to check.

ALTER TABLE "organisers" ALTER COLUMN "display_name" DROP NOT NULL;

-- ===========================================================================
-- 2. One-time codes.
-- ===========================================================================
--
-- `code_hash` is HMAC-SHA256 under a pepper held outside the database. A
-- six-digit code is a 10^6 space: a plain hash of one is a lookup table, not a
-- secret. The code itself is never stored, logged or returned.
--
-- Rows survive their use. They are how the rate limit is counted, and how an
-- attempt against a number nobody owns stays visible afterwards.

CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    -- Deliberately not a foreign key: a code can be requested for a number with
    -- no organiser, and the response must not differ either way.
    "phone_e164" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "requested_ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "otp_challenges_phone_e164_created_at_idx"
  ON "otp_challenges" ("phone_e164", "created_at");

CREATE INDEX "otp_challenges_requested_ip_hash_created_at_idx"
  ON "otp_challenges" ("requested_ip_hash", "created_at");

ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_attempts_is_not_negative"
  CHECK ("attempts" >= 0);

-- ===========================================================================
-- 3. Sessions.
-- ===========================================================================
--
-- A table rather than a JWT, because architecture §10 requires payout approval
-- to re-authenticate regardless of session age, and a stolen phone needs "sign
-- out everywhere". Neither is possible against a token that cannot be withdrawn
-- before it expires.
--
-- `token_hash` is SHA-256 of the cookie value; the cookie is 32 random bytes
-- and is never stored. A database dump yields no working session.

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "organiser_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    -- When the person last proved they hold the phone. Payout approval reads
    -- this, not created_at.
    "authenticated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" ("token_hash");

CREATE INDEX "sessions_organiser_id_idx" ON "sessions" ("organiser_id");

CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_organiser_id_fkey"
  FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 4. Privileges.
-- ===========================================================================
--
-- Both tables inherit SELECT and INSERT from the default privileges set in
-- 20260807235900. UPDATE and DELETE are granted here, by name — which is the
-- point of that default: a new table arrives append-only and stays that way
-- until a migration says otherwise in a line a reviewer can see.
--
-- Both need UPDATE: a challenge counts its attempts and marks itself consumed,
-- a session is revoked and touched on use. Neither needs DELETE from the
-- application — expiry is a timestamp, not a deletion, and rows are evidence.
-- Retention pruning is the owner's job on a schedule (POPIA §11).

GRANT UPDATE ON "otp_challenges", "sessions" TO "isipheko_app";
