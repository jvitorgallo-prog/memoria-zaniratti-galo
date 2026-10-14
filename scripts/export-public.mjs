#!/usr/bin/env node
/** Frozen-input exporter. Public output is assembled field by field; no source object is spread. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_INPUT_SHA = '2c063f6e0050fa6a3bec42c856160eb4a9b83eb22ae0c4d5155da1de81a575f9';
const CORE_PERSON_COUNT = 89;
const CORE_EDGE_COUNT = 118;
const CORE_FAMILY_COUNT = 20;
const PUBLIC_CLASSES = new Set(['transcrito do site', 'relato familiar', 'transcrito do documento fornecido', 'relato familiar com apoio indireto do site']);
const ALLOWED_SOURCES = new Set(['S1','S2','S3','S4','S5','S6','S7','S8','S9','U2','U3','P1','P2','P3','P4','legacy-luigi','legacy-pasqua','legacy-dante','legacy-grandilia','legacy-zenaide','legacy-genealogia']);
const PRIVATE_DOC_SOURCE_SEQUENCE = ['P4','P1','P2','P3'];
const ASSET_ID = 'asset-genea-a3-upper';
const ASSET_PATH = path.join(ROOT, 'public/assets/revisados/genea-a3-francesco-luigi-recorte.png');
const ASSET_PUBLIC_PATH = 'assets/revisados/genea-a3-francesco-luigi-recorte.png';
const ASSET_ORIGIN_SHA = '27a3b8087c74cb2d6f1c435fe727d153b9f41dc03d34c102b536cb47486f9fda';
const PUBLIC_LEGACY_PAGES = new Map([
  ['BRA/Luigi1883B.htm', { title: 'Luigi Zaniratti (1883–1886)', people: [], sources: ['legacy-luigi'] }],
  ['BRA/PasquaB.htm', { title: 'Pasqua Zaniratti (1881–1965)', people: [], sources: ['legacy-pasqua'] }],
  ['BRA/Dante1878B.htm', { title: 'Dante Zaniratti (1878–1879)', people: [], sources: ['legacy-dante'] }],
  ['Esposito/Grandilia.htm', { title: 'Grandilia Zaniratti (1887–1963)', people: ['grandilia'], sources: ['S4','legacy-grandilia'] }],
  ['Murucci/Zenaide1895.htm', { title: 'Zenaide Zaniratti (1895)', people: ['zenaide'], sources: ['S7','legacy-zenaide'] }],
  ['BRA/AlberoBondenoB.htm', { title: 'Árvore genealógica histórica de Bondeno', people: [], sources: ['S3','S5'] }],
  ['BRA/GenealogiaB.htm', { title: 'Critérios genealógicos do site histórico', people: [], sources: ['S5','legacy-genealogia'] }],
]);
const PUBLIC_LEGACY_IMAGES = new Map([
  ['Foto/GeneaA3.gif', { id: 'asset-genea-a3-original', title: 'Diagrama histórico GeneaA3', alt: 'Diagrama GeneaA3 do ramo Francesco e Luigi.', caption: 'Imagem histórica preservada; não determina por si só parentesco entre pessoas de mesmo nome.', people: ['luigi','custode'], sources: ['S3'], kind: 'diagram' }],
  ['Foto/AlbBiagio.gif', { id: 'asset-albero-san-biagio', title: 'Diagrama Salvatonica / San Biagio', alt: 'Diagrama genealógico histórico de Salvatonica e San Biagio.', caption: 'Ramo histórico mantido separado do ramo Francesco/Bondeno.', people: ['giovanni16'], sources: ['S1'], kind: 'diagram' }],
]);

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const iso = () => new Date().toISOString();
const cleanName = value => String(value || '').replaceAll('/', ' ').replace(/\s+/g, ' ').trim();
const parseRefs = value => String(value || '').split(';').flatMap(part => {
  const refs = [...part.matchAll(/\b(S\d+|U\d+|P\d+)\b(?:\s*([^;]*))?/g)];
  if (!refs.length) return [];
  return refs.map(match => ({ id: match[1], locator: (match[2] || '').replace(/[^A-Za-z0-9 .,:–-]/g, '').trim() || 'referência da fonte' }));
});
const legacySourceId = legacyPath => `legacy-item-${digest(Buffer.from(legacyPath)).slice(0, 16)}`;
const legacyAssetId = legacyPath => `asset-legacy-${digest(Buffer.from(legacyPath)).slice(0, 12)}`;
async function pruneGeneratedFiles(directory, keepPaths) {
  async function walk(current) {
    let entries = [];
    try { entries = await readdir(current, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        const remaining = await readdir(full);
        if (!remaining.length) await rmdir(full);
      } else {
        const relative = path.relative(ROOT, full).split(path.sep).join('/');
        if (!keepPaths.has(relative)) await unlink(full);
      }
    }
  }
  await walk(directory);
}
function privateDocumentSources(docs) {
  const records = docs.registros.filter(x => x.mime_type === 'application/pdf' && x.estado_publicacao === 'privado');
  if (records.length !== PRIVATE_DOC_SOURCE_SEQUENCE.length) throw new Error('A quantidade de documentos privados mudou; revisão editorial necessária.');
  return new Map(records.map((record, index) => [record, PRIVATE_DOC_SOURCE_SEQUENCE[index]]));
}

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

function makeSources(canonical, docs, siteCatalog, legacyAssets, documentAssets) {
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
    const imageAssets = id === 'S3' ? [ASSET_ID, 'asset-genea-a3-original'] : id === 'S1' ? ['asset-albero-san-biagio'] : [];
    sources.set(id, { id, title, kind: id.startsWith('S') ? 'historic_site' : 'family_testimony', public_reference: id.startsWith('S') ? 'Página ou imagem do site histórico.' : `Relato familiar, ${id}.`, approved_external_url: url, reproduction: id.startsWith('S') ? 'reviewed_copy' : 'metadata_only', asset_ids: imageAssets, public_note: id.startsWith('S') ? 'Referência ao conteúdo histórico preservado em captura arquivística.' : 'Testemunho familiar citado de forma resumida.' });
  }
  const legacySourceDefs = {
    'BRA/Luigi1883B.htm': ['legacy-luigi','Biografia histórica de Luigi Zaniratti'],
    'BRA/PasquaB.htm': ['legacy-pasqua','Biografia histórica de Pasqua Zaniratti'],
    'BRA/Dante1878B.htm': ['legacy-dante','Biografia histórica de Dante Zaniratti'],
    'Esposito/Grandilia.htm': ['legacy-grandilia','Biografia histórica de Grandilia Zaniratti'],
    'Murucci/Zenaide1895.htm': ['legacy-zenaide','Biografia histórica de Zenaide Zaniratti'],
    'BRA/GenealogiaB.htm': ['legacy-genealogia','Página de critérios genealógicos do site histórico'],
  };
  for (const [legacyPath, [id, title]] of Object.entries(legacySourceDefs)) {
    const record = siteCatalog.find(x => x.arquivo_local === legacyPath);
    const capture = record?.capturas_indexadas?.find(c => c.snapshot)?.snapshot || null;
    sources.set(id, { id, title, kind: 'historic_site', public_reference: `Cópia estática da página histórica ${legacyPath}.`, approved_external_url: capture, reproduction: 'reviewed_copy', asset_ids: [], public_note: 'Texto preservado da página histórica; scripts e contatos foram removidos.' });
  }
  const legacyRecords = siteCatalog.filter(x => x.arquivo_local && ['htm','html','gif','jpg'].includes(String(x.formato || '').toLowerCase()));
  for (const record of legacyRecords) {
    const id = legacySourceId(String(record.arquivo_local).replaceAll('\\', '/'));
    const capture = record.capturas_indexadas?.find(c => c.snapshot)?.snapshot || null;
    const ext = String(record.formato || '').toLowerCase();
    const candidateAssetId = PUBLIC_LEGACY_IMAGES.get(record.arquivo_local)?.id || legacyAssetId(record.arquivo_local);
    const assetIds = legacyAssets.some(a => a.id === candidateAssetId) ? [candidateAssetId] : [];
    sources.set(id, { id, title: path.basename(record.arquivo_local), kind: ['htm','html'].includes(ext) ? 'historic_site' : 'other', public_reference: `Item catalogado do site familiar: ${path.basename(record.arquivo_local)}.`, approved_external_url: capture, reproduction: ['recurso_recuperado','derivado_de_recuperacao'].includes(record.status) ? 'reviewed_copy' : 'metadata_only', asset_ids: assetIds, public_note: 'SHA e estado de recuperação registrados no inventário público do acervo.' });
  }
  // Four supplied personal documents retain only a short citation label and no URL or original bytes.
  for (const id of ['P1','P2','P3','P4']) {
    if (canonical.fontes[id]) {
      const asset = documentAssets.find(item => item.source_id === id);
      sources.set(id, { id, title: `Documento fornecido, referência ${id}`, kind: 'provided_document', public_reference: `Documento fornecido; citação mínima ${id}.`, approved_external_url: null, reproduction: 'reviewed_copy', asset_ids: asset ? [asset.id] : [], public_note: id === 'P4' ? 'Documento histórico público e extrato genealógico disponíveis no acervo.' : 'Extrato genealógico derivado disponível no acervo; o documento original não é publicado.' });
    }
  }
  const pdfs = docs.registros.filter(x => x.mime_type === 'application/pdf');
  if (pdfs.length !== 26) throw new Error(`Catálogo documental esperado: 26 PDFs; encontrado ${pdfs.length}`);
  let publicCounter = 0;
  for (const doc of pdfs) {
    const mapped = privateDocumentSources(docs).get(doc);
    if (mapped) continue; // P1–P4 are already represented with intentionally generic metadata.
    if (doc.estado_publicacao === 'privado') continue;
    if (doc.estado_publicacao !== 'pendente_revisao' || !/^https:\/\//.test(doc.url_original || '')) throw new Error(`PDF público sem URL ou revisão de catálogo: ${doc.arquivo_id}`);
    publicCounter += 1;
    const label = path.basename(doc.arquivo, '.pdf').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const id = `catalog-pdf-${String(publicCounter).padStart(2, '0')}`;
    const documentAsset = documentAssets.find(asset => asset.source_id === id);
    sources.set(id, { id, title: label, kind: 'archive_document', public_reference: 'Documento histórico disponível em repositório público.', approved_external_url: doc.url_original, reproduction: documentAsset ? 'reviewed_copy' : 'metadata_only', asset_ids: documentAsset ? [documentAsset.id] : [], public_note: documentAsset ? 'Cópia local de origem pública; hash registrado no acervo.' : 'Consulte a versão no repositório de origem.' });
  }
  if (publicCounter !== 22) throw new Error(`Esperados 22 PDFs de origem pública, encontrados ${publicCounter}`);
  return sources;
}

function sanitizeHistoricalHtml(text) {
  const html = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<(?:form|object|embed)\b[^>]*>[\s\S]*?<\/(?:form|object)\s*>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    // The reader is written as UTF-8, even when the archived HTML declared another charset.
    .replace(/<meta\b[^>]*>/gi, tag => tag.replace(/charset\s*=\s*(["']?)[\w.-]+/gi, (_match, quote) => `charset=${quote}utf-8`))
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+href\s*=\s*(["'])mailto:[\s\S]*?\1/gi, '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[contato removido]')
    .replace(/Cópia local parcial[^<]*<a[^>]*>\s*Fonte arquivada\s*<\/a>/gi, 'Página histórica preservada em captura arquivística.')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]*>/gi, '');
  const scrubText = value => value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[contato removido]')
    .replace(/\b(?:CPF|RG)\s*[:#-]?\s*[A-Z0-9./-]{5,}/gi, '[identificador removido]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[identificador removido]');
  return html.replace(/>([^<>]+)</g, (_, content) => `>${scrubText(content)}<`);
}

function htmlText(text) {
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[contato removido]')
    .replace(/Cópia local parcial[^.]*\./gi, '')
    .replace(/\s+/g, ' ').trim();
}

function rewriteLegacyLinks(html, legacyPath, records, availablePaths) {
  const known = new Set(records.map(x => String(x.arquivo_local).replaceAll('\\', '/')));
  const outputPath = original => {
    const ext = path.extname(original).slice(1).toLowerCase();
    if (ext === 'htm') return `acervo/site-historico/${original.replace(/\.htm$/i, '.html')}`;
    if (ext === 'html') return `acervo/site-historico/${original.replace(/\.html$/i, '.source.html')}`;
    if (['gif','jpg'].includes(ext)) return `assets/acervo/${original.replaceAll('/', '-')}`;
    if (ext === 'css') return `acervo/site-historico/${original}`;
    return null;
  };
  const fromPublic = outputPath(legacyPath);
  const rewrite = value => {
    const targetValue = String(value || '').trim();
    if (!targetValue || /^javascript:/i.test(targetValue)) return '';
    if (/^(?:mailto:|tel:|data:|#)/i.test(targetValue)) return targetValue;
    let resolved;
    let targetUrl;
    try { targetUrl = new URL(targetValue, `http://legacy/${legacyPath}`); resolved = decodeURIComponent(targetUrl.pathname.replace(/^\//, '')); } catch { return ''; }
    if (/_lacunas\.html$/i.test(resolved)) {
      const archivedUrl = targetUrl.searchParams.get('url');
      if (archivedUrl) {
        try {
          const archived = new URL(archivedUrl);
          const archivedHost = /^(?:www\.)?zaniratti\.it$/i.test(archived.hostname);
          const archivedPath = decodeURIComponent(archived.pathname.replace(/^\//, ''));
          const archivedTarget = outputPath(archivedPath);
          if (/^https?:$/i.test(archived.protocol) && archivedHost && availablePaths.has(archivedPath) && known.has(archivedPath) && archivedTarget) {
            return (path.posix.relative(path.posix.dirname(fromPublic), archivedTarget) || path.posix.basename(archivedTarget)) + archived.hash;
          }
        } catch {}
      }
      return '#legacy-page-not-recovered';
    }
    const archiveHost = /^(?:www\.)?zaniratti\.it$/i.test(targetUrl.hostname);
    if (/^https?:$/i.test(targetUrl.protocol) && !archiveHost && targetUrl.hostname !== 'legacy') return targetValue;
    const candidate = outputPath(resolved);
    if (!known.has(resolved) || !candidate) return archiveHost || targetUrl.hostname === 'legacy' && /\.(?:htm|html|asp|gif|jpe?g|png)$/i.test(resolved) ? '#legacy-page-not-recovered' : '';
    return (path.posix.relative(path.posix.dirname(fromPublic), candidate) || path.posix.basename(candidate)) + targetUrl.hash;
  };
  const rewritten = html.replace(/\b(href|src|background)\s*=\s*(["'])(.*?)\2/gi, (full, attr, quote, value) => {
    if (/^href$/i.test(attr) && /^#/.test(value)) return full;
    const rewritten = rewrite(value);
    if (rewritten === '#legacy-page-not-recovered' && attr.toLowerCase() === 'src') return `${attr}=${quote}#legacy-asset-not-recovered${quote} data-legacy-original="${encodeURIComponent(value)}"`;
    if (rewritten === '#legacy-page-not-recovered' && attr.toLowerCase() === 'background') return '';
    if (!rewritten) return ['href','src','background'].includes(attr.toLowerCase()) ? '' : full;
    return `${attr}=${quote}${rewritten}${quote}`;
  }).replace(/url\(([^)]*)\)/gi, (full, raw) => {
    const quote = raw.trim().match(/^(["'])(.*)\1$/);
    const value = quote ? quote[2] : raw.trim();
    if (/^(?:https?:|data:|#)/i.test(value)) return full;
    const rewritten = rewrite(value);
    if (rewritten === '#legacy-page-not-recovered') return 'none';
    return rewritten ? `url('${rewritten}')` : 'none';
  });
  return rewritten
    .replace(/<img\b([^>]*\bsrc\s*=\s*(["'])#legacy-asset-not-recovered\2[^>]*)>/gi, (_, attrs) => {
      const alt = attrs.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2]?.replace(/[<>]/g, '').trim();
      const encodedPath = attrs.match(/\bdata-legacy-original\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
      let originalPath = encodedPath;
      try { originalPath = decodeURIComponent(encodedPath); } catch {}
      const safePath = originalPath.replace(/[&<>"']/g, '');
      return `<span class="archive-link-missing">[imagem histórica não recuperada${safePath ? `: ${safePath}` : ''}${alt ? ` (${alt})` : ''}]</span>`;
    })
    .replace(/(<area\b[^>]*?)\s+href\s*=\s*(["'])#legacy-page-not-recovered\2/gi, '$1')
    .replace(/<a\b([^>]*href\s*=\s*(["'])#legacy-page-not-recovered\2[^>]*)>([\s\S]*?)<\/a>/gi, (_, _attrs, _quote, content) => {
      const label = htmlText(content);
      if (/^(?:\.\.\/)*_lacunas\.html\?url=/i.test(label)) return '<span class="archive-link-missing">[página histórica referenciada; cópia não recuperada]</span>';
      return content + '<span class="archive-link-missing"> [página não recuperada no acervo]</span>';
    })
    .replace(/\s(src|href|background)\s*=\s*(["'])#legacy-(?:page|asset)-not-recovered\2/gi, '');
}

async function prepareLegacy(siteCatalog, siteRoot) {
  const records = siteCatalog.filter(x => x.arquivo_local && ['htm','html','gif','jpg'].includes(String(x.formato || '').toLowerCase()));
  const confirmedPagePeople = new Map();
  const knownPaths = new Set(records.map(x => String(x.arquivo_local).replaceAll('\\', '/')));
  for (const [pagePath, pageInfo] of PUBLIC_LEGACY_PAGES) {
    if (!pageInfo.people?.length) continue;
    let pageBytes;
    try { pageBytes = await readFile(path.join(siteRoot, ...pagePath.split('/'))); } catch { continue; }
    const pageText = pageBytes.toString('utf8');
    for (const match of pageText.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
      let target;
      try { target = decodeURIComponent(new URL(match[2], `http://legacy/${pagePath}`).pathname.replace(/^\//, '')); } catch { continue; }
      if (!knownPaths.has(target) || target === 'Foto/Albero1.gif') continue;
      confirmedPagePeople.set(target, [...new Set([...(confirmedPagePeople.get(target) || []), ...pageInfo.people])]);
    }
  }
  const archiveItems = [];
  const assets = [];
  const publicFiles = [];
  const inventoryEntries = [];
  const availablePaths = new Set();
  for (const record of records) {
    const legacyPath = String(record.arquivo_local).replaceAll('\\', '/');
    if (!['recurso_recuperado','derivado_de_recuperacao'].includes(record.status)) continue;
    if (legacyPath.startsWith('/') || legacyPath.split('/').includes('..')) continue;
    try {
      const bytes = await readFile(path.join(siteRoot, ...legacyPath.split('/')));
      if (!record.sha256_local || digest(bytes) === record.sha256_local) availablePaths.add(legacyPath);
    } catch {}
  }
  for (const record of records) {
    const legacyPath = String(record.arquivo_local).replaceAll('\\', '/');
    if (legacyPath.startsWith('/') || legacyPath.split('/').includes('..')) throw new Error(`Caminho de legado inválido: ${legacyPath}`);
    const page = PUBLIC_LEGACY_PAGES.get(legacyPath);
    const image = PUBLIC_LEGACY_IMAGES.get(legacyPath);
    const originBytes = Number(record.bytes) || null;
    const capture = record.capturas_indexadas?.find(c => c.snapshot) || null;
    const originSha = /^[0-9a-f]{64}$/i.test(record.sha256_local || '') ? record.sha256_local : null;
    let localBytes = null;
    const ext = path.extname(legacyPath).slice(1).toLowerCase();
    const localPath = path.join(siteRoot, ...legacyPath.split('/'));
    try { localBytes = await readFile(localPath); } catch {}
    const localCopySha = localBytes ? digest(localBytes) : null;
    const matchesCatalogHash = !record.sha256_local || localCopySha === record.sha256_local;
    if ((page || image) && localBytes && !matchesCatalogHash) throw new Error(`SHA de item editorialmente selecionado diverge do catálogo: ${legacyPath}`);
    let publicPath = null, publicBytes = null, publicSha = null, status = 'catalog_only', transcript = null;
    let extractedTitle = null;
    const isHtml = ['htm','html'].includes(ext);
    const isImage = ['gif','jpg'].includes(ext);
    const eligibleLocal = localBytes && ['recurso_recuperado','derivado_de_recuperacao'].includes(record.status);
    const outputPath = ext === 'htm' ? `acervo/site-historico/${legacyPath.replace(/\.htm$/i, '.html')}` : ext === 'html' ? `acervo/site-historico/${legacyPath.replace(/\.html$/i, '.source.html')}` : isImage ? `assets/acervo/${legacyPath.replaceAll('/', '-')}` : null;
    if (eligibleLocal && isHtml) {
      const sanitized = rewriteLegacyLinks(sanitizeHistoricalHtml(localBytes.toString('utf8')), legacyPath, records, availablePaths);
      const titleMatch = sanitized.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
      const titleText = titleMatch ? htmlText(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';
      if (titleText && titleText.length <= 140 && !/^(?:Microsoft|Internet Explorer|Page cannot be displayed)$/i.test(titleText)) extractedTitle = titleText;
      publicBytes = Buffer.from(sanitized, 'utf8');
      publicPath = outputPath;
      publicSha = digest(publicBytes); status = 'public_derivative';
      publicFiles.push({ path: path.join(ROOT, 'public', ...publicPath.split('/')), bytes: publicBytes });
      transcript = htmlText(sanitized);
    } else if (eligibleLocal && isImage) {
      publicBytes = localBytes; publicPath = outputPath;
      publicSha = digest(publicBytes); status = 'original_public';
      publicFiles.push({ path: path.join(ROOT, 'public', ...publicPath.split('/')), bytes: publicBytes });
      const mime = record.mime_local || (ext === 'jpg' ? 'image/jpeg' : 'image/gif');
      const imageTitle = image?.title || path.basename(legacyPath, path.extname(legacyPath)).replace(/[_-]+/g, ' ');
      const linkedPeople = confirmedPagePeople.get(legacyPath) || [];
      const peopleLabel = linkedPeople.map(id => PUBLIC_LEGACY_PAGES.get([...PUBLIC_LEGACY_PAGES].find(([, info]) => info.people?.includes(id))?.[0])?.title || id).join(' e ');
      assets.push({ id: image?.id || legacyAssetId(legacyPath), public_path: publicPath, sha256: publicSha, mime, bytes: publicBytes.length, alt: image?.alt || `Imagem histórica: ${imageTitle}.`, caption: image?.caption || (linkedPeople.length ? `Imagem referenciada pela página histórica de ${peopleLabel}; a relação de página não a identifica por si só como retrato.` : `Imagem recuperada do site histórico (${legacyPath}).`), rights_public_note: 'Arquivo público preservado do site familiar histórico; SHA-256 registrado no inventário.' });
    } else if (eligibleLocal && ext === 'css') {
      publicBytes = Buffer.from(localBytes.toString('utf8').replace(/@import\s+[^;]+;/gi, '').replace(/url\(([^)]*)\)/gi, (_, value) => `url(${value.replace(/["']/g, '')})`), 'utf8');
      publicPath = outputPath; publicSha = digest(publicBytes); status = 'public_derivative';
      publicFiles.push({ path: path.join(ROOT, 'public', ...publicPath.split('/')), bytes: publicBytes });
    } else if (eligibleLocal) status = isImage ? 'original_public' : 'public_derivative';
    else if (record.status === 'recurso_recuperado' || record.status === 'derivado_de_recuperacao') status = 'local_copy_review_needed';
    else if (capture) status = 'capture_indexed';
    const metadata = page || image || {};
    const id = `legacy-${legacyPath.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const kind = image?.kind || (isHtml ? 'historical_page' : ext === 'txt' ? 'document' : 'inventory_record');
    const title = metadata.title || extractedTitle || path.basename(legacyPath);
    const personIds = [...new Set([...(metadata.people || []), ...(confirmedPagePeople.get(legacyPath) || [])])];
    const sourceIds = [...new Set([...(metadata.sources || []), legacySourceId(legacyPath)])];
    const imagePageTitle = isImage && confirmedPagePeople.has(legacyPath) ? [...PUBLIC_LEGACY_PAGES.values()].find(info => info.people?.some(id => personIds.includes(id)))?.title : null;
    const description = isHtml ? 'Cópia estática do conteúdo histórico; scripts e contatos foram removidos.' : image ? metadata.caption : isImage && imagePageTitle ? `Imagem usada na página histórica “${imagePageTitle}”; a relação de página não a identifica por si só como retrato.` : isImage ? `Imagem histórica do site familiar: ${path.basename(legacyPath)}.` : `Item do acervo antigo: ${path.basename(legacyPath)}.`;
    archiveItems.push({ id, title, kind, status, legacy_path: legacyPath, capture_url: capture?.snapshot || null, capture_timestamp_utc: capture?.timestamp_utc || null, original_sha256: originSha, original_bytes: originBytes, mime: record.mime_local || 'application/octet-stream', public_path: publicPath, public_sha256: publicSha, public_bytes: publicBytes?.length ?? null, person_ids: personIds, event_ids: [], source_ids: sourceIds, description, transcript });
    inventoryEntries.push({ legacy_path: legacyPath, format: record.formato || ext, status: record.status || 'catalogado', mime: record.mime_local || 'application/octet-stream', bytes: originBytes || 0, origin_sha256: originSha, local_copy_sha256: localCopySha, catalog_hash_matches_local_copy: matchesCatalogHash, capture_url: capture?.snapshot || null, capture_timestamp_utc: capture?.timestamp_utc || null, reference_count: Array.isArray(record.paginas_que_referenciam) ? record.paginas_que_referenciam.length : 0, public_status: status, public_path: publicPath, public_sha256: publicSha, public_bytes: publicBytes?.length ?? null });
  }
  for (const [legacyPath] of [...PUBLIC_LEGACY_PAGES, ...PUBLIC_LEGACY_IMAGES]) if (!records.some(x => x.arquivo_local === legacyPath)) throw new Error(`Item público selecionado não consta do catálogo: ${legacyPath}`);
  return { records, archiveItems, assets, publicFiles, inventoryEntries };
}

async function prepareDocuments(docs) {
  const pdfs = docs.registros.filter(x => x.mime_type === 'application/pdf');
  if (pdfs.length !== 26) throw new Error(`Catálogo documental esperado: 26 PDFs; encontrado ${pdfs.length}`);
  const archiveItems = [], assets = [], publicFiles = [];
  const privateSourceByRecord = privateDocumentSources(docs);
  let publicCounter = 0;
  const privateTranscripts = {
    P1: { title: 'Registro de nascimento — extrato genealógico', text: 'João Vítor consta como filho de Luiz Cláudio e Rejane; Reni aparece como avó materna. Para o avô materno, o registro informa José Galo. A data de nascimento e identificadores civis não são reproduzidos; a divergência do nome do avô permanece atribuída à fonte.' , people: ['jv','reni','joao_galo','rejane','luiz_claudio'] },
    P2: { title: 'Registros de Reni e João — extrato genealógico', text: 'Reni Zanirate Galo nasceu em 20 de março de 1938 em Santa Clara, Porciúncula, e faleceu em 23 de dezembro de 1998 em Petrópolis. João Galo nasceu em 16 de fevereiro de 1938 em Varre-Sai e faleceu em 13 de novembro de 2017 em Petrópolis. A transcrição registra o casamento dos dois em 6 de janeiro de 1960. Identificadores civis e dados médicos não são reproduzidos.' , people: ['reni','joao_galo'] },
    P3: { title: 'Registro de Rejane — nota de grafia', text: 'O documento registra Rejane Natalino Galo Esteves; outra transcrição registra Rejane Natalina Galo. As duas grafias permanecem atribuídas às respectivas fontes.' , people: ['rejane'] },
    P4: { title: 'Extrato de casamento de Custode e Ernesta', text: 'O extrato de casamento registra a união de Custode Sante e Ernesta Galliera em 2 de junho de 1880, ato 37. Custode consta com 31 anos e naturalidade em Bondeno; Ernesta consta com 21 anos.' , people: ['custode','ernesta'] },
  };
  const escaped = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  for (const doc of pdfs) {
    const sourceId = privateSourceByRecord.get(doc);
    const originalSha = /^[0-9a-f]{64}$/i.test(doc.sha256 || '') ? doc.sha256 : null;
    const stableId = sourceId ? `documento-${sourceId.toLowerCase()}` : `documento-catalog-pdf-${String(++publicCounter).padStart(2,'0')}`;
    let publicPath = null, publicSha = null, publicBytes = null, status = 'catalog_only', transcript = null;
    const personIds = [];
    if (sourceId) {
      const safe = privateTranscripts[sourceId];
      if (!safe) throw new Error(`Falta derivação pública para ${sourceId}`);
      personIds.push(...safe.people);
      transcript = safe.text;
      if (sourceId === 'P4') {
        const bytes = await readFile(String(doc.caminho_local));
        if (digest(bytes) !== doc.sha256) throw new Error('SHA do extrato P4 diverge do catálogo documental.');
        publicBytes = bytes; publicPath = 'assets/acervo/documentos/p4-original.pdf';
        publicSha = digest(publicBytes); status = 'original_public';
        assets.push({ id: 'asset-p4-original', source_id: 'P4', public_path: publicPath, sha256: publicSha, mime: 'application/pdf', bytes: publicBytes.length, alt: 'Extrato histórico de casamento de Custode Sante e Ernesta Galliera, 1880.', caption: 'Documento civil histórico consultado para a união de Custode e Ernesta; extrato genealógico resumido nesta ficha.', rights_public_note: 'Documento histórico familiar autorizado para publicação; SHA-256 registrado no acervo.' });
        publicFiles.push({ path: path.join(ROOT, 'public', ...publicPath.split('/')), bytes: publicBytes });
      } else {
        const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escaped(safe.title)}</title><main><h1>${escaped(safe.title)}</h1><p>${escaped(safe.text)}</p></main></html>`;
        publicBytes = Buffer.from(html, 'utf8');
        publicPath = `acervo/documentos/${sourceId.toLowerCase()}-extrato.html`;
        publicSha = digest(publicBytes); status = 'public_derivative';
        publicFiles.push({ path: path.join(ROOT, 'public', ...publicPath.split('/')), bytes: publicBytes });
      }
    } else {
      if (doc.estado_publicacao !== 'pendente_revisao' || !/^https:\/\//.test(doc.url_original || '')) throw new Error(`PDF público sem URL ou revisão de catálogo: ${doc.arquivo_id}`);
      const localPath = path.resolve(String(doc.caminho_local || ''));
      const bytes = await readFile(localPath);
      if (digest(bytes) !== originalSha) throw new Error(`SHA do PDF público diverge do catálogo: ${doc.arquivo_id}`);
      if (bytes.length > 50 * 1024 * 1024) throw new Error(`PDF excede o limite público de 50 MB: ${doc.arquivo_id}`);
      const sourceIdForPublic = `catalog-pdf-${String(publicCounter).padStart(2,'0')}`;
      const assetId = `asset-${sourceIdForPublic}`;
      publicPath = `assets/acervo/documentos/${sourceIdForPublic}.pdf`;
      publicBytes = bytes; publicSha = digest(bytes); status = 'original_public';
      assets.push({ id: assetId, source_id: sourceIdForPublic, public_path: publicPath, sha256: publicSha, mime: 'application/pdf', bytes: bytes.length, alt: 'Documento histórico em PDF.', caption: 'Cópia local do documento disponível no repositório público indicado.', rights_public_note: 'Fonte pública catalogada; SHA-256 conferido contra o catálogo documental.' });
      publicFiles.push({ path: path.join(ROOT, 'public', ...publicPath.split('/')), bytes });
    }
    const title = sourceId ? privateTranscripts[sourceId].title : path.basename(doc.arquivo, '.pdf').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    archiveItems.push({ id: stableId, title, kind: 'document', status, legacy_path: `catalogo-documental/${stableId}`, capture_url: sourceId ? null : doc.url_original, capture_timestamp_utc: sourceId ? null : doc.capturado_em_utc || null, original_sha256: sourceId && sourceId !== 'P4' ? null : originalSha, original_bytes: sourceId && sourceId !== 'P4' ? null : Number(doc.bytes) || null, mime: 'application/pdf', public_path: publicPath, public_sha256: publicSha, public_bytes: publicBytes?.length || null, person_ids: personIds, event_ids: [], source_ids: [sourceId || `catalog-pdf-${String(publicCounter).padStart(2,'0')}`], description: sourceId === 'P4' ? 'Documento civil histórico completo e extrato genealógico; hash de publicação conferido.' : sourceId ? 'Derivação editorial com fatos genealógicos selecionados; metadados privados do original foram omitidos.' : 'PDF de origem pública preservado integralmente; origem e hash registrados.', transcript });
  }
  if (publicCounter !== 22) throw new Error(`Esperados 22 PDFs de origem pública, encontrados ${publicCounter}`);
  return { archiveItems, assets, publicFiles };
}

function buildSnapshot(canonical, docs, siteCatalog, assetBytes, legacy, supplemental, releaseOptions) {
  if (Object.keys(canonical.pessoas || {}).length !== CORE_PERSON_COUNT) throw new Error('Contagem do núcleo de pessoas mudou; exige revisão editorial.');
  if (canonical.parentescos?.length !== CORE_EDGE_COUNT) throw new Error('Contagem do núcleo de vínculos mudou; exige revisão editorial.');
  if (Object.keys(canonical.familias || {}).length !== CORE_FAMILY_COUNT) throw new Error('Contagem do núcleo de agrupamentos mudou; exige revisão editorial.');
  const assetDigest = digest(assetBytes);
  const asset = { id: ASSET_ID, public_path: ASSET_PUBLIC_PATH, sha256: assetDigest, mime: 'image/png', bytes: assetBytes.length, alt: 'Recorte superior do diagrama GeneaA3, com Francesco, Luigi e irmãos no ramo de Bondeno.', caption: 'O diagrama é uma versão histórica; a identificação de pessoas com o mesmo nome em relatos familiares não é presumida.', rights_public_note: 'Derivado do diagrama histórico identificado por captura e SHA-256 no manifesto.' };
  const sourceMap = makeSources(canonical, docs, siteCatalog, legacy.assets, legacy.documentAssets || []);
  const citations = [];
  const citationMap = new Map();
  function citation(ref) {
    if (!ALLOWED_SOURCES.has(ref.id) && !ref.id.startsWith('legacy-item-')) throw new Error(`Fonte privada ou não aprovada bloqueou a exportação: ${ref.id}`);
    if (!sourceMap.has(ref.id)) throw new Error(`Fonte citada não tem ficha pública saneada: ${ref.id}`);
    const key = `${ref.id}|${ref.locator}`;
    if (!citationMap.has(key)) {
      const id = `c-${ref.id.toLowerCase()}-${citations.length + 1}`;
      citationMap.set(key, id);
      citations.push({ id, source_id: ref.id, locator: ref.locator || 'referência da fonte', quote: null, translation: null, language: null });
    }
    return citationMap.get(key);
  }

  const people = Object.entries(canonical.pessoas).map(([id, raw]) => {
    let label = cleanName(raw.name);
    const surname = canonical.afirmacoes.find(c => c.pessoa_id === id && c.campo === 'anexo_sobrenome' && c.adotado === 'preservado como alegação de entrada')?.valor;
    if (!['fernando','vera','elcio'].includes(id) && !label.includes(' ') && surname && surname !== label) label = `${label} ${cleanName(surname)}`;
    if (id === 'lourdes_esposito') label = 'Lourdes Espósito';
    if (id === 'reni') label = 'Reni Zaniratti Galo';
    if (id === 'elisa') label = 'Elisa Bernardino Zaniratti';
    return { id, label, preferred_name_assertion_id: `a-name-${id}`, claim_ids: [`a-name-${id}`], branch_ids: [], aliases: [] };
  });
  const coreIds = new Set(people.map(p => p.id));
  const knownPagePeople = new Map([
    ['Esposito/Grandilia.htm','grandilia'],
    ['Murucci/Zenaide1895.htm','zenaide'],
    ['BRA/Edmondo1950B.htm','edmondo1950'],
    ['BRA/FrancescoB.htm','francesco'],
    ['BRA/Luigi1803B.htm','luigi'],
    ['BRA/CustodeSanteB.htm','custode'],
    ['BRA/ValentimB.htm','valentim'],
    ['BRA/Dante1882B.htm','dante1882'],
    ['BRA/PasquaMellaraB.htm','pasqua'],
    ['BRA/MariaCavalliniB.htm','maria_cavallini'],
    ['BRA/ErnestaGallieraB.htm','ernesta'],
    ['BRA/Antonio1846B.htm','antonio1846'],
    // These exact profile URLs are the already-adopted children in the 10-child
    // Grandilia/Nicola family list; the legacy page is another transcription of
    // those same people, not a second generation of namesakes.
    ['Esposito/Luzia_Esposito.htm','luzia'],
    ['Esposito/Ana_Maria.htm','ana_maria'],
    ['Esposito/Helia_Esposito.htm','helia'],
    ['Esposito/Orestes1915.htm','orestes'],
    ['Esposito/Santina_Esposito.htm','santina'],
    ['Esposito/MariaGrandiliaEsposito.htm','maria_esposito'],
    ['Esposito/Valquiria.htm','valquiria'],
    ['Esposito/LourdesEsposito.htm','lourdes_esposito'],
    ['Esposito/Carmen_Esposito.htm','carmen'],
    ['Esposito/Mafalda_Esposito.htm','mafalda'],
    // The 16 names in this exact Murucci page reproduce the adopted S7 list.
    ['Murucci/Zelmira_Murucci.htm','zenaide_child_1'],
    ['Murucci/Auresmina.htm','zenaide_child_2'],
    ['Murucci/Conceicao1933.htm','zenaide_child_3'],
    ['Murucci/Darzina_Murucci.htm','zenaide_child_4'],
    ['Murucci/MariaZenaide.htm','zenaide_child_5'],
    ['Murucci/QuitaZenaide.htm','zenaide_child_6'],
    ['Murucci/Geraldo1111.htm','zenaide_child_7'],
    ['Murucci/AurecilZenaide.htm','zenaide_child_8'],
    ['Murucci/PedroZenaide.htm','zenaide_child_9'],
    ['Murucci/Anibal_Murucci.htm','zenaide_child_10'],
    ['Murucci/Antonio1111.htm','zenaide_child_11'],
    ['Murucci/Felipe1922.htm','zenaide_child_12'],
    ['Murucci/Sebastiao1111.htm','zenaide_child_13'],
    ['Murucci/JoaoZenaide.htm','zenaide_child_14'],
    ['Murucci/JoseRainazo.htm','zenaide_child_15'],
    ['Murucci/GabrielBelo.htm','zenaide_child_16'],
    ...[
      ['Giovanni16XX','giovanni16'],['Bartolomeo1','bartolomeo1'],['Domenica1724','domenica1724'],['Giovanna1725','giovanna1725'],['Giovanni1727','giovanni1727'],['Cattarina1729','cattarina1729'],['Angela1733','angela1733'],['Giovanni1741','giovanni1741'],['Bartolomeo1768','bartolomeo1768'],['Giuseppe1770','giuseppe1770'],['Domenico1772','domenico1772'],['Domenica1775','domenica1775'],['Antonio1777','antonio1777'],['Barbara1778','barbara1778'],['Maria1780','maria1780'],['Vittoria1782','vittoria1782'],['GiovanniBattista1803','giovanni1803'],['Bartolomeo1829','bartolomeo1829'],['Rosa1832','rosa1832'],['Francesco1833','francesco1833'],['Enrica1837','enrica1837'],
    ].flatMap(([stem,id]) => [[`BRA/${stem}B.htm`,id],[`ITA/${stem}I.htm`,id]]),
  ]);
  const normalizedLegacyPath = legacyPath => String(legacyPath).replace(/^(?:Esposito|Murucci)\//,'');
  // Andreza1976B and AndrezaB contain the same complete parent/sibling/spouse/
  // child table; use the latter URL as their stable identity key.
  const equivalentLegacyPaths = new Map([['BRA/Andreza1976B.htm','BRA/AndrezaB.htm']]);
  const canonicalLegacyPath = legacyPath => equivalentLegacyPaths.get(String(legacyPath)) || String(legacyPath);
  const pathId = legacyPath => {
    const canonicalPath = canonicalLegacyPath(legacyPath);
    return knownPagePeople.get(canonicalPath) || knownPagePeople.get(normalizedLegacyPath(canonicalPath)) || `hist-${digest(Buffer.from(normalizedLegacyPath(canonicalPath).toLowerCase())).slice(0,16)}`;
  };
  const profileByPath = new Map(supplemental.pages.filter(p => p.relations.length).map(p => [p.path.toLowerCase(),p]));
  const pageByPath = new Map(supplemental.pages.map(p => [p.path.toLowerCase(),p]));
  const labelsByPath = new Map();
  function setPathLabel(legacyPath, label, priority) {
    if (!legacyPath || !label) return;
    const key = legacyPath.toLowerCase();
    const old = labelsByPath.get(key);
    if (!old || priority > old.priority) labelsByPath.set(key,{ label: cleanName(label), priority });
  }
  for (const page of supplemental.pages) {
    if (page.title && !page.tree_map) setPathLabel(page.path,page.title,page.relations.length ? 4 : 3);
    for (const relation of page.relations) for (const ref of relation.names) if (ref.target) setPathLabel(ref.target,ref.label,2);
    for (const ref of page.map_nodes || []) if (ref.target && ref.label && !/^(?:nato|nasc|born|morto|morte|n\.?\s*\d)/i.test(ref.label)) setPathLabel(ref.target,ref.label,1);
  }
  const linkedPaths = new Set();
  for (const page of supplemental.pages) {
    if (page.relations.length) linkedPaths.add(page.path.toLowerCase());
    for (const relation of page.relations) for (const ref of relation.names) if (ref.target) linkedPaths.add(ref.target.toLowerCase());
    for (const ref of page.map_nodes || []) if (ref.target) linkedPaths.add(ref.target.toLowerCase());
  }
  const supplementalPeople = [];
  const unlinkedIds = new Map();
  function unlinkedId(pagePath, role, label, anchor = '') {
    const normalizedLabel = cleanName(label).toLocaleLowerCase('pt-BR');
    if (role === 'parent' && normalizedLabel === 'ernesta galliera' && anchor === 'co-parent:custode') return 'ernesta';
    if (role === 'parent' && normalizedLabel === 'maria cavallini' && pagePath === 'BRA/Antonio1846B.htm' && anchor === 'co-parent:luigi') return 'maria_cavallini';
    if (role === 'spouse' && normalizedLabel === 'felipe murucci' && pagePath === 'Murucci/Zenaide1895.htm') return 'felipe_murucci';
    if (role === 'spouse' && normalizedLabel === 'flora salani' && pagePath === 'BRA/Antonio1846B.htm') {
      const key='parent|flora salani|co-parent:antonio1846';
      if (!unlinkedIds.has(key)) unlinkedIds.set(key,`hist-ref-${digest(Buffer.from(key)).slice(0,16)}`);
      return unlinkedIds.get(key);
    }
    const key = `${role}|${cleanName(label).toLowerCase()}|${anchor || pagePath.toLowerCase()}`;
    if (!unlinkedIds.has(key)) unlinkedIds.set(key,`hist-ref-${digest(Buffer.from(key)).slice(0,16)}`);
    return unlinkedIds.get(key);
  }
  function unlinkedAnchor(page, role, subjectId) {
    const parents=page.relations.find(r=>r.role==='parent')?.names.filter(n=>n.target).map(n=>pathId(n.target)).sort() || [];
    const spouses=page.relations.find(r=>r.role==='spouse')?.names.filter(n=>n.target).map(n=>pathId(n.target)).sort() || [];
    if (role==='parent' && parents.length) return `co-parent:${parents.join('|')}`;
    if (role==='sibling' && parents.length) return `parents:${parents.join('|')}`;
    if (role==='spouse') return `spouse-of:${subjectId}`;
    if (role==='child' && (subjectId || spouses.length)) return `parents:${[subjectId,...spouses].sort().join('|')}`;
    return '';
  }
  for (const page of supplemental.pages) {
    if (page.relations.length) {
      const id = pathId(page.path);
      if (!coreIds.has(id) && !supplementalPeople.some(p => p.id === id)) {
        supplementalPeople.push({ id, label: cleanName(page.title) || 'Pessoa citada em página histórica', preferred_name_assertion_id: `a-name-${id}`, claim_ids: [`a-name-${id}`], branch_ids: [], aliases: [], _name_source_path: page.path });
      }
    }
    const subjectId = pathId(page.path);
    for (const relation of page.relations) for (const ref of relation.names) {
      const id = ref.target ? pathId(ref.target) : unlinkedId(page.path,relation.role,ref.label,unlinkedAnchor(page,relation.role,subjectId));
      if (!coreIds.has(id) && !supplementalPeople.some(p => p.id === id)) {
        const sourcePath = ref.target && profileByPath.get(ref.target.toLowerCase()) ? profileByPath.get(ref.target.toLowerCase()).path : page.path;
        supplementalPeople.push({ id, label: ref.target ? (labelsByPath.get(ref.target.toLowerCase())?.label || 'Pessoa referenciada no site histórico') : cleanName(ref.label), preferred_name_assertion_id: `a-name-${id}`, claim_ids: [`a-name-${id}`], branch_ids: [], aliases: [], _name_source_path: sourcePath, _unlinked: !ref.target });
      }
    }
    for (const ref of page.map_nodes || []) if (ref.target) {
      const id = pathId(ref.target);
      if (!coreIds.has(id) && !supplementalPeople.some(p => p.id === id)) {
        const label = labelsByPath.get(ref.target.toLowerCase())?.label;
        if (!label) continue;
        const sourcePath = pageByPath.get(ref.target.toLowerCase())?.path || page.path;
        supplementalPeople.push({ id, label, preferred_name_assertion_id: `a-name-${id}`, claim_ids: [`a-name-${id}`], branch_ids: [], aliases: [], _name_source_path: sourcePath, _map_only: !profileByPath.has(ref.target.toLowerCase()) });
      }
    }
  }
  const edmondoId = 'edmondo1950';
  if (!coreIds.has(edmondoId) && !supplementalPeople.some(p => p.id === edmondoId)) supplementalPeople.push({ id: edmondoId, label: 'Edmondo Lorenzo Zaniratti', preferred_name_assertion_id: `a-name-${edmondoId}`, claim_ids: [`a-name-${edmondoId}`], branch_ids: [], aliases: [], _name_source_path: 'BRA/Edmondo1950B.htm' });
  const edmondoProfile = profileByPath.get('bra/edmondo1950b.htm');
  if (!edmondoProfile && !supplementalPeople.some(p => p.id === edmondoId)) throw new Error('Não foi encontrado Edmondo Lorenzo no corpus fornecido.');
  for (const person of supplementalPeople) people.push(person);
  const peopleById = new Map(people.map(p => [p.id, p]));
  const assertions = [];
  const nameClaims = new Map();
  for (const claim of canonical.afirmacoes) {
    if (!peopleById.has(claim.pessoa_id) || !['name','anexo_nome','anexo_sobrenome','grafia_familiar','nome_usual'].includes(claim.campo) || claim.adotado !== 'sim') continue;
    const refs = parseRefs(claim.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (refs.length) nameClaims.set(claim.pessoa_id, refs);
  }
  for (const person of people) {
    const refs = nameClaims.get(person.id) || parseRefs(canonical.pessoas[person.id]?.sources?.join(';') || '').filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (!refs.length && coreIds.has(person.id)) throw new Error(`Nome sem fonte pública permitida: ${person.id}`);
    if (!refs.length) continue;
    const cids = [...new Set(refs.map(citation))];
    assertions.push({ id: person.preferred_name_assertion_id, subject_kind: 'person', subject_id: person.id, predicate: 'preferred_name', object_person_id: null, literal: person.label, date: null, interpretation: 'preferred', evidence_class: 'nome selecionado para esta edição; grafia conforme as fontes citadas', citation_ids: cids, public_note: '' });
  }
  for (const person of supplementalPeople) {
    if (assertions.some(a => a.id === person.preferred_name_assertion_id)) continue;
    const sourcePath = person._name_source_path;
    const sourceId = sourcePath && legacySourceId(sourcePath);
    if (!sourceId || !sourceMap.has(sourceId)) throw new Error(`Nome de referência sem página-fonte pública: ${person.id}`);
    const ref = citation({ id: sourceId, locator: person._unlinked ? 'tabela de relações, nome sem link individual' : person._map_only ? 'mapa histórico, destino sem página recuperada' : 'título ou referência de página histórica' });
    assertions.push({ id: person.preferred_name_assertion_id, subject_kind: 'person', subject_id: person.id, predicate: 'preferred_name', object_person_id: null, literal: person.label, date: null, interpretation: person._unlinked || person._map_only ? 'annotation' : 'preferred', evidence_class: person._unlinked || person._map_only ? 'referência literal em página histórica; identidade não individualizada' : 'página histórica recuperada', citation_ids: [ref], public_note: person._unlinked || person._map_only ? 'Referência estável a uma menção ou destino sem página individual recuperada; não equivale a identidade confirmada.' : '' });
  }
  const nameVariants = [
    { id: 'reni', predicate: 'alternate_name', literal: 'Reni Zanirate Galo', refs: [{ id: 'P2', locator: 'p. 1' }], interpretation: 'alternative', evidence: 'grafia transcrita de documento fornecido' },
    { id: 'elisa', predicate: 'alternate_name', literal: 'Elisa Bernardino Zanirate', refs: [{ id: 'P2', locator: 'p. 1' }], interpretation: 'alternative', evidence: 'grafia transcrita de documento fornecido' },
    { id: 'joao_galo', predicate: 'alternate_name', literal: 'João Gallo', refs: [{ id: 'U2', locator: 'relato familiar' }], interpretation: 'alternative', evidence: 'relato familiar' },
    { id: 'valentim', predicate: 'alternate_name', literal: 'Valentim Zanirate', refs: [{ id: 'P2', locator: 'p. 1' }], interpretation: 'alternative', evidence: 'grafia transcrita de documento fornecido' },
    { id: 'rejane', predicate: 'name_spelling_divergence', literal: 'Rejane Natalino Galo Esteves', refs: [{ id: 'P1', locator: 'p. 1' }, { id: 'P3', locator: 'p. 1' }], interpretation: 'disputed', evidence: 'divergência de grafia em documentos', publicNote: 'P1 registra Natalino; P3 registra Natalina. As formas permanecem atribuídas às fontes.' },
  ];
  for (const variant of nameVariants) {
    const id = `a-${variant.predicate}-${variant.id}`;
    assertions.push({ id, subject_kind: 'person', subject_id: variant.id, predicate: variant.predicate, object_person_id: null, literal: variant.literal, date: null, interpretation: variant.interpretation, evidence_class: variant.evidence, citation_ids: [...new Set(variant.refs.map(citation))], public_note: variant.publicNote || '' });
    peopleById.get(variant.id).claim_ids.push(id);
  }

  const variantFields = new Set(['grafia_familiar','grafia_nome_documento','nome_usual','nome_filho','variacao_site','nome_literal_titulo','nome_literal_certidao_filho','nome_literal_declarante','anexo_nome','anexo_sobrenome']);
  for (const claim of canonical.afirmacoes) {
    if (!peopleById.has(claim.pessoa_id) || !variantFields.has(claim.campo) || claim.adotado === 'não' || claim.campo.startsWith('anexo_') && claim.adotado !== 'preservado como alegação de entrada') continue;
    if (['fernando','vera','elcio'].includes(claim.pessoa_id) && claim.campo.startsWith('anexo_')) continue;
    const refs = parseRefs(claim.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (!refs.length) continue;
    const literal = cleanName(claim.valor);
    if (!literal || literal === peopleById.get(claim.pessoa_id).label) continue;
    const predicate = ['anexo_nome','anexo_sobrenome'].includes(claim.campo) ? 'historical_name_component' : 'alternate_name';
    const id = `a-${predicate}-${claim.pessoa_id}-${assertions.length + 1}`;
    const interpretation = claim.adotado === 'menção divergente' || claim.campo.includes('literal') ? 'disputed' : claim.campo.startsWith('anexo_') ? 'annotation' : 'alternative';
    assertions.push({ id, subject_kind: 'person', subject_id: claim.pessoa_id, predicate, object_person_id: null, literal, date: null, interpretation, evidence_class: claim.classe, citation_ids: [...new Set(refs.map(citation))], public_note: claim.campo.startsWith('anexo_') ? 'Grafia ou forma preservada da árvore/site histórico.' : '' });
    peopleById.get(claim.pessoa_id).claim_ids.push(id);
  }
  for (const person of people) {
    person.aliases = [...new Set(assertions.filter(a => a.subject_kind === 'person' && a.subject_id === person.id && ['alternate_name','name_spelling_divergence'].includes(a.predicate)).map(a => a.literal))].filter(name => name !== person.label).sort((a,b) => a.localeCompare(b, 'pt-BR'));
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
  if (parentEdges.length !== CORE_EDGE_COUNT) throw new Error('Nem todos os vínculos do núcleo foram projetados.');
  const attivitaRefs = [citation({ id: 'U2', locator: 'relato familiar' }), citation({ id: 'U3', locator: 'relato familiar adicional' })];
  assertions.push({ id: 'a-memory-attivita-custode', subject_kind: 'person', subject_id: 'custode', predicate: 'travel_memory_not_confirmed', object_person_id: null, literal: 'A família relata que Custode chegou ao Brasil no vapor Attività; a lista de passageiros e a data da viagem ainda não foram localizadas no acervo.', date: null, interpretation: 'annotation', evidence_class: 'relato familiar', citation_ids: attivitaRefs, public_note: '' });
  peopleById.get('custode').claim_ids.push('a-memory-attivita-custode');
  const grandfatherConflictRefs = [citation({ id: 'P1', locator: 'p. 1' }), citation({ id: 'P3', locator: 'p. 1' })];
  assertions.push({ id: 'a-conflict-maternal-grandfather-jv', subject_kind: 'person', subject_id: 'jv', predicate: 'source_divergence', object_person_id: null, literal: 'Na certidão de João Vítor, o avô materno aparece como José Galo; os registros de Reni e Rejane identificam João Galo. A divergência permanece aberta.', date: null, interpretation: 'disputed', evidence_class: 'divergência entre transcrições documentais', citation_ids: grandfatherConflictRefs, public_note: '' });
  peopleById.get('jv').claim_ids.push('a-conflict-maternal-grandfather-jv');
  assertions.push({ id: 'a-conflict-reni-father-name', subject_kind: 'person', subject_id: 'reni', predicate: 'father_name_on_death_record', object_person_id: null, literal: 'Vicentim Zanirate', date: null, interpretation: 'disputed', evidence_class: 'transcrição de óbito divergente do registro de casamento', citation_ids: [citation({ id: 'P2', locator: 'pp. 1, 2 e 4' })], public_note: 'O registro de casamento P2 p. 1 identifica Valentim; as páginas de óbito transcrevem Vicentim. A divergência não altera a filiação adotada.' });
  peopleById.get('reni').claim_ids.push('a-conflict-reni-father-name');

  // Build navigation components from adopted parentage plus explicit unions.
  // A spouse is included only when the marriage itself is an adopted assertion.
  const adjacency = new Map(people.filter(p => coreIds.has(p.id)).map(p => [p.id, new Set()]));
  for (const edge of parentEdges) { adjacency.get(edge.parent).add(edge.child); adjacency.get(edge.child).add(edge.parent); }
  const explicitCoreUnions = [
    ['custode','ernesta'],['grandilia','nicola'],['reni','joao_galo'],
    ['dante1882','maria_gallo'],['valentim','elisa'],['luigi','pasqua'],
    ['zenaide','felipe_murucci'],
  ];
  for (const [left,right] of explicitCoreUnions) if (adjacency.has(left) && adjacency.has(right)) { adjacency.get(left).add(right); adjacency.get(right).add(left); }
  const components = [];
  const seen = new Set();
  for (const person of people.filter(p => coreIds.has(p.id))) {
    if (seen.has(person.id)) continue;
    const stack = [person.id], ids = [];
    while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); ids.push(id); stack.push(...adjacency.get(id)); }
    components.push(ids.sort());
  }
  const branches = components.map(ids => {
    const id = ids.includes('giovanni16') ? 'ramo-salvatonica-san-biagio' : ids.includes('custode') ? 'ramo-francesco-bondeno-galo' : `ramo-historico-${digest(Buffer.from(ids.join('|'))).slice(0,10)}`;
    const label = id === 'ramo-salvatonica-san-biagio' ? 'Salvatonica / San Biagio' : id === 'ramo-francesco-bondeno-galo' ? 'Francesco / Bondeno' : 'Pessoas em fichas relacionadas';
    const note = id === 'ramo-salvatonica-san-biagio' ? 'Ramo apresentado separadamente; nenhuma ligação hipotética ao ramo Francesco/Bondeno foi incluída.' : id === 'ramo-francesco-bondeno-galo' ? 'Descendência em Bondeno com ramos por casamento. Relações e datas têm origem consultável.' : 'Pessoas agrupadas por relações familiares explicitamente citadas.';
    for (const pid of ids) peopleById.get(pid).branch_ids.push(id);
    return { id, label, description: 'Conjunto de pessoas ligado por afirmações de parentesco citadas.', person_ids: ids, note };
  });

  const groups = [];
  for (const [id, family] of Object.entries(canonical.familias)) {
    const participants = [...new Set([family.father, family.mother, ...(family.children || [])].filter(Boolean))];
    if (!participants.every(pid => peopleById.has(pid))) throw new Error(`Participante privado/ausente em agrupamento ${id}`);
    const participantRoles = [];
    for (const pid of participants) {
      const role = pid === family.father || pid === family.mother ? 'parent' : 'child';
      participantRoles.push({ person_id: pid, role });
    }
    groups.push({ id, kind: 'parental_group', participant_ids: participants, participants: participantRoles, event_ids: [], note: 'Grupo de pais e filhos conforme os vínculos citados; não equivale a registro de casamento.' });
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
  const explicitDeaths = new Set(canonical.afirmacoes.filter(c => c.campo === 'death' && c.adotado === 'sim' && parseRefs(c.fonte).some(r => ALLOWED_SOURCES.has(r.id))).map(c => c.pessoa_id));
  for (const claim of canonical.afirmacoes) {
    if (!peopleById.has(claim.pessoa_id) || !['birth','death'].includes(claim.campo) || claim.adotado !== 'sim') continue;
    const refs = parseRefs(claim.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (!refs.length) continue;
    const yearMatch = String(claim.valor).match(/\b(\d{4})\b/g);
    const year = yearMatch ? Math.min(...yearMatch.map(Number)) : null;
    const historicalOrDeceasedBirth = claim.campo === 'birth' && ((year !== null && year <= 1906) || explicitDeaths.has(claim.pessoa_id));
    const explicitDeath = claim.campo === 'death';
    const historicalFamilyReport = claim.pessoa_id === 'custode' && claim.campo === 'birth' && refs.some(r => r.id === 'U2');
    if (!historicalOrDeceasedBirth && !explicitDeath && !historicalFamilyReport) continue;
    const evidenceClass = historicalFamilyReport ? 'relato familiar; data não confirmada por documento civil' : claim.classe;
    const result = addDatedClaim({ id: `${claim.campo}-${claim.pessoa_id}-${claim.valor.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`, subjectKind: 'person', subjectId: claim.pessoa_id, type: claim.campo, rawDate: claim.valor, refs, evidenceClass });
    const placeClaim = canonical.afirmacoes.find(p => p.pessoa_id === claim.pessoa_id && p.campo === (claim.campo === 'birth' ? 'birth_place' : 'death_place') && p.adotado === 'sim');
    if (placeClaim) {
      const placeRefs = parseRefs(placeClaim.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
      if (placeRefs.length) {
        const placeId = `a-${claim.campo}-place-${claim.pessoa_id}`;
        assertions.push({ id: placeId, subject_kind: 'person', subject_id: claim.pessoa_id, predicate: `${claim.campo}_place`, object_person_id: null, literal: cleanName(placeClaim.valor), date: null, interpretation: 'preferred', evidence_class: placeClaim.classe, citation_ids: [...new Set(placeRefs.map(citation))], public_note: '' });
        peopleById.get(claim.pessoa_id).claim_ids.push(placeId);
        const event = events.find(e => e.id === result.eventId);
        if (event) event.claim_ids.push(placeId);
      }
    }
  }

  // Only explicitly reported or cited marriages are published. The FAM/group records above never create marriages.
  const explicitMarriages = [
    { id: 'casamento-custode-ernesta-1880', groupId: 'union-custode-ernesta', participants: ['custode','ernesta'], date: '2 JUN 1880', refs: [{ id: 'P4', locator: 'extrato civil, ato 37' }], evidenceClass: 'ato civil fornecido; data explicitamente conferida' },
    { id: 'casamento-grandilia-nicola-1910', groupId: 'union-grandilia-nicola', participants: ['grandilia','nicola'], date: '31 DEC 1910', refs: [{ id: 'S4', locator: 'biografia, referência ao casamento' }], evidenceClass: 'transcrito do site histórico' },
    { id: 'casamento-reni-joao-1960', groupId: 'union-reni-joao', participants: ['reni','joao_galo'], date: '6 JAN 1960', refs: [{ id: 'P2', locator: 'p. 1' }], evidenceClass: 'ato civil fornecido; data explicitamente transcrita' },
    { id: 'casamento-dante-maria', groupId: 'union-dante-maria-gallo', participants: ['dante1882','maria_gallo'], date: null, refs: [{ id: 'U2', locator: 'relato familiar' }], evidenceClass: 'relato familiar' },
    { id: 'casamento-valentim-elisa', groupId: 'union-valentim-elisa', participants: ['valentim','elisa'], date: null, refs: [{ id: 'U2', locator: 'relato familiar' }], evidenceClass: 'relato familiar' },
    { id: 'casamento-luigi-pasqua', groupId: 'union-luigi-pasqua', participants: ['luigi','pasqua'], date: null, refs: [{ id: 'U2', locator: 'relato familiar' }], evidenceClass: 'relato familiar' },
    { id: 'casamento-zenaide-felipe', groupId: 'union-zenaide-felipe-murucci', participants: ['zenaide','felipe_murucci'], date: null, refs: [{ id: 'S7', locator: 'biografia histórica de Zenaide' }], evidenceClass: 'transcrito do site histórico', literal: 'A biografia histórica relata que Zenaide tinha 12 anos quando se casou com Felipe Murucci; não informa a data do casamento.' },
  ];
  for (const marriage of explicitMarriages) {
    if (!marriage.participants.every(id => peopleById.has(id))) throw new Error(`Pessoa ausente na união ${marriage.groupId}`);
    const group = { id: marriage.groupId, kind: 'union', participant_ids: marriage.participants, participants: marriage.participants.map(person_id => ({ person_id, role: 'spouse' })), event_ids: [`evt-${marriage.id}`], note: 'Casamento informado na história familiar; a data aparece somente quando há referência explícita.' };
    groups.push(group);
    if (marriage.date) {
      const added = addDatedClaim({ id: marriage.id, subjectKind: 'group', subjectId: group.id, type: 'marriage', rawDate: marriage.date, refs: marriage.refs, evidenceClass: marriage.evidenceClass });
      group.event_ids = [added.eventId];
    } else {
      const assertionId = `a-${marriage.id}`;
      const eventId = `evt-${marriage.id}`;
      assertions.push({ id: assertionId, subject_kind: 'group', subject_id: group.id, predicate: 'marriage', object_person_id: null, literal: marriage.literal || 'Casamento informado pela família; sem data indicada.', date: null, interpretation: 'preferred', evidence_class: marriage.evidenceClass, citation_ids: [...new Set(marriage.refs.map(citation))], public_note: '' });
      events.push({ id: eventId, type: 'marriage', subject_kind: 'group', subject_id: group.id, claim_ids: [assertionId] });
      group.event_ids = [eventId];
    }
  }

  // Integrate recovered legacy relation tables and historical image maps as source-backed records.
  // A profile path is the stable identity key; map position and surnames never create parentage.
  const supplementalEdges = new Set();
  const unionGroups = new Map();
  const extraBranches = [];
  function addLegacyRelation(page, role, fromId, toId, index) {
    const sourceId = legacySourceId(page.path);
    if (!sourceMap.has(sourceId)) throw new Error(`Página de parentesco sem ficha pública: ${page.path}`);
    const citationId = citation({ id: sourceId, locator: `tabela de relações, ${role}` });
    const edgeKey = `${role}|${fromId}|${toId}|${sourceId}`;
    if (supplementalEdges.has(edgeKey)) return;
    supplementalEdges.add(edgeKey);
    const assertionId = `a-legacy-${digest(Buffer.from(`${edgeKey}|${index}`)).slice(0,18)}`;
    if (role === 'parent' || role === 'child') {
      const childId = role === 'parent' ? fromId : toId;
      const parentId = role === 'parent' ? toId : fromId;
      const adoptedParents = parentEdges.filter(edge => edge.child === childId).map(edge => edge.parent);
      const conflict = coreIds.has(childId) && adoptedParents.length > 0 && !adoptedParents.includes(parentId);
      assertions.push({ id: assertionId, subject_kind: 'person', subject_id: childId, predicate: 'child_of', object_person_id: parentId, literal: '', date: null, interpretation: conflict ? 'disputed' : 'preferred', evidence_class: 'transcrito do site', citation_ids: [citationId], public_note: conflict ? 'A página histórica apresenta esta filiação; a edição familiar atual mantém separadamente a filiação adotada.' : '' });
    } else if (role === 'sibling') {
      assertions.push({ id: assertionId, subject_kind: 'person', subject_id: fromId, predicate: 'sibling_of', object_person_id: toId, literal: '', date: null, interpretation: 'preferred', evidence_class: 'transcrito do site', citation_ids: [citationId], public_note: '' });
    }
    peopleById.get(fromId)?.claim_ids.push(assertionId);
    peopleById.get(toId)?.claim_ids.push(assertionId);
  }
  for (const page of supplemental.pages) {
    if (!page.relations.length) continue;
    const subjectId = pathId(page.path);
    if (!peopleById.has(subjectId)) continue;
    const srcId = legacySourceId(page.path);
    const pageCite = citation({ id: srcId, locator: 'ficha biográfica e tabela de relações' });
    const relationIds = { parent: [], sibling: [], spouse: [], child: [] };
    let ordinal = 0;
    for (const relation of page.relations) {
      for (const ref of relation.names) {
        ordinal += 1;
        const targetId = ref.target ? pathId(ref.target) : unlinkedId(page.path,relation.role,ref.label,unlinkedAnchor(page,relation.role,subjectId));
        if (!peopleById.has(targetId)) continue;
        relationIds[relation.role]?.push(targetId);
        if (relation.role === 'parent') addLegacyRelation(page,'parent',subjectId,targetId,ordinal);
        else if (relation.role === 'child') addLegacyRelation(page,'child',subjectId,targetId,ordinal);
        else if (relation.role === 'sibling') addLegacyRelation(page,'sibling',subjectId,targetId,ordinal);
        else if (relation.role === 'spouse' && targetId !== subjectId) {
          const pair = [subjectId,targetId].sort();
          const key = pair.join('|');
          let group = unionGroups.get(key);
          if (!group) {
            const groupId = `legacy-union-${digest(Buffer.from(key)).slice(0,16)}`;
            const assertionId = `a-legacy-marriage-${digest(Buffer.from(`${key}|${srcId}`)).slice(0,16)}`;
            const eventId = `evt-legacy-marriage-${digest(Buffer.from(key)).slice(0,16)}`;
            assertions.push({ id: assertionId, subject_kind: 'group', subject_id: groupId, predicate: 'marriage', object_person_id: null, literal: 'União indicada na coluna de cônjuge da página histórica; sem data informada.', date: null, interpretation: 'preferred', evidence_class: 'relação explícita na tabela da página histórica', citation_ids: [pageCite], public_note: '' });
            events.push({ id: eventId, type: 'marriage', subject_kind: 'group', subject_id: groupId, claim_ids: [assertionId] });
            group = { id: groupId, kind: 'union', participant_ids: pair, participants: pair.map(person_id => ({ person_id, role: 'spouse' })), event_ids: [eventId], note: 'União indicada explicitamente na coluna de cônjuge de uma ficha histórica; sem data indicada.' };
            unionGroups.set(key,group); groups.push(group);
            peopleById.get(subjectId)?.claim_ids.push(assertionId); peopleById.get(targetId)?.claim_ids.push(assertionId);
          }
        }
      }
    }
    const parents = [...new Set(relationIds.parent)];
    const siblings = [...new Set(relationIds.sibling)];
    const spouseIds = [...new Set(relationIds.spouse)];
    const descendants = [...new Set(relationIds.child)];
    const relationshipArchive = legacy.archiveItems.find(item => item.legacy_path.toLowerCase() === page.path.toLowerCase());
    if (relationshipArchive) for (const relatedId of [...parents,...siblings,...spouseIds,...descendants]) {
      if (peopleById.has(relatedId) && !relationshipArchive.person_ids.includes(relatedId)) relationshipArchive.person_ids.push(relatedId);
    }
    // Attach this recovered page and its source to its path-confirmed person.
    const archivePage = legacy.archiveItems.find(item => item.legacy_path === page.path);
    if (archivePage && !archivePage.person_ids.includes(subjectId)) archivePage.person_ids.push(subjectId);
    for (const image of page.images || []) {
      if (!image.target || !/\.(?:gif|jpe?g|png)$/i.test(image.target)) continue;
      const archiveImage = legacy.archiveItems.find(item => item.legacy_path.toLowerCase() === image.target.toLowerCase());
      if (archiveImage && !archiveImage.person_ids.includes(subjectId)) archiveImage.person_ids.push(subjectId);
    }
  }
  // Legacy parental groups are a projection of exact preferred child_of claims.
  // Sibling rows remain sibling_of assertions and never become children of the
  // subject's parents; each child is grouped only with its own complete parent set.
  const legacyChildrenByParentSet = new Map();
  const preferredParentSetByChild = new Map();
  for (const claim of assertions.filter(a => a.predicate === 'child_of' && a.interpretation === 'preferred')) {
    const set = preferredParentSetByChild.get(claim.subject_id) || new Set();
    set.add(claim.object_person_id);
    preferredParentSetByChild.set(claim.subject_id,set);
  }
  for (const claim of assertions.filter(a => a.predicate === 'child_of' && a.interpretation === 'preferred' && a.id.startsWith('a-legacy-'))) {
    const parentSet = [...(preferredParentSetByChild.get(claim.subject_id) || [])].sort();
    if (!parentSet.length) continue;
    const key = parentSet.join('|');
    const children = legacyChildrenByParentSet.get(key) || new Set();
    children.add(claim.subject_id);
    legacyChildrenByParentSet.set(key,children);
  }
  for (const [parentKey, childSet] of legacyChildrenByParentSet) {
    const parentIds = parentKey.split('|');
    const childIds = [...childSet].sort();
    const participantIds = [...parentIds,...childIds];
    const alreadyCovered = groups.some(group => group.kind === 'parental_group' && participantIds.every(id => group.participant_ids.includes(id)) && parentIds.every(id => group.participants.some(p => p.person_id === id && p.role === 'parent')) && childIds.every(id => group.participants.some(p => p.person_id === id && p.role === 'child')));
    if (alreadyCovered) continue;
    const groupKey = `${parentIds.join('|')}::${childIds.join('|')}`;
    const groupId = `legacy-family-${digest(Buffer.from(groupKey)).slice(0,16)}`;
    groups.push({ id: groupId, kind: 'parental_group', participant_ids: participantIds, participants: participantIds.map(person_id => ({ person_id, role: parentIds.includes(person_id) ? 'parent' : 'child' })), event_ids: [], note: 'Grupo formado somente por filiações preferidas citadas com o mesmo conjunto exato de pais; não implica casamento.' });
  }
  // Attach every recovered page/image whose exact legacy path resolves to an
  // existing adopted or path-confirmed person, including biographies with no
  // relation table of their own (for example, the children in the Esposito and
  // Murucci family lists).
  for (const page of supplemental.pages) {
    const subjectId = pathId(page.path);
    if (!peopleById.has(subjectId)) continue;
    const archivePage = legacy.archiveItems.find(item => item.legacy_path.toLowerCase() === page.path.toLowerCase());
    if (archivePage && !archivePage.person_ids.includes(subjectId)) archivePage.person_ids.push(subjectId);
    for (const image of page.images || []) {
      if (!image.target || !/\.(?:gif|jpe?g|png)$/i.test(image.target)) continue;
      const archiveImage = legacy.archiveItems.find(item => item.legacy_path.toLowerCase() === image.target.toLowerCase());
      if (archiveImage && !archiveImage.person_ids.includes(subjectId)) archiveImage.person_ids.push(subjectId);
    }
  }
  // Edmondo Lorenzo is the site author identified by his own recovered profile; the family testimony
  // is kept as a separate place report and does not add parents or an adoption relationship.
  const edmondoSource = legacySourceId('BRA/Edmondo1950B.htm');
  if (peopleById.has('edmondo1950') && sourceMap.has(edmondoSource)) {
    const authorCitation = citation({ id: edmondoSource, locator: 'biografia histórica: autoria do site' });
    const residenceCitation = citation({ id: 'U2', locator: 'relato familiar sobre Edmondo e Milão' });
    for (const [predicate,literal,citationId,evidence] of [
      ['role','Autor material do site familiar histórico.',authorCitation,'biografia publicada no site histórico'],
      ['residence_place','Milão',residenceCitation,'relato familiar fornecido'],
    ]) {
      const claimId = `a-edmondo1950-${predicate}`;
      assertions.push({ id: claimId, subject_kind: 'person', subject_id: 'edmondo1950', predicate, object_person_id: null, literal, date: null, interpretation: 'annotation', evidence_class: evidence, citation_ids: [citationId], public_note: '' });
      peopleById.get('edmondo1950').claim_ids.push(claimId);
    }
  }

  const treeEditionCounts = {
    'BRA/AlbSBiagioB.htm': { historical_person_count: 21, count_edition_label: 'ForestaB, captura de 19/05/2005' },
    'BRA/AlberoB.htm': { historical_person_count: 100, count_edition_label: 'ForestaI, captura de 25/10/2004' },
    'BRA/AlberoBondenoB.htm': { historical_person_count: 127, count_edition_label: 'ForestaB, captura de 19/05/2005' },
    'BRA/AlbAlegreB.htm': { historical_person_count: 71, count_edition_label: 'ForestaB, captura de 19/05/2005', historical_counts: [{ count: 66, edition: 'ForestaI, captura de 25/10/2004' }] },
    'BRA/AlbGiobatB.htm': { historical_person_count: 24, count_edition_label: 'ForestaB, captura de 19/05/2005' },
  };
  const mainTreeIds = new Map([
    ['BRA/AlbSBiagioB.htm','tree-san-biagio'],['ITA/AlbSBiagioI.htm','tree-san-biagio'],
    ['BRA/AlberoB.htm','tree-francesco-bondeno'],['BRA/AlberoBondenoB.htm','tree-francesco-bondeno'],
    ['BRA/AlbAlegreB.htm','tree-porto-alegre'],['BRA/AlbGiobatB.htm','tree-giovanni-battista'],
  ]);
  const mainTreePaths = new Set(['BRA/AlbSBiagioB.htm','BRA/AlberoBondenoB.htm','BRA/AlbAlegreB.htm','BRA/AlbGiobatB.htm']);
  const branchByTreeId = new Map();
  const mapReferenceNotes = [];
  for (const page of supplemental.pages.filter(p => p.tree_map)) {
    const members = [...new Set((page.map_nodes || []).filter(n => n.target).map(n => pathId(n.target)))].filter(id => peopleById.has(id));
    const unresolvedReferences = (page.map_nodes || []).filter(n => n.target && !peopleById.has(pathId(n.target))).map(n => ({ target: n.target, label: n.label || null, status: 'named_destination_missing_or_unreadable' }));
    const sourceId = legacySourceId(page.path);
    const archiveId = `legacy-${page.path.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
    const assetIds = legacy.assets.filter(a => (page.images || []).some(i => i.target && a.public_path.endsWith(i.target.replaceAll('/','-')))).map(a => a.id);
    const edition = treeEditionCounts[page.path] || {};
    const treeId = mainTreeIds.get(page.path) || `tree-sub-${digest(Buffer.from(page.path.toLowerCase())).slice(0,12)}`;
    let branch = branchByTreeId.get(treeId);
    if (!branch) {
      branch = { id: `tree-${digest(Buffer.from(treeId)).slice(0,12)}`, tree_id: treeId, is_original_tree: mainTreePaths.has(page.path), category: mainTreePaths.has(page.path) ? 'original_tree' : 'subtree_or_edition', label: page.title || 'Árvore histórica', description: page.description || 'Árvore genealógica preservada do site histórico.', person_ids: [], note: 'A quantidade indicada pertence à edição histórica citada e não representa o total atual deste atlas.', source_language: page.path.startsWith('ITA/') || /^albero genealogico/i.test(page.title) ? 'it' : 'pt', historical_person_count: edition.historical_person_count ?? null, count_edition_label: edition.count_edition_label ?? null, count_source_id: edition.historical_person_count ? legacySourceId(edition.count_edition_label?.startsWith('ForestaI') ? 'ITA/ForestaI.htm' : 'BRA/ForestaB.htm') : sourceId, historical_counts: edition.historical_counts || [], origin_source_ids: [], asset_ids: [], archive_item_ids: [], legacy_urls: [], unresolved_references: [], diagram_transcriptions: [], region_label: treeId === 'tree-san-biagio' ? 'San Biagio di Bondeno, Ferrara' : treeId === 'tree-francesco-bondeno' ? 'Bondeno, Ferrara; descendência em Minas Gerais e outros ramos no Brasil' : treeId === 'tree-porto-alegre' ? 'Rio Grande do Sul' : treeId === 'tree-giovanni-battista' ? 'Toscana e Lazio' : null, country_label: treeId === 'tree-porto-alegre' ? 'Brasil' : treeId === 'tree-francesco-bondeno' ? 'Itália e Brasil' : ['tree-san-biagio','tree-giovanni-battista'].includes(treeId) ? 'Itália' : null };
      branchByTreeId.set(treeId,branch); extraBranches.push(branch);
    } else if (edition.historical_person_count && !mainTreePaths.has(page.path)) {
      branch.historical_counts = [...(branch.historical_counts || []), { count: edition.historical_person_count, edition: edition.count_edition_label }];
    }
    if (mainTreePaths.has(page.path)) {
      if (branch.historical_person_count && branch.count_edition_label && branch.count_edition_label !== edition.count_edition_label) branch.historical_counts = [...(branch.historical_counts || []), { count: branch.historical_person_count, edition: branch.count_edition_label }];
      branch.historical_person_count = edition.historical_person_count ?? branch.historical_person_count;
      branch.count_edition_label = edition.count_edition_label ?? branch.count_edition_label;
      branch.count_source_id = edition.historical_person_count ? legacySourceId(edition.count_edition_label?.startsWith('ForestaI') ? 'ITA/ForestaI.htm' : 'BRA/ForestaB.htm') : branch.count_source_id;
      branch.is_original_tree=true; branch.category='original_tree';
      branch.label=page.title || branch.label; branch.description=page.description || branch.description;
    }
    branch.person_ids = [...new Set([...branch.person_ids,...members])];
    branch.origin_source_ids = [...new Set([...branch.origin_source_ids,sourceId,...(edition.historical_person_count ? [legacySourceId(page.path.startsWith('ITA/') ? 'ITA/ForestaI.htm' : 'BRA/ForestaB.htm')] : [])])];
    branch.asset_ids = [...new Set([...branch.asset_ids,...assetIds])];
    branch.archive_item_ids = [...new Set([...branch.archive_item_ids,archiveId])];
    branch.legacy_urls = [...new Set([...branch.legacy_urls,page.path])];
    branch.unresolved_references.push(...unresolvedReferences);
    const diagramLabels = {
      'BRA/AlberoB.htm': { asset_path: 'Foto/GeneaA3.gif', names: ['Francesco','Luigi','Maria','Carlo','Leonilde','Antonio','Palmira','Sigismondo','Albertina','Gilberto','Nadia','Angelica','Edmondo','Sante','Clarice','Deulma','Deulmo','Leonida','Orlando','Irene','Paolo','Miriam','Mario','Bianca','Emanuela','Anna','Adelina','Dircea','Giovanna','Ermelinda','Agostino','Dante','Pasqua','Aristodemo','Annunziata','Diletta','Enzo','Alvaro','Custode Sante','Ermanno','Ugo','Umberto','Daniele','Grandilia','Ulisse','Ernesto','Zenaide','Elpidio','Custódio','Jair','Guanair','Devanir','Devair','Genair','Anair','Sebastião','Creusa','Gerci','Valdemar','Jorge Ailton','Paulo Henrique','Edmar','Helena','Laurides','José Carlos','Laerte','Hilário','Geraldo','Cynthia','Vinicius','Felipe','Débora','Viviane','Ângelo','Amanda','Lourdes','Iolanda','Maria Hilda','Moisés'], uncertain_labels: ['Dorselina'] },
      'BRA/AlbSBiagioB.htm': { asset_path: 'Foto/AlbBiagio.gif', names: ['Giovanni','Bartolomeo','Domenica','Giovanna','Cattarina','Angela','Giuseppe','Domenico','Antonio','Barbara','Maria','Vittoria','Rosa','Francesco','Enrica','Matilde'], uncertain_labels: [] },
    }[page.path];
    if (diagramLabels) {
      const imageSourceId=legacySourceId(diagramLabels.asset_path);
      const diagramAsset=legacy.assets.find(a=>a.public_path.endsWith(diagramLabels.asset_path.replaceAll('/','-')));
      if (diagramAsset && sourceMap.has(imageSourceId)) branch.diagram_transcriptions.push({ asset_id: diagramAsset.id, source_id: imageSourceId, citation_id: citation({ id: imageSourceId, locator: 'rótulos legíveis no diagrama; sem associação com destinos/áreas' }), method: 'transcrição visual', confidence_note: 'Os nomes foram lidos na imagem; as áreas clicáveis não correspondem com segurança a cada rótulo. A lista não cria identidade nem parentesco.', names: diagramLabels.names, uncertain_labels: diagramLabels.uncertain_labels });
    }
    for (const id of members) if (!peopleById.get(id).branch_ids.includes(branch.id)) peopleById.get(id).branch_ids.push(branch.id);
    mapReferenceNotes.push(...unresolvedReferences.map(ref => ({ source_path: page.path, ...ref })));
  }
  const mappedPersonIds = new Set(extraBranches.flatMap(branch => branch.person_ids));
  const unassignedProfiles = [...new Set(supplemental.pages.filter(p => p.relations.length).map(p => pathId(p.path)))].filter(id => peopleById.has(id) && !mappedPersonIds.has(id));
  if (unassignedProfiles.length) {
    const branchId='legacy-profiles-unassigned';
    const unassignedPaths=supplemental.pages.filter(p => p.relations.length && unassignedProfiles.includes(pathId(p.path)));
    const branch={ id: branchId, tree_id: null, is_original_tree: false, category: 'unassigned_profiles', label: 'Fichas históricas sem árvore associada', description: 'Pessoas identificadas em fichas biográficas cujo vínculo com uma das árvores originais não foi estabelecido.', person_ids: unassignedProfiles, note: 'Fichas preservadas sem atribuição de ramo por sobrenome ou semelhança de nome.', source_language: 'pt', historical_person_count: null, count_edition_label: null, count_source_id: null, historical_counts: [], origin_source_ids: [...new Set(unassignedPaths.map(p => legacySourceId(p.path)))], asset_ids: [], archive_item_ids: unassignedPaths.map(p => `legacy-${p.path.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`), legacy_urls: unassignedPaths.map(p => p.path), unresolved_references: [] };
    for (const id of unassignedProfiles) if (!peopleById.get(id).branch_ids.includes(branchId)) peopleById.get(id).branch_ids.push(branchId);
    extraBranches.push(branch);
  }

  const narrativeFields = new Set(['emigracao','emigracao_navio','criado_por','casamento_e_descendencia','correcao_identidade_site','memoria_lista_passageiros','residencia_e_naturalidade_relato','memoria_geografia_familiar','divergencia_geografia_familiar','pista_overlay_registro_populacional','anexo_nota']);
  const bioParagraphs = new Map(people.map(p => [p.id, []]));
  for (const claim of canonical.afirmacoes) {
    if (!peopleById.has(claim.pessoa_id) || !narrativeFields.has(claim.campo)) continue;
    if (claim.adotado !== 'sim' && claim.adotado !== 'somente nota; sem novo evento ou parentesco') continue;
    const refs = parseRefs(claim.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id));
    if (!refs.length) continue;
    const citationIds = [...new Set(refs.map(citation))];
    let predicate = claim.campo;
    let interpretation = claim.adotado.startsWith('somente nota') ? 'annotation' : 'preferred';
    let publicNote = '';
    if (claim.campo === 'emigracao') predicate = 'migration';
    if (claim.campo === 'pista_overlay_registro_populacional') { interpretation = 'annotation'; publicNote = 'Pista de leitura, não identificação confirmada.'; }
    const publicLiteral = {
      emigracao_navio: 'A família relata que Custode chegou ao Brasil no vapor Attività. A lista de passageiros e a data da viagem ainda não foram localizadas no acervo.',
      memoria_lista_passageiros: 'Relato familiar lembra uma imagem de lista do Attività com Custode e Grandilia criança; a lista original e a data da viagem não foram localizadas.',
      residencia_e_naturalidade_relato: 'Relato familiar: Valentim viveu em Santa Clara; não há data de nascimento informada.',
      memoria_geografia_familiar: 'A memória familiar situa os avós na região de Santa Clara e Varre-Sai; os registros apresentam localidades específicas.',
      divergencia_geografia_familiar: 'A memória familiar situa João na região de Santa Clara; o registro transcrito indica Varre-Sai.',
      pista_overlay_registro_populacional: 'Uma sobreposição no registro populacional sugere correspondências de datas para Ulisse e Ernesto; sem as imagens originais, essas correspondências não foram adotadas.',
      correcao_identidade_site: 'A identificação familiar atual entre os filhos de Valentim é Reni. A versão antiga do site usava “Maria de Lourdes”; Lourdes Espósito, filha de Grandilia, é outra pessoa.',
    }[claim.campo] || cleanName(claim.valor);
    const assertionId = `a-fact-${claim.pessoa_id}-${claim.campo}-${assertions.length + 1}`;
    assertions.push({ id: assertionId, subject_kind: 'person', subject_id: claim.pessoa_id, predicate, object_person_id: null, literal: publicLiteral, date: null, interpretation, evidence_class: claim.classe, citation_ids: citationIds, public_note: publicNote });
    peopleById.get(claim.pessoa_id).claim_ids.push(assertionId);
    const factText = claim.campo === 'emigracao' ? `Emigração: ${cleanName(claim.valor)}.`
      : claim.campo === 'criado_por' ? `Foi criado por ${cleanName(claim.valor)}; isso não altera a filiação registrada.`
      : claim.campo === 'casamento_e_descendencia' ? cleanName(claim.valor) + '.'
      : publicLiteral;
    bioParagraphs.get(claim.pessoa_id).push({ text: factText, source_ids: [...new Set(citationIds.map(cid => citations.find(c => c.id === cid).source_id))], citation_ids: citationIds });
    if (claim.campo === 'emigracao' || claim.campo === 'emigracao_navio') {
      const eventId = `evt-migration-${claim.pessoa_id}-${claim.campo}`;
      events.push({ id: eventId, type: 'migration', subject_kind: 'person', subject_id: claim.pessoa_id, claim_ids: [assertionId] });
    }
  }

  const marriageDetails = canonical.afirmacoes.filter(c => c.campo === 'idade_em_1880' && c.adotado === 'sim');
  if (marriageDetails.length) {
    const refs = [...new Set(marriageDetails.flatMap(c => parseRefs(c.fonte).filter(r => ALLOWED_SOURCES.has(r.id) && sourceMap.has(r.id))))];
    const citationIds = [...new Set(refs.map(citation))];
    const detailsText = `No extrato do casamento de 1880, Custode consta com ${cleanName(marriageDetails.find(c => c.pessoa_id === 'custode')?.valor || 'idade registrada')} e naturalidade em Bondeno; Ernesta consta com ${cleanName(marriageDetails.find(c => c.pessoa_id === 'ernesta')?.valor || 'idade registrada')}.`;
    const assertionId = 'a-marriage-record-ages-1880';
    assertions.push({ id: assertionId, subject_kind: 'group', subject_id: 'union-custode-ernesta', predicate: 'marriage_record_details', object_person_id: null, literal: detailsText, date: null, interpretation: 'preferred', evidence_class: 'extrato civil fornecido', citation_ids: citationIds, public_note: '' });
    for (const personId of ['custode','ernesta']) bioParagraphs.get(personId).push({ text: detailsText, source_ids: [...new Set(citationIds.map(cid => citations.find(c => c.id === cid).source_id))], citation_ids: citationIds });
  }

  for (const person of people) {
    const ownEvents = events.filter(e => e.subject_kind === 'person' && e.subject_id === person.id);
    for (const event of ownEvents) {
      for (const assertionId of event.claim_ids) {
        const claim = assertions.find(a => a.id === assertionId);
        if (!claim || !claim.date && !claim.predicate.endsWith('_place')) continue;
        const text = claim.predicate === 'birth' ? `Nascimento: ${claim.literal}.` : claim.predicate === 'death' ? `Falecimento: ${claim.literal}.` : claim.predicate === 'birth_place' ? `Local de nascimento: ${claim.literal}.` : claim.predicate === 'death_place' ? `Local de falecimento: ${claim.literal}.` : claim.literal;
        const sourceIds = [...new Set(claim.citation_ids.map(cid => citations.find(c => c.id === cid).source_id))];
        bioParagraphs.get(person.id).push({ text, source_ids: sourceIds, citation_ids: claim.citation_ids });
      }
    }
    const unionAssertions = assertions.filter(a => a.subject_kind === 'group' && a.predicate === 'marriage' && groups.find(g => g.id === a.subject_id)?.participant_ids.includes(person.id));
    for (const claim of unionAssertions) {
      const group = groups.find(g => g.id === claim.subject_id);
      const spouseId = group.participant_ids.find(id => id !== person.id);
      const spouse = peopleById.get(spouseId);
      const date = claim.date ? ` em ${claim.date.literal}` : '';
      bioParagraphs.get(person.id).push({ text: `Casou-se com ${spouse.label}${date}.`, source_ids: [...new Set(claim.citation_ids.map(cid => citations.find(c => c.id === cid).source_id))], citation_ids: claim.citation_ids });
    }
  }
  const biographies = people.filter(p => bioParagraphs.get(p.id).length).map(person => {
    const paragraphs = bioParagraphs.get(person.id);
    const page = legacy.archiveItems.find(item => item.status === 'public_derivative' && item.person_ids.includes(person.id) && item.transcript);
    if (page) {
      const markers = { luigi: /Luigi\s*\(1883-1886\)/i, pasqua: /Pasqua\s*\(1881-1965\)/i, dante1882: /Dante\s*\(1878-1879\)/i, grandilia: /Grandilia\s*\(1887-1963\)/i, zenaide: /Zenaide\s*\(1895-19\?\?\)/i };
      const marker = markers[person.id]?.exec(page.transcript);
      if (marker) {
        const start = marker.index;
        const endIndex = page.transcript.indexOf('Árvore Pais', start);
        const excerpt = page.transcript.slice(start, endIndex > start ? endIndex : Math.min(start + 1600, page.transcript.length)).trim();
        if (excerpt) {
          const sourceIds = [...new Set(page.source_ids)];
          const citeIds = sourceIds.map(sourceId => citation({ id: sourceId, locator: sourceId.startsWith('legacy-') ? 'transcrição da biografia histórica' : 'biografia histórica' }));
          paragraphs.push({ text: `Transcrição da biografia histórica: ${excerpt}`, source_ids: sourceIds, citation_ids: [...new Set(citeIds)] });
        }
      }
    }
    const source_ids = [...new Set(paragraphs.flatMap(p => p.source_ids))];
    return { id: `bio-${person.id}`, person_id: person.id, title: person.label, paragraphs, source_ids };
  });

  const editorialOpenings = {
    reni: {
      text: 'Reni Zaniratti Galo era filha de Valentim Zaniratti e Elisa Bernardino. Casou-se com João Galo e teve cinco filhos: Fernando, Vera, Elcio, José Airson e Rejane. Seu registro situa seu nascimento em Santa Clara e seu falecimento em Petrópolis.',
      source_ids: ['U2','P2','P3'], refs: [{ id: 'U2', locator: 'relato familiar' }, { id: 'P2', locator: 'pp. 1–2' }, { id: 'P3', locator: 'p. 1' }],
    },
    custode: {
      text: 'Custode Sante Zaniratti era filho de Luigi Zaniratti e Pasqua Mellara. Nasceu em Stellata, no município de Bondeno. Veio ao Brasil no vapor Attività, conforme a história familiar. Os 13 filhos registrados incluem Grandilia, Zenaide e Valentim.',
      source_ids: ['U2','S3','S4'], refs: [{ id: 'U2', locator: 'relato familiar' }, { id: 'S3', locator: 'diagrama histórico, nomes e filiação' }, { id: 'S4', locator: 'biografia histórica de Grandilia' }],
    },
    valentim: {
      text: 'Valentim Zaniratti, filho de Custode Sante, viveu em Santa Clara. Casou-se com Elisa Bernardino; teve Walter, Nedina, Reni e Antônio.',
      source_ids: ['U2','U3','S4','P2'], refs: [{ id: 'U2', locator: 'relato familiar' }, { id: 'U3', locator: 'relato familiar adicional' }, { id: 'S4', locator: 'biografia histórica de Grandilia' }, { id: 'P2', locator: 'p. 1' }],
    },
  };
  for (const [personId, opening] of Object.entries(editorialOpenings)) {
    const biography = biographies.find(item => item.person_id === personId);
    if (!biography) throw new Error(`Biografia ausente para abertura editorial: ${personId}`);
    biography.paragraphs.unshift({ text: opening.text, source_ids: opening.source_ids, citation_ids: opening.refs.map(citation) });
    biography.source_ids = [...new Set([...biography.source_ids, ...opening.source_ids])];
  }

  for (const page of supplemental.pages.filter(p => p.relations.length)) {
    const personId = pathId(page.path);
    const archivePage = legacy.archiveItems.find(item => item.legacy_path === page.path);
    if (!peopleById.has(personId) || !archivePage) continue;
    const sourceId = legacySourceId(page.path);
    const citeId = citation({ id: sourceId, locator: 'biografia histórica recuperada' });
    const text = archivePage.transcript || [page.title,page.description].filter(Boolean).join('. ');
    if (!text) continue;
    const paragraph = { text, source_ids: [sourceId], citation_ids: [citeId] };
    const existing = biographies.find(b => b.person_id === personId);
    if (existing) {
      if (!existing.paragraphs.some(p => p.source_ids.includes(sourceId))) existing.paragraphs.push(paragraph);
      existing.source_ids = [...new Set([...existing.source_ids,sourceId])];
    } else {
      biographies.push({ id: `bio-${personId}`, person_id: personId, title: peopleById.get(personId).label, paragraphs: [paragraph], source_ids: [sourceId] });
    }
  }
  const edmondoBio = biographies.find(b => b.person_id === 'edmondo1950');
  if (edmondoBio) {
    const familyCitation = citation({ id: 'U2', locator: 'relato familiar sobre Edmondo em Milão' });
    edmondoBio.paragraphs.unshift({ text: 'O relato familiar também situa Edmondo em Milão; a biografia antiga do site descreve residência em outras cidades italianas em diferentes períodos.', source_ids: ['U2',legacySourceId('BRA/Edmondo1950B.htm')], citation_ids: [familyCitation,citation({ id: legacySourceId('BRA/Edmondo1950B.htm'), locator: 'biografia histórica: percurso residencial' })] });
    edmondoBio.source_ids = [...new Set([...edmondoBio.source_ids,'U2'])];
  }

  const sourceList = [...sourceMap.values()];
  const usedIds = new Set(citations.map(c => c.source_id));
  // Keep the 22 public PDF fichas available to the sources page, even when not used by a claim.
  const archiveSourceIds = new Set(legacy.archiveItems.flatMap(item => item.source_ids));
  const sources = sourceList.filter(s => usedIds.has(s.id) || s.id.startsWith('catalog-pdf-') || archiveSourceIds.has(s.id));
  for (const item of legacy.archiveItems) {
    const personSet = new Set(item.person_ids);
    if (item.legacy_path.startsWith('catalogo-documental/')) {
      const sourceSet = new Set(item.source_ids);
      item.event_ids = events.filter(event => event.claim_ids.some(claimId => {
        const claim = assertions.find(a => a.id === claimId);
        return claim?.citation_ids.some(citationId => sourceSet.has(citations.find(c => c.id === citationId)?.source_id));
      })).map(event => event.id);
    } else {
      item.event_ids = events.filter(event => (event.subject_kind === 'person' && personSet.has(event.subject_id)) || (event.subject_kind === 'group' && groups.find(g => g.id === event.subject_id)?.participant_ids.some(id => personSet.has(id)))).map(event => event.id);
    }
  }
  const snapshot = {
    schema_version: '1.1.0',
    release: { id: releaseOptions.id, state: 'candidate', generated_at: iso(), content_revision: releaseOptions.revision, locale: 'pt', public_changelog: releaseOptions.changelog },
    people: people.map(({ _name_source_path, _unlinked, _map_only, ...publicPerson }) => publicPerson), branches: [...branches,...extraBranches], groups, events, assertions, citations, sources, assets: [asset, ...legacy.assets.map(({ source_id, ...publicAsset }) => publicAsset)], legacy_urls: [], biographies, archive_items: legacy.archiveItems,
  };
  return { snapshot, siteRecords: legacy.records };
}

function buildGedcom(snapshot) {
  const lines = ['0 HEAD','1 SOUR ZanirattiGaloPublicExporter','1 GEDC','2 VERS 5.5.1','1 CHAR UTF-8'];
  const familyByChild = new Map();
  for (const assertion of snapshot.assertions.filter(a => a.predicate === 'child_of' && a.interpretation === 'preferred')) {
    const parents = familyByChild.get(assertion.subject_id) || [];
    if (!parents.includes(assertion.object_person_id)) parents.push(assertion.object_person_id);
    familyByChild.set(assertion.subject_id, parents);
  }
  for (const p of snapshot.people) {
    lines.push(`0 @${p.id}@ INDI`, `1 NAME ${p.label}`, `1 _PUBID ${p.id}`);
    for (const alias of p.aliases) lines.push(`1 NICK ${alias}`);
    for (const [child, parents] of familyByChild) if (parents.includes(p.id)) lines.push(`1 FAMS @F-${child}@`);
    if (familyByChild.has(p.id)) lines.push(`1 FAMC @F-${p.id}@`);
    const evts = snapshot.events.filter(e => e.subject_kind === 'person' && e.subject_id === p.id);
    for (const event of evts) {
      const claim = snapshot.assertions.find(a => a.id === event.claim_ids[0]);
      if (claim) {
        const tag = event.type === 'birth' ? 'BIRT' : event.type === 'death' ? 'DEAT' : 'EVEN';
        lines.push(`1 ${tag}`);
        if (claim.date) lines.push(`2 DATE ${claim.date.literal}`);
        if (event.type === 'migration') lines.push('2 TYPE Migration');
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
    if (claim) lines.push('1 MARR', ...(claim.date ? [`2 DATE ${claim.date.literal}`] : []), '2 SOUR @S-PUBLIC@');
  }
  lines.push('0 @S-PUBLIC@ SOUR','1 TITL Snapshot público candidato Zaniratti/Galo','1 NOTE Citações mínimas no snapshot JSON público.','0 TRLR');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    const value = process.argv[i + 1];
    if (!['--input','--docs','--site-catalog','--site-root','--approve','--release-id','--content-revision','--changelog'].includes(key) || !value) throw new Error('Uso: export-public.mjs --input <corpus.json> --docs <catalogo_documental.json> --site-catalog <catalogo_site.json> --site-root <copia-site-historico> [--release-id <id> --content-revision <revision> --changelog <texto>] [--approve <decisao-editorial.json>]');
    args.set(key, value);
  }
  if (!args.has('--input') || !args.has('--docs') || !args.has('--site-catalog') || !args.has('--site-root')) throw new Error('Informe explicitamente --input, --docs, --site-catalog e --site-root; não há origem padrão.');
  for (const key of ['--input','--docs','--site-catalog','--site-root']) {
    const requestedPath = path.resolve(args.get(key));
    if (requestedPath.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Entrada ${key} precisa ficar fora do checkout do site.`);
    const actualPath = await realpath(requestedPath);
    if (actualPath.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Entrada ${key} resolve para dentro do checkout do site.`);
    args.set(key, actualPath);
  }
  if (args.has('--approve')) {
    const requestedPath = path.resolve(args.get('--approve'));
    if (requestedPath.startsWith(`${ROOT}${path.sep}`)) throw new Error('A decisão editorial deve ficar fora do checkout público.');
    const approvalPath = await realpath(requestedPath);
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
  const legacy = await prepareLegacy(siteCatalog, args.get('--site-root'));
  const supplementalText = execFileSync('python3', [path.join(ROOT,'scripts/extract-legacy-genealogy.py'), args.get('--site-root')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const supplemental = JSON.parse(supplementalText);
  const documents = await prepareDocuments(docs);
  legacy.archiveItems.push(...documents.archiveItems);
  legacy.assets.push(...documents.assets);
  legacy.publicFiles.push(...documents.publicFiles);
  legacy.documentAssets = documents.assets;
  const releaseOptions = {
    id: args.get('--release-id') || 'zaniratti-integral-atlas-candidate-2026-10-13',
    revision: args.get('--content-revision') || 'family-atlas-integral-2026-10-13-v2',
    changelog: args.get('--changelog') || 'Integra as árvores e fichas históricas recuperadas, preservando as identidades e relações com suas fontes.',
  };
  if (!/^[a-z0-9][a-z0-9-]{4,99}$/.test(releaseOptions.id) || !/^[a-z0-9][a-z0-9-]{4,99}$/.test(releaseOptions.revision) || releaseOptions.changelog.length > 500) throw new Error('Metadados de release inválidos.');
  const { snapshot, siteRecords } = buildSnapshot(canonical, docs, siteCatalog, assetBytes, legacy, supplemental, releaseOptions);
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
    snapshot_sha256: digest(Buffer.from(dataText)), assets: [{ path: ASSET_PUBLIC_PATH, sha256: digest(assetBytes), bytes: assetBytes.length }, ...legacy.assets.map(a => ({ path: a.public_path, sha256: a.sha256, bytes: a.bytes }))], gedcom_sha256: digest(Buffer.from(gedcom)),
    inventory_summary: { historical_site_records: siteRecords.length, public_historical_pages: supplemental.pages.filter(p => p.relations.length).length, historical_tree_maps: supplemental.tree_map_count, supplemental_profile_pages: supplemental.profile_page_count, supplemental_people_added: snapshot.people.length - Object.keys(canonical.pessoas).length, catalog_pdf_records: 26, public_pdf_originals: documents.assets.length, private_pdf_derivatives: documents.archiveItems.filter(i => i.status === 'public_derivative').length },
    note: snapshot.release.state === 'approved' ? 'Projeção pública revisada para disponibilização no site.' : 'Candidato de atlas familiar; fatos citados, cópias históricas estáticas e metadados sem caminhos locais ou conteúdo de e-mail.'
  };
  if (approvalDecision) manifest.approval_decision = approvalDecision;
  await mkdir(path.join(ROOT, 'content/public'), { recursive: true });
  await mkdir(path.join(ROOT, 'public/downloads'), { recursive: true });
  const keepGenerated = new Set(legacy.publicFiles.map(file => path.relative(path.join(ROOT, 'public'), file.path).split(path.sep).join('/')));
  await pruneGeneratedFiles(path.join(ROOT, 'public/acervo'), keepGenerated);
  await pruneGeneratedFiles(path.join(ROOT, 'public/assets/acervo'), keepGenerated);
  for (const file of legacy.publicFiles) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.bytes);
  }
  await writeFile(path.join(ROOT, 'content/public/snapshot.json'), dataText);
  await writeFile(path.join(ROOT, 'public/downloads/familia-zaniratti.ged'), gedcom);
  await writeFile(path.join(ROOT, 'public/downloads/linha-principal.ged'), gedcom);
  const inventory = { generated_from: 'catalogo_site.json', entries: legacy.inventoryEntries };
  const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
  manifest.inventory_sha256 = digest(Buffer.from(inventoryText));
  await writeFile(path.join(ROOT, 'content/public/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(ROOT, 'content/public/legacy-inventory.json'), inventoryText);
  console.log(`${snapshot.release.state} ${snapshot.people.length} people / ${parentEdgeCount(snapshot)} parent edges / ${snapshot.groups.length} groups / ${snapshot.events.length} events / ${snapshot.biographies.length} biographies / ${snapshot.archive_items.filter(i => i.public_path).length} public archive files / ${snapshot.sources.filter(s => s.id.startsWith('catalog-pdf-')).length} public PDF fichas`);
}
function parentEdgeCount(snapshot) { return snapshot.assertions.filter(a => a.predicate === 'child_of').length; }

main().catch(error => { console.error(`export-public: ${error.message}`); process.exitCode = 1; });
