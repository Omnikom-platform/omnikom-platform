// deploy-signed: uploads a signed or sealed folder to its Cloudflare Pages project ONLY if its checks pass for the stage, then writes the
// project and deployment id into that stage's register line.
//   node deploy-signed.mjs <signed> --clean <clean> --mode draft|live|handover --to preview|production [--i-mean-production] --project <pages project> [--functions <lead.js>] [--register <file>]
//   node deploy-signed.mjs <sealed> --in <signed draft> --clean <clean> --mode sealed --to preview --project <pages project> [--functions <lead.js>] [--register <file>]
// Nothing has a default: draft and sealed take only --to preview, live and handover only --to production, and the register is
// --register <file> or SIGN_SITE_REGISTER (kept outside the repository). --to production also needs --i-mean-production (live and
// handover deploys are the owner's go only, README.md). Needs CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID when the token sees more than one account). Exit 0 deployed, 1 refused or failed, 2 wrong command line.
// The upload is the seam `run`, the project read `probe`, the clock `now` (deploy-signed.test.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check as checkSigned, REGISTER_UNSET } from './sign-site.mjs';
import { check as checkSealed } from './seal-site.mjs';

const TARGET = { draft: 'preview', sealed: 'preview', live: 'production', handover: 'production' };
const STAGE = { draft: 'draft', sealed: 'sealed-draft', live: 'live', handover: 'handed-over' };
const USAGE = 'usage: node deploy-signed.mjs <signed> --clean <clean> --mode draft|live|handover --to preview|production [--i-mean-production] --project <p> [--functions <lead.js>] [--register <file>]\n'
  + '   or: node deploy-signed.mjs <sealed> --in <signed draft> --clean <clean> --mode sealed --to preview --project <p> [--functions <lead.js>] [--register <file>]\n'
  + 'draft and sealed take only --to preview, live and handover only --to production (with --i-mean-production)';

// the real upload: wrangler deploys <dir>/public (with <dir>/functions) to the project and returns what it printed
export function upload({ dir, project }) {
  const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  return execFileSync(process.execPath, [NPX_CLI, '--yes', 'wrangler@4.151.3', 'pages', 'deploy', 'public', '--project-name', project, '--branch', 'main', '--commit-dirty=true'], { cwd: dir, encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
// the project read with the token: the same call as `omnikom site project get` (project-api.mjs), run as a child so a test can hand a fake
export const probe = ({ project, env }) => spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'project-api.mjs'), 'get', project], { env, encoding: 'utf8', timeout: 60000 });
const TOKEN_REFUSED = (p) => `REFUSED: the token was refused for project ${p}; the key file loaded may be the wrong one for this project; nothing deployed`;
const AUTH_TEXT = /Authentication error|\[code: (?:10000|9106|9109)\]/i;
const lastLine = (t) => String(t).trim().split(/\r?\n/).pop().slice(0, 160);
// the register line a deploy fills: the LAST one with this id and this stage whose project and deployment cells are still "-"
const lineOf = (lines, id, stage) => lines.findLastIndex((l, i) => { const c = l.split('\t'); return i > 0 && c[3] === id && c[2] === stage && c[7] === '-' && c[8] === '-'; });

export function deploy(argv, { env = process.env, run = upload, probe: read = probe, now = Date.now, out = console.log, err = console.error } = {}) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const folder = argv[0], clean = opt('--clean'), mode = opt('--mode'), to = opt('--to'), project = opt('--project'), fn = opt('--functions'), inDir = opt('--in');
  if (!folder || folder.startsWith('--') || !clean || !Object.hasOwn(TARGET, mode || '') || to !== TARGET[mode] || !/^[a-z0-9-]+$/.test(project || '') || (mode === 'sealed') !== (inDir !== undefined)) { err(USAGE); return 2; }
  if (to === 'production' && !argv.includes('--i-mean-production')) { err("REFUSED: a production upload needs --i-mean-production (the owner's go); nothing deployed"); return 1; }
  const register = opt('--register') || env.SIGN_SITE_REGISTER;
  if (!register) { err(`REFUSED: ${REGISTER_UNSET}`); return 1; }
  if (!env.CLOUDFLARE_API_TOKEN) { err('CLOUDFLARE_API_TOKEN is not set'); return 1; }
  const refuse = (res, why) => { err(res.problems.slice(0, 20).join('\n')); err(`REFUSED: ${why}; nothing deployed`); return 1; };
  let res;
  if (mode === 'sealed') {
    // seal-site's check also proves <sealed>-functions holds exactly omk-key.js, the tool's file for this ID
    res = checkSealed(folder, inDir, true);
    if (!res.ok) return refuse(res, `${folder} fails the sealed check against ${inDir}`);
    const draft = checkSigned(inDir, 'draft', clean, true);
    if (!draft.ok) return refuse(draft, `${inDir} fails the draft check against ${clean}`);
  } else {
    res = checkSigned(folder, mode, clean, true);
    if (!res.ok) return refuse(res, `${folder} fails the ${mode} check`);
  }
  const stage = STAGE[mode];
  if (lineOf(fs.existsSync(register) ? fs.readFileSync(register, 'utf8').split('\n') : [], res.id, stage) < 0) { err(`REFUSED: the register has no ${stage} line for ${res.id} waiting for a deployment; nothing deployed`); return 1; }
  const seen = read({ project, env });
  if (seen.status !== 0) { const t = `${seen.stdout || ''}${seen.stderr || ''}`, http = (t.match(/HTTP (\d{3})/) || [])[1]; err(http === '401' || http === '403' ? TOKEN_REFUSED(project) : `REFUSED: the project ${project} could not be read (${lastLine(t)}); nothing deployed`); return 1; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-signed-'));
  try {
    fs.cpSync(folder, path.join(dir, 'public'), { recursive: true });
    if (fn) { fs.mkdirSync(path.join(dir, 'functions', 'api'), { recursive: true }); fs.copyFileSync(fn, path.join(dir, 'functions', 'api', 'lead.js')); }
    // the draft lock's key function, written beside the folder by sign-site (draft) or seal-site (sealed); the checks above proved it is the tool's
    const keyDir = `${path.resolve(folder)}-functions`;
    if (fs.existsSync(keyDir)) fs.cpSync(keyDir, path.join(dir, 'functions'), { recursive: true });
    const t0 = now(); let printed;
    try { printed = String(run({ dir, project }) || ''); } catch (e) { const t = `${e.stdout || ''}${e.stderr || ''}`; err(AUTH_TEXT.test(t) ? TOKEN_REFUSED(project) : `FAILED: the upload to ${project} failed (${lastLine(t || e.message)}); the register line was not filled`); return 1; }
    const took = Math.round((now() - t0) / 1000);
    const url = printed.match(/https:\/\/([0-9a-f]{8})\.[a-z0-9-]+\.pages\.dev/) || [];
    const lines = fs.readFileSync(register, 'utf8').split('\n'), i = lineOf(lines, res.id, stage);
    if (i < 0) { err(`deployed ${project}, but the ${stage} line for ${res.id} is gone from the register: record it by hand`); return 1; }
    const c = lines[i].split('\t'); c[7] = project; c[8] = url[1] || 'unknown'; lines[i] = c.join('\t');
    fs.writeFileSync(register, lines.join('\n'));
    out(`deployed ${project}: ${url[0] || 'url not printed'} (${res.id}, stage ${stage}); register updated; upload took ${took} s`);
    return 0;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const isMain = (() => { if (!process.argv[1]) return false; try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) process.exitCode = deploy(process.argv.slice(2));
