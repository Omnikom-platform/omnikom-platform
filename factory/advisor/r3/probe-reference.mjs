// Probe: load today's engine from the lovable source (read-only) and answer one line. Run with the ts-hook.
import { pathToFileURL } from 'node:url';
const src = process.argv[2];
const mod = await import(pathToFileURL(src + '/advisor-engine/index.ts').href);
const e = mod.getEngine();
const { reply } = e.respond(mod.initialState(), process.argv[3] || 'how much does it cost');
console.log(JSON.stringify({ intents: reply.intents, band: reply.band, text: reply.text.slice(0, 120), stats: e.stats }));
