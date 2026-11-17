-- One poster head office picks to show on any screen with nothing else to play.
ALTER TABLE "Media" ADD COLUMN "defaultSlide" BOOLEAN NOT NULL DEFAULT false;
