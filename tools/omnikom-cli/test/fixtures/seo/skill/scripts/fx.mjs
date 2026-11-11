// Helpers of the fake step scripts of the `omnikom seo` tests. Every script is one behaviour a real step can have (test/seo-run.mjs).
// SEO_FIXTURE_RECORD (a file the test names) gets one JSON line per start and end: the tests read it to see order and overlap.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const record = o => { if (process.env.SEO_FIXTURE_RECORD) appendFileSync(process.env.SEO_FIXTURE_RECORD, JSON.stringify(o) + '\n'); };
export function write(file, text = '{"ok":true}\n') { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
// one request to the fake site (the "client"): the server counts how many are open at once
export async function hit(url) { if (url) await fetch(url, { signal: AbortSignal.timeout(30000) }).then(r => r.text()); }
export const begin = () => { const id = arg('id', process.argv[1]); record({ id, event: 'start', t: Date.now() }); return id; };
export const end = id => record({ id, event: 'end', t: Date.now() });
