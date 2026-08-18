-- Fields the setup screen asks for and the schema had nowhere to put.
--
-- Hand-written and verified with `prisma migrate deploy` plus
-- `prisma migrate diff` — `prisma migrate dev` cannot run against this schema
-- (docs/decisions.md M1-06 §9).

-- ===========================================================================
-- 1. need_items.note — free text, never parsed.
-- ===========================================================================
--
-- `design/setup.html` asks "How much, or how many" as one free-text field, and
-- the answers are things like "Around R1 200 to hire", "For 200 people",
-- "2 head" and "Mealie meal, rice, sugar, oil".
--
-- The last of those has no quantity in it at all. Parsing this into
-- quantity_required/unit/estimated_cost_cents would turn a grocery list into
-- "1 unit" — data loss that reads like data, on the page a bereaved family is
-- about to share. The structured columns stay for M2-03, where partial claiming
-- actually reads them.

ALTER TABLE "need_items" ADD COLUMN "note" TEXT;

-- Every item starts as one of a thing. M2-03 owns quantities properly.
ALTER TABLE "need_items" ALTER COLUMN "quantity_required" SET DEFAULT 1;

-- ===========================================================================
-- 2. events.subtitle and events.place.
-- ===========================================================================
--
-- The details step collects four things: the name, an optional second name, the
-- day, and where. `title` and `event_date` existed; the other two had nowhere
-- to go.
--
-- `subtitle` is the line under the title — a clan name (uMaZondi), the other
-- partner, the family — which `design/event.html` renders directly beneath it.
-- `place` is the area, and the setup screen is explicit that it is the area
-- rather than the street: a public page does not need somebody's address.
--
-- Storing either inside `description` would have made the public page parse
-- prose back into fields it once had.

ALTER TABLE "events" ADD COLUMN "subtitle" TEXT;
ALTER TABLE "events" ADD COLUMN "place" TEXT;
