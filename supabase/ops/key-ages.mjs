// key-ages: how old is every machine credential, and which ones are due for rotation? (13-DATA-MODEL section 8, 02-BACKEND section 8)
//   node supabase/ops/key-ages.mjs --db STAGING_DB_URL [--max-age-days 90] [--warn-days 14] [--summary <file>]
// The database URL is given by variable NAME, read from the environment and never printed; the connection is one read-only
// transaction (promote-check.mjs's helper). It lists the api_keys rows as: kind, label, site, age in days, last used, expires,
// revoked. It never selects or prints key_hash, vault_ref, scope or an id: a table row here cannot leak a credential.
// Exit 1 (red; GitHub emails the repository's watchers) when an ACTIVE key (not revoked) is
//   - older than --max-age-days (default 90), or
//   - expires within --warn-days (default 14), which includes a key whose expiry already passed but was never revoked.
// The table is also appended to --summary <file>, or to $GITHUB_STEP_SUMMARY when that is set (the job summary).
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { psqlReadOnly } from './promote-check.mjs';

const DAY = 86400000;
const VAR = /^[A-Z][A-Z0-9_]*$/;
const SQL = `select coalesce(json_agg(json_build_object(
    'kind', k.kind, 'label', k.label, 'site', coalesce(s.domain, s.preview_host), 'workspace', k.workspace_id is not null,
    'created', k.created_at, 'last_used', k.last_used_at, 'expires', k.expires_at, 'revoked', k.revoked_at)
  order by k.created_at, k.kind, k.label), '[]')
  from public.api_keys k left join public.sites s on s.id = k.site_id;`;

const day = iso => (iso ? String(iso).slice(0, 10) : '');
const cell = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();

export function assess(rows, { now = new Date(), maxAgeDays = 90, warnDays = 14 } = {}) {
  return rows.map(r => {
    const age = Math.floor((now.getTime() - new Date(r.created).getTime()) / DAY);
    const flags = [];
    if (!r.revoked) {
      if (age > maxAgeDays) flags.push(`older than ${maxAgeDays} days`);
      if (r.expires) {
        const left = new Date(r.expires).getTime() - now.getTime();
        if (left <= 0) flags.push('expired and not revoked');
        else if (left <= warnDays * DAY) flags.push(`expires in ${Math.ceil(left / DAY)} days`);
      }
    }
    return {
      kind: r.kind, label: r.label, site: r.site || (r.workspace ? '(workspace)' : '(platform)'), age,
      lastUsed: day(r.last_used) || 'never', expires: day(r.expires) || 'never', revoked: day(r.revoked) || 'no', flags,
    };
  });
}

export function table(rows) {
  const head = ['kind', 'label', 'site', 'age (days)', 'last used', 'expires', 'revoked', 'rotate?'];
  const body = rows.map(r => [r.kind, r.label, r.site, r.age, r.lastUsed, r.expires, r.revoked, r.flags.length ? `YES: ${r.flags.join('; ')}` : '']);
  return [head, ...body].map((cells, i) => `| ${cells.map(cell).join(' | ')} |${i === 0 ? '\n|' + head.map(() => ' --- |').join('') : ''}`).join('\n');
}

export function main(argv, env = process.env, log = console.log, err = console.error, exec = psqlReadOnly) {
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const dbVar = opt('--db');
  const maxAgeDays = opt('--max-age-days') === null ? 90 : Number(opt('--max-age-days'));
  const warnDays = opt('--warn-days') === null ? 14 : Number(opt('--warn-days'));
  if (!dbVar || !VAR.test(dbVar) || !Number.isFinite(maxAgeDays) || !Number.isFinite(warnDays)) { err('usage: key-ages.mjs --db <VARIABLE> [--max-age-days 90] [--warn-days 14] [--summary <file>]'); return 2; }
  const url = env[dbVar];
  if (!url) { err(`set ${dbVar} (a database URL; read by name, never printed)`); return 2; }
  let rows;
  try { rows = JSON.parse(exec(url, SQL)); } catch (e) { err(`cannot read api_keys from ${dbVar}: ${String(e.message).slice(0, 300)}`); return 2; }

  const list = assess(rows, { maxAgeDays, warnDays });
  const due = list.filter(r => r.flags.length);
  const md = [`### API key ages (${list.length} keys, ${due.length} due)`, '', list.length ? table(list) : 'No api_keys rows.', '',
    `A key is due when it is not revoked and is older than ${maxAgeDays} days or expires within ${warnDays} days.`].join('\n');
  log(md);
  for (const r of due) log(`DUE ${r.kind} "${cell(r.label)}" (${r.site}): ${r.flags.join('; ')}`);
  const summary = opt('--summary') || env.GITHUB_STEP_SUMMARY;
  if (summary) { try { appendFileSync(summary, md + '\n'); } catch (e) { err(`could not write the summary: ${e.message}`); } }
  log(due.length ? `KEY ROTATION DUE: ${due.length} of ${list.length} keys` : `OK: ${list.length} keys, none due`);
  return due.length ? 1 : 0;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
