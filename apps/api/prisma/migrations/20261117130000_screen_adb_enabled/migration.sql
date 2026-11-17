-- The TV reports whether Android debugging (adb) is on; the dashboard warns about it.
ALTER TABLE "Screen" ADD COLUMN "adbEnabled" BOOLEAN;
