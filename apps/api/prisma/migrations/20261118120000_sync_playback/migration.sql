-- Keep the TVs of a branch on one timeline, and what each TV reports about it.
ALTER TABLE "Branch" ADD COLUMN "syncPlayback" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Screen" ADD COLUMN "playSync" JSONB;
