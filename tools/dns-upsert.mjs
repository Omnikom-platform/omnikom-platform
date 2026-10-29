// Creates DNS records in a Cloudflare zone, idempotently (same name + type + content = skip), from a JSON file of records.
//   node tools/dns-upsert.mjs --zone omnikom.io --records <file.json> [--token-env CLOUDFLARE_API_TOKEN] [--dry-run]
// The file holds [{type, name, content, priority?, proxied?}] with names relative to the zone ("send.notify") or absolute.
// The token is read from the environment by NAME only and never printed; records are public DNS data and are printed.
// Used 2026-10-30 for the Resend records of notify.omnikom.io (25-BUILD-SEQUENCE 1.4).
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const after = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const zoneName = after('--zone'), file = after('--records'), tokenEnv = after('--token-env', 'CLOUDFLARE_API_TOKEN'), dry = argv.includes('--dry-run');
const token = process.env[tokenEnv];
if (!zoneName || !file) { console.error('usage: --zone <zone> --records <file.json> [--token-env NAME] [--dry-run]'); process.exit(2); }
if (!token) { console.error(`set ${tokenEnv} (read by name, never printed)`); process.exit(2); }
const api = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  if (!j.success) throw new Error(`${path}: ${JSON.stringify(j.errors).replace(token, '<token>')}`);
  return j.result;
};
const zones = await api(`/zones?name=${encodeURIComponent(zoneName)}`);
if (!zones.length) { console.error(`zone ${zoneName} is not visible to ${tokenEnv}`); process.exit(1); }
const zone = zones[0];
console.log(`zone ${zone.name} (${zone.id}) in account "${zone.account.name}"`);
const want = JSON.parse(readFileSync(file, 'utf8'));
let created = 0, skipped = 0, failed = 0;
for (const w of want) {
  const name = w.name.endsWith(zoneName) ? w.name : `${w.name}.${zoneName}`;
  const existing = await api(`/zones/${zone.id}/dns_records?type=${w.type}&name=${encodeURIComponent(name)}`);
  const same = existing.find(e => e.content.replace(/^"|"$/g, '') === w.content);
  if (same) { console.log(`skip   ${w.type} ${name} (exists)`); skipped++; continue; }
  if (existing.length && w.type === 'CNAME') { console.log(`FAIL   ${w.type} ${name}: a different CNAME exists (${existing[0].content})`); failed++; continue; }
  const body = { type: w.type, name, content: w.content, ttl: 1, proxied: w.proxied === true, ...(w.type === 'MX' ? { priority: Number(w.priority ?? 10) } : {}) };
  if (dry) { console.log(`would  ${w.type} ${name} -> ${w.content}`); continue; }
  try { const r = await api(`/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(body) }); console.log(`create ${w.type} ${r.name} -> ${r.content.slice(0, 60)}${r.content.length > 60 ? '...' : ''}`); created++; }
  catch (e) { console.log(`FAIL   ${w.type} ${name}: ${e.message}`); failed++; }
}
console.log(`${dry ? 'DRY RUN' : 'done'}: ${created} created, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
