-- Read-only inspection queries for a reviewed editorial database.
-- Run as a trusted operator after connecting to the database.

SELECT 'people' AS item, count(*) AS rows FROM editorial.person
UNION ALL SELECT 'family_groups', count(*) FROM editorial.family_group
UNION ALL SELECT 'sources', count(*) FROM editorial.source
UNION ALL SELECT 'parent_edges', count(*) FROM editorial.assertion WHERE predicate = 'parent_of'
UNION ALL SELECT 'assertions', count(*) FROM editorial.assertion
UNION ALL SELECT 'citations', count(*) FROM editorial.citation
UNION ALL SELECT 'capture_occurrences', count(*) FROM editorial.capture_occurrence
UNION ALL SELECT 'objects', count(*) FROM editorial.original_object
ORDER BY item;

-- Any returned row is an assertion with no citation.
SELECT a.id, a.predicate, a.subject_person_id
FROM editorial.assertion a
WHERE NOT EXISTS (
  SELECT 1 FROM editorial.citation c WHERE c.assertion_id = a.id
);

-- The browser roles should have neither schema USAGE nor table SELECT.
SELECT r.rolname,
       has_schema_privilege(r.rolname, 'editorial', 'USAGE') AS schema_usage,
       has_table_privilege(r.rolname, 'editorial.person', 'SELECT') AS person_select,
       r.rolbypassrls AS bypass_rls
FROM pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname;

-- Every editorial table should have RLS enabled and forced.
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'editorial' AND c.relkind = 'r'
ORDER BY c.relname;

-- Capture index entries that still lack a verified object payload.
SELECT origin_kind, recovery_state, count(*) AS rows,
       count(expected_payload_sha256) AS expected_hashes,
       count(object_sha256) AS verified_objects
FROM editorial.capture_occurrence
WHERE origin_kind IN ('wayback', 'commoncrawl', 'other_archive')
GROUP BY origin_kind, recovery_state
ORDER BY origin_kind, recovery_state;

-- Explicit checks for the corrections preserved in the current corpus.
SELECT id, life_status, disclosure
FROM editorial.person
WHERE id IN ('reni', 'lourdes_esposito', 'valentim')
ORDER BY id;

SELECT group_id, person_id, role
FROM editorial.group_participant
WHERE group_id = 'custode_valentim'
ORDER BY role, person_id;
