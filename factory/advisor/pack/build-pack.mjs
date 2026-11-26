// Builds a pack.json from a hand-converted source module (factory/advisor/packs/<client>/source.mjs).
// Each intent whose answer names a claim gets that claim's text, with its facts filled in, as its variant; claims keep their {{fact.x}} so the
// validator can see a line that would use a MISSING fact. Keys are sorted so two builds give the same bytes.
// Run: node factory/advisor/pack/build-pack.mjs <source.mjs> <out.json>
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: build-pack.mjs <source.mjs> <out.json>'); process.exit(2); }
const pack = structuredClone((await import(pathToFileURL(resolve(src)).href)).default);
const facts = pack.facts || {};
const fill = (s) => s.replace(/\{\{\s*fact\.([\w-]+)\s*\}\}/g, (m, k) => (facts[k] && facts[k].value != null ? String(facts[k].value) : m));
const claims = new Map((pack.claims || []).map((c) => [c.id, c]));
for (const it of pack.intents || []) {
  if (it.variants || !it.answer) continue;
  const c = claims.get(it.answer);
  if (c) it.variants = [c.text, ...(c.variants || [])].map((t) => ({ when: [], text: fill(t) }));
  if (!it.label) it.label = it.id;
}
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x;
const text = JSON.stringify(sortKeys(pack), null, 1) + '\n';
writeFileSync(out, text);
console.log('wrote ' + out + ' ' + Buffer.byteLength(text) + ' bytes, ' + (pack.intents || []).length + ' intents, ' + (pack.claims || []).length + ' claims');
