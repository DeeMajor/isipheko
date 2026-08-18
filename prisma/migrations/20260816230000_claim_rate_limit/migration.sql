-- The per-address limit on claiming, and what an abuse review works from.
--
-- `POST /api/claim` needs no session: anybody holding the event link can claim,
-- and the link is the capability (M2-04). That is the product, but it means the
-- endpoint is open, and a stranger quietly holding every chair on a funeral is
-- a real harm even though no money moves.
--
-- Hashed, never in the clear (CLAUDE.md rule 8). Same caveat as M1-06 §5: the
-- address is only as trustworthy as the proxy in front of it, so this is a
-- speed bump outside Cloudflare rather than a control.

ALTER TABLE "need_claims" ADD COLUMN "claimed_ip_hash" TEXT;

CREATE INDEX "need_claims_claimed_ip_hash_created_at_idx"
  ON "need_claims" ("claimed_ip_hash", "created_at");
