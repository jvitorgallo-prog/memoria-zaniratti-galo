#!/usr/bin/env node
/** Frozen-input exporter. Public output is assembled field by field; no source object is spread. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_INPUT_SHA = '2c063f6e0050fa6a3bec42c856160eb4a9b83eb22ae0c4d5155da1de81a575f9';
const PUBLIC_PERSON_COUNT = 89;
const PUBLIC_EDGE_COUNT = 118;
const PUBLIC_FAMILY_COUNT = 20;
const PUBLIC_CLASSES = new Set(['transcrito do site', 'relato familiar', 'transcrito do documento fornecido', 'relato familiar com apoio indireto do site']);
const ALLOWED_SOURCES = new Set(['S1','S2','S3','S4','S5','S6','S7','S8','S9','U2','U3','P1','P2','P3','P4']);
const PRIVATE_DOC_HASH_TO_SOURCE = new Map([
  ['2b7a7bae54af6938', 'P1'], ['19e1d9181c8ac4d0', 'P4'],
  ['6774d5b58b44c296', 'P2'], ['6b41e68752de8e60', 'P3'],
]);
const ASSET_ID = 'asset-genea-a3-upper';
const ASSET_PATH = path.join(ROOT, 'public/assets/revisados/genea-a3-francesco-luigi-recorte.png');
const ASSET_PUBLIC_PATH = 'assets/revisados/genea-a3-francesco-luigi-recorte.png';
const ASSET_ORIGIN_SHA = '27a3b8087c74cb2d6f1c435fe727d153b9f41dc03d34c102b536cb47486f9fda';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const iso = () => new Date().toISOString();
const cleanName = value => String(value || '').replaceAll('/', ' ').replace(/\s+/g, ' ').trim();
const parseSourceRef = value => {
  const match = String(value).trim().match(/^(S\d+|U\d+|P\d+|A1)(?:\s*(.*))?$/);
  if (!match) throw new Error(`Referência de fonte não reconhecida: ${String(value).slice(0, 40)}`);
  return { id: match[1], locator: match[2] ? match[2].replace(/[^A-Za-z0-9 .,:–-]/g, '').trim() : 'referência da fonte' };
};
const parseRefs = value => String(value || '').split(';').map(parseSourceRef);

function parseDateLiteral(literal) {
  const raw = String(literal || '').trim();
  let match = raw.match(/^(ABT|ABOUT|EST)\s+(\d{4})$/i);
  if (match) {
    const year = Number(match[2]);
    return { literal: raw, qualifier: 'about', precision: 'year', components: { year, month: null, day: null }, lower_bound: null, upper_bound: null, normalization_note: 'Ano aproximado; literal mantido conforme a fonte.' };
  }
  match = raw.match(/^(BET)\s+(\d{4})\s+AND\s+(\d{4})$/i);
  if (match) {
    const a = Number(match[2]), b = Number(match[3]);
    return { literal: raw, qualifier: 'between', precision: 'interval', components: { year: null, month: null, day: null }, lower_bound: { year: a, month: null, day: null }, upper_bound: { year: b, month: null, day: null }, normalization_note: 'Intervalo preservado; não convertido em data exata.' };
  }
  match = raw.match(/^(?:(\d{1,2})\s+)?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)?\s*(\d{4})$/i);
  if (!match) return null;
  const months = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
  const day = match[1] ? Number(match[1]) : null;
  const month = match[2] ? months[match[2].toUpperCase()] : null;
  const year = Number(match[3]);
  return { literal: raw, qualifier: 'exact', precision: day ? 'day' : month ? 'month' : 'year', components: { year, month, day }, lower_bound: null, upper_bound: null, normalization_note: 'Componentes conhecidos preservados; literal mantido conforme a fonte.' };
}

function makeSources(canonical, docs) {
  const sources = new Map();
  const historicalTitles = {
    S1: 'Diagrama histórico Salvatonica/San Biagio', S2: 'Página histórica do ramo Salvatonica/San Biagio',
    S3: 'Diagrama histórico GeneaA3, ramo Francesco/Bondeno', S4: 'Biografia histórica de Grandilia',
    S5: 'Página histórica do ramo Francesco/Bondeno', S6: 'Biografia histórica de Antonio',
    S7: 'Biografia histórica de Zenaide', S8: 'Página histórica de fontes, transcrição recebida',
    S9: 'Anotações históricas do registro populacional de Burana',
    U2: 'Relato familiar fornecido (2026), referência U2', U3: 'Relato familiar adicional (2026), referência U3',
  };
  for (const [id, title] of Object.entries(historicalTitles)) {
    if (!canonical.fontes[id]) continue;
    const f = canonical.fontes[id];
    const url = /^https:\/\/web\.archive\.org\//.test(f.url || '') && id.startsWith('S') ? f.url : null;
    sources.set(id, { id, title, kind: id.startsWith('S') ? 'historic_site' : 'family_testimony', public_reference: id.startsWith('S') ? 'Página ou imagem do site histórico.' : `Relato familiar, ${id}.`, approved_external_url: url, reproduction: 'metadata_only', asset_ids: id === 'S3' ? [ASSET_ID] : [], public_note: id.startsWith('S') ? 'Referência ao conteúdo histórico preservado em captura arquivística.' : 'Testemunho familiar citado de forma resumida.' });
  }
  // Four supplied personal documents retain only a short citation label and no URL or original bytes.
  for (const id of ['P1','P2','P3','P4']) {
    if (canonical.fontes[id]) sources.set(id, { id, title: `Documento fornecido, referência ${id}`, kind: 'provided_document', public_reference: `Documento fornecido; citação mínima ${id}.`, approved_external_url: null, reproduction: 'metadata_only', asset_ids: [], public_note: 'Documento consultado como fonte; reprodução não disponível nesta página.' });
  }
  const pdfs = docs.registros.filter(x => x.mime_type === 'application/pdf');
  if (pdfs.length !== 26) throw new Error(`Catálogo documental esperado: 26 PDFs; encontrado ${pdfs.length}`);
  let publicCounter = 0;
  for (const doc of pdfs) {
    const mapped = PRIVATE_DOC_HASH_TO_SOURCE.get(doc.arquivo_id);
    if (mapped) continue; // P1–P4 are already represented with intentionally generic metadata.
    if (PRIVATE_DOC_HASH_TO_SOURCE.has(doc.arquivo_id) && !mapped) continue;
    if (doc.estado_publicacao !== 'pendente_revisao' || !/^https:\/\//.test(doc.url_original || '')) throw new Error(`PDF público sem URL ou revisão de catálogo: ${doc.arquivo_id}`);
    publicCounter += 1;
    const label = path.basename(doc.arquivo, '.pdf').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const id = `catalog-pdf-${String(publicCounter).padStart(2, '0')}`;
    sources.set(id, { id, title: label, kind: 'archive_document', public_reference: 'Documento histórico disponível em repositório público.', approved_external_url: doc.url_original, reproduction: 'metadata_only', asset_ids: [], public_note: 'Consulte a versão no repositório de origem.' });
  }
  if (publicCounter !== 22) throw new Error(`Esperados 22 PDFs de origem pública, encontrados ${publicCounter}`);
  return sources;
}

function buildSnapshot(canonical, docs, siteCatalog, assetBytes) {
  if (Object.keys(canonical.pessoas || {}).length !== PUBLIC_PERSON_COUNT) throw new Error('Contagem pública de pessoas mudou; exige nova revisão explícita.');
  if (canonical.parentescos?.length !== PUBLIC_EDGE_COUNT) throw new Error('Contagem de vínculos mudou; exige nova revisão explícita.');
  if (Object.keys(canonical.familias || {}).length !== PUBLIC_FAMILY_COUNT) throw new Error('Contagem de agrupamentos mudou; exige nova revisão explícita.');
  const assetDigest = digest(assetBytes);
  const asset = { id: ASSET_ID, public_path: ASSET_PUBLIC_PATH, sha256: assetDigest, mime: 'image/png', bytes: assetBytes.length, alt: 'Recorte superior do diagrama GeneaA3, com Francesco, Luigi e irmãos no ramo de Bondeno.', caption: 'O diagrama é uma versão histórica; a identificação de pessoas com o mesmo nome em relatos familiares não é presumida.', rights_public_note: 'Derivado do diagrama histórico identificado por captura e SHA-256 no manifesto.' };
  const sourceMap = makeSources(canonical, docs);
  const citations = [];
  const citationMap = new Map();
  function citation(ref) {
    if (!ALLOWED_SOURCES.has(ref.id)) throw new Error(`Fonte privada ou não aprovada bloqueou a exportação: ${ref.id}`);
    if (!sourceMap.has(ref.id)) throw new Error(`Fonte citada não tem ficha pública saneada: ${ref.id}`);
    const key = `${ref.id}|${ref.locator}`;
    if (!citationMap.has(key)) {
      const id = `c-${ref.id.toLowerCase()}-${citations.length + 1}`;
      citationMap.set(key, id);
      citations.push({ id, source_id: ref.id, locator: ref.locator || 'referência da fonte', quote: null, translation: null, language: null });
    }
    return citationMap.get(key);
  }

  const people = Object.entries(canonical.pessoas).map(([id, raw]) => ({
    id, label: cleanName(raw.name), preferred_name_assertion_id: `a-name-${id}`, claim_ids: [`a-name-${id}`], branch_ids: [],
  }));
  const peopleById = new Map(people.map(p => [p.id, p]));
  const assertions = [];
  const nameClaims = new Map();
  for (const claim of canonical.afirmacoes) {
    if (!peopleById.has(claim.pessoa_id) || !['name','anexo_nome','anexo_sobrenome','grafia_familiar','nome_usual'].includes(claim.campo) || claim.adotado !== 'sim') continue;
    const refs = parseRefs(claim.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (refs.length) nameClaims.set(claim.pessoa_id, refs);
  }
  for (const person of people) {
    const refs = nameClaims.get(person.id) || parseRefs(canonical.pessoas[person.id].sources?.join(';') || '').filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (!refs.length) throw new Error(`Nome sem fonte pública permitida: ${person.id}`);
    const cids = [...new Set(refs.map(citation))];
    assertions.push({ id: person.preferred_name_assertion_id, subject_kind: 'person', subject_id: person.id, predicate: 'preferred_name', object_person_id: null, literal: person.label, date: null, interpretation: 'preferred', evidence_class: 'nome selecionado para esta edição; grafia conforme as fontes citadas', citation_ids: cids, public_note: '' });
  }
  const nameVariants = [
    { id: 'reni', predicate: 'alternate_name', literal: 'Reni Zaniratti Galo', refs: [{ id: 'U2', locator: 'relato familiar' }], interpretation: 'alternative', evidence: 'relato familiar' },
    { id: 'joao_galo', predicate: 'alternate_name', literal: 'João Gallo', refs: [{ id: 'U2', locator: 'relato familiar' }], interpretation: 'alternative', evidence: 'relato familiar' },
    { id: 'valentim', predicate: 'alternate_name', literal: 'Valentim Zanirate', refs: [{ id: 'P2', locator: 'p. 1' }], interpretation: 'alternative', evidence: 'grafia transcrita de documento fornecido' },
    { id: 'rejane', predicate: 'name_spelling_divergence', literal: 'Rejane Natalino Galo Esteves', refs: [{ id: 'P1', locator: 'p. 1' }, { id: 'P3', locator: 'p. 1' }], interpretation: 'disputed', evidence: 'divergência de grafia em documentos', publicNote: 'P1 registra Natalino; P3 registra Natalina. As formas permanecem atribuídas às fontes.' },
  ];
  for (const variant of nameVariants) {
    const id = `a-${variant.predicate}-${variant.id}`;
    assertions.push({ id, subject_kind: 'person', subject_id: variant.id, predicate: variant.predicate, object_person_id: null, literal: variant.literal, date: null, interpretation: variant.interpretation, evidence_class: variant.evidence, citation_ids: [...new Set(variant.refs.map(citation))], public_note: variant.publicNote || '' });
    peopleById.get(variant.id).claim_ids.push(id);
  }

  const parentEdges = [];
  for (const [index, edge] of canonical.parentescos.entries()) {
    if (!peopleById.has(edge.parent) || !peopleById.has(edge.child)) throw new Error(`Ponta ausente no vínculo ${edge.parent} -> ${edge.child}`);
    if (!PUBLIC_CLASSES.has(edge.classe)) throw new Error(`Classe de vínculo não revisada: ${edge.classe}`);
    const refs = parseRefs(edge.fontes);
    const cids = [...new Set(refs.map(citation))];
    const id = `a-parent-${index + 1}-${edge.parent}-${edge.child}`;
    assertions.push({ id, subject_kind: 'person', subject_id: edge.child, predicate: 'child_of', object_person_id: edge.parent, literal: '', date: null, interpretation: 'preferred', evidence_class: edge.classe, citation_ids: cids, public_note: '' });
    peopleById.get(edge.parent).claim_ids.push(id);
    peopleById.get(edge.child).claim_ids.push(id);
    parentEdges.push({ parent: edge.parent, child: edge.child, id });
  }
  if (parentEdges.length !== PUBLIC_EDGE_COUNT) throw new Error('Nem todos os vínculos autorizados foram projetados.');
  const attivitaRefs = [citation({ id: 'U2', locator: 'relato familiar' }), citation({ id: 'U3', locator: 'relato familiar adicional' })];
  assertions.push({ id: 'a-memory-attivita-custode', subject_kind: 'person', subject_id: 'custode', predicate: 'travel_memory_not_confirmed', object_person_id: null, literal: 'Attività: lembrança familiar; chegada e lista de passageiros não comprovadas.', date: null, interpretation: 'annotation', evidence_class: 'relato familiar, não confirmado', citation_ids: attivitaRefs, public_note: '' });
  peopleById.get('custode').claim_ids.push('a-memory-attivita-custode');
  const grandfatherConflictRefs = [citation({ id: 'P1', locator: 'p. 1' }), citation({ id: 'P3', locator: 'p. 1' })];
  assertions.push({ id: 'a-conflict-maternal-grandfather-jv', subject_kind: 'person', subject_id: 'jv', predicate: 'source_divergence', object_person_id: null, literal: 'Na certidão de João Vítor, o avô materno aparece como José Galo; os registros de Reni e Rejane identificam João Galo. A divergência permanece aberta.', date: null, interpretation: 'disputed', evidence_class: 'divergência entre transcrições documentais', citation_ids: grandfatherConflictRefs, public_note: '' });
  peopleById.get('jv').claim_ids.push('a-conflict-maternal-grandfather-jv');
  assertions.push({ id: 'a-conflict-reni-father-name', subject_kind: 'person', subject_id: 'reni', predicate: 'father_name_on_death_record', object_person_id: null, literal: 'Vicentim Zanirate', date: null, interpretation: 'disputed', evidence_class: 'transcrição de óbito divergente do registro de casamento', citation_ids: [citation({ id: 'P2', locator: 'pp. 1, 2 e 4' })], public_note: 'O registro de casamento P2 p. 1 identifica Valentim; as páginas de óbito transcrevem Vicentim. A divergência não altera a filiação adotada.' });
  peopleById.get('reni').claim_ids.push('a-conflict-reni-father-name');

  // Components stay distinct. The isolated Gallo record remains unlinked rather than being attached by surname.
  const adjacency = new Map(people.map(p => [p.id, new Set()]));
  for (const edge of parentEdges) { adjacency.get(edge.parent).add(edge.child); adjacency.get(edge.child).add(edge.parent); }
  const components = [];
  const seen = new Set();
  for (const person of people) {
    if (seen.has(person.id)) continue;
    const stack = [person.id], ids = [];
    while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); ids.push(id); stack.push(...adjacency.get(id)); }
    components.push(ids.sort());
  }
  const branches = components.map(ids => {
    const id = ids.includes('giovanni16') ? 'ramo-salvatonica-san-biagio' : ids.includes('custode') ? 'ramo-francesco-bondeno-galo' : 'ramo-gallo-sem-vinculo';
    const label = id === 'ramo-salvatonica-san-biagio' ? 'Salvatonica / San Biagio' : id === 'ramo-francesco-bondeno-galo' ? 'Francesco / Bondeno e linha Galo' : 'Registro Gallo sem vínculo demonstrado';
    const note = id === 'ramo-salvatonica-san-biagio' ? 'Ramo apresentado separadamente; nenhuma ligação hipotética ao ramo Francesco/Bondeno foi incluída.' : id === 'ramo-gallo-sem-vinculo' ? 'Pessoa mantida em separado, sem atribuição de parentesco por sobrenome.' : 'A mãe de Valentim permanece desconhecida. Reni e Lourdes Espósito são pessoas distintas. A lembrança do Attività não confirma a chegada de Custode.';
    for (const pid of ids) peopleById.get(pid).branch_ids.push(id);
    return { id, label, description: 'Conjunto de pessoas ligado por afirmações de parentesco citadas.', person_ids: ids, note };
  });

  const groups = [];
  for (const [id, family] of Object.entries(canonical.familias)) {
    const participants = [...new Set([family.father, family.mother, ...(family.children || [])].filter(Boolean))];
    if (!participants.every(pid => peopleById.has(pid))) throw new Error(`Participante privado/ausente em agrupamento ${id}`);
    groups.push({ id, kind: 'parental_group', participant_ids: participants, event_ids: [], note: 'Grupo de pais e filhos conforme os vínculos citados; não equivale a registro de casamento.' });
  }

  const events = [];
  const eventClaims = new Map();
  function addDatedClaim({ id, subjectKind, subjectId, type, rawDate, refs, evidenceClass, publicNote = '' }) {
    const date = parseDateLiteral(rawDate);
    if (!date) throw new Error(`Data não reconhecida (${id}); não exportada automaticamente.`);
    const cids = [...new Set(refs.map(citation))];
    const assertionId = `a-${id}`;
    assertions.push({ id: assertionId, subject_kind: subjectKind, subject_id: subjectId, predicate: type, object_person_id: null, literal: rawDate, date, interpretation: 'preferred', evidence_class: evidenceClass, citation_ids: cids, public_note: publicNote });
    const eventId = `evt-${id}`;
    events.push({ id: eventId, type, subject_kind: subjectKind, subject_id: subjectId, claim_ids: [assertionId] });
    eventClaims.set(assertionId, eventId);
    return { assertionId, eventId };
  }
  for (const claim of canonical.afirmacoes) {
    if (!peopleById.has(claim.pessoa_id) || !['birth','death'].includes(claim.campo) || claim.adotado !== 'sim') continue;
    const refs = parseRefs(claim.fonte);
    const yearMatch = String(claim.valor).match(/\b(\d{4})\b/g);
    const year = yearMatch ? Math.min(...yearMatch.map(Number)) : null;
    const explicitHistoricalSite = claim.classe === 'transcrito do site' && refs.some(r => /^S\d+$/.test(r.id)) && year !== null && year <= 1906;
    const historicalFamilyReport = claim.pessoa_id === 'custode' && claim.campo === 'birth' && claim.classe === 'relato familiar' && refs.some(r => r.id === 'U2');
    const explicitDeath = claim.campo === 'death' && ['transcrito do site','transcrito do documento fornecido'].includes(claim.classe) && refs.some(r => /^S\d+$/.test(r.id) || /^P[1-4]$/.test(r.id));
    const confirmedDeceasedBirth = claim.campo === 'birth' && ['reni','joao_galo'].includes(claim.pessoa_id) && claim.classe === 'transcrito do documento fornecido' && refs.some(r => r.id === 'P2');
    if (!explicitHistoricalSite && !explicitDeath && !confirmedDeceasedBirth && !historicalFamilyReport) continue;
    if (refs.some(r => !ALLOWED_SOURCES.has(r.id))) continue;
    const evidenceClass = claim.classe;
    const result = addDatedClaim({ id: `${claim.campo}-${claim.pessoa_id}-${claim.valor.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`, subjectKind: 'person', subjectId: claim.pessoa_id, type: claim.campo, rawDate: claim.valor, refs, evidenceClass: historicalFamilyReport ? 'relato familiar; data não confirmada por documento civil' : evidenceClass });
    const knownBirthPlaces = {
      custode: { value: 'Stellata, Bondeno, Ferrara, Itália', refs: [{ id: 'U2', locator: 'relato familiar' }], evidence: 'relato familiar' },
      reni: { value: 'Santa Clara, Porciúncula, Rio de Janeiro, Brasil', refs: [{ id: 'P2', locator: 'p. 1' }], evidence: 'transcrito do documento fornecido' },
      joao_galo: { value: 'Varre-Sai, Rio de Janeiro, Brasil', refs: [{ id: 'P2', locator: 'p. 1' }], evidence: 'transcrito do documento fornecido' },
    };
    const place = knownBirthPlaces[claim.pessoa_id];
    if (claim.campo === 'birth' && place) {
      const placeId = `a-birth-place-${claim.pessoa_id}`;
      assertions.push({ id: placeId, subject_kind: 'person', subject_id: claim.pessoa_id, predicate: 'birth_place', object_person_id: null, literal: place.value, date: null, interpretation: 'preferred', evidence_class: place.evidence, citation_ids: [...new Set(place.refs.map(citation))], public_note: '' });
      peopleById.get(claim.pessoa_id).claim_ids.push(placeId);
      const event = events.find(e => e.id === result.eventId);
      if (event) event.claim_ids.push(placeId);
    }
  }

  // Only three explicit, cited marriages are published. The FAM/group records above never create marriages.
  const explicitMarriages = [
    { id: 'casamento-custode-ernesta-1880', groupId: 'union-custode-ernesta', participants: ['custode','ernesta'], date: '2 JUN 1880', refs: [{ id: 'P4', locator: 'extrato civil, ato 37' }], evidenceClass: 'ato civil fornecido; data explicitamente conferida' },
    { id: 'casamento-grandilia-nicola-1910', groupId: 'union-grandilia-nicola', participants: ['grandilia','nicola'], date: '31 DEC 1910', refs: [{ id: 'S4', locator: 'biografia, referência ao casamento' }], evidenceClass: 'transcrito do site histórico' },
    { id: 'casamento-reni-joao-1960', groupId: 'union-reni-joao', participants: ['reni','joao_galo'], date: '6 JAN 1960', refs: [{ id: 'P2', locator: 'p. 1' }], evidenceClass: 'ato civil fornecido; data explicitamente transcrita' },
  ];
  for (const marriage of explicitMarriages) {
    if (!marriage.participants.every(id => peopleById.has(id))) throw new Error(`Pessoa ausente na união ${marriage.groupId}`);
    const group = { id: marriage.groupId, kind: 'union', participant_ids: marriage.participants, event_ids: [`evt-${marriage.id}`], note: 'União publicada porque há afirmação explícita e citação própria.' };
    groups.push(group);
    const added = addDatedClaim({ id: marriage.id, subjectKind: 'group', subjectId: group.id, type: 'marriage', rawDate: marriage.date, refs: marriage.refs, evidenceClass: marriage.evidenceClass });
    group.event_ids = [added.eventId];
  }

  const sourceList = [...sourceMap.values()];
  const usedIds = new Set(citations.map(c => c.source_id));
  // Keep the 22 public PDF fichas available to the sources page, even when not used by a claim.
  const sources = sourceList.filter(s => usedIds.has(s.id) || s.id.startsWith('catalog-pdf-'));
  const siteRecords = siteCatalog.filter(x => x.arquivo_local && ['htm','html','gif','jpg'].includes(String(x.formato || '').toLowerCase()));
  const snapshot = {
    schema_version: '1.0.0',
    release: { id: 'zaniratti-galo-candidate-2026-10-11', state: 'candidate', generated_at: iso(), content_revision: 'rodada06-public-allowlist-v3', locale: 'pt', public_changelog: 'Nomes selecionados, vínculos citados, datas históricas explícitas, grupos parentais e casamentos com citação própria.' },
    people, branches, groups, events, assertions, citations, sources, assets: [asset], legacy_urls: [],
  };
  return { snapshot, siteRecords };
}

function buildGedcom(snapshot) {
  const lines = ['0 HEAD','1 SOUR ZanirattiGaloPublicExporter','1 GEDC','2 VERS 5.5.1','1 CHAR UTF-8'];
  const familyByChild = new Map();
  for (const assertion of snapshot.assertions.filter(a => a.predicate === 'child_of')) {
    familyByChild.set(assertion.subject_id, [...(familyByChild.get(assertion.subject_id) || []), assertion.object_person_id]);
  }
  for (const p of snapshot.people) {
    lines.push(`0 @${p.id}@ INDI`, `1 NAME ${p.label}`, `1 _PUBID ${p.id}`);
    for (const [child, parents] of familyByChild) if (parents.includes(p.id)) lines.push(`1 FAMS @F-${child}@`);
    if (familyByChild.has(p.id)) lines.push(`1 FAMC @F-${p.id}@`);
    const evts = snapshot.events.filter(e => e.subject_kind === 'person' && e.subject_id === p.id);
    for (const event of evts) {
      const claim = snapshot.assertions.find(a => a.id === event.claim_ids[0]);
      if (claim) {
        lines.push(`1 ${event.type === 'birth' ? 'BIRT' : 'DEAT'}`, `2 DATE ${claim.date.literal}`);
        const place = snapshot.assertions.find(a => a.subject_id === p.id && a.predicate === 'birth_place');
        if (event.type === 'birth' && place) lines.push(`2 PLAC ${place.literal}`);
        lines.push('2 SOUR @S-PUBLIC@');
      }
    }
    lines.push('1 SOUR @S-PUBLIC@');
  }
  for (const [child, parents] of familyByChild) {
    lines.push(`0 @F-${child}@ FAM`);
    for (const parent of parents) lines.push(`1 _PARENT @${parent}@`);
    lines.push(`1 CHIL @${child}@`, '1 NOTE Parentage assertions only; no marriage implied.', '1 SOUR @S-PUBLIC@');
  }
  for (const group of snapshot.groups.filter(g => g.kind === 'union')) {
    lines.push(`0 @${group.id}@ FAM`);
    for (const participant of group.participant_ids) lines.push(`1 _PARTNER @${participant}@`);
    const evt = snapshot.events.find(e => e.id === group.event_ids[0]);
    const claim = evt && snapshot.assertions.find(a => a.id === evt.claim_ids[0]);
    if (claim) lines.push('1 MARR', `2 DATE ${claim.date.literal}`, '2 SOUR @S-PUBLIC@');
  }
  lines.push('0 @S-PUBLIC@ SOUR','1 TITL Snapshot público candidato Zaniratti/Galo','1 NOTE Citações mínimas no snapshot JSON público.','0 TRLR');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (!['--input','--docs','--site-catalog','--approve'].includes(key) || !value) throw new Error('Uso: export-public.mjs --input <corpus.json> --docs <catalogo_documental.json> --site-catalog <catalogo_site.json> [--approve <decisao-editorial.json>]');
    args.set(key, path.resolve(value));
  }
  if (!args.has('--input') || !args.has('--docs') || !args.has('--site-catalog')) throw new Error('Informe explicitamente --input, --docs e --site-catalog; não há origem padrão.');
  for (const key of ['--input','--docs','--site-catalog']) {
    if (args.get(key).startsWith(`${ROOT}${path.sep}`)) throw new Error(`Entrada ${key} precisa ficar fora do checkout do site.`);
    const actualPath = await realpath(args.get(key));
    if (actualPath.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Entrada ${key} resolve para dentro do checkout do site.`);
    args.set(key, actualPath);
  }
  if (args.has('--approve')) {
    if (args.get('--approve').startsWith(`${ROOT}${path.sep}`)) throw new Error('A decisão editorial deve ficar fora do checkout público.');
    const approvalPath = await realpath(args.get('--approve'));
    if (approvalPath.startsWith(`${ROOT}${path.sep}`)) throw new Error('A decisão editorial resolve para dentro do checkout público.');
    args.set('--approve', approvalPath);
  }
  const inputBytes = await readFile(args.get('--input'));
  if (digest(inputBytes) !== EXPECTED_INPUT_SHA) throw new Error('Hash da base revisada mudou; a projeção exige nova conferência editorial.');
  const [canonical, docs, siteCatalog, assetBytes] = await Promise.all([
    Promise.resolve(JSON.parse(inputBytes.toString('utf8'))),
    readFile(args.get('--docs'), 'utf8').then(JSON.parse), readFile(args.get('--site-catalog'), 'utf8').then(JSON.parse), readFile(ASSET_PATH),
  ]);
  const originRecord = siteCatalog.find(x => x.arquivo_local === 'Foto/GeneaA3.gif');
  if (!originRecord || originRecord.sha256_local !== ASSET_ORIGIN_SHA) throw new Error('O hash de origem GeneaA3 não confere com o catálogo do site.');
  const originCapture = originRecord.capturas_indexadas?.find(c => c.snapshot)?.snapshot;
  if (originCapture !== 'https://web.archive.org/web/20041029160237id_/http://www.zaniratti.it:80/Foto/GeneaA3.gif') throw new Error('A captura de origem GeneaA3 mudou sem revisão.');
  const { snapshot, siteRecords } = buildSnapshot(canonical, docs, siteCatalog, assetBytes);
  let approvalDecision = null;
  if (args.has('--approve')) {
    const candidatePath = path.join(ROOT, 'content/public/snapshot.json');
    const oldCandidateText = await readFile(candidatePath, 'utf8');
    const oldCandidate = JSON.parse(oldCandidateText);
    if (oldCandidate.release?.state !== 'candidate' || oldCandidate.release?.content_revision !== snapshot.release.content_revision) throw new Error('Não há candidato da mesma revisão para aprovar. Gere e revise um candidato primeiro.');
    snapshot.release.generated_at = oldCandidate.release.generated_at;
    const approval = JSON.parse(await readFile(args.get('--approve'), 'utf8'));
    const candidateHash = digest(Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`));
    if (digest(Buffer.from(oldCandidateText)) !== candidateHash || approval.decision !== 'approved' || approval.release_id !== snapshot.release.id || approval.candidate_snapshot_sha256 !== candidateHash || approval.reviewer_role !== 'coordenação editorial' || !/^\d{4}-\d\d-\d\dT/.test(approval.reviewed_at || '') || (approval.public_changelog !== undefined && approval.public_changelog !== snapshot.release.public_changelog)) {
      throw new Error('Decisão inválida: requer o hash exato do candidato, release correspondente, papel coordenação editorial e reviewed_at.');
    }
    approvalDecision = { candidate_snapshot_sha256: candidateHash, reviewer_role: 'coordenação editorial', reviewed_at: approval.reviewed_at };
    snapshot.release.state = 'approved';
  }
  const gedcom = buildGedcom(snapshot);
  const dataText = `${JSON.stringify(snapshot, null, 2)}\n`;
  const manifest = {
    release_id: snapshot.release.id, state: snapshot.release.state, source_revision: snapshot.release.content_revision,
    source_snapshot_sha256: EXPECTED_INPUT_SHA,
    origin_asset: { catalog_path: 'Foto/GeneaA3.gif', sha256: ASSET_ORIGIN_SHA, capture_url: originCapture },
    snapshot_sha256: digest(Buffer.from(dataText)), assets: [{ path: ASSET_PUBLIC_PATH, sha256: digest(assetBytes), bytes: assetBytes.length }], gedcom_sha256: digest(Buffer.from(gedcom)),
    inventory_summary: { historical_site_records: siteRecords.length, catalog_pdf_records: 26 },
    note: snapshot.release.state === 'approved' ? 'Projeção pública revisada para disponibilização no site.' : 'Candidato local para revisão. Metadados públicos sem HTML bruto, documentos originais, caminhos locais ou conteúdo de e-mail.'
  };
  if (approvalDecision) manifest.approval_decision = approvalDecision;
  await mkdir(path.join(ROOT, 'content/public'), { recursive: true });
  await mkdir(path.join(ROOT, 'public/downloads'), { recursive: true });
  await writeFile(path.join(ROOT, 'content/public/snapshot.json'), dataText);
  await writeFile(path.join(ROOT, 'public/downloads/linha-principal.ged'), gedcom);
  const inventory = { generated_from: 'catalogo_site.json', entries: siteRecords.map(x => ({
    legacy_path: x.arquivo_local, format: x.formato || path.extname(x.arquivo_local).slice(1),
    status: x.status || 'catalogado', mime: x.mime_local || 'text/html', bytes: Number(x.bytes) || 0,
    capture_url: x.capturas_indexadas?.find(c => c.snapshot)?.snapshot || null,
    capture_timestamp_utc: x.capturas_indexadas?.find(c => c.timestamp_utc)?.timestamp_utc || null,
    reference_count: Array.isArray(x.paginas_que_referenciam) ? x.paginas_que_referenciam.length : 0,
    public_treatment: 'metadata_only; conteúdo histórico não é servido como HTML bruto',
  })) };
  const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
  manifest.inventory_sha256 = digest(Buffer.from(inventoryText));
  await writeFile(path.join(ROOT, 'content/public/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(ROOT, 'content/public/legacy-inventory.json'), inventoryText);
  console.log(`candidate ${snapshot.people.length} people / ${parentEdgeCount(snapshot)} parent edges / ${snapshot.groups.length} groups / ${snapshot.events.length} events / ${snapshot.sources.filter(s => s.id.startsWith('catalog-pdf-')).length} public PDF fichas`);
}
function parentEdgeCount(snapshot) { return snapshot.assertions.filter(a => a.predicate === 'child_of').length; }

main().catch(error => { console.error(`export-public: ${error.message}`); process.exitCode = 1; });
