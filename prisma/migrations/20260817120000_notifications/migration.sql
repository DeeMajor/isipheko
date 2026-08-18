-- Notifications (M2-08): the outbox, and the facts waiting to be summarised.
--
-- Hand-written and verified with `prisma migrate deploy` plus
-- `prisma migrate diff` (docs/decisions.md M1-06 §9).
--
-- Two tables rather than one, and the distinction is not cosmetic:
--
--   `notifications`  — a message we intend to send.
--   `digest_entries` — a thing that happened, waiting for a summary.
--
-- A single table with a mode column would be one row type pretending to be two,
-- and every query on it would immediately need to say which kind it meant.
--
-- **No queue, and that is deliberate.** Architecture §3 lists Redis + BullMQ;
-- neither is installed, and M1-06 §4 already declined to add Redis for rate
-- limiting on the same reasoning. What a digest needs is state that survives a
-- restart and a row two writers can race for, both of which Postgres gives
-- transactionally. BullMQ can replace `scripts/notify.ts` later without
-- touching either table — that is the property that makes this reversible.

-- ===========================================================================
-- 1. Enums
-- ===========================================================================

CREATE TYPE "notification_channel" AS ENUM ('whatsapp', 'sms', 'email');
CREATE TYPE "notification_status" AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE "notification_kind" AS ENUM (
  'organiser_digest',
  'contribution_confirmed',
  'claim_confirmed',
  'claim_expiring'
);
CREATE TYPE "digest_entry_kind" AS ENUM (
  'contribution_self_reported',
  'contribution_confirmed',
  'need_claimed'
);

-- ===========================================================================
-- 2. notifications — the outbox
-- ===========================================================================
--
-- `params` holds the template's named parameters and never a rendered body.
-- The parameters are what goes to Meta, and prose in this column would be a
-- second copy of src/copy/ living in the database, drifting from the first.

CREATE TABLE "notifications" (
  "id"              TEXT NOT NULL,
  "kind"            "notification_kind" NOT NULL,
  "channel"         "notification_channel" NOT NULL,
  "status"          "notification_status" NOT NULL DEFAULT 'pending',
  "template_id"     TEXT NOT NULL,
  "params"          JSONB NOT NULL,
  "to_phone_e164"   TEXT,
  "to_email"        TEXT,
  "organiser_id"    TEXT,
  "event_id"        TEXT,
  "scheduled_for"   TIMESTAMP(3) NOT NULL,
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "sent_at"         TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- A message with no address is a message that cannot be sent, and it would sit
-- in the outbox failing forever. Refuse it at the boundary instead.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_have_a_recipient"
  CHECK (
    ("channel" = 'email' AND "to_email" IS NOT NULL)
    OR ("channel" <> 'email' AND "to_phone_e164" IS NOT NULL)
  );

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts_are_not_negative"
  CHECK ("attempts" >= 0);

CREATE INDEX "notifications_status_scheduled_for_idx"
  ON "notifications" ("status", "scheduled_for");

-- What `digestDueAt` reads: the last digest for this organiser on this event.
CREATE INDEX "notifications_organiser_id_event_id_kind_sent_at_idx"
  ON "notifications" ("organiser_id", "event_id", "kind", "sent_at");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_organiser_id_fkey"
  FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 3. digest_entries — the facts awaiting a summary
-- ===========================================================================
--
-- `notification_id` is NULL until a digest claims the row. That is what makes
-- "fifty contributions in ten minutes produce exactly one message" a property
-- of the data rather than of a counter somebody has to keep correct.

CREATE TABLE "digest_entries" (
  "id"              TEXT NOT NULL,
  "event_id"        TEXT NOT NULL,
  "organiser_id"    TEXT NOT NULL,
  "kind"            "digest_entry_kind" NOT NULL,
  "notification_id" TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "digest_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "digest_entries_organiser_id_event_id_notification_id_idx"
  ON "digest_entries" ("organiser_id", "event_id", "notification_id");

ALTER TABLE "digest_entries"
  ADD CONSTRAINT "digest_entries_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "digest_entries"
  ADD CONSTRAINT "digest_entries_organiser_id_fkey"
  FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "digest_entries"
  ADD CONSTRAINT "digest_entries_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- 4. Grants
-- ===========================================================================
--
-- M1-02's default privileges give a new table SELECT and INSERT only, so both
-- of these arrive append-only. They are not: a notification is claimed, sent,
-- retried and failed, and a digest entry is claimed by the digest that
-- summarises it.
--
-- **DELETE is granted here, unlike anywhere else in this schema**, and that is
-- the point of the grant being written out. These rows hold a name and a phone
-- number in `params` and `to_phone_e164` — personal data with no evidential
-- value once the message has gone (POPIA §11, architecture §11 retention). The
-- sweep in scripts/expire.ts prunes them. The ledger and the audit log still
-- hold no DELETE, and must not.

GRANT UPDATE, DELETE ON "notifications", "digest_entries" TO "isipheko_app";
