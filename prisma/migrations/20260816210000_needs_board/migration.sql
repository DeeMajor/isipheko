-- The needs board: quantities that mean something, and claims that cannot
-- over-reserve. Implementation plan M2-03.
--
-- Hand-written and verified with `prisma migrate deploy` plus
-- `prisma migrate diff` (docs/decisions.md M1-06 §9).

-- ===========================================================================
-- 1. Suggested items.
-- ===========================================================================
--
-- A contributor can suggest something the family forgot — and a contributor has
-- no account, so all we hold is the name they gave (CLAUDE.md rule 4).
--
-- Three states rather than a boolean: an organiser working down a list needs to
-- know what they have already declined, otherwise the same suggestion comes
-- back at them every time they open the page.

CREATE TYPE "need_item_status" AS ENUM ('active', 'suggested', 'declined');

ALTER TABLE "need_items"
  ADD COLUMN "status" "need_item_status" NOT NULL DEFAULT 'active';

ALTER TABLE "need_items" ADD COLUMN "suggested_by_name" TEXT;

CREATE INDEX "need_items_event_id_status_idx" ON "need_items" ("event_id", "status");

-- ===========================================================================
-- 2. The constraint that makes over-claiming impossible.
-- ===========================================================================
--
-- Claiming is a conditional UPDATE — `SET quantity_claimed = quantity_claimed +
-- :q WHERE quantity_claimed + :q <= quantity_required` — which is atomic on its
-- own: two people tapping "I'll bring the last chair" at the same moment cannot
-- both affect a row (CLAUDE.md rule 5).
--
-- This CHECK is the backstop, in the same posture as the ledger's unique index
-- beside its advisory lock. The mechanism can be wrong — a future query that
-- forgets the WHERE, a decrement that runs twice — and the thing that catches
-- it should be Postgres rather than a reviewer. An over-claimed item means two
-- families arrive with one tent.

ALTER TABLE "need_items"
  ADD CONSTRAINT "need_items_quantity_required_is_at_least_one"
  CHECK ("quantity_required" >= 1);

ALTER TABLE "need_items"
  ADD CONSTRAINT "need_items_quantity_claimed_is_not_negative"
  CHECK ("quantity_claimed" >= 0);

ALTER TABLE "need_items"
  ADD CONSTRAINT "need_items_quantity_claimed_within_required"
  CHECK ("quantity_claimed" <= "quantity_required");

-- A claim of nothing is not a claim. Without this it would sit in the list
-- looking like somebody had taken something, and the chairs would appear taken
-- for no reason anybody could find.
ALTER TABLE "need_claims"
  ADD CONSTRAINT "need_claims_quantity_is_at_least_one"
  CHECK ("quantity" >= 1);

-- ===========================================================================
-- 3. The sweep.
-- ===========================================================================
--
-- scripts/expire-claims.ts reads claims that are still `claimed` and past their
-- expiry. Claiming also expires lapsed claims on the item it is about to touch,
-- so a claim that lapsed an hour ago never blocks somebody now — but the sweep
-- is what keeps the public board honest between attempts.

CREATE INDEX "need_claims_status_expires_at_idx"
  ON "need_claims" ("status", "expires_at");
