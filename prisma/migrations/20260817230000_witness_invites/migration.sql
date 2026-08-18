-- Abakhaphi accept and decline (M3-03).
--
-- M1-07 collected witnesses at setup and wrote them `invited` with nothing
-- sent, because no SMS or WhatsApp provider exists and still does not. What was
-- missing was any way for the person to answer. This adds it.
--
-- **The invite is a capability in a URL**, for the reason M2-11 §1 records for
-- the handover link: it has to reach a phone we have never seen, and no cookie
-- travels there. An umkhaphi has no account and will never have one (rule 4) —
-- asking somebody to sign in to answer one question would be an account to say
-- one word.
--
-- What bounds it: scoped to one witness on one event, expiring, revealing
-- nothing the public page does not, and moving no money.
--
-- **The token is on the row rather than in a table of its own**, unlike
-- `handover_tokens`. A collection has many handover links across two kinds and
-- several members; a witness has exactly one live invite, so a hash on the row
-- says the same thing without a join. Issuing again replaces it — two live
-- links for one person is a capability nobody is tracking (M2-11 §7).

ALTER TABLE "witnesses" ADD COLUMN "declined_at" TIMESTAMP(3);
ALTER TABLE "witnesses" ADD COLUMN "invite_token_hash" TEXT;
ALTER TABLE "witnesses" ADD COLUMN "invite_expires_at" TIMESTAMP(3);

-- The token is never stored; this is its SHA-256, so a dump yields no usable
-- link. Unique because a collision would mean one link answering for two
-- people, and the index is also how a tapped link finds its row.
CREATE UNIQUE INDEX "witnesses_invite_token_hash_key"
  ON "witnesses" ("invite_token_hash");

-- A live invite has both halves or neither. A hash with no expiry is a link
-- that never dies; an expiry with no hash is a row describing a link nobody
-- holds.
ALTER TABLE "witnesses"
  ADD CONSTRAINT "witnesses_invite_is_whole"
  CHECK (
    ("invite_token_hash" IS NULL AND "invite_expires_at" IS NULL)
    OR ("invite_token_hash" IS NOT NULL AND "invite_expires_at" IS NOT NULL)
  );

-- The answer and its time agree, in both directions. Without this a row could
-- say `accepted` with no time on it, and the page would carry a name it could
-- not say when anybody agreed to.
ALTER TABLE "witnesses"
  ADD CONSTRAINT "witnesses_answer_is_timed"
  CHECK (
    ("status" = 'invited' AND "accepted_at" IS NULL AND "declined_at" IS NULL)
    OR ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "declined_at" IS NULL)
    OR ("status" = 'declined' AND "declined_at" IS NOT NULL AND "accepted_at" IS NULL)
  );

-- No grant here on purpose: `witnesses` already holds UPDATE and DELETE from
-- M1-02's named list, which is what answering an invite and removing somebody
-- from the list both need.
