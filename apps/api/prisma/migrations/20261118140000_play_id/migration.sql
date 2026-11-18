-- Each play carries an id made by the TV, so a batch re-sent after a lost reply, even one whose
-- times were corrected once the TV clock was set, is counted once. Older TVs send none (NULL).
ALTER TABLE "PlayLog" ADD COLUMN "playId" UUID;
CREATE UNIQUE INDEX "PlayLog_screenId_playId_key" ON "PlayLog"("screenId", "playId");
