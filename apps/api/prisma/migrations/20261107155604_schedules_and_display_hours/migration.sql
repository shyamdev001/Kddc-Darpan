/*
  Warnings:

  - You are about to drop the column `brightness` on the `Schedule` table. All the data in the column will be lost.
  - You are about to drop the column `screenOff` on the `Schedule` table. All the data in the column will be lost.
  - You are about to drop the column `screenOn` on the `Schedule` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Schedule" DROP COLUMN "brightness",
DROP COLUMN "screenOff",
DROP COLUMN "screenOn",
ALTER COLUMN "startDate" SET DATA TYPE DATE,
ALTER COLUMN "endDate" SET DATA TYPE DATE;

-- CreateTable
CREATE TABLE "DisplayHours" (
    "id" UUID NOT NULL,
    "targetType" "AssignmentTarget" NOT NULL,
    "screenId" UUID,
    "branchId" UUID,
    "talukaId" UUID,
    "regionId" UUID,
    "daysOfWeek" INTEGER[],
    "onTime" TEXT NOT NULL,
    "offTime" TEXT NOT NULL,
    "closedSaturdays" INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisplayHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisplayHours_targetType_idx" ON "DisplayHours"("targetType");

-- CreateIndex
CREATE INDEX "Schedule_assignmentId_idx" ON "Schedule"("assignmentId");

-- AddForeignKey
ALTER TABLE "DisplayHours" ADD CONSTRAINT "DisplayHours_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplayHours" ADD CONSTRAINT "DisplayHours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplayHours" ADD CONSTRAINT "DisplayHours_talukaId_fkey" FOREIGN KEY ("talukaId") REFERENCES "Taluka"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplayHours" ADD CONSTRAINT "DisplayHours_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;
