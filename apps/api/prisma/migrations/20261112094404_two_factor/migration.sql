-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpLastStep" INTEGER;
