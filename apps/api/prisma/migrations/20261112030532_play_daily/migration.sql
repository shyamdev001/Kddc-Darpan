-- CreateTable
CREATE TABLE "PlayDaily" (
    "id" BIGSERIAL NOT NULL,
    "day" DATE NOT NULL,
    "screenId" UUID,
    "mediaId" UUID,
    "screenName" TEXT NOT NULL,
    "branchName" TEXT,
    "mediaName" TEXT NOT NULL,
    "plays" INTEGER NOT NULL,
    "durationMs" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayDaily_mediaId_day_idx" ON "PlayDaily"("mediaId", "day");

-- CreateIndex
CREATE INDEX "PlayDaily_screenId_day_idx" ON "PlayDaily"("screenId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "PlayDaily_day_screenId_mediaId_key" ON "PlayDaily"("day", "screenId", "mediaId");

-- AddForeignKey
ALTER TABLE "PlayDaily" ADD CONSTRAINT "PlayDaily_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayDaily" ADD CONSTRAINT "PlayDaily_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
