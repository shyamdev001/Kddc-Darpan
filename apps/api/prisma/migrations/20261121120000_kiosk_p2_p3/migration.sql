-- K5: a release can be marked to install at once on the TVs.
ALTER TABLE "AppRelease" ADD COLUMN "installNow" BOOLEAN NOT NULL DEFAULT false;

-- K8: at most one command of each type on its way to a TV. Older duplicates are closed first.
UPDATE "DeviceCommand" d SET "status" = 'FAILED', "completedAt" = now(), "result" = '{"error":"Replaced by a newer command"}'
WHERE d."status" IN ('PENDING', 'SENT')
  AND EXISTS (
    SELECT 1 FROM "DeviceCommand" n
    WHERE n."screenId" = d."screenId" AND n."type" = d."type" AND n."status" IN ('PENDING', 'SENT')
      AND (n."createdAt" > d."createdAt" OR (n."createdAt" = d."createdAt" AND n."id" > d."id"))
  );
CREATE UNIQUE INDEX "DeviceCommand_one_live_per_type" ON "DeviceCommand" ("screenId", "type") WHERE "status" IN ('PENDING', 'SENT');
