-- Signing out ends the session on the server too, and "Sign out everywhere" ends all of them.
ALTER TABLE "User" ADD COLUMN "sessionsValidAfter" TIMESTAMP(3);

CREATE TABLE "RevokedSession" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
