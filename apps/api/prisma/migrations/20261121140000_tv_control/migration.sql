-- TV control: the TV's own state from the heartbeat (screen on/off, boot time, network, thermal, volume).
ALTER TABLE "Screen" ADD COLUMN "tvStatus" JSONB;
