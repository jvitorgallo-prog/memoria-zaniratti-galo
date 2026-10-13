import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublic } from './validate-public.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotText = await readFile(path.join(ROOT, 'content/public/snapshot.json'), 'utf8');
const inventoryText = await readFile(path.join(ROOT, 'content/public/legacy-inventory.json'), 'utf8');
const currentSnapshot = JSON.parse(snapshotText);
const publicPaths = [...new Set([...currentSnapshot.assets.map(a => a.public_path), ...currentSnapshot.archive_items.map(a => a.public_path).filter(Boolean)])];
const assetFiles = Object.fromEntries(await Promise.all(publicPaths.map(async p => [p, await readFile(path.join(ROOT, 'public', p))])));
const base = {
  assetFiles,
  snapshot: JSON.parse(snapshotText), inventory: JSON.parse(inventoryText),
  manifest: JSON.parse(await readFile(path.join(ROOT, 'content/public/manifest.json'), 'utf8')),
  gedcom: await readFile(path.join(ROOT, 'public/downloads/linha-principal.ged'), 'utf8'),
  asset: await readFile(path.join(ROOT, 'public/assets/revisados/genea-a3-francesco-luigi-recorte.png')),
  snapshotText, inventoryText,
};
assert.equal(validatePublic(base), true);

const candidatePreview = structuredClone(base);
if (candidatePreview.snapshot.release.state === 'approved') {
  candidatePreview.snapshot.release.state = 'candidate';
  candidatePreview.manifest.state = 'candidate';
  delete candidatePreview.manifest.approval_decision;
  candidatePreview.manifest.note = 'Candidato local para revisão. Metadados públicos sem HTML bruto, documentos originais, caminhos locais ou conteúdo de e-mail.';
  candidatePreview.snapshotText = `${JSON.stringify(candidatePreview.snapshot, null, 2)}\n`;
  candidatePreview.manifest.snapshot_sha256 = createHash('sha256').update(candidatePreview.snapshotText).digest('hex');
  assert.equal(validatePublic(candidatePreview), true);
}
const approvedPreview = structuredClone(candidatePreview);
const reviewedHash = approvedPreview.manifest.snapshot_sha256;
approvedPreview.snapshot.release.state = 'approved';
approvedPreview.manifest.state = 'approved';
approvedPreview.manifest.approval_decision = { candidate_snapshot_sha256: reviewedHash, reviewer_role: 'coordenação editorial', reviewed_at: '2026-10-11T23:59:00Z' };
approvedPreview.manifest.note = 'Projeção pública revisada para disponibilização no site.';
approvedPreview.snapshotText = `${JSON.stringify(approvedPreview.snapshot, null, 2)}\n`;
approvedPreview.manifest.snapshot_sha256 = createHash('sha256').update(approvedPreview.snapshotText).digest('hex');
assert.equal(validatePublic(approvedPreview), true);

function asCandidate(input) {
  const candidate = structuredClone(input);
  if (candidate.snapshot.release.state === 'approved') {
    candidate.snapshot.release.state = 'candidate';
    candidate.manifest.state = 'candidate';
    delete candidate.manifest.approval_decision;
    candidate.manifest.note = 'Candidato local para revisão. Metadados públicos sem HTML bruto, documentos originais, caminhos locais ou conteúdo de e-mail.';
    candidate.snapshotText = `${JSON.stringify(candidate.snapshot, null, 2)}\n`;
    candidate.manifest.snapshot_sha256 = createHash('sha256').update(candidate.snapshotText).digest('hex');
  }
  return candidate;
}

function clone() { return asCandidate(base); }

const approvedTamper = structuredClone(base.snapshot.release.state === 'approved' ? base : approvedPreview);
approvedTamper.snapshot.people[0].label += ' alterado';
assert.throws(() => validatePublic(approvedTamper));

const privateDate = clone();
privateDate.snapshot.people[0].birth = '1883';
assert.throws(() => validatePublic(privateDate), /unexpected or missing fields/);

const hiddenParent = clone();
hiddenParent.snapshot.assertions.find(a => a.predicate === 'child_of').object_person_id = 'private-relative';
assert.throws(() => validatePublic(hiddenParent), /private parent endpoint/);

const missingCitation = clone();
missingCitation.snapshot.assertions.find(a => a.predicate === 'child_of').citation_ids = [];
assert.throws(() => validatePublic(missingCitation), /uncited assertion/);

const editorialOpenings = clone();
for (const [personId, pattern] of [
  ['reni', /filha de Valentim Zaniratti e Elisa Bernardino.*cinco filhos: Fernando, Vera, Elcio, José Airson e Rejane/s],
  ['custode', /filho de Luigi Zaniratti e Pasqua Mellara.*vapor Attività.*13 filhos registrados incluem Grandilia, Zenaide e Valentim/s],
  ['valentim', /filho de Custode Sante.*viveu em Santa Clara.*Walter, Nedina, Reni e Antônio/s],
]) {
  const biography = editorialOpenings.snapshot.biographies.find(b => b.person_id === personId);
  assert.match(biography.paragraphs[0].text, pattern);
  assert(biography.paragraphs[0].source_ids.length > 0);
}

const biographyCitationMismatch = clone();
const zenaideBiography = biographyCitationMismatch.snapshot.biographies.find(b => b.person_id === 'zenaide');
const historicalParagraph = zenaideBiography.paragraphs.find(p => p.text.startsWith('Transcrição da biografia histórica:'));
historicalParagraph.source_ids = ['S3'];
assert.throws(() => validatePublic(biographyCitationMismatch), /must cite one of its declared sources/);

const privateDocumentUrl = clone();
privateDocumentUrl.snapshot.sources.find(s => s.id === 'P2').approved_external_url = 'https://drive.google.com/private/original.pdf';
assert.throws(() => validatePublic(privateDocumentUrl), /private path/);

const badBirthDate = clone();
const badBirthAssertion = structuredClone(badBirthDate.snapshot.assertions.find(a => a.predicate === 'birth'));
badBirthAssertion.id = 'a-birth-rejane-synthetic';
badBirthAssertion.subject_id = 'rejane';
badBirthAssertion.literal = '1 JAN 2000';
badBirthAssertion.date.literal = '1 JAN 2000';
badBirthAssertion.date.components = { year: 2000, month: 1, day: 1 };
badBirthAssertion.date.precision = 'day';
badBirthDate.snapshot.assertions.push(badBirthAssertion);
badBirthDate.snapshot.people.find(p => p.id === 'rejane').claim_ids.push(badBirthAssertion.id);
assert.throws(() => validatePublic(badBirthDate), /birth date on potentially living person/);

const impliedMarriage = clone();
impliedMarriage.snapshot.groups.find(g => g.kind === 'parental_group').event_ids.push(impliedMarriage.snapshot.events.find(e => e.type === 'marriage').id);
assert.throws(() => validatePublic(impliedMarriage), /parental group must not imply marriage/);

const missingReportedMarriage = clone();
missingReportedMarriage.snapshot.groups = missingReportedMarriage.snapshot.groups.filter(g => g.id !== 'union-luigi-pasqua');
assert.throws(() => validatePublic(missingReportedMarriage));

const badAsset = clone();
badAsset.assetFiles[badAsset.snapshot.assets[0].public_path][0] ^= 0xff;
assert.throws(() => validatePublic(badAsset), /asset hash mismatch|asset hash does not match bytes/);

const badInventory = clone();
badInventory.inventory.entries[0].legacy_path = '../../private/file.htm';
assert.throws(() => validatePublic(badInventory));

console.log('Public export tests passed: privacy fields, endpoint closure, citations, date boundaries, explicit unions, all asset bytes and legacy paths.');
