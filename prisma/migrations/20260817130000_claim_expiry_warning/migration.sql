-- The 48-hour claim warning (M2-08, architecture §8.2).
--
-- A claim expiring in two days gets one message to the person holding it. The
-- marker is a column rather than a lookup against `notifications`, because the
-- sweep runs every hour and "have we already told them" has to be answerable
-- without reading the outbox — and because the outbox is pruned on a retention
-- schedule, which would make a pruned row read as "never warned" and send the
-- same message again.

ALTER TABLE "need_claims" ADD COLUMN "expiry_warned_at" TIMESTAMP(3);

-- The sweep reads exactly this: claims still held, expiring soon, not warned.
CREATE INDEX "need_claims_status_expires_at_expiry_warned_at_idx"
  ON "need_claims" ("status", "expires_at", "expiry_warned_at");
