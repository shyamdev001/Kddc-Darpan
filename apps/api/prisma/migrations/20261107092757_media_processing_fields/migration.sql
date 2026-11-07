-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "originalMimeType" TEXT NOT NULL,
ADD COLUMN     "originalSha256" TEXT NOT NULL,
ADD COLUMN     "originalSizeBytes" BIGINT NOT NULL,
ADD COLUMN     "thumbKey" TEXT,
ALTER COLUMN "mimeType" DROP NOT NULL,
ALTER COLUMN "sizeBytes" DROP NOT NULL,
ALTER COLUMN "sha256" DROP NOT NULL,
ALTER COLUMN "storageKey" DROP NOT NULL,
ALTER COLUMN "originalKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Media_originalKey_key" ON "Media"("originalKey");

-- CreateIndex
CREATE INDEX "Media_originalSha256_idx" ON "Media"("originalSha256");

