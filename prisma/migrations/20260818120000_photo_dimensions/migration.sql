-- M4-02: the album lazy-loads photos, and a lazy image with no intrinsic size
-- shifts the layout when it lands. Four hundred of them on a slow connection is
-- the whole page moving for a minute.
--
-- Nullable because every row that exists predates them, and because a
-- contribution without a photo has no dimensions to hold. Written at upload
-- time from the full derivative, alongside `photo_key`.

ALTER TABLE "contributions"
  ADD COLUMN "photo_width" INTEGER,
  ADD COLUMN "photo_height" INTEGER;
