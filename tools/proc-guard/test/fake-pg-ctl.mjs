// A stand-in for pg_ctl. Records every call (one JSON line in FAKE_PGCTL_LOG). Without FAKE_PGCTL_FAIL it behaves like a stop: it
// ends the process named in <data>/postmaster.pid with its whole tree and removes the pid file. With FAKE_PGCTL_FAIL it fails and
// changes nothing.
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_PGCTL_LOG, JSON.stringify(args) + '\n');
if (process.env.FAKE_PGCTL_FAIL) process.exit(1);
const data = args[args.indexOf('-D') + 1];
const pidFile = join(data, 'postmaster.pid');
const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 30000 });
else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
rmSync(pidFile, { force: true });
