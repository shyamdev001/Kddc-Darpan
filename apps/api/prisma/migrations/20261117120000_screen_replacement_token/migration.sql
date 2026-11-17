-- A TV registering again with a paired screen's hardware id waits for head office instead of taking it over.
ALTER TABLE "Screen" ADD COLUMN "replacementTokenHash" TEXT;

CREATE UNIQUE INDEX "Screen_replacementTokenHash_key" ON "Screen"("replacementTokenHash");
