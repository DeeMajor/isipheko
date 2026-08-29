-- M4-02b — a message and a photograph on an in-kind contribution.
--
-- Somebody brings the tent, which is the most substantial thing anyone does and
-- the thing the product is named for, and could leave no message and no photo,
-- ever. The album therefore under-represented exactly the contribution
-- *ukupheka* describes.
--
-- ## Why the columns are here and not on `contributions`
--
-- A cash contribution's row is created at the pay step, which is where M4-01
-- attaches the photo. **An in-kind row is created at confirm time**, inside
-- `confirmDelivery`'s transaction, by the organiser, from a claim the
-- contributor made hours or days earlier. So the attachment point is not on the
-- row's creation path at all — there is no row yet when the only person with
-- something to say is present.
--
-- The claim is where she is. These carry on it from the moment she claims, and
-- `confirmDelivery` moves them across to the contribution it creates.
--
-- The alternative was reaching her after delivery through the capability she
-- already holds, which is the only handle we have on somebody with no account
-- (rule 4). It needs a message we cannot send — no BSP is configured (M2-08) —
-- so it is a design for a product that has one.

ALTER TABLE "need_claims"
  ADD COLUMN "message" TEXT,
  ADD COLUMN "photo_key" TEXT,
  ADD COLUMN "photo_width" INTEGER,
  ADD COLUMN "photo_height" INTEGER;

-- The same pair `contributions` carries, and for the same measured reason: the
-- album lazy-loads four hundred images and one with no intrinsic size shifts
-- the layout as it lands, while a fixed aspect box crops somebody's photograph
-- of a gravestone to fit (M4-02).

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- Nothing new. `need_claims` already carries UPDATE — claiming, expiring and
-- confirming delivery are all updates — and these columns are written by the
-- same paths.
