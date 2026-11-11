// exit 0, writes its evidence. --id <id> --out <file> [--read <file that must exist>] [--hit <url>] [--ms <work time>]
// Barriers, so that "ran at once" and "never ran at once" do not depend on how long node takes to start (2-3 s on a loaded laptop):
//   --mark <file>                 writes <file> when it starts
//   --peek <file> --window <ms>   waits up to the window for <file>; records whether it appeared (a step the runner serialised never sees its partner)
//   --rendezvous <file>           waits up to 8 s for <file>; if it never appears it exits 1 saying which barrier never opened (a runner that did not run both at once)
// Every wait here is bounded (peek 2.5 s by default, rendezvous 8 s, the fake site 30 s), so no fixture step can hang the test.
import { existsSync } from 'node:fs';
import { arg, begin, end, hit, record, sleep, write } from './fx.mjs';

const id = begin();
if (arg('read') && !existsSync(arg('read'))) { console.error(`${id}: input ${arg('read')} is missing`); process.exit(1); }
if (arg('mark')) write(arg('mark'), id);
const waitFor = async (file, ms) => { for (const t0 = Date.now(); !existsSync(file) && Date.now() - t0 < ms;) await sleep(50); return existsSync(file); };
if (arg('peek')) record({ id, event: 'peek', sawOther: await waitFor(arg('peek'), Number(arg('window', 2500))) });
if (arg('rendezvous') && !(await waitFor(arg('rendezvous'), 8000))) { console.error(`${id}: barrier never opened: ${arg('rendezvous')} did not appear in 8 s (my partner never started: the runner did not run us at once)`); process.exit(1); }
await hit(arg('hit'));
await sleep(Number(arg('ms', 0)));
write(arg('out'), JSON.stringify({ id, args: process.argv.slice(2), cwd: process.cwd() }));
console.log(`${id} done`);
end(id);
