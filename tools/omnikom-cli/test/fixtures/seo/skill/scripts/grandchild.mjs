// the process hang.mjs starts: writes its pid and waits
import { writeFileSync } from 'node:fs';
import { arg } from './fx.mjs';

writeFileSync(arg('pidfile'), String(process.pid));
setInterval(() => {}, 1000);
setTimeout(() => process.exit(3), 120000);   // never outlives a failed tree kill for long
