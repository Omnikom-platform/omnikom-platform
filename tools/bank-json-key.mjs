// Banks a downloaded service-account JSON key file into the master .env as ONE base64 line under a variable name, then deletes
// the downloaded file. The content is never printed: only the name, the key's client_email and the length are shown.
//   node tools/bank-json-key.mjs --file "<path to the downloaded .json>" --name GOOGLE_SERVICE_ACCOUNT_JSON --env "<env file>"
// Use: a .json saved by the browser into the Downloads folder must not stay there (ground rule 6: no secret outside the store).
import { readFileSync, rmSync } from 'node:fs';
import { bank } from './lib/bank.mjs';

const argv = process.argv.slice(2);
const after = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const file = after('--file'), name = after('--name', 'GOOGLE_SERVICE_ACCOUNT_JSON'), env = after('--env', process.env.OMNIKOM_ENV_FILE);
if (!file || !env) { console.error('usage: --file <json> [--name VAR] --env <env file>'); process.exit(2); }
const raw = readFileSync(file, 'utf8');
let j; try { j = JSON.parse(raw); } catch { console.error('not a JSON file'); process.exit(1); }
if (j.type !== 'service_account' || !j.private_key || !j.client_email) { console.error('not a service-account key (type, private_key, client_email expected)'); process.exit(1); }
const r = bank(env, name, Buffer.from(raw, 'utf8').toString('base64'));
if (!r.ok) { console.error('NOT SAVED:', r.error); process.exit(1); }
rmSync(file, { force: true });
console.log(`saved ${name} (${r.length} chars, base64 of the JSON) for ${j.client_email} in project ${j.project_id}; downloaded file deleted`);
