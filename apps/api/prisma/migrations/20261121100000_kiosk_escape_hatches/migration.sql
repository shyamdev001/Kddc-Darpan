-- Kiosk escape hatches (K1, K2, K7): rescue mode and the kiosk PIN on screens, and the one-row
-- kiosk settings holding the PIN as a salted PBKDF2-HMAC-SHA1 hash (never the PIN).
ALTER TABLE "Screen" ADD COLUMN "rescueMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Screen" ADD COLUMN "kioskPinSet" BOOLEAN;

CREATE TABLE "KioskSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pinSalt" TEXT,
    "pinHash" TEXT,
    "pinIterations" INTEGER,
    "pinSetAt" TIMESTAMP(3),
    "pinSetById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskSettings_pkey" PRIMARY KEY ("id")
);
