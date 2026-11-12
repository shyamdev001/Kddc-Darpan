/*
  Warnings:

  - You are about to drop the column `isActive` on the `AppRelease` table. All the data in the column will be lost.
  - You are about to drop the column `isTestOnly` on the `AppRelease` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `AppRelease` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ReleaseStage" AS ENUM ('TEST', 'ALL', 'STOPPED');

-- AlterTable
ALTER TABLE "AppRelease" DROP COLUMN "isActive",
DROP COLUMN "isTestOnly",
ADD COLUMN     "stage" "ReleaseStage" NOT NULL DEFAULT 'TEST',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "uploadedById" UUID;

-- AlterTable
ALTER TABLE "Screen" ADD COLUMN     "appVersionCode" INTEGER,
ADD COLUMN     "testUpdates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updateStatus" TEXT;

-- AddForeignKey
ALTER TABLE "AppRelease" ADD CONSTRAINT "AppRelease_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
