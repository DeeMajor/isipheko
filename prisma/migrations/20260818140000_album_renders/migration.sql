-- The print-ready album (M4-03).
--
-- ## Queued, never synchronous
--
-- Rendering four hundred entries and their photographs is seconds of CPU: the
-- photos are AVIF and a PDF holds neither AVIF nor WebP, so every one of them
-- is decoded and re-encoded on the way in. No organiser should watch a spinner
-- for that, and no web worker should be held open for it.
--
-- There is no Redis and no BullMQ — M1-06 §4 and M2-08 §1 both declined to add
-- one, and this task did not change the answer. `pnpm render` picks these rows
-- up, exactly as `pnpm notify` and `pnpm expire` pick up theirs.
--
-- ## A table, not columns on `events`
--
-- A render has a state machine, a history of attempts, and more than one
-- version over the life of an umcimbi. Columns on `events` would hold the
-- latest attempt and forget the rest, and the row somebody needs when a render
-- fails twice is the one that says it failed twice.

CREATE TYPE "album_render_status" AS ENUM ('pending', 'rendering', 'ready', 'failed');

CREATE TABLE "album_renders" (
  "id"           TEXT NOT NULL,
  "event_id"     TEXT NOT NULL,

  -- A hash of everything the album would draw. The same record always renders
  -- the same file, so a second request for an unchanged album returns the one
  -- that exists; a record that has grown mints a new version. Content
  -- addressing, the same bargain the OG card strikes (M2-07 §2).
  "version"      TEXT NOT NULL,

  "status"       "album_render_status" NOT NULL DEFAULT 'pending',

  -- `album/<event>/<version>.pdf`, once there is one.
  "object_key"   TEXT,

  -- A render that fails forever must stop being retried forever, and must say
  -- so on the screen rather than looking like one that has not started.
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,

  -- Supplied by the application rather than defaulted here. The sweep reads
  -- these columns to decide what is due, and a rule read off a wall clock is a
  -- rule whose test passes or fails according to the hour somebody runs it.
  "requested_at" TIMESTAMP(3) NOT NULL,
  "started_at"   TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "album_renders_pkey" PRIMARY KEY ("id")
);

-- Requesting the same version twice is one row. That is what makes the request
-- button safe to press twice on a connection that has already eaten one tap.
CREATE UNIQUE INDEX "album_renders_event_id_version_key"
  ON "album_renders" ("event_id", "version");

-- What the sweep reads: the oldest pending work first.
CREATE INDEX "album_renders_status_requested_at_idx"
  ON "album_renders" ("status", "requested_at");

ALTER TABLE "album_renders"
  ADD CONSTRAINT "album_renders_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- M1-02's default privileges give a new table SELECT and INSERT. A render moves
-- through pending → rendering → ready | failed, so it needs UPDATE.
--
-- **No DELETE**, for the same reason as everywhere else here: a row recording
-- that a render failed three times is exactly the row somebody would want gone
-- and exactly the one worth keeping. Housekeeping is an operational job.

GRANT UPDATE ON "album_renders" TO "isipheko_app";
REVOKE DELETE, TRUNCATE ON "album_renders" FROM "isipheko_app";
