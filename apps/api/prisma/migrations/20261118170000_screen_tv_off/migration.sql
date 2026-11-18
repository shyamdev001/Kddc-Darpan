-- The screen taken away by the TV itself during display hours (DC9): {kind, at, backAt, count}.
ALTER TABLE "Screen" ADD COLUMN "tvOff" JSONB;
