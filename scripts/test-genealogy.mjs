import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const snapshot = JSON.parse(await readFile(new URL('../content/public/snapshot.json', import.meta.url), 'utf8'));
const claims = snapshot.assertions;
const adoptedParents = claims.filter(claim => claim.predicate === 'child_of' && claim.interpretation === 'preferred');
const people = new Map(snapshot.people.map(person => [person.id, person]));
const parents = id => [...new Set(adoptedParents.filter(claim => claim.subject_id === id).map(claim => claim.object_person_id))].sort();
const children = id => [...new Set(adoptedParents.filter(claim => claim.object_person_id === id).map(claim => claim.subject_id))].sort();

const expected = {
  custode: ['ermanno','ugo','umberto','daniele','dante1882','maria1884','luigi1886','ulisse','ernesto','carlo1892','zenaide','grandilia','valentim'],
  valentim: ['walter','nedina','reni','antonio_filho'],
  reni: ['fernando','vera','elcio','jose_airson','rejane'],
  grandilia: ['luzia','ana_maria','helia','orestes','santina','maria_esposito','valquiria','lourdes_esposito','carmen','mafalda'],
  zenaide: Array.from({length:16}, (_, i) => `zenaide_child_${i+1}`),
};
for (const [id, childIds] of Object.entries(expected)) assert.deepEqual(children(id), childIds.sort(), `The complete recorded family of ${id} must survive export.`);
assert.deepEqual(parents('custode'), ['luigi','pasqua']);
assert.deepEqual(parents('valentim'), ['custode'], 'An explicit marriage of Custode does not establish the mother of Valentim.');
assert.deepEqual(parents('reni'), ['elisa','valentim']);
assert.deepEqual(parents('rejane'), ['joao_galo','reni']);
assert.deepEqual(parents('jv'), ['luiz_claudio','rejane']);
assert(!parents('antonio_filho').includes('grandilia'), 'Being raised by Grandilia is not parentage.');
assert(!children('valentim').includes('lourdes_esposito'), 'Lourdes Espósito must not be substituted for Reni.');
assert(people.get('reni').label.includes('Reni Zaniratti Galo'), 'The user’s corrected family spelling is the presentation name.');
assert(children('grandilia').includes('lourdes_esposito'));

for (const [a,b] of [['luigi','pasqua'],['custode','ernesta'],['valentim','elisa'],['reni','joao_galo'],['dante1882','maria_gallo'],['zenaide','felipe_murucci']]) {
  assert(snapshot.groups.some(group => group.kind === 'union' && group.participant_ids.includes(a) && group.participant_ids.includes(b)), `The explicitly reported union ${a}/${b} must be navigable.`);
}

// Same names in recovered pages are not an identity match. These three people
// were children of Antonio and Flora, not parents of Custode or his son Dante.
for (const [path,wrongId] of [['BRA/Luigi1883B.htm','luigi'],['BRA/PasquaB.htm','pasqua'],['BRA/Dante1878B.htm','dante1882']]) {
  const item = snapshot.archive_items.find(item => item.legacy_path === path);
  assert(item?.public_path, `Recovered page ${path} must be readable.`);
  assert(!item.person_ids.includes(wrongId), `${path} must not merge two people who share a given name.`);
}

const antonioPage = snapshot.archive_items.find(item => item.legacy_path === 'BRA/Antonio1846B.htm');
assert(antonioPage?.person_ids.includes('antonio1846'), 'S6 and its exact original page must resolve to the same Antonio.');
assert.deepEqual(parents('antonio1846'), ['luigi','maria_cavallini']);

// A parental grouping must not turn siblings into children of unproved parents.
// Only the explicitly adopted parentage permits this presentation in the atlas.
const parentPairs = new Set(adoptedParents.map(claim => `${claim.subject_id}|${claim.object_person_id}`));
for (const group of snapshot.groups.filter(group => group.kind === 'parental_group' && group.id.startsWith('legacy-family-'))) {
  const parentIds = group.participants.filter(participant => participant.role === 'parent').map(participant => participant.person_id);
  const childIds = group.participants.filter(participant => participant.role === 'child').map(participant => participant.person_id);
  for (const childId of childIds) for (const parentId of parentIds) {
    assert(parentPairs.has(`${childId}|${parentId}`), `Parental group ${group.id} implies unsupported parentage ${parentId} → ${childId}.`);
  }
}

for (const claim of claims.filter(claim => claim.date)) {
  if (claim.date.precision === 'year') {
    assert.equal(claim.date.components.month, null, `Invented month: ${claim.id}`);
    assert.equal(claim.date.components.day, null, `Invented day: ${claim.id}`);
  }
  if (claim.date.qualifier === 'about') {
    assert(!claim.date.lower_bound && !claim.date.upper_bound, `Invented interval around an approximate year: ${claim.id}`);
  }
}

// Genealogy is a directed graph; multiple unions are valid, ancestry cycles are not.
const visiting = new Set(), visited = new Set();
function visit(id) {
  assert(!visiting.has(id), `Ancestry cycle at ${id}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const parent of parents(id)) visit(parent);
  visiting.delete(id);visited.add(id);
}
for (const id of people.keys()) visit(id);
const isolated = new Set(snapshot.branches.find(branch => branch.id === 'ramo-salvatonica-san-biagio')?.person_ids || []);
for (const claim of adoptedParents) {
  assert(isolated.has(claim.subject_id) === isolated.has(claim.object_person_id), 'No invented bridge between the historic Zaniratti branches.');
}

for (const bio of snapshot.biographies) for (const paragraph of bio.paragraphs) {
  assert(!/^U\d+:|não fixar ano|1813\s*[–-]\s*1895/i.test(paragraph.text), `Research instructions cannot be displayed as a biography: ${bio.id}`);
}
console.log('Genealogy checks passed: complete families, explicit unions, identity separation, date precision and ancestry integrity.');
