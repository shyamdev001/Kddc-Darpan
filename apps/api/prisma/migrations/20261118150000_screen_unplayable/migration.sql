-- Videos a TV reports it cannot play (its decoder or sound output refused them): [{mediaId, reason}].
ALTER TABLE "Screen" ADD COLUMN "unplayable" JSONB;
