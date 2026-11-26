// The engine must not name a client, nor an intent of any pack. Exits 1 if any file in factory/advisor/engine/ contains a
// banned string (any case), or names an intent id or an intent family ("price." and the like) of a pack under
// factory/advisor/packs/; otherwise prints "NO CLIENT TEXT: PASS". Every client word and every intent the engine steers by
// belongs in a pack (for intents: pack.steer), never in the engine.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BANNED = ['1,299', 'omnikom', 'cold call'];
const dir = fileURLToPath(new URL('../engine/', import.meta.url));
const packsDir = fileURLToPath(new URL('../packs/', import.meta.url));
const ids = new Set(), families = new Set();
for (const p of readdirSync(packsDir)) {
  const f = join(packsDir, p, 'pack.json');
  if (!existsSync(f)) continue;
  for (const it of JSON.parse(readFileSync(f, 'utf8')).intents || []) {
    ids.add(it.id);
    const dot = it.id.lastIndexOf('.');
    if (dot > 0) families.add(it.id.slice(0, it.id.indexOf('.') + 1));
  }
}
if (!ids.size) { console.log('NO CLIENT TEXT: FAIL (no pack intents found under ' + packsDir + ')'); process.exit(1); }
const hits = [];
for (const name of readdirSync(dir)) {
  const lines = readFileSync(join(dir, name), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const word of BANNED) if (line.toLowerCase().includes(word)) hits.push(name + ':' + (i + 1) + ': contains "' + word + '"');
    for (const m of line.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      const s = m[1];
      if (ids.has(s)) hits.push(name + ':' + (i + 1) + ': names the intent "' + s + '"');
      else for (const f of families) if (s.startsWith(f)) { hits.push(name + ':' + (i + 1) + ': names the intent family "' + f + '"'); break; }
    }
  });
}
if (hits.length) {
  console.log(hits.join('\n'));
  console.log('NO CLIENT TEXT: FAIL (' + hits.length + ')');
  process.exit(1);
}
console.log('NO CLIENT TEXT: PASS (' + ids.size + ' intent ids, ' + families.size + ' families checked)');
