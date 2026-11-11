// never ends, and has a child that never ends either: a timeout must stop the whole tree. --pidfile <file> gets the grandchild's pid
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { arg, begin, write } from './fx.mjs';

begin();
const child = spawn(process.execPath, [fileURLToPath(new URL('./grandchild.mjs', import.meta.url)), '--pidfile', arg('pidfile')], { stdio: 'ignore' });
child.unref();
write(arg('pidfile'), String(child.pid));   // at once: a slow machine may stop this step before the grandchild's own node has started
console.log('hanging');
setInterval(() => {}, 1000);
setTimeout(() => process.exit(3), 90000);   // the runner's timeout stops this long before; if that ever fails, this ends the step instead of hanging the test
