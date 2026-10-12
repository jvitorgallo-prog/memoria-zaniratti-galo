import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE_CLASSES = new Set(['transcrito do site','relato familiar','transcrito do documento fornecido','relato familiar com apoio indireto do site']);
const PRIVATE_KEYS = new Set(['email','email_address','address','document_number','signature','private_path','original_path','drive_url','birth_place','death_place']);
const EMAIL_RE = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const PRIVATE_PATH_RE = /(?:\/workspace\/|drive\.google\.com|documentos_privados|raw\/snapshots\/|raw\/commoncrawl\/)/i;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function privacyScan(value, pointer = '$') {
  if (Array.isArray(value)) return value.forEach((v, i) => privacyScan(v, `${pointer}[${i}]`));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      assert(!PRIVATE_KEYS.has(key.toLowerCase()), `private field ${pointer}.${key}`);
      privacyScan(child, `${pointer}.${key}`);
    }
  } else if (typeof value === 'string') {
    assert(!EMAIL_RE.test(value), `email in ${pointer}`);
    assert(!PRIVATE_PATH_RE.test(value), `private path in ${pointer}`);
  }
}

function exactKeys(object, expected, where) {
  assert.deepEqual(Object.keys(object).sort(), [...expected].sort(), `${where} has unexpected or missing fields`);
}

export function validatePublic({ snapshot, manifest, gedcom, asset, inventory, snapshotText, inventoryText }) {
  privacyScan(snapshot);
  privacyScan(manifest);
  privacyScan(inventory);
  exactKeys(snapshot, ['schema_version','release','people','branches','groups','events','assertions','citations','sources','assets','legacy_urls'], 'snapshot');
  assert.equal(snapshot.schema_version, '1.0.0');
  exactKeys(snapshot.release, ['id','state','generated_at','content_revision','locale','public_changelog'], 'release');
  assert(['candidate','approved'].includes(snapshot.release.state), 'published is only set by deployment');
  assert.equal(manifest.state, snapshot.release.state);
  if (snapshot.release.state === 'candidate') {
    assert.equal(manifest.approval_decision, undefined, 'candidate must not carry an approval record');
  } else {
    assert(manifest.approval_decision, 'approved release needs recorded editorial decision');
    assert.equal(manifest.approval_decision.reviewer_role, 'coordenação editorial');
    const candidate = structuredClone(snapshot);
    candidate.release.state = 'candidate';
    assert.equal(manifest.approval_decision.candidate_snapshot_sha256, sha(Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`)));
  }
  assert.equal(snapshot.people.length, 89);
  assert.equal(snapshot.branches.length, 3, 'disconnected branches must remain separate');
  assert.equal(snapshot.events.length, 39);
  assert.equal(snapshot.assertions.filter(a => a.predicate === 'child_of').length, 118);
  assert.equal(snapshot.groups.filter(g => g.kind === 'parental_group').length, 20);
  assert.equal(snapshot.groups.filter(g => g.kind === 'union').length, 3);
  assert.equal(snapshot.legacy_urls.length, 0, 'no redirect/bridge can be inferred without review');

  const personIds = new Set(snapshot.people.map(p => p.id));
  const branchIds = new Set(snapshot.branches.map(b => b.id));
  const groupIds = new Set(snapshot.groups.map(g => g.id));
  const eventIds = new Set(snapshot.events.map(e => e.id));
  const assertionIds = new Set(snapshot.assertions.map(a => a.id));
  const citationIds = new Set(snapshot.citations.map(c => c.id));
  const sourceIds = new Set(snapshot.sources.map(s => s.id));
  const assetIds = new Set(snapshot.assets.map(a => a.id));
  for (const [set, list, name] of [[personIds,snapshot.people,'person'],[branchIds,snapshot.branches,'branch'],[groupIds,snapshot.groups,'group'],[eventIds,snapshot.events,'event'],[assertionIds,snapshot.assertions,'assertion'],[citationIds,snapshot.citations,'citation'],[sourceIds,snapshot.sources,'source']]) assert.equal(set.size, list.length, `duplicate ${name} id`);

  for (const p of snapshot.people) {
    exactKeys(p, ['id','label','preferred_name_assertion_id','claim_ids','branch_ids'], 'person');
    assert(p.label.trim());
    assert(assertionIds.has(p.preferred_name_assertion_id));
    assert(p.claim_ids.includes(p.preferred_name_assertion_id));
    for (const id of p.claim_ids) assert(assertionIds.has(id), `dangling claim ${id}`);
    for (const id of p.branch_ids) assert(branchIds.has(id), `dangling branch ${id}`);
  }
  for (const branch of snapshot.branches) {
    exactKeys(branch, ['id','label','description','person_ids','note'], 'branch');
    for (const id of branch.person_ids) assert(personIds.has(id));
  }
  for (const group of snapshot.groups) {
    exactKeys(group, ['id','kind','participant_ids','event_ids','note'], 'group');
    assert(['parental_group','union'].includes(group.kind));
    assert(group.participant_ids.length > 0);
    for (const id of group.participant_ids) assert(personIds.has(id), `non-public group participant ${id}`);
    for (const id of group.event_ids) assert(eventIds.has(id), `dangling group event ${id}`);
    if (group.kind === 'parental_group') assert.equal(group.event_ids.length, 0, 'parental group must not imply marriage');
  }

  const edgePairs = new Set();
  for (const assertion of snapshot.assertions) {
    exactKeys(assertion, ['id','subject_kind','subject_id','predicate','object_person_id','literal','date','interpretation','evidence_class','citation_ids','public_note'], 'assertion');
    assert(['person','group','event'].includes(assertion.subject_kind));
    if (assertion.subject_kind === 'person') assert(personIds.has(assertion.subject_id), `missing assertion person ${assertion.subject_id}`);
    if (assertion.subject_kind === 'group') assert(groupIds.has(assertion.subject_id), `missing assertion group ${assertion.subject_id}`);
    assert(['preferred','alternative','disputed','annotation'].includes(assertion.interpretation));
    assert(assertion.evidence_class.trim(), `empty evidence class ${assertion.id}`);
    assert(assertion.citation_ids.length > 0, `uncited assertion ${assertion.id}`);
    for (const cid of assertion.citation_ids) assert(citationIds.has(cid), `dangling citation ${cid}`);
    if (assertion.predicate === 'child_of') {
      assert.equal(assertion.subject_kind, 'person');
      assert(personIds.has(assertion.object_person_id), `private parent endpoint ${assertion.object_person_id}`);
      assert(EDGE_CLASSES.has(assertion.evidence_class), `unknown edge class ${assertion.evidence_class}`);
      edgePairs.add(`${assertion.object_person_id}>${assertion.subject_id}`);
    }
    if (assertion.date) {
      exactKeys(assertion.date, ['literal','qualifier','precision','components','lower_bound','upper_bound','normalization_note'], 'date');
      assert(assertion.date.literal && assertion.date.precision);
      assert(!/^(?:unknown|und|---)$/i.test(assertion.date.literal));
      if (assertion.predicate === 'birth') {
        const year = assertion.date.components.year || assertion.date.lower_bound?.year;
        assert((year !== null && year !== undefined && year <= 1906) || ['custode','reni','joao_galo'].includes(assertion.subject_id), `birth date on potentially living person: ${assertion.subject_id}`);
      }
    }
  }
  assert.equal(edgePairs.size, 118, 'duplicate parentage edge');
  const alternateNames = snapshot.assertions.filter(a => a.predicate === 'alternate_name');
  assert(alternateNames.some(a => a.subject_id === 'reni' && a.literal === 'Reni Zaniratti Galo' && a.interpretation === 'alternative'));
  assert(alternateNames.some(a => a.subject_id === 'joao_galo' && a.literal === 'João Gallo' && a.interpretation === 'alternative'));
  assert(alternateNames.some(a => a.subject_id === 'valentim' && a.literal === 'Valentim Zanirate' && a.interpretation === 'alternative'));
  assert(snapshot.assertions.some(a => a.subject_id === 'rejane' && a.predicate === 'name_spelling_divergence' && a.interpretation === 'disputed'));
  assert(snapshot.assertions.some(a => a.subject_id === 'reni' && a.predicate === 'father_name_on_death_record' && a.interpretation === 'disputed'));
  assert(snapshot.assertions.some(a => a.subject_id === 'jv' && a.predicate === 'source_divergence' && a.interpretation === 'disputed'));
  assert(snapshot.assertions.some(a => a.subject_id === 'custode' && a.predicate === 'travel_memory_not_confirmed' && /não comprovadas/.test(a.literal)));
  assert.deepEqual(snapshot.assertions.filter(a => a.predicate === 'child_of' && a.subject_id === 'valentim').map(a => a.object_person_id), ['custode'], 'Valentim has no assigned mother');
  assert.notEqual(snapshot.people.find(p => p.id === 'reni').id, snapshot.people.find(p => p.label.includes('Lourdes Espósito'))?.id, 'Reni and Lourdes Espósito must remain distinct records');
  for (const c of snapshot.citations) {
    exactKeys(c, ['id','source_id','locator','quote','translation','language'], 'citation');
    assert(sourceIds.has(c.source_id), `citation source missing: ${c.source_id}`);
    assert.equal(c.quote, null, 'public citations use minimal locators, not copied text');
    assert.equal(c.translation, null);
  }
  for (const source of snapshot.sources) {
    exactKeys(source, ['id','title','kind','public_reference','approved_external_url','reproduction','asset_ids','public_note'], 'source');
    assert.equal(source.reproduction, 'metadata_only');
    for (const aid of source.asset_ids) assert(assetIds.has(aid));
    if (/^P[1-4]$/.test(source.id)) assert.equal(source.approved_external_url, null, `${source.id} must not reveal a private document URL`);
    if (source.approved_external_url) assert(source.approved_external_url.startsWith('https://'), `unsafe source URL ${source.id}`);
  }
  assert.equal(snapshot.sources.filter(s => s.id.startsWith('catalog-pdf-')).length, 22);
  for (const event of snapshot.events) {
    exactKeys(event, ['id','type','subject_kind','subject_id','claim_ids'], 'event');
    assert(['birth','death','marriage','migration','residence','other'].includes(event.type));
    if (event.subject_kind === 'person') assert(personIds.has(event.subject_id));
    else assert(groupIds.has(event.subject_id));
    assert(event.claim_ids.length > 0);
    for (const cid of event.claim_ids) assert(assertionIds.has(cid));
  }
  const marriages = snapshot.events.filter(e => e.type === 'marriage');
  assert.equal(snapshot.events.filter(e => e.type === 'birth').length, 31);
  assert.equal(snapshot.events.filter(e => e.type === 'death').length, 5);
  assert.equal(marriages.length, 3);
  assert.deepEqual(marriages.map(e => e.subject_id).sort(), ['union-custode-ernesta','union-grandilia-nicola','union-reni-joao'].sort());
  assert.equal(snapshot.assets.length, 1);
  const assetRec = snapshot.assets[0];
  exactKeys(assetRec, ['id','public_path','sha256','mime','bytes','alt','caption','rights_public_note'], 'asset');
  assert.equal(assetRec.mime, 'image/png');
  assert.equal(assetRec.sha256, sha(asset), 'asset hash does not match bytes');
  assert.equal(assetRec.bytes, asset.length);
  assert(!assetRec.public_path.includes('..'));
  assert.equal(manifest.snapshot_sha256, sha(Buffer.from(snapshotText)));
  assert.equal(manifest.inventory_sha256, sha(Buffer.from(inventoryText)));
  assert.equal(manifest.assets[0].sha256, assetRec.sha256);
  assert.equal(manifest.origin_asset.sha256, '27a3b8087c74cb2d6f1c435fe727d153b9f41dc03d34c102b536cb47486f9fda');
  assert.equal(inventory.entries.length, 363);
  for (const entry of inventory.entries) {
    assert(!entry.legacy_path.startsWith('/'));
    assert(!entry.legacy_path.includes('..'));
    assert.equal(entry.public_treatment, 'metadata_only; conteúdo histórico não é servido como HTML bruto');
  }
  assert.equal((gedcom.match(/^1 BIRT$/gm) || []).length, 31);
  assert.equal((gedcom.match(/^1 DEAT$/gm) || []).length, 5);
  assert.equal((gedcom.match(/^1 MARR$/gm) || []).length, 3);
  assert(!/\b(?:CAUSE|CAUSE OF DEATH|EMAIL)\b/i.test(gedcom));
  return true;
}

async function main() {
  const snapshotPath = path.join(ROOT, 'content/public/snapshot.json');
  const manifestPath = path.join(ROOT, 'content/public/manifest.json');
  const inventoryPath = path.join(ROOT, 'content/public/legacy-inventory.json');
  const [snapshotText, inventoryText, manifest, gedcom, asset] = await Promise.all([
    readFile(snapshotPath, 'utf8'), readFile(inventoryPath, 'utf8'), readFile(manifestPath, 'utf8').then(JSON.parse),
    readFile(path.join(ROOT, 'public/downloads/linha-principal.ged'), 'utf8'), readFile(path.join(ROOT, 'public/assets/revisados/genea-a3-francesco-luigi-recorte.png')),
  ]);
  validatePublic({ snapshot: JSON.parse(snapshotText), manifest, gedcom, asset, inventory: JSON.parse(inventoryText), snapshotText, inventoryText });
  console.log('public candidate valid: counts, citation/reference closure, branch separation, source policy, privacy, inventory and hashes');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`validate-public: ${error.message}`); process.exitCode = 1; });
}
