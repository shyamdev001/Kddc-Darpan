-- What each TV model can do, as the TV detects it (WebView version, decoders, brightness, screen-off...).
ALTER TABLE "Screen" ADD COLUMN "capabilities" JSONB;
