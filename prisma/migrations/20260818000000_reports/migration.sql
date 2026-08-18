-- The report channel (M3-06, architecture §10).
--
-- 57% of South Africans who report a scam hear nothing back. That finding is
-- why the acknowledgement is the product rather than the form: a form that
-- swallows a report is worse than no form, because it spends the one moment
-- somebody was willing to act.
--
-- ## A report does nothing by itself
--
-- **There is no column here that could flag, hold or hide the event a report
-- names**, and that absence is the design. The reporter has no account and
-- never will (rule 4), so anything automatic would be automatic for whoever is
-- willing to press it most — five reports on a funeral would change the page
-- under a family who are burying somebody. A person decides; this table
-- records. docs/decisions.md M3-06 §1 states it as a standing rule, because the
-- pressure to automate it will come back.
--
-- It accepts a report about **nothing we hold**: both foreign keys null, with
-- what they were sent in free text. That is the most valuable report there is,
-- because a link resolving to nothing is the scam case.

CREATE TYPE "report_reason" AS ENUM (
  'not_who_they_say',
  'never_happened',
  'asked_for_a_code',
  'money_not_received',
  'something_else'
);

CREATE TYPE "report_status" AS ENUM ('received', 'reviewing', 'closed');

CREATE TABLE "reports" (
  "id"                  TEXT NOT NULL,

  -- `REP-4K7B2X`, shown on screen the moment it is filed — the acknowledgement
  -- that actually arrives, since no BSP exists to send the other one. It is
  -- deliberately not reachable through /check: a code anybody could type would
  -- let somebody read a report about themselves, and the reporter may well be
  -- in the same family.
  "ref_prefix"          TEXT NOT NULL,
  "ref_code"            TEXT NOT NULL,

  "reason"              "report_reason" NOT NULL,
  "detail"              TEXT,

  "event_id"            TEXT,
  "collection_id"       TEXT,
  "about_typed"         TEXT,

  -- Optional, and never required to file. It is the only way to come back to
  -- them, which is why the screen says plainly what happens when it is blank.
  "reporter_phone_e164" TEXT,

  "ip_hash"             TEXT,
  "user_agent_hash"     TEXT,

  "status"              "report_status" NOT NULL DEFAULT 'received',

  -- One working day, computed at insert so the promise on the screen and the
  -- deadline in the record are the same number and cannot drift.
  "respond_by"          TIMESTAMP(3) NOT NULL,
  "acknowledged_at"     TIMESTAMP(3),
  "closed_at"           TIMESTAMP(3),

  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- A closed report has a time on it, and an open one does not. Without this a
-- row could read `closed` with nothing saying when anybody looked.
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_closed_is_timed"
  CHECK (
    ("status" = 'closed' AND "closed_at" IS NOT NULL)
    OR ("status" <> 'closed' AND "closed_at" IS NULL)
  );

CREATE UNIQUE INDEX "reports_ref_prefix_ref_code_key" ON "reports" ("ref_prefix", "ref_code");
-- The queue, in the order a person works it.
CREATE INDEX "reports_status_respond_by_idx" ON "reports" ("status", "respond_by");
CREATE INDEX "reports_event_id_idx" ON "reports" ("event_id");

-- SET NULL rather than CASCADE: a report about a page that was later removed is
-- the report most worth keeping.
ALTER TABLE "reports"
  ADD CONSTRAINT "reports_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "reports"
  ADD CONSTRAINT "reports_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- The new notification kind
-- ===========================================================================

ALTER TYPE "notification_kind" ADD VALUE 'report_received';

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- M1-02's default privileges give a new table SELECT and INSERT. Triage is an
-- UPDATE — received, reviewing, closed — and that is all this needs.
--
-- **No DELETE.** A report is evidence, and the one thing that must not be
-- possible is a report quietly disappearing.

GRANT UPDATE ON "reports" TO "isipheko_app";
REVOKE DELETE, TRUNCATE ON "reports" FROM "isipheko_app";
