// Work order 02 Settled 7: the import's row cap is measured, not guessed. An Edge Function has 2 s of CPU; the cap is the largest of 1000, 2000 and
// 5000 rows whose parse + map stays under 1 s of CPU. Not a test (no .test.ts): run it in Deno, the functions' runtime, and copy the lines into
// docs/product/4-backend.md.
//   deno run -A supabase/functions/test/import-cpu.ts [--runs 5]
// Synthetic rows only (HubSpot-style headers with the test site's budget and timing). Each size runs --runs times after one warm-up run; the line
// gives the median and the worst CPU time (process.cpuUsage, user + system) of parse + map alone, and of everything lead-import does in JS before the
// database call (parse, map, the rows it sends, JSON, sha256 of the file).
import { cpuUsage } from 'node:process';
import { importRows, parseCsv } from '../_shared/crm-map.ts';
import { sha256Hex } from '../_shared/http.ts';

const runs = Number(Deno.args[Deno.args.indexOf('--runs') + 1] || 5) || 5;
const TEMPLATE = { columns: [
  { header: 'First Name', field: 'name', transform: 'first' }, { header: 'Last Name', field: 'name', transform: 'last' }, { header: 'Email', field: 'email' },
  { header: 'Phone Number', field: 'phone', transform: 'e164' }, { header: 'Lead Status', field: 'status' }, { header: 'Budget', field: 'answers.budget' },
  { header: 'Timing', field: 'answers.timing' }, { header: 'Message', field: 'answers.message' }, { header: 'Contact owner', field: 'owner' },
], value_maps: { status: { new: 'New', contacted: 'Attempted to Contact', qualified: 'Connected', closed: 'Open Deal', spam: 'Unqualified' } } };
const TIMING = ['0-3 months', '3-6 months', '6-12 months', 'just looking'];
// pad: extra characters in each row's message, so the largest case is a 5 MB file (the body cap) of 5000 rows
function file(n: number, pad = 0): string {
  const lines = [TEMPLATE.columns.map(c => c.header).join(',')];
  for (let i = 0; i < n; i++) {
    lines.push([`Jordan${i}`, `Reyes van der Berg ${i}`, `jordan.${i}@example.com`, `(510) 555-${String(i % 10000).padStart(4, '0')}`, 'Attempted to Contact',
      String(250000 + i * 10), TIMING[i % 4], `"Call me after six, please. Interested in a ""three bed"" near the park, row ${i}.${' more'.repeat(pad / 5)}"`, 'Agent One'].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
const cpuMs = (f: () => unknown) => { const a = cpuUsage(); f(); const b = cpuUsage(a); return (b.user + b.system) / 1000; };
const cpuMsAsync = async (f: () => Promise<unknown>) => { const a = cpuUsage(); await f(); const b = cpuUsage(a); return (b.user + b.system) / 1000; };
const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const r0 = (x: number) => Math.round(x);

console.log(`Deno ${Deno.version.deno} (V8 ${Deno.version.v8}), ${runs} runs per size after one warm-up`);
for (const [n, pad] of [[1000, 0], [2000, 0], [5000, 0], [5000, 840]]) {
  const text = file(n, pad);
  const mapOnly = () => importRows(TEMPLATE, parseCsv(text).rows);
  const whole = async () => {
    const p = parseCsv(text);
    const m = importRows(TEMPLATE, p.rows);
    const rows = m.leads.map((l: Record<string, unknown>, i: number) => ({ line: m.sourceRows[i] + 2, ...l }));
    JSON.stringify(rows);
    await sha256Hex(text);
  };
  cpuMs(mapOnly); await whole();   // warm-up
  const a: number[] = [], b: number[] = [];
  for (let i = 0; i < runs; i++) { a.push(cpuMs(mapOnly)); b.push(await cpuMsAsync(whole)); }
  const check = importRows(TEMPLATE, parseCsv(text).rows);
  if (check.leads.length !== n) throw new Error(`expected ${n} leads, got ${check.leads.length}`);
  console.log(`${n} rows (${(text.length / 1024 / 1024).toFixed(2)} MB): parse + map ${r0(median(a))} ms CPU (worst ${r0(Math.max(...a))}); ` +
    `everything before the database ${r0(median(b))} ms CPU (worst ${r0(Math.max(...b))})`);
}
