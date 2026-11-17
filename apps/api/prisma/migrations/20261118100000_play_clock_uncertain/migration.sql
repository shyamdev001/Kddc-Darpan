-- Plays recorded while the TV's clock was not set (power cut, no internet): their time may be off.
ALTER TABLE "PlayLog" ADD COLUMN "clockUncertain" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlayDaily" ADD COLUMN "uncertainPlays" INTEGER NOT NULL DEFAULT 0;
