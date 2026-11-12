-- CreateTable
CREATE TABLE "AlertSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "offlineAfterMin" INTEGER NOT NULL DEFAULT 15,
    "recipients" TEXT[],
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "onTime" TEXT NOT NULL DEFAULT '10:00',
    "offTime" TEXT NOT NULL DEFAULT '17:30',
    "closedSaturdays" INTEGER[] DEFAULT ARRAY[2, 4]::INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAlert" (
    "id" UUID NOT NULL,
    "screenId" UUID NOT NULL,
    "offlineSince" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreenAlert_screenId_resolvedAt_idx" ON "ScreenAlert"("screenId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ScreenAlert_resolvedAt_idx" ON "ScreenAlert"("resolvedAt");

-- AddForeignKey
ALTER TABLE "ScreenAlert" ADD CONSTRAINT "ScreenAlert_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;
