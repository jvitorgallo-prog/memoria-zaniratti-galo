import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = JSON.parse(await readFile(path.join(root, 'src/data/historical-images.json'), 'utf8'));
const hashes = new Set();
const supplement = JSON.parse(await readFile(path.join(root, 'content/public/supplement-manifest.json'), 'utf8'));
assert.equal(supplement.state, 'approved');
assert.equal(supplement.reviewed_by_role, 'coordenação editorial');
assert.equal(createHash('sha256').update(await readFile(path.join(root, 'content/public/snapshot.json'))).digest('hex'), supplement.base_snapshot_sha256);
for (const entry of supplement.files) {
  assert.match(entry.path, /^downloads\/[a-z0-9-]+\.(json|zip)$/);
  const bytes = await readFile(path.join(root, 'public', entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
}
for (const item of images) {
  assert.match(item.path, /^\/assets\/imagens-originais\/[a-z0-9-]+\.(gif|jpe?g|png|webp)$/i);
  const bytes = await readFile(path.join(root, 'public', item.path));
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, item.sha256, `Integridade: ${item.original_filename}`);
  assert.equal(bytes.length, item.bytes);
  assert(!hashes.has(hash), `Hash repetido fora de aliases: ${item.original_filename}`);
  hashes.add(hash);
  const validImage = bytes.subarray(0,6).toString().startsWith('GIF8') || bytes.subarray(0,3).equals(Buffer.from([255,216,255])) || bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP');
  assert(validImage, `O arquivo não contém uma imagem: ${item.original_filename}`);
  const origin = new URL(item.provenance.original_url);
  assert(origin.hostname === 'zaniratti.it' || origin.hostname.endsWith('.zaniratti.it'));
  const capture = new URL(item.provenance.snapshot_url);
  assert.equal(capture.hostname, 'web.archive.org');
  assert.match(item.provenance.timestamp_utc, /^\d{14}$/);
  assert(capture.pathname.startsWith('/web/'+item.provenance.timestamp_utc), 'Timestamp e link arquivado divergem');
  assert(!/\/\.\.\//.test(item.path));
}
console.log(`${images.length} imagens originais verificadas por bytes, formato, hash e proveniência.`);
