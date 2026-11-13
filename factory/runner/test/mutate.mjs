// Watched-fail for the build runner: a broken COPY of factory/runner (and tools/github-secrets.mjs, .github/workflows, .github/scripts) with ONE rule removed,
// test/run.mjs run against it (RUNNER_DIR, SECRETS_TOOL), the suite must go red on a named check.
// [name, file (relative to the repo root), exactText, replacement, sections of run.mjs that judge it], applied with split/join to a temp copy,
// one child process per mutant, a few at a time. Caught = the suite exited nonzero AND printed a "FAIL <check>" line (a crash of the
// test itself, "FAIL import", is not a catch); target text not found exactly once = "target text missing".
// Pattern: factory/test/mutate.mjs. The media mutants need sharp (npm ci --prefix factory/runner) and are reported as skipped without it.
//   node factory/runner/test/mutate.mjs      exit 0 = every mutant caught, none missing
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const R = 'factory/runner/';
const HAS_SHARP = existsSync(join(REPO, R, 'node_modules', 'sharp'));
const ALL_MUTANTS = [
  // publish.mjs: the refusals before any build
  ['publish: a different site is accepted', `${R}publish.mjs`, 'if (exp.site.id !== SITE_ID) throw', 'if (false) throw', 'refusals'],
  ['publish: a different job is accepted', `${R}publish.mjs`, 'if (exp.job.id !== JOB_ID) throw', 'if (false) throw', 'refusals'],
  ['publish: a missing look-folder is accepted', `${R}publish.mjs`, 'if (!existsSync(design)) throw', 'if (false) throw', 'refusals'],
  ['publish: a non-200 export is accepted', `${R}publish.mjs`, 'if (ex.status !== 200) throw new Stop(', 'if (false) throw new Stop(', 'refusals'],
  ['publish: a missing Cloudflare credential is accepted', `${R}publish.mjs`, "if (!opts['no-deploy'] && (!CF_TOKEN || !CF_ACCOUNT)) throw", 'if (false) throw', 'refusals'],
  ['publish: a media path that climbs out is accepted', `${R}publish.mjs`, 'if (!m || !safeRelPath(m.path)) throw', 'if (!m) throw', 'media-export'],
  ['publish: a media url on another host is fetched', `${R}publish.mjs`, "else if (new URL(m.url, origin).origin !== origin) why = 'url on another host';", '', 'media-export'],
  ['publish: a failure sends no failed callback', `${R}publish.mjs`, "await callback('failed', {", 'void ({', 'refusals'],
  // publish.mjs: a busy site is waited for (work order 13, H0-1)
  ['publish: a busy site (S-JOB-BUSY) is not waited for', `${R}publish.mjs`, 'for (let tries = 0, waited = 0; isBusy(ex); tries++) {', 'for (let tries = 0, waited = 0; false; tries++) {', 'refusals'],
  ['publish: every 409 on the export counts as busy', `${R}publish.mjs`, "try { return JSON.parse(r.text).code === 'S-JOB-BUSY'; }", 'try { return true; }', 'refusals'],
  // publish.mjs: build, gate, deploy
  ['publish: --force-fail is not passed to the factory', `${R}publish.mjs`, "...(opts['force-fail'] ? ['--force-fail', opts['force-fail']] : [])", '...[]', 'gate'],
  ['publish: the audit exit code is ignored', `${R}publish.mjs`, 'if (a.status !== 0) {\n    for (const f of', 'if (false) {\n    for (const f of', 'gate'],
  ['publish: an audit usage error is not told apart', `${R}publish.mjs`, 'if (a.status === 2) throw', 'if (false) throw', 'gate'],
  ['publish: the audit is not run with --summary', `${R}publish.mjs`, "'--target', auditTarget, '--summary']", "'--target', auditTarget]", 'gate'],
  ['publish: a pass stores a made-up audit, not the summary', `${R}publish.mjs`, "const gateReport = { factory: 'pass', audit };", "const gateReport = { factory: 'pass', audit: { exit: 0, fails: [] } };", 'gate'],
  ['publish: a fail stores only the exit, not the summary', `${R}publish.mjs`, "throw new Stop('audit failed', { factory: 'pass', audit });", "throw new Stop('audit failed', { factory: 'pass', audit: { exit: a.status } });", 'gate'],
  ['publish: output that is not JSON passes the audit', `${R}publish.mjs`, "if (!audit || typeof audit !== 'object'", "if (false && typeof audit !== 'object'", 'gate'],
  ['publish: a summary of another version is accepted', `${R}publish.mjs`, ' || audit.v !== 1 ||', ' ||', 'gate'],
  ['publish: a summary without a pass flag is accepted', `${R}publish.mjs`, " || typeof audit.pass !== 'boolean'", '', 'gate'],
  ['publish: an unreadable audit output keeps no exit or lines', `${R}publish.mjs`, "throw new Stop('audit output unreadable', { factory: 'pass', audit: { exit: a.status, lines: tail(a.text, 10) } });", "throw new Stop('audit output unreadable', { factory: 'pass' });", 'gate'],
  ['publish: the FAIL lines are not printed', `${R}publish.mjs`, 'for (const f of audit.fails.slice(0, 20)) out(', 'for (const f of []) out(', 'gate'],
  ['publish: the audit target is swapped (preview judged as production, live as preview)', `${R}publish.mjs`, "const auditTarget = branch === 'main' ? 'production' : 'preview';", "const auditTarget = branch === 'main' ? 'preview' : 'production';", 'gate'],
  ['publish: the audit is not told the target', `${R}publish.mjs`, "dist, '--target', auditTarget, '--summary']", "dist, '--summary']", 'gate'],
  ['publish: no gating callback', `${R}publish.mjs`, "await callback('gating');", '', 'full'],
  ['publish: no deploying callback', `${R}publish.mjs`, "await callback('deploying');", '', 'full'],
  ['publish: a preview deploys to the production branch', `${R}publish.mjs`, "exp.site.state !== 'live' ? 'preview' : 'main';", "'main';", 'wrangler'],
  ['publish: a live site deploys to the preview branch', `${R}publish.mjs`, "exp.site.state !== 'live' ? 'preview' : 'main';", "'preview';", 'wrangler'],
  ['publish: the Cloudflare token is not given to wrangler', `${R}publish.mjs`, 'CLOUDFLARE_API_TOKEN: CF_TOKEN,', 'CLOUDFLARE_API_TOKEN: CF_ACCOUNT,', 'wrangler'],
  ['publish: wrangler gets the runner\'s whole environment back (no allow list)', `${R}publish.mjs`, 'const wenv = childEnv({', 'const wenv = ({ ...process.env,', 'wrangler'],
  ['publish: the build gets the runner\'s whole environment back', `${R}publish.mjs`, "'--force-fail', opts['force-fail']] : [])], { timeoutMs: 180000, toolEnv: childEnv() }", "'--force-fail', opts['force-fail']] : [])], { timeoutMs: 180000, toolEnv: process.env }", 'childenv'],
  ['publish: the audit gets the runner\'s whole environment back', `${R}publish.mjs`, "auditTarget, '--summary'], { timeoutMs: 180000, toolEnv: childEnv() }", "auditTarget, '--summary'], { timeoutMs: 180000, toolEnv: process.env }", 'childenv'],
  ['childEnv: a name outside the allow list passes (deny list instead of allow list)', `${R}lib/common.mjs`, 'if (CHILD_ALLOW.has(IS_WIN ? k.toUpperCase() : k)) out[k] = v;', 'out[k] = v;', 'childenv'],
  ['publish: the site function is not staged for the deploy', `${R}publish.mjs`, "cpSync(join(REPO, 'factory', 'worker', 'pages-function-lead.js'), join(root, 'lead.js'));", '', 'wrangler'],
  ['publish: a failing wrangler is accepted', `${R}publish.mjs`, "if (w.status !== 0) throw new Stop('deploy failed'", "if (false) throw new Stop('deploy failed'", 'wrangler'],
  ['publish: wrangler output without an address is accepted', `${R}publish.mjs`, "if (!m) throw new Stop('deploy failed: wrangler printed no deployment address'", "if (false) throw new Stop('deploy failed: wrangler printed no deployment address'", 'wrangler'],
  ['publish: the deploy id is not the deployment hash', `${R}publish.mjs`, 'deployId = m[1];', "deployId = 'unknown';", 'wrangler'],
  ['publish: wrangler is not pinned', `${R}publish.mjs`, "const WRANGLER_VERSION = '4.152.0';", "const WRANGLER_VERSION = 'latest';", 'wrangler'],
  ['publish: wrangler output is printed unscrubbed', `${R}publish.mjs`, "const out = (line) => console.log(scrub(line));", 'const out = (line) => console.log(line);', 'wrangler'],
  ['publish: a project missing a lead setting is deployed anyway', `${R}publish.mjs`, 'if (lacking.length) throw new Stop(', 'if (false) throw new Stop(', 'wrangler'],
  ['publish: the lead settings check does not ask for SITE_SIGNING_KEY', `${R}publish.mjs`, "const LEAD_SETTINGS = ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'];", "const LEAD_SETTINGS = ['SITE_ID', 'PLATFORM_BASE'];", 'wrangler'],
  ['publish: the lead settings are read from the wrong environment', `${R}publish.mjs`, "const envName = branch === 'main' ? 'production' : 'preview';", "const envName = branch === 'main' ? 'preview' : 'production';", 'wrangler'],
  ['publish: a project whose settings cannot be read is deployed anyway', `${R}publish.mjs`, 'if (!cf || cf.status !== 200 || !cfJson || cfJson.success === false || !cfJson.result) throw new Stop(', 'if (false) throw new Stop(', 'wrangler'],
  ['publish: the lead settings read is not tried again after a 5xx', `${R}publish.mjs`, 'for (let n = 1; n <= 3 && !(cf && cf.status < 500); n++)', 'for (let n = 1; n <= 1 && !(cf && cf.status < 500); n++)', 'wrangler'],
  ['publish: the lead settings check is skipped altogether', `${R}publish.mjs`, "  if (!opts['no-deploy']) {\n    const envName", "  if (false) {\n    const envName", 'wrangler'],
  // publish.mjs: smoke
  ['publish: smoke gives up after one try', `${R}publish.mjs`, 'for (let n = 1; n <= tries && !smokeOk; n++)', 'for (let n = 1; n <= 1 && !smokeOk; n++)', 'smoke'],
  ['publish: smoke accepts any HTTP status', `${R}publish.mjs`, "if (res.status !== 200) smokeWhy", 'if (false) smokeWhy', 'smoke'],
  ['publish: a preview without noindex passes smoke', `${R}publish.mjs`, 'else if (!isLive && !/noindex/i.test(robots)) smokeWhy', 'else if (false) smokeWhy', 'smoke'],
  ['publish: a live site with noindex passes smoke', `${R}publish.mjs`, 'else if (isLive && /noindex/i.test(robots)) smokeWhy', 'else if (false) smokeWhy', 'smoke'],
  ['publish: the page title is not compared', `${R}publish.mjs`, 'else if (wantTitle === null || !body.includes(`<title>${wantTitle}</title>`)) smokeWhy', 'else if (false) smokeWhy', 'smoke'],
  ['publish: the smoke failure carries no deploy id', `${R}publish.mjs`, '{ ...gateReport, deployId, deployUrl, smoke: smokeWhy }', '{ ...gateReport, smoke: smokeWhy }', 'smoke'],
  // publish.mjs: callbacks
  ['publish: a 409 is treated like any other failure', `${R}publish.mjs`, 'if (r.status === 409) throw new Refused(', 'if (false) throw new Refused(', 'callbacks'],
  // lib/common.mjs
  ['common: callbacks are signed over an empty body', `${R}lib/common.mjs`, "method === 'GET' ? '' : body)", "'')", 'full'],
  ['common: the signature header has another name', `${R}lib/common.mjs`, "'x-runner-signature': await sign(", "'x-signature': await sign(", 'full'],
  ['common: a 503 is not retried', `${R}lib/common.mjs`, 'const RETRY_STATUS = new Set([502, 503, 504]);', 'const RETRY_STATUS = new Set([]);', 'callbacks'],
  ['common: a request has no timeout', `${R}lib/common.mjs`, 'signal: AbortSignal.timeout(timeoutMs) });', '});', 'refusals'],
  ['common: a ".." segment is allowed in a media path', `${R}lib/common.mjs`, " || seg === '..'", '', 'pieces'],
  ['common: a plain http base is accepted anywhere', `${R}lib/common.mjs`, "if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname)))", 'if (false)', 'pieces'],
  ['common: secrets are not scrubbed', `${R}lib/common.mjs`, "for (const v of secrets) t = t.split(v).join('<secret>');", '', 'pieces'],
  ['common: the project ref is not scrubbed', `${R}lib/common.mjs`, 'if (ref) t = t.split(ref).join', 'if (false) t = t.split(ref).join', 'pieces'],
  ['common: signed-URL tokens are not scrubbed', `${R}lib/common.mjs`, "'$1<redacted>'", "'$1'", 'pieces'],
  ['sign: the method is not part of the signed string', `${R}lib/sign.mjs`, '${t}\\n${method.toUpperCase()}\\n${pathWithQuery}\\n${body}', '${t}\\nGET\\n${pathWithQuery}\\n${body}', 'signature'],
  ['sign: the path is not part of the signed string', `${R}lib/sign.mjs`, '\\n${pathWithQuery}\\n${body}', '\\n/\\n${body}', 'signature'],
  // media.mjs (need sharp)
  ['media: the EXIF orientation is not applied', `${R}media.mjs`, '.rotate().resize(', '.resize(', 'media', 'sharp'],
  ['media: the metadata (EXIF, GPS) is kept', `${R}media.mjs`, '.webp({ quality: 82 })', '.withMetadata().webp({ quality: 82 })', 'media', 'sharp'],
  ['media: a size wider than the original is made', `${R}media.mjs`, 'const wanted = SIZES.filter((w) => w <= width);', 'const wanted = SIZES;', 'media', 'sharp'],
  ['media: the 800 slot is not made for an original narrower than 800', `${R}media.mjs`, 'if (!wanted.includes(SMALLEST)) wanted.push(SMALLEST);', '', 'media', 'sharp'],
  ['media: a narrow original is upscaled into the 800 slot', `${R}media.mjs`, '.resize({ width: w, withoutEnlargement: true })', '.resize({ width: w, withoutEnlargement: false })', 'media', 'sharp'],
  ['media: another workspace is accepted', `${R}media.mjs`, 'if (m.workspace_id !== WORKSPACE_ID) die(', 'if (false) die(', 'media', 'sharp'],
  ['media: a PDF is run through the image pipeline', `${R}media.mjs`, 'if (/\\.pdf$/i.test(m.path)) {', 'if (false) {', 'media', 'sharp'],
  ['media: exifStripped is reported false', `${R}media.mjs`, 'exifStripped: true, bytes: total', 'exifStripped: false, bytes: total', 'media', 'sharp'],
  ['media: a failed upload is ignored', `${R}media.mjs`, 'if (put.status < 200 || put.status >= 300) die(', 'if (false) die(', 'media', 'sharp'],
  ['media: an upload url on another host is accepted', `${R}media.mjs`, ' || !sameHost(m.uploads[w]))', ')', 'media', 'sharp'],
  // the workflow files
  ['workflows: an action is pinned by a tag, not a SHA', '.github/workflows/ci.yml', 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          fetch-depth: 0', 'actions/checkout@v7\n        with:\n          fetch-depth: 0', 'workflows'],
  ['workflows: ci.yml has no permissions block', '.github/workflows/ci.yml', 'permissions:\n  contents: read\n\nconcurrency:\n  group: ci-', 'concurrency:\n  group: ci-', 'workflows'],
  ['workflows: a job has no timeout', '.github/workflows/keepalive.yml', '    timeout-minutes: 10\n', '', 'workflows'],
  ['workflows: a secret is put on a command line', '.github/workflows/publish.yml', 'node factory/runner/publish.mjs "${args[@]}"', 'node factory/runner/publish.mjs "${args[@]}" ${{ secrets.RUNNER_KEY }}', 'workflows'],
  ['workflows: the payload is expanded inside the script', '.github/workflows/media.yml', 'run: node factory/runner/media.mjs', 'run: node factory/runner/media.mjs ${{ github.event.client_payload.media_id }}', 'workflows'],
  ['workflows: the backup job is not switched off', '.github/workflows/backup.yml', "    if: ${{ vars.BACKUP_ENABLED == 'true' }}\n", '', 'workflows'],
  ['workflows: publish loses its per-site queue', '.github/workflows/publish.yml', '  queue: max\n', '', 'workflows'],
  ['workflows: the gitleaks download is not checked against its sha256', '.github/workflows/ci.yml', '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb', '0000000000000000000000000000000000000000000000000000000000000000', 'workflows'],
  ['workflows: the shellcheck download is not checked against its sha256', '.github/workflows/ci.yml', 'b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6', '0000000000000000000000000000000000000000000000000000000000000000', 'workflows'],
  ['workflows: actionlint uses the image shellcheck, not the pinned one', '.github/workflows/ci.yml', ' -shellcheck "$RUNNER_TEMP/shellcheck-v0.11.0/shellcheck"', '', 'workflows'],
  // tools/github-secrets.mjs
  ['secrets: the value is given on the command line', 'tools/github-secrets.mjs', "gh(['secret', 'set', name, '-R', opts.repo], value)", "gh(['secret', 'set', name, '-R', opts.repo, '-b', value], undefined)", 'secrets'],
  ['secrets: --dry-run still sets', 'tools/github-secrets.mjs', 'if (opts.dry) {', 'if (false) {', 'secrets'],
  ['secrets: gh output is not scrubbed', 'tools/github-secrets.mjs', 'err: scrub(r.stderr)', 'err: String(r.stderr || "")', 'secrets'],
  ['secrets: the base address is derived wrongly', 'tools/github-secrets.mjs', '.supabase.co/functions/v1`;', '.supabase.co/functions/v2`;', 'secrets'],
  ['secrets: a missing name is skipped silently', 'tools/github-secrets.mjs', "if (!value) { console.log(`NOT SET (missing in the env): ${name}`); continue; }", 'if (!value) { continue; }', 'secrets'],
  ['secrets: a lowercase name is accepted', 'tools/github-secrets.mjs', "!/^[A-Z][A-Z0-9_]*$/.test(n) || n.startsWith('GITHUB_')", "n.startsWith('GITHUB_')", 'secrets'],
  ['secrets: a GITHUB_ name is accepted', 'tools/github-secrets.mjs', " || n.startsWith('GITHUB_')", '', 'secrets'],
  ['secrets: a failed set still exits 0', 'tools/github-secrets.mjs', 'process.exit(failed ? 1 : 0);', 'process.exit(0);', 'secrets'],
  // E8: the deployment's own address by content hash, the rollback of a live deploy (book row E8, H1-6)
  ['E8 publish: a failed live smoke is not rolled back', `${R}publish.mjs`, "branch === 'main' && !opts['no-deploy'] ?", 'false ?', 'wrangler'],
  ['E8 publish: a failed preview smoke is rolled back too', `${R}publish.mjs`, "branch === 'main' && !opts['no-deploy'] ?", "!opts['no-deploy'] ?", 'wrangler'],
  ['E8 publish: the rollback names another deployment', `${R}publish.mjs`, '/deployments/${id}/rollback', '/deployments/latest/rollback', 'wrangler'],
  ['E8 publish: a refused rollback is reported as done', `${R}publish.mjs`, 'r && r.status === 200 && j && j.success === true ?', 'r ?', 'wrangler'],
  ['E8 publish: the deployment live before is not read', `${R}publish.mjs`, 'previous = liveDeploymentOf(cfJson.result);', '', 'wrangler'],
  ['E8 publish: no earlier deployment is rolled back anyway', `${R}publish.mjs`, "if (!previous) return 'no earlier deployment to roll back to: the failed one stays live';", '', 'wrangler'],
  ['E8 publish: the own address is not compared by content hash', `${R}publish.mjs`, 'else if (ownHash !== wantHash) smokeWhy', 'else if (false) smokeWhy', 'smoke'],
  // E9: both dispatch triggers on media.yml, version-free job names, the ruleset (book row E9, H0-5)
  ['E9 workflows: media.yml groups by the payload only', '.github/workflows/media.yml', '  group: media-${{ github.event.client_payload.media_id || inputs.media_id }}', '  group: media-${{ github.event.client_payload.media_id }}', 'workflows'],
  ['E9 workflows: a job name carries a version again', '.github/workflows/ci.yml', '    name: secret scan (gitleaks)', '    name: secret scan (gitleaks 8.30.1)', 'workflows'],
  ['E9 workflows: a required check is renamed in ci.yml', '.github/workflows/ci.yml', '    name: departments and client files', '    name: departments and the client files', 'workflows'],
  // B15-b3: the draft deployment, its signed link and gate, the delete of a failed draft (book row B15)
  ['B15 publish: a preview build of a live site goes to main', `${R}publish.mjs`, "exp.job.preview === true ? 'draft' :", "false ? 'draft' :", 'wrangler'],
  ['B15 publish: a preview build of a live site is smoked as live', `${R}publish.mjs`, "const isLive = branch === 'main';", "const isLive = exp.site.state === 'live';", 'wrangler'],
  ['B15 publish: a preview ships no gate', `${R}publish.mjs`, '    if (gate) {   // book row B15-b3', '    if (false) {   // book row B15-b3', 'wrangler'],
  ['B15 publish: the smoke never asks without the link', `${R}publish.mjs`, 'if (bare !== 404) smokeWhy', 'if (false) smokeWhy', 'wrangler'],
  ['B15 publish: the link is not reported', `${R}publish.mjs`, 'gateReport: gate ? { ...gateReport, link:', 'gateReport: false ? { ...gateReport, link:', 'wrangler'],
  ['B15 publish: the token itself ships in the deployment', `${R}publish.mjs`, "sha256: createHash('sha256').update(gate.token).digest('hex')", 'sha256: gate.token', 'wrangler'],
  ['B15 publish: a redirect that keeps the token passes the smoke', `${R}publish.mjs`, "return to.searchParams.has('k') ?", 'return false ?', 'wrangler'],
  ['B15 publish: a link answered without a redirect passes the smoke', `${R}publish.mjs`, 'if (first.status < 300 || first.status > 399) return', 'if (false) return', 'wrangler'],
  ['B15 publish: the smoke drops the cookie', `${R}publish.mjs`, "ask(to.href, 'follow', cookie)", "ask(to.href, 'follow')", 'wrangler'],
  ['B15 publish: a failed draft stays up', `${R}publish.mjs`, ': gate ? `; ${await deleteDraft(', ': false ? `; ${await deleteDraft(', 'wrangler'],
  ['B15 publish: the delete names the short id, not the uuid', `${R}publish.mjs`, '`${deploymentsUrl(target)}/${hits[0].id}?force=true`', '`${deploymentsUrl(target)}/${shortId}?force=true`', 'wrangler'],
  ['B15 publish: an entry whose id does not start with the short id is taken', `${R}publish.mjs`, "&& typeof d.id === 'string' && d.id.startsWith(shortId)", '', 'wrangler'],
  ['B15 publish: an entry with another short_id is taken', `${R}publish.mjs`, 'd.short_id === shortId && ', '', 'wrangler'],
  ['B15 publish: two matches delete the first', `${R}publish.mjs`, 'if (hits.length !== 1) return left(', 'if (!hits.length) return left(', 'wrangler'],
  ['B15 publish: a failed list is read as an empty one', `${R}publish.mjs`, 'if (!list) return left(', 'if (!list) break; left(', 'wrangler'],
  ['B15 publish: only the first page of the deployment list is read', `${R}publish.mjs`, 'page <= 4 && !hits.length', 'page <= 1 && !hits.length', 'wrangler'],
  ['B15 publish: the deployment list is read without end', `${R}publish.mjs`, 'page <= 4 && !hits.length', '!hits.length', 'wrangler'],
  // B15-F: the delete of a failed draft carries force=true and nothing else does; a refused delete is told in Cloudflare's words
  ['B15 publish: the delete of a failed draft is sent without force', `${R}publish.mjs`, '${hits[0].id}?force=true`', '${hits[0].id}`', 'wrangler'],
  ['B15 publish: the list read of the deployments carries force', `${R}publish.mjs`, '`${deploymentsUrl(target)}?per_page=25&page=${page}`', '`${deploymentsUrl(target)}?per_page=25&page=${page}&force=true`', 'wrangler'],
  ['B15 publish: the rollback carries force', `${R}publish.mjs`, '/deployments/${id}/rollback`', '/deployments/${id}/rollback?force=true`', 'wrangler'],
  ['B15 publish: the settings read of the project carries force', `${R}publish.mjs`, '/pages/projects/${target}`, { headers', '/pages/projects/${target}?force=true`, { headers', 'wrangler'],
  ['B15 publish: a refused delete is told as deleted', `${R}publish.mjs`, 'del.r && del.r.ok && del.j && del.j.success === true ?', 'del.r ?', 'wrangler'],
  ["B15 publish: Cloudflare's words on a refused delete are cut short", `${R}publish.mjs`, '.slice(0, 160)', '.slice(0, 60)', 'wrangler'],
  // B12-E: the addresses of items that left the site answer 404 from a function of the deployment (book row B12)
  ['B12-E publish: a draft ships the gone list', `${R}publish.mjs`, 'const gone = gate ? [] : ', 'const gone = ', 'wrangler'],
  ['B12-E publish: the gone list is not shipped', `${R}publish.mjs`, '    if (gone.length) {', '    if (false) {', 'wrangler'],
  ['B12-E publish: the addresses are not read from the export', `${R}publish.mjs`, '.goneAddresses(exp);', '.goneAddresses({ ...exp, removed: [] });', 'wrangler'],
  ['B12-E publish: _routes.json invokes the function for every address', `${R}publish.mjs`, "const rules = ['/api/lead', ...gone]", "const rules = ['/*']", 'wrangler'],
  ['B12-E publish: _routes.json drops /api/lead', `${R}publish.mjs`, "const rules = ['/api/lead', ...gone]", 'const rules = [...gone]', 'wrangler'],
  ['B12-E publish: _routes.json is written outside the deployed folder', `${R}publish.mjs`, "writeFileSync(join(dist, '_routes.json')", "writeFileSync(join(work, '_routes.json')", 'wrangler'],
  ['B12-E publish: the function wrapper is not copied', `${R}publish.mjs`, "      cpSync(join(REPO, 'factory', 'worker', 'pages-function-gone.js'), join(fns, '_middleware.js'));\n", '', 'wrangler'],
  ['B12-E publish: the gone function is not copied', `${R}publish.mjs`, "      cpSync(join(REPO, 'factory', 'worker', 'gone.mjs'), join(fns, 'gone.mjs'));\n", '', 'wrangler'],
  ['B12-E publish: the list is not written', `${R}publish.mjs`, "      writeFileSync(join(fns, 'gone-list.mjs'), ", "      void (join(fns, 'gone-list.mjs'), ", 'wrangler'],
  ["B12-E publish: the site's own 404 page is not shipped", `${R}publish.mjs`, "page: readFileSync(join(dist, '404.html'), 'utf8')", "page: 'Not found'", 'wrangler'],
  ['B12-E publish: the addresses are printed in the log', `${R}publish.mjs`, ' (the addresses are not printed)', ': ${gone.join(\' \')}', 'wrangler'],
  // Cloudflare's limits on a _routes.json (100 rules, 100 characters a rule): each boundary has its own fault, and so have the file and the log past them
  ['B12-E publish: exactly 100 rules are written as /*', `${R}publish.mjs`, 'rules.length > ROUTES_MAX_RULES', 'rules.length >= ROUTES_MAX_RULES', 'wrangler'],
  ['B12-E publish: 101 rules are still written as a list', `${R}publish.mjs`, 'rules.length > ROUTES_MAX_RULES', 'rules.length > ROUTES_MAX_RULES + 1', 'wrangler'],
  ['B12-E publish: an address of exactly 100 characters is written as /*', `${R}publish.mjs`, 'a.length > ROUTES_MAX_CHARS', 'a.length >= ROUTES_MAX_CHARS', 'wrangler'],
  ['B12-E publish: an address of 101 characters is still written as a list', `${R}publish.mjs`, 'a.length > ROUTES_MAX_CHARS', 'a.length > ROUTES_MAX_CHARS + 1', 'wrangler'],
  ['B12-E publish: past the limits the file still lists the addresses', `${R}publish.mjs`, "include: wide ? ['/*'] : rules", 'include: rules', 'wrangler'],
  ['B12-E publish: past the limits the log says nothing', `${R}publish.mjs`, "${wide ? `; every request passes the function (more than ${ROUTES_MAX_RULES} rules or a rule over ${ROUTES_MAX_CHARS} characters)` : ''}", '', 'wrangler'],
  // FLOWS-RUNNER-1: the staging flows on GitHub's runner (flows.yml, .github/scripts/flows-result.mjs)
  ['FLOWS-RUNNER-1 flows.yml: a push starts it too', '.github/workflows/flows.yml', '  workflow_dispatch:', '  push:\n  workflow_dispatch:', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the grep is pasted into the shell line', '.github/workflows/flows.yml', '--grep="$FLOWS_GREP" --reporter=list,json', '--grep="${{ inputs.grep }}" --reporter=list,json', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: a second start replaces the waiting one', '.github/workflows/flows.yml', '  queue: max', '  cancel-in-progress: false', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the flow has no time limit of its own', '.github/workflows/flows.yml', 'timeout 75m ', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: any branch or tag runs', '.github/workflows/flows.yml', 'case "$GITHUB_REF" in refs/heads/master|refs/heads/check/*) ;; *) echo "BLOCKED: flows run only from master or a check/ branch"; exit 1 ;; esac', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the spec is not checked', '.github/workflows/flows.yml', '[[ "$FLOWS_SPEC" =~ $spec_re ]] || { echo "BLOCKED: spec is not a file name of apps/dashboard/tests"; exit 1; }', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the grep is not checked', '.github/workflows/flows.yml', '[[ "$FLOWS_GREP" =~ $grep_re ]] || { echo "BLOCKED: grep takes 1 to 100 letters, digits, spaces and . _ : - only"; exit 1; }', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the mutant is not checked', '.github/workflows/flows.yml', '[[ "$FLOWS_MUTANT" =~ $mutant_re ]] || { echo "BLOCKED: mutant is empty or a FLOWS_MUTANT name (lower-case words joined by -)"; exit 1; }', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the grep pattern lets any text through', '.github/workflows/flows.yml', "grep_re='^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,99}$'", "grep_re='^.+$'", 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: a trace is recorded', '.github/workflows/flows.yml', '--reporter=list,json', '--reporter=list,json --trace=on', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the plain output is uploaded', '.github/workflows/flows.yml', '          path: ${{ runner.temp }}/flows-report.enc', '          path: ${{ runner.temp }}/flows', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the report key is put on the command line', '.github/workflows/flows.yml', '-pass env:FLOWS_REPORT_KEY', '-pass "pass:$FLOWS_REPORT_KEY"', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: an empty report key seals with an empty password', '.github/workflows/flows.yml', 'if [ -z "$FLOWS_REPORT_KEY" ]; then echo "no artifact: FLOWS_REPORT_KEY has no repository secret, and nothing is kept unsealed"; exit 0; fi', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the upload runs with no seal', '.github/workflows/flows.yml', "steps.seal.outputs.sealed == 'yes'", "steps.seal.outcome == 'success'", 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: a production key reaches the job', '.github/workflows/flows.yml', '          FLOWS_REPORT_KEY: ${{ secrets.FLOWS_REPORT_KEY }}', '          FLOWS_REPORT_KEY: ${{ secrets.FLOWS_REPORT_KEY }}\n          PROD_DB_URL: ${{ secrets.PROD_DB_URL }}', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the result is not read from the report', '.github/workflows/flows.yml', 'run: node .github/scripts/flows-result.mjs "$RUNNER_TEMP/flows/report.json"', 'run: echo "flows result: 1 passed"', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: a spec file is missing from the choice', '.github/workflows/flows.yml', '          - styles.spec.ts', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows.yml: the key check is skipped', '.github/workflows/flows.yml', 'if [ -n "$SITE_SIGNING_KEY_TEST_DEMO_A" ]; then', 'if true; then', 'workflows'],
  ["FLOWS-RUNNER-1 flows.yml: the preflight demands the owner's optional keys", '.github/workflows/flows.yml', 'STAGING_DB_URL; do', 'STAGING_DB_URL SITE_SIGNING_KEY_TEST_DEMO_A FLOWS_REPORT_KEY; do', 'workflows'],
  ['FLOWS-RUNNER-1: the install runs install scripts', '.github/workflows/flows.yml', 'npm ci --ignore-scripts --no-audit --no-fund', 'npm ci --no-audit --no-fund', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a failed test counts as a pass', '.github/scripts/flows-result.mjs', 'const ok = s.expected >= 1 && s.unexpected === 0 && errors.length === 0;', 'const ok = s.expected >= 1;', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a run with no passed test passes', '.github/scripts/flows-result.mjs', 's.expected >= 1 && ', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: the first error is printed unredacted', '.github/scripts/flows-result.mjs', 'redact(firstLine(message))', 'firstLine(message)', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: the job summary is not written', '.github/scripts/flows-result.mjs', 'if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(', 'if (false) appendFileSync(', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a setup error is not reported', '.github/scripts/flows-result.mjs', 'const errors = report.errors || [];', 'const errors = [];', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: an unreadable report passes', '.github/scripts/flows-result.mjs', "console.log('flows result: no readable report'); process.exit(1);", "console.log('flows result: no readable report'); process.exit(0);", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a JWT is printed', '.github/scripts/flows-result.mjs', "'[token]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a URL is printed', '.github/scripts/flows-result.mjs', "'[url]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a project host is printed', '.github/scripts/flows-result.mjs', "'[host]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: an email address is printed', '.github/scripts/flows-result.mjs', "'[email]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a uuid is printed', '.github/scripts/flows-result.mjs', "'[uuid]']", "'$&']", 'workflows'],
  ["FLOWS-RUNNER-1 flows-result: a test lead's name is printed", '.github/scripts/flows-result.mjs', "'[lead]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a phone number is printed', '.github/scripts/flows-result.mjs', "'[phone]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a long key-like string is printed', '.github/scripts/flows-result.mjs', "'[secret]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a project ref is printed', '.github/scripts/flows-result.mjs', "'[id]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a Windows path is printed', '.github/scripts/flows-result.mjs', "'[path]']", "'$&']", 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a flow that sends a lead passes without the key', '.github/scripts/flows-result.mjs', 'if ((list.suites || []).some(chosen)) {', 'if (false) {', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: the describes are not read from the spec', '.github/scripts/flows-result.mjs', `"'--as', 'site:"`, `"'--as', 'nobody:"`, 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: a nested describe is not searched', '.github/scripts/flows-result.mjs', ' || (suite.suites || []).some(chosen)', '', 'workflows'],
  ['FLOWS-RUNNER-1 flows-result: an unreadable list passes', '.github/scripts/flows-result.mjs', "console.log('BLOCKED: no readable list of the chosen flows'); process.exit(1);", "console.log('BLOCKED: no readable list of the chosen flows'); process.exit(0);", 'workflows'],
];

const ONLY = process.env.MUTANT_ONLY;   // a substring of the mutant names: only those run (a scoped run; the whole list is the CI run)
const MUTANTS = ONLY ? ALL_MUTANTS.filter((m) => m[0].includes(ONLY)) : ALL_MUTANTS;
const JOBS = Number(process.env.MUTANT_JOBS) || 3;
const made = [];
function makeCopy(i) {
  const root = mkdtempSync(join(tmpdir(), `omnikom-runner-mut-${i}-`));
  made.push(root);
  cpSync(join(REPO, R), join(root, R), { recursive: true, filter: (src) => !/\/(node_modules|test)(\/|$)/.test('/' + src.slice(join(REPO, R).length).replace(/\\/g, '/')) });
  mkdirSync(join(root, 'tools'), { recursive: true });
  cpSync(join(REPO, 'tools', 'github-secrets.mjs'), join(root, 'tools', 'github-secrets.mjs'));
  cpSync(join(REPO, '.github', 'workflows'), join(root, '.github', 'workflows'), { recursive: true });
  cpSync(join(REPO, '.github', 'scripts'), join(root, '.github', 'scripts'), { recursive: true });
  if (existsSync(join(REPO, R, 'node_modules'))) symlinkSync(join(REPO, R, 'node_modules'), join(root, R, 'node_modules'), 'junction');
  return root;
}

function runOne([name, file, target, replacement, sections, needs], i) {
  return new Promise((done) => {
    if (needs === 'sharp' && !HAS_SHARP) return done({ name, status: 'skipped', detail: 'sharp not installed' });
    const root = makeCopy(i);
    const f = join(root, file);
    const src = readFileSync(f, 'utf8');
    const n = src.split(target).length - 1;
    if (n !== 1) return done({ name, status: 'missing', detail: `target found ${n} times` });
    writeFileSync(f, src.split(target).join(replacement));
    const env = { ...process.env, RUNNER_DIR: join(root, R), SECRETS_TOOL: join(root, 'tools', 'github-secrets.mjs'), WORKFLOWS_DIR: join(root, '.github', 'workflows'), FLOWS_RESULT: join(root, '.github', 'scripts', 'flows-result.mjs'), RUNNER_TEST_BAIL: '1', RUNNER_TEST_ONLY: `signature,pieces,${sections}` };
    const p = spawn(process.execPath, [join(REPO, R, 'test', 'run.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => p.kill('SIGKILL'), 600000);
    p.on('close', (code) => {
      clearTimeout(t);
      const red = out.split(/\r?\n/).find((l) => /^FAIL (?!import)/.test(l));
      done(code !== 0 && red ? { name, status: 'caught', detail: red.slice(5, 120) } : { name, status: 'survived', detail: `exit ${code}, no failing check\n${out.slice(-300)}` });
    });
  });
}

const results = [];
let next = 0;
async function lane() {
  while (next < MUTANTS.length) {
    const i = next++;
    const r = await runOne(MUTANTS[i], i);
    results[i] = r;
    console.log(`${r.status === 'caught' ? 'caught  ' : r.status.padEnd(8)} ${r.name}${r.status === 'caught' ? `   <- ${r.detail}` : r.status === 'skipped' ? '' : `   ${r.detail}`}`);
  }
}
await Promise.all(Array.from({ length: JOBS }, lane));
for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp */ } }

const count = (s) => results.filter((r) => r.status === s).length;
const skipped = count('skipped');
console.log(`${MUTANTS.length - skipped} mutants, ${count('caught')} caught, ${count('survived')} survived, ${count('missing')} target text missing${skipped ? `, ${skipped} skipped (sharp not installed)` : ''}`);
process.exit(count('survived') || count('missing') ? 1 : 0);
