-- Originals are deleted 30 days after processing worked; this records when.
ALTER TABLE "Media" ADD COLUMN "originalDeletedAt" TIMESTAMP(3);
