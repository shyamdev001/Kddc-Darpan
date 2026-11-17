-- The TV reports how many of its files are downloaded and why the last one failed.
ALTER TABLE "Screen" ADD COLUMN "filesReady" INTEGER;
ALTER TABLE "Screen" ADD COLUMN "filesTotal" INTEGER;
ALTER TABLE "Screen" ADD COLUMN "downloadError" TEXT;
