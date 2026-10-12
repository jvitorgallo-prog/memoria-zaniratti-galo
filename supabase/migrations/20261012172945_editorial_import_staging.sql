-- Operator-only temporary staging for a hash-checked atomic client-side import.
-- Contains no genealogy data. Never exposed to the Data API or application roles.
BEGIN;
CREATE TABLE editorial.import_staging (
 batch_id text NOT NULL CHECK(batch_id ~ '^[0-9a-f]{64}$'),
 part_no integer NOT NULL CHECK(part_no >= 0),
 payload text NOT NULL,
 PRIMARY KEY(batch_id, part_no)
);
ALTER TABLE editorial.import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial.import_staging FORCE ROW LEVEL SECURITY;
REVOKE ALL ON editorial.import_staging FROM PUBLIC, anon, authenticated, service_role, zaniratti_editorial_backend;
COMMIT;
