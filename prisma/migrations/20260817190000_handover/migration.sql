-- The handover (M2-11, Part D2.4).
--
-- **The host does nothing in the system** (CLAUDE.md rule 15), so confirmation
-- cannot depend on them: one of the contributors who is standing there taps
-- once, on their own phone, and the record closes with their name against it.
--
-- Two things are needed for that, and this migration is both.

-- ===========================================================================
-- 1. Who confirmed it, as a fact rather than a string
-- ===========================================================================
--
-- `handover_confirmed_by` is free text and stays for display. It cannot say
-- *verifiably* who confirmed a handover — only what somebody typed — and the
-- incwadi's "witnessed by Thandi Ngcobo" is a claim the family keeps for years.
--
-- NULL is exactly the organiser-marked case: she closed it on her own word, and
-- the record says so.

ALTER TABLE "collections" ADD COLUMN "handover_confirmed_member_id" TEXT;

ALTER TABLE "collections"
  ADD CONSTRAINT "collections_handover_confirmed_member_id_fkey"
  FOREIGN KEY ("handover_confirmed_member_id") REFERENCES "collection_members"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- 2. handover_tokens — a capability that travels to somebody else's phone
-- ===========================================================================
--
-- **This puts a capability in a URL, which docs/decisions.md M2-04 §3 refused
-- for undo.** That refusal was right there and is right here for a different
-- answer: undo is a fifteen-second capability on a page the person is already
-- looking at, so an HttpOnly cookie works. A witness link has to reach a
-- different person's phone, and no cookie can travel.
--
-- What limits it instead:
--
--   * single use — `redeemed_at` is set in the same conditional UPDATE that
--     spends it, so a forwarded link confirms nothing twice;
--   * expiring — a link that outlives the umcimbi is a link nobody meant;
--   * scoped to one collection and one member;
--   * it confirms a handover and does nothing else. No money moves (rule 12),
--     and it exposes nothing the collection page does not already show.
--
-- The token itself is never stored. SHA-256 of 32 random bytes, like sessions
-- (M1-06): a database dump yields no usable link.

CREATE TYPE "handover_token_kind" AS ENUM ('witness', 'host');

CREATE TABLE "handover_tokens" (
  "id"            TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "kind"          "handover_token_kind" NOT NULL,

  -- The member who was asked to witness it. NULL for a host acknowledgement,
  -- which is optional and belongs to nobody in the group.
  "member_id"     TEXT,

  "token_hash"    TEXT NOT NULL,
  "expires_at"    TIMESTAMP(3) NOT NULL,
  "redeemed_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "handover_tokens_pkey" PRIMARY KEY ("id")
);

-- A witness token names the person who will be there; a host token does not.
ALTER TABLE "handover_tokens"
  ADD CONSTRAINT "handover_tokens_witness_names_a_member"
  CHECK (
    ("kind" = 'witness' AND "member_id" IS NOT NULL)
    OR ("kind" = 'host' AND "member_id" IS NULL)
  );

CREATE UNIQUE INDEX "handover_tokens_token_hash_key"
  ON "handover_tokens" ("token_hash");

CREATE INDEX "handover_tokens_collection_id_kind_idx"
  ON "handover_tokens" ("collection_id", "kind");

ALTER TABLE "handover_tokens"
  ADD CONSTRAINT "handover_tokens_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "handover_tokens"
  ADD CONSTRAINT "handover_tokens_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "collection_members"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 3. Grants
-- ===========================================================================
--
-- M1-02's default privileges give a new table SELECT and INSERT only. Redeeming
-- a token is an UPDATE, and expired ones are pruned like notifications are
-- (M2-08 §10) — they hold no evidence once spent, and an unspent one is a live
-- capability that should not outlive its window.

GRANT UPDATE, DELETE ON "handover_tokens" TO "isipheko_app";
