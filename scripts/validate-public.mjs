import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE_CLASSES = new Set(['transcrito do site','relato familiar','transcrito do documento fornecido','relato familiar com apoio indireto do site']);
const CORE_PARENT_EDGE_COUNT = 118;
const CORE_PERSON_COUNT = 89;
const PRIVATE_KEYS = new Set(['email','email_address','address','street_address','phone','document_number','civil_id','signature','medical','cause_of_death','private_path','original_path','drive_url']);
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

export function validatePublic({ snapshot, manifest, gedcom, asset, assetFiles = null, inventory, snapshotText, inventoryText }) {
  privacyScan(snapshot);
  privacyScan(manifest);
  privacyScan(inventory);
  exactKeys(snapshot, ['schema_version','release','people','branches','groups','events','assertions','citations','sources','assets','legacy_urls','biographies','archive_items'], 'snapshot');
  assert.equal(snapshot.schema_version, '1.1.0');
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
  assert.equal(snapshot.people.filter(p => !p.id.startsWith('hist-') && p.id !== 'edmondo1950').length, CORE_PERSON_COUNT, 'existing core IDs remain intact');
  assert.equal(new Set(snapshot.branches.filter(b => b.is_original_tree).map(b => b.tree_id)).size, 4, 'four original trees stay distinct');
  assert(snapshot.branches.some(b => b.category === 'unassigned_profiles'), 'unassigned biographies stay visible without a fabricated branch');
  const bondenoBranch = snapshot.branches.find(b => b.id === 'ramo-francesco-bondeno-galo');
  assert.equal(bondenoBranch?.label, 'Francesco / Bondeno');
  assert.equal(bondenoBranch?.note, 'Descendência em Bondeno com ramos por casamento. Relações e datas têm origem consultável.');
  assert(snapshot.events.length >= 46);
  const coreParentAssertions = snapshot.assertions.filter(a => a.predicate === 'child_of' && a.id.startsWith('a-parent-'));
  assert.equal(coreParentAssertions.length, CORE_PARENT_EDGE_COUNT);
  assert.equal(snapshot.groups.filter(g => g.kind === 'parental_group' && !g.id.startsWith('legacy-family-')).length, 20);
  const coreUnionIds = new Set(['union-custode-ernesta','union-grandilia-nicola','union-reni-joao','union-dante-maria-gallo','union-valentim-elisa','union-luigi-pasqua','union-zenaide-felipe-murucci']);
  assert.equal(snapshot.groups.filter(g => g.kind === 'union' && coreUnionIds.has(g.id)).length, 7);
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
    exactKeys(p, ['id','label','preferred_name_assertion_id','claim_ids','branch_ids','aliases'], 'person');
    assert(p.label.trim());
    assert(assertionIds.has(p.preferred_name_assertion_id));
    assert(p.claim_ids.includes(p.preferred_name_assertion_id));
    for (const id of p.claim_ids) assert(assertionIds.has(id), `dangling claim ${id}`);
    for (const id of p.branch_ids) assert(branchIds.has(id), `dangling branch ${id}`);
    assert(Array.isArray(p.aliases));
  }
  for (const branch of snapshot.branches) {
    for (const field of ['id','label','description','person_ids','note']) assert(Object.hasOwn(branch,field), `branch missing ${field}`);
    for (const id of branch.person_ids) assert(personIds.has(id));
  }
  for (const group of snapshot.groups) {
    exactKeys(group, ['id','kind','participant_ids','participants','event_ids','note'], 'group');
    assert(['parental_group','union'].includes(group.kind));
    assert(group.participant_ids.length > 0);
    for (const id of group.participant_ids) assert(personIds.has(id), `non-public group participant ${id}`);
    for (const id of group.event_ids) assert(eventIds.has(id), `dangling group event ${id}`);
    if (group.kind === 'parental_group') assert.equal(group.event_ids.length, 0, 'parental group must not imply marriage');
    assert.deepEqual(group.participants.map(x => x.person_id), group.participant_ids);
    for (const participant of group.participants) {
      exactKeys(participant, ['person_id','role'], 'group participant');
      assert(['parent','spouse','child','family_member'].includes(participant.role));
    }
  }

  const edgePairs = new Set();
  const deceasedIds = new Set(snapshot.events.filter(e => e.type === 'death' && e.subject_kind === 'person').map(e => e.subject_id));
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
        assert((year !== null && year !== undefined && year <= 1906) || deceasedIds.has(assertion.subject_id) || assertion.subject_id === 'custode', `birth date on potentially living person: ${assertion.subject_id}`);
      }
    }
  }
  const coreEdgePairs = new Set(coreParentAssertions.map(a => `${a.object_person_id}>${a.subject_id}`));
  assert.equal(coreEdgePairs.size, CORE_PARENT_EDGE_COUNT, 'duplicate parentage edge in core');
  const preferredParentPairs = new Set(snapshot.assertions.filter(a => a.predicate === 'child_of' && a.interpretation === 'preferred').map(a => `${a.object_person_id}>${a.subject_id}`));
  for (const group of snapshot.groups.filter(g => g.kind === 'parental_group' && g.id.startsWith('legacy-family-'))) {
    const parents = group.participants.filter(p => p.role === 'parent').map(p => p.person_id);
    const children = group.participants.filter(p => p.role === 'child').map(p => p.person_id);
    assert(parents.length > 0 && children.length > 0, `legacy parental group must have parents and children: ${group.id}`);
    for (const parentId of parents) for (const childId of children) assert(preferredParentPairs.has(`${parentId}>${childId}`), `legacy group member pair lacks preferred child_of: ${group.id} ${parentId}>${childId}`);
  }
  const preferredParentsByChild = new Map();
  for (const edge of snapshot.assertions.filter(a => a.predicate === 'child_of' && a.interpretation === 'preferred')) {
    const parents = preferredParentsByChild.get(edge.subject_id) || new Set();
    parents.add(edge.object_person_id);
    preferredParentsByChild.set(edge.subject_id, parents);
  }
  for (const [childId, parents] of preferredParentsByChild) assert(parents.size <= 2, `more than two preferred biological parents for ${childId}`);
  const felipeId = snapshot.people.find(p => p.label === 'Felipe Zaniratti (2004)')?.id;
  if (felipeId) assert.equal(preferredParentsByChild.get(felipeId)?.size, 2, 'Andreza/Gabriel page crosswalk must not duplicate a parent');
  assert.equal(snapshot.people.filter(p => p.id === 'antonio1846').length, 1, 'S6 URL identity must resolve to the existing Antonio record');
  const antonioParents = preferredParentsByChild.get('antonio1846') || new Set();
  assert.deepEqual([...antonioParents].sort(), ['luigi','maria_cavallini'].sort(), 'Antonio S6 parentage must resolve to Luigi and Maria Cavallini without a third reference stub');
  assert(!snapshot.people.some(p => p.id.startsWith('hist-') && p.label === 'Antonio Zaniratti (1846)'), 'do not duplicate core Antonio 1846 by URL');
  const alternateNames = snapshot.assertions.filter(a => a.predicate === 'alternate_name');
  assert.equal(snapshot.people.find(p => p.id === 'reni').label, 'Reni Zaniratti Galo');
  assert(alternateNames.some(a => a.subject_id === 'reni' && a.literal === 'Reni Zanirate Galo' && a.interpretation === 'alternative'));
  assert.equal(snapshot.people.find(p => p.id === 'elisa').label, 'Elisa Bernardino Zaniratti');
  assert(alternateNames.some(a => a.subject_id === 'elisa' && a.literal === 'Elisa Bernardino Zanirate' && a.interpretation === 'alternative'));
  assert(alternateNames.some(a => a.subject_id === 'joao_galo' && a.literal === 'João Gallo' && a.interpretation === 'alternative'));
  assert(alternateNames.some(a => a.subject_id === 'valentim' && a.literal === 'Valentim Zanirate' && a.interpretation === 'alternative'));
  assert(snapshot.assertions.some(a => a.subject_id === 'rejane' && a.predicate === 'name_spelling_divergence' && a.interpretation === 'disputed'));
  assert(snapshot.assertions.some(a => a.subject_id === 'reni' && a.predicate === 'father_name_on_death_record' && a.interpretation === 'disputed'));
  assert(snapshot.assertions.some(a => a.subject_id === 'jv' && a.predicate === 'source_divergence' && a.interpretation === 'disputed'));
  assert(snapshot.assertions.some(a => a.subject_id === 'custode' && a.predicate === 'travel_memory_not_confirmed' && /família relata que Custode chegou/i.test(a.literal)));
  assert(snapshot.people.find(p => p.id === 'lourdes_esposito').label.includes('Espósito'));
  assert(snapshot.assertions.some(a => a.subject_id === 'antonio_filho' && a.predicate === 'criado_por'));
  assert(snapshot.assertions.some(a => a.subject_id === 'antonio_filho' && a.predicate === 'casamento_e_descendencia' && /não se casou e não teve filhos/i.test(a.literal)));
  assert(snapshot.groups.some(g => g.id === 'union-dante-maria-gallo' && g.participant_ids.includes('dante1882') && g.participant_ids.includes('maria_gallo')));
  assert(snapshot.groups.some(g => g.id === 'union-valentim-elisa' && g.participant_ids.includes('valentim') && g.participant_ids.includes('elisa')));
  assert(snapshot.groups.some(g => g.id === 'union-luigi-pasqua' && g.participant_ids.includes('luigi') && g.participant_ids.includes('pasqua')));
  assert(snapshot.groups.some(g => g.id === 'union-zenaide-felipe-murucci' && g.participant_ids.includes('zenaide') && g.participant_ids.includes('felipe_murucci')));
  const zenaideMarriage = snapshot.assertions.find(a => a.id === 'a-casamento-zenaide-felipe');
  assert.equal(zenaideMarriage?.date, null, 'do not infer marriage year from Zenaide’s stated age');
  assert.match(zenaideMarriage?.literal || '', /tinha 12 anos quando se casou/i);
  const childrenOf = id => [...new Set(coreParentAssertions.filter(a => a.object_person_id === id).map(a => a.subject_id))];
  for (const [id, count] of [['custode',13],['valentim',4],['reni',5],['grandilia',10],['zenaide',16]]) assert.equal(childrenOf(id).length, count, `child count for ${id}`);
  assert.deepEqual(coreParentAssertions.filter(a => a.subject_id === 'valentim').map(a => a.object_person_id), ['custode'], 'Valentim has no assigned mother in adopted core');
  assert.notEqual(snapshot.people.find(p => p.id === 'reni').id, snapshot.people.find(p => p.label.includes('Lourdes Espósito'))?.id, 'Reni and Lourdes Espósito must remain distinct records');
  for (const c of snapshot.citations) {
    exactKeys(c, ['id','source_id','locator','quote','translation','language'], 'citation');
    assert(sourceIds.has(c.source_id), `citation source missing: ${c.source_id}`);
    assert.equal(c.quote, null, 'public citations use minimal locators, not copied text');
    assert.equal(c.translation, null);
  }
  for (const source of snapshot.sources) {
    exactKeys(source, ['id','title','kind','public_reference','approved_external_url','reproduction','asset_ids','public_note'], 'source');
    assert(['metadata_only','reviewed_copy'].includes(source.reproduction));
    for (const aid of source.asset_ids) assert(assetIds.has(aid));
    if (/^P[1-4]$/.test(source.id)) assert.equal(source.approved_external_url, null, `${source.id} must not reveal a private document URL`);
    if (source.approved_external_url) assert(source.approved_external_url.startsWith('https://'), `unsafe source URL ${source.id}`);
  }
  assert.equal(snapshot.sources.filter(s => s.id.startsWith('catalog-pdf-')).length, 22);
  for (const source of snapshot.sources.filter(s => s.id.startsWith('catalog-pdf-'))) assert.equal(source.reproduction, 'reviewed_copy');
  for (const event of snapshot.events) {
    exactKeys(event, ['id','type','subject_kind','subject_id','claim_ids'], 'event');
    assert(['birth','death','marriage','migration','residence','other'].includes(event.type));
    if (event.subject_kind === 'person') assert(personIds.has(event.subject_id));
    else assert(groupIds.has(event.subject_id));
    assert(event.claim_ids.length > 0);
    for (const cid of event.claim_ids) assert(assertionIds.has(cid));
  }
  const marriages = snapshot.events.filter(e => e.type === 'marriage');
  assert.equal(snapshot.events.filter(e => e.type === 'birth' && e.id.startsWith('evt-birth-')).length, 31);
  assert.equal(snapshot.events.filter(e => e.type === 'death' && e.id.startsWith('evt-death-')).length, 5);
  assert(marriages.length >= 7);
  for (const unionId of coreUnionIds) assert(marriages.some(e => e.subject_id === unionId));
  assert(snapshot.assets.length >= 100, 'historical photographs and diagrams should be preserved');
  for (const assetRec of snapshot.assets) {
    exactKeys(assetRec, ['id','public_path','sha256','mime','bytes','alt','caption','rights_public_note'], 'asset');
    assert(!assetRec.public_path.includes('..'));
    const bytes = assetFiles?.[assetRec.public_path] || (assetRec.id === snapshot.assets[0].id ? asset : null);
    if (bytes) { assert.equal(assetRec.sha256, sha(bytes), `asset hash mismatch ${assetRec.id}`); assert.equal(assetRec.bytes, bytes.length); }
  }
  assert.equal(manifest.snapshot_sha256, sha(Buffer.from(snapshotText)));
  assert.equal(manifest.inventory_sha256, sha(Buffer.from(inventoryText)));
  assert.deepEqual(manifest.assets.map(a => [a.path,a.sha256,a.bytes]).sort(), snapshot.assets.map(a => [a.public_path,a.sha256,a.bytes]).sort());
  assert.equal(manifest.origin_asset.sha256, '27a3b8087c74cb2d6f1c435fe727d153b9f41dc03d34c102b536cb47486f9fda');
  assert.equal(inventory.entries.length, 363);
  for (const entry of inventory.entries) {
    assert(!entry.legacy_path.startsWith('/'));
    assert(!entry.legacy_path.includes('..'));
    assert(['public_derivative','original_public','capture_indexed','catalog_only','local_copy_review_needed'].includes(entry.public_status));
    if (entry.public_path) assert(!entry.public_path.startsWith('/') && !entry.public_path.includes('..'));
  }
  assert.equal(snapshot.archive_items.length, 389);
  const sourceIdsAll = new Set(snapshot.sources.map(s => s.id));
  for (const item of snapshot.archive_items) {
    exactKeys(item, ['id','title','kind','status','legacy_path','capture_url','capture_timestamp_utc','original_sha256','original_bytes','mime','public_path','public_sha256','public_bytes','person_ids','event_ids','source_ids','description','transcript'], 'archive item');
    assert(['public_derivative','original_public','capture_indexed','catalog_only','local_copy_review_needed'].includes(item.status));
    assert(!item.legacy_path.startsWith('/') && !item.legacy_path.includes('..'));
    for (const id of item.person_ids) assert(personIds.has(id));
    for (const id of item.event_ids) assert(eventIds.has(id));
    for (const id of item.source_ids) assert(sourceIdsAll.has(id));
    if (item.public_path) {
      assert(['public_derivative','original_public'].includes(item.status));
      assert(item.public_sha256 && item.public_bytes > 0);
      const bytes = assetFiles?.[item.public_path];
      if (bytes) { assert.equal(sha(bytes), item.public_sha256); assert.equal(bytes.length, item.public_bytes); }
      if (item.public_path.endsWith('.html')) {
        const html = bytes?.toString('utf8') || '';
        assert(!/<script\b/i.test(html), `script remains in archive page ${item.id}`);
        assert(!/<[^>]+\son[a-z]+\s*=/i.test(html), `inline event handler remains in archive page ${item.id}`);
        assert(!EMAIL_RE.test(html), `email remains in archive page ${item.id}`);
        assert(!/https?:\/\/(?:www\.)?zaniratti\.it\//i.test(html), `internal legacy URL was not localized in ${item.id}`);
        assert(!/#legacy-(?:page|asset)-not-recovered/.test(html), `unresolved legacy placeholder leaked in ${item.id}`);
        for (const match of html.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
          const src = match[2];
          if (/^(?:https?:|data:|#|\/\/)/i.test(src)) continue;
          const localPath = path.posix.normalize(path.posix.join(path.posix.dirname(item.public_path), src.split('#')[0]));
          assert(assetFiles?.[localPath], `local image source missing from public asset set: ${item.id} -> ${src}`);
        }
      }
    } else assert.equal(item.public_sha256, null);
  }
  assert(/1963/.test(snapshot.archive_items.find(i => i.id === 'legacy-esposito-grandilia-htm')?.transcript || ''), 'historical dates must be preserved in recovered site biographies');
  const documentItems = snapshot.archive_items.filter(i => i.legacy_path.startsWith('catalogo-documental/'));
  assert.equal(documentItems.length, 26);
  assert.equal(documentItems.filter(i => i.status === 'original_public' && i.public_path?.endsWith('.pdf')).length, 23);
  assert.equal(documentItems.filter(i => i.status === 'public_derivative' && i.public_path?.endsWith('.html')).length, 3);
  for (const item of documentItems.filter(i => /^documento-p[1-3]$/.test(i.id))) {
    assert.equal(item.original_sha256, null, 'private document hash must not be exposed');
    assert.equal(item.original_bytes, null, 'private document size must not be exposed');
    assert.equal(item.capture_url, null, 'private document locator must not be exposed');
  }
  const p4 = documentItems.find(i => i.id === 'documento-p4');
  assert.equal(p4.status, 'original_public');
  assert(p4.public_path?.endsWith('/p4-original.pdf'));
  assert(p4.original_sha256 && p4.original_bytes > 0);
  assert(p4.transcript.includes('Custode Sante') && p4.transcript.includes('Ernesta Galliera'));
  assert(p4.event_ids.includes('evt-casamento-custode-ernesta-1880'));
  for (const biography of snapshot.biographies) {
    exactKeys(biography, ['id','person_id','title','paragraphs','source_ids'], 'biography');
    assert(personIds.has(biography.person_id));
    for (const id of biography.source_ids) assert(sourceIdsAll.has(id));
    assert(biography.paragraphs.length > 0);
    for (const paragraph of biography.paragraphs) {
      exactKeys(paragraph, ['text','source_ids','citation_ids'], 'biography paragraph');
      assert(paragraph.text.trim());
      assert(!/^História de /i.test(paragraph.text), 'boilerplate biography echo');
      assert(!/^(?:Filiação registrada|Filhos registrados nos vínculos parentais):/i.test(paragraph.text), 'structured relationships belong in the family graph');
      for (const id of paragraph.source_ids) assert(sourceIdsAll.has(id));
      for (const id of paragraph.citation_ids) {
        assert(citationIds.has(id));
        const citation = snapshot.citations.find(c => c.id === id);
        assert(paragraph.source_ids.includes(citation.source_id), `biography citation ${id} must cite one of its declared sources`);
      }
    }
  }
  assert(snapshot.archive_items.filter(i => i.public_path).length >= 9);
  assert(snapshot.biographies.length >= 30, 'biographies must contain cited prose facts rather than filler');
  assert.equal((gedcom.match(/^1 BIRT$/gm) || []).length, 31);
  assert.equal((gedcom.match(/^1 DEAT$/gm) || []).length, 5);
  for (const assertion of snapshot.assertions.filter(a => a.predicate === 'child_of' && a.interpretation === 'disputed')) {
    const family = gedcom.split(`0 @F-${assertion.subject_id}@ FAM\n`)[1]?.split('\n0 ')[0] || '';
    assert(!family.includes(`1 _PARENT @${assertion.object_person_id}@`), `disputed parentage exported in GEDCOM for ${assertion.subject_id}`);
  }
  assert((gedcom.match(/^1 MARR$/gm) || []).length >= 7);
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
  const snapshot = JSON.parse(snapshotText);
  const publicPaths = [...new Set([...snapshot.assets.map(a => a.public_path), ...snapshot.archive_items.map(i => i.public_path).filter(Boolean)])];
  const assetFiles = Object.fromEntries(await Promise.all(publicPaths.map(async publicPath => [publicPath, await readFile(path.join(ROOT, 'public', publicPath))])));
  validatePublic({ snapshot, manifest, gedcom, asset, assetFiles, inventory: JSON.parse(inventoryText), snapshotText, inventoryText });
  console.log('public candidate valid: family counts, source closure, privacy, biography/archive linkage, and byte hashes');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`validate-public: ${error.message}`); process.exitCode = 1; });
}
