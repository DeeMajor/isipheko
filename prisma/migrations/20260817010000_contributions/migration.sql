-- Mode A contributions: what a self-report is, and what limits it.
--
-- Hand-written and verified with `prisma migrate deploy` plus
-- `prisma migrate diff` (docs/decisions.md M1-06 §9).

-- ===========================================================================
-- 1. self_reported_at — the difference between "I've paid" and "I looked".
-- ===========================================================================
--
-- The row is created when the contributor reaches the pay step, because that is
-- when a reference code has to exist and a code needs a row to be unique
-- against. Most of those rows are people who opened the screen, saw a number,
-- and went to their banking app — or did not.
--
-- Without this column the organiser's confirmation queue cannot tell somebody
-- who says they paid from somebody who wandered off, and the queue is the
-- screen that most needs to be trustworthy: it is where money is acknowledged.

ALTER TABLE "contributions" ADD COLUMN "self_reported_at" TIMESTAMP(3);

-- ===========================================================================
-- 2. reported_ip_hash — the per-address limit.
-- ===========================================================================
--
-- The contribution flow has no account by design (CLAUDE.md rule 4), so an
-- address and a phone number are the only things there are to count against.
-- Hashed, never stored in the clear (rule 8).
--
-- Same caveat as M1-06 §5 and M2-04: the address is only as trustworthy as the
-- proxy in front of it. Real behind Cloudflare, a speed bump anywhere else.

ALTER TABLE "contributions" ADD COLUMN "reported_ip_hash" TEXT;

CREATE INDEX "contributions_reported_ip_hash_created_at_idx"
  ON "contributions" ("reported_ip_hash", "created_at");

-- Architecture §5.2 rate-limits self-reports per phone as well as per address.
CREATE INDEX "contributions_contributor_phone_e164_created_at_idx"
  ON "contributions" ("contributor_phone_e164", "created_at");
