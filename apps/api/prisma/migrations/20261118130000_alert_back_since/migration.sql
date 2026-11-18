-- An open alert remembers when its screen came back; it closes only after 10 steady minutes, so a
-- TV that keeps dropping does not send "offline" and "back" emails every cycle.
ALTER TABLE "ScreenAlert" ADD COLUMN "backSince" TIMESTAMP(3);
