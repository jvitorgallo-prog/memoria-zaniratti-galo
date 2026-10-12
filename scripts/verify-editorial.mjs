#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing required argument ${name}`);
  return path.resolve(process.argv[i + 1]);
}

const migrationPath = arg('--migration');
const importPath = arg('--import-sql');
const runtimeDir = arg('--runtime-dir');
const databaseDir = path.join(runtimeDir, 'db-editorial-validation');
fs.rmSync(databaseDir, { recursive: true, force: true });
const require = createRequire(path.join(runtimeDir, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite(databaseDir);

async function scalar(sql) {
  const result = await db.query(sql);
  return result.rows[0]?.value;
}

async function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let report;
try {
  await db.exec(`CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN NOBYPASSRLS;`);
  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  const importSql = fs.readFileSync(importPath, 'utf8');
  await db.exec(importSql);
  const auditBefore = await scalar("SELECT count(*)::int AS value FROM editorial.audit_log");
  await db.exec(importSql);
  const auditAfter = await scalar("SELECT count(*)::int AS value FROM editorial.audit_log");

  const count = async (table, predicate = '') => scalar(`SELECT count(*)::int AS value FROM editorial.${table} ${predicate}`);
  report = {
    database: 'PGlite isolated local Postgres runtime',
    migration: path.basename(migrationPath),
    imported_batch_count: await count('import_batch'),
    people: await count('person'),
    groups: await count('family_group'),
    sources: await count('source'),
    parent_edges: await count('assertion', "WHERE predicate='parent_of'"),
    assertions: await count('assertion'),
    citations: await count('citation'),
    site_capture_occurrences: await count('capture_occurrence', "WHERE id LIKE 'occ-site-%'"),
    document_capture_occurrences: await count('capture_occurrence', "WHERE id LIKE 'occ-doc-%'"),
    wayback_index_occurrences: await count('capture_occurrence', "WHERE origin_kind='wayback'"),
    commoncrawl_index_occurrences: await count('capture_occurrence', "WHERE origin_kind='commoncrawl'"),
    archive_indexed_only_without_object: await count('capture_occurrence', "WHERE origin_kind IN ('wayback','commoncrawl') AND recovery_state='indexed_only' AND object_sha256 IS NULL"),
    citations_linked_to_capture: await count('citation', 'WHERE capture_id IS NOT NULL'),
    original_objects: await count('original_object'),
    uncovered_assertions: await scalar("SELECT count(*)::int AS value FROM editorial.assertion a WHERE NOT EXISTS (SELECT 1 FROM editorial.citation c WHERE c.assertion_id=a.id)"),
    repeated_capture_source_groups: await scalar("SELECT count(*)::int AS value FROM (SELECT source_id FROM editorial.capture_occurrence GROUP BY source_id HAVING count(*) > 1) q"),
    partial_dates_without_fake_month_day: await scalar("SELECT count(*)::int AS value FROM editorial.assertion WHERE date_value IS NOT NULL AND date_value->'components'->>'month' IS NULL AND date_value->'components'->>'day' IS NULL"),
    audit_rows_after_first_import: auditBefore,
    audit_rows_after_identical_replay: auditAfter,
    anonymous_schema_usage: await scalar("SELECT has_schema_privilege('anon','editorial','USAGE') AS value"),
    anonymous_person_select: await scalar("SELECT has_table_privilege('anon','editorial.person','SELECT') AS value"),
    authenticated_schema_usage: await scalar("SELECT has_schema_privilege('authenticated','editorial','USAGE') AS value"),
    service_role_schema_usage: await scalar("SELECT has_schema_privilege('service_role','editorial','USAGE') AS value"),
    backend_schema_usage: await scalar("SELECT has_schema_privilege('zaniratti_editorial_backend','editorial','USAGE') AS value"),
    browser_role_bypassrls: await scalar("SELECT bool_or(rolbypassrls) AS value FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')"),
    backend_role_bypassrls: await scalar("SELECT rolbypassrls AS value FROM pg_roles WHERE rolname='zaniratti_editorial_backend'"),
    backend_delete_grant: await scalar("SELECT has_table_privilege('zaniratti_editorial_backend','editorial.person','DELETE') AS value"),
    all_editorial_tables_rls_forced: await scalar("SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) AS value FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='editorial' AND c.relkind='r'"),
    reni_and_lourdes_are_separate_people: await scalar("SELECT (SELECT count(*) FROM editorial.person WHERE id IN ('reni','lourdes_esposito'))=2 AND 'reni' <> 'lourdes_esposito' AS value"),
    valentim_maternal_parent_unassigned: await scalar("SELECT EXISTS (SELECT 1 FROM editorial.family_group g JOIN editorial.group_participant child ON child.group_id=g.id AND child.person_id='valentim' AND child.role='child' WHERE g.id='custode_valentim' AND g.note_private ILIKE '%Mãe de Valentim não atribuída automaticamente%' AND NOT EXISTS (SELECT 1 FROM editorial.group_participant p WHERE p.group_id=g.id AND p.role='parent' AND p.person_id <> 'custode')) AS value"),
    seventeenth_century_branches_unconnected: await scalar("WITH RECURSIVE edges(a,b) AS (SELECT subject_person_id,target_person_id FROM editorial.assertion WHERE predicate='parent_of'), walk(id) AS (SELECT 'giovanni16'::text UNION SELECT CASE WHEN e.a=w.id THEN e.b ELSE e.a END FROM walk w JOIN edges e ON e.a=w.id OR e.b=w.id) SELECT NOT EXISTS (SELECT 1 FROM walk WHERE id='francesco') AS value"),
    reni_birth_literal_preserved: await scalar("SELECT count(*)=1 AS value FROM editorial.assertion WHERE subject_person_id='reni' AND predicate='birth' AND value_literal='20 MAR 1938' AND date_value->>'literal'='20 MAR 1938' AND date_value->'components'->>'month'='3' AND date_value->'components'->>'day'='20'"),
    partial_year_dates_without_fabricated_day: await scalar("SELECT count(*)::int AS value FROM editorial.assertion WHERE date_value->>'precision' IN ('year','month','century','interval','unknown') AND date_value->'components'->>'day' IS NOT NULL"),
  };

  await assert(report.imported_batch_count === 1, 'Expected exactly one import manifest.');
  await assert(report.people === 89, `Expected 89 people; got ${report.people}.`);
  await assert(report.groups === 20, `Expected 20 family groups; got ${report.groups}.`);
  await assert(report.parent_edges === 118, `Expected 118 parent edges; got ${report.parent_edges}.`);
  await assert(report.wayback_index_occurrences >= 1186, 'Unique Wayback capture occurrences were not all imported.');
  await assert(report.commoncrawl_index_occurrences >= 251, 'Common Crawl index rows were not all imported.');
  await assert(report.uncovered_assertions === 0, 'Found assertions without citations.');
  await assert(auditBefore === auditAfter, 'Identical replay created duplicate audit rows.');
  await assert(report.anonymous_schema_usage === false && report.anonymous_person_select === false, 'anon can access editorial schema/table.');
  await assert(report.authenticated_schema_usage === false && report.service_role_schema_usage === false, 'authenticated or service_role can access editorial schema.');
  await assert(report.browser_role_bypassrls === false, 'A browser role bypasses RLS.');
  await assert(report.all_editorial_tables_rls_forced === true, 'At least one editorial table lacks forced RLS.');
  await assert(report.backend_schema_usage === true && report.backend_role_bypassrls === false && report.backend_delete_grant === false, 'Editorial backend role is not limited as intended.');
  await assert(report.reni_and_lourdes_are_separate_people === true, 'Reni was merged with Lourdes Esposito.');
  await assert(report.valentim_maternal_parent_unassigned === true, 'Valentim has an invented maternal parent.');
  await assert(report.seventeenth_century_branches_unconnected === true, 'The two historic branches were connected by an unproven edge.');
  await assert(report.reni_birth_literal_preserved === true, 'Reni birth literal or partial date components were changed.');
  await assert(report.partial_year_dates_without_fabricated_day === 0, 'A partial date received an unrecorded day.');
  await db.exec('BEGIN; SET LOCAL ROLE zaniratti_editorial_backend;');
  const backendPeople = await scalar('SELECT count(*)::int AS value FROM editorial.person');
  await db.exec('ROLLBACK');
  report.backend_can_read_policy_rows = backendPeople === 89;
  await assert(report.backend_can_read_policy_rows, 'Backend role could not read rows through its RLS policy.');
  await db.exec("BEGIN; INSERT INTO editorial.assertion(id,subject_person_id,predicate,evidence_class) VALUES ('verify-no-citation','reni','verification','verification');");
  try {
    await db.exec('COMMIT;');
    report.uncited_assertion_commit_rejected = false;
  } catch {
    await db.exec('ROLLBACK').catch(() => {});
    report.uncited_assertion_commit_rejected = true;
  }
  await assert(report.uncited_assertion_commit_rejected, 'An uncited assertion committed successfully.');
  await db.exec('BEGIN; SET LOCAL ROLE anon; SELECT * FROM editorial.person;');
  throw new Error('Direct SELECT as anon unexpectedly succeeded.');
} catch (error) {
  if (/permission denied|schema .* does not exist|relation .* does not exist/i.test(error.message)) {
    await db.exec('ROLLBACK').catch(() => {});
    if (error.message.includes('Direct SELECT as anon unexpectedly succeeded')) throw error;
    report.anonymous_direct_select_denied = true;
  } else if (error.message !== 'permission denied for schema editorial') {
    console.error(`verify-editorial: ${error.message}`, error.code ?? '', error.position ?? '');
    process.exitCode = 1;
  }
  // Query is expected to fail for anon; continue only when the SQL error matches.
} finally {
  await db.close();
}

if (!process.exitCode) console.log(JSON.stringify(report, null, 2));
