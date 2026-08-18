-- A group claim is a claim (M2-09, Part D2.5).
--
-- Eight cousins jointly claiming the tent reserves quantity through **the same
-- conditional UPDATE every other claim goes through** (M2-03 §1). A second
-- reservation path would break the one property that makes the last chair safe:
-- that exactly one statement decides who got it.
--
-- What a `need_claims` row could not say until now is *who*, when the who is a
-- group rather than a person. Without the link there is no way to release the
-- item when a collection is abandoned, and no way to tell a real group claim
-- from somebody typing "The Ngcobo cousins" into the board.
--
-- `claimant_name` stays filled, because it is what the board displays.

ALTER TABLE "need_claims" ADD COLUMN "collection_id" TEXT;

ALTER TABLE "need_claims"
  ADD CONSTRAINT "need_claims_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A collection claims **one** item, as a unit (Part D2.5). Two claims for one
-- collection would be two groups' worth of reservation held by one group.
CREATE UNIQUE INDEX "need_claims_collection_id_key"
  ON "need_claims" ("collection_id");
