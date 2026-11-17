-- The TV reports its last crash and whether it fell back to safe mode (posters only).
ALTER TABLE "Screen" ADD COLUMN "lastCrash" JSONB;
ALTER TABLE "Screen" ADD COLUMN "safeMode" BOOLEAN NOT NULL DEFAULT false;
