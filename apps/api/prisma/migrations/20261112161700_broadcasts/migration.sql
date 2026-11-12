-- CreateEnum
CREATE TYPE "BroadcastKind" AS ENUM ('MESSAGE', 'MEDIA', 'LINK');

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "broadcastId" UUID,
ADD COLUMN     "broadcastStatus" TEXT;

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" UUID NOT NULL,
    "kind" "BroadcastKind" NOT NULL,
    "title" TEXT,
    "message" TEXT,
    "mediaId" UUID,
    "url" TEXT,
    "youtubeId" TEXT,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "targetType" "AssignmentTarget" NOT NULL,
    "screenId" UUID,
    "branchId" UUID,
    "talukaId" UUID,
    "regionId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "startedById" UUID,
    "endedById" UUID,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_endedAt_startedAt_idx" ON "Broadcast"("endedAt", "startedAt");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_talukaId_fkey" FOREIGN KEY ("talukaId") REFERENCES "Taluka"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
