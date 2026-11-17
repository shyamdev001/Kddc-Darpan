-- Per-account limit: 5 wrong passwords or 2FA codes in a row (from any address) pause sign-in for 15 minutes.
ALTER TABLE "User" ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
