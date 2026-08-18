-- The optional host acknowledgement (M2-11, Part D2.4).
--
-- **Not a handover status.** `handover_status` records *who closed the record*
-- — a witness who was there, or the organiser on her own word — and the incwadi
-- says which for as long as the paper lasts. Overwriting it with
-- `host_acknowledged` would erase that distinction the moment a family tapped a
-- link, which is exactly backwards: the family's tap is an extra line on the
-- record, not a better account of how it was confirmed.
--
-- It is also never required (CLAUDE.md rule 15). Nothing waits on this column
-- being set, no ledger entry follows it, and a handover is complete without it.

ALTER TABLE "collections" ADD COLUMN "host_acknowledged_at" TIMESTAMP(3);
