-- Remove only the operator-owned temporary transport after successful import.
-- Preserved original data remains in the private archival corpus and Drive.
BEGIN;
DO $$ BEGIN
 -- A fresh database with no transported data can also replay these migrations.
 IF EXISTS (SELECT 1 FROM editorial.import_staging)
    AND NOT EXISTS (SELECT 1 FROM editorial.import_batch
   WHERE batch_id = '7314ea42ed584f71dfc0c2d472d126be8e2299f6765fd7df15d04997be5384fc'
     AND payload_sha256 = batch_id) THEN
  RAISE EXCEPTION 'reviewed editorial import batch not present';
 END IF;
END $$;
DROP TABLE editorial.import_staging;
COMMIT;
