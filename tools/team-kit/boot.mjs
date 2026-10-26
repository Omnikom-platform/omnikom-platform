// boot: start one ELEV8 team member as a fresh interactive Claude session in this terminal (START-TEAM.cmd opens one window per
// role). Ported from the Francine & Eli team launcher (2026-10-21) for the ELEV8 audit, 2026-10-26.
// The opening message is the role's boot prompt from icm/agents/boot-prompts.md (agents carry "ICM-ROLE: <role>", which the
// hooks in .claude/settings.json use to inject the charter, write scope, phase rows and gaps; the Lead carries none).
// Session names ("ELEV8 Lead", ...) are how the team reaches each other with SendMessage.
// Usage: node tools/team/boot.mjs <lead|researcher|seo-analyst|reviewer> [--dry]   (--dry prints the command, starts nothing)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// heading in boot-prompts.md, window/session name, model, effort
export const TEAM = {
  lead: { heading: 'Lead', name: 'ELEV8 Lead', model: 'claude-opus-5-5', effort: 'high' },
  researcher: { heading: 'Researcher', name: 'ELEV8 Researcher', model: 'claude-sonnet-5-5', effort: 'high' },
  'seo-analyst': { heading: 'SEO analyst', name: 'ELEV8 SEO analyst', model: 'claude-opus-5-5', effort: 'medium' },
  reviewer: { heading: 'Reviewer', name: 'ELEV8 Reviewer', model: 'claude-fable-5-1', effort: 'high' },
};
const TEAM_LINE = 'Team mode (terminal windows from START-TEAM.cmd): the Lead is the session named "ELEV8 Lead"; the others are "ELEV8 Researcher" and "ELEV8 SEO analyst". Reach any of them with SendMessage to that name. Do not message anyone just to say you are up: read what your boot prompt says, then do what it says. Never restart work the Status column shows done.';

export function bootPrompt(role) {
  const t = TEAM[role]; if (!t) throw new Error(`unknown role: ${role} (${Object.keys(TEAM).join(', ')})`);
  // CRLF-safe: the section split and the ``` block match below expect "\n".
  const md = fs.readFileSync(path.join(ROOT, 'icm/agents/boot-prompts.md'), 'utf8').replace(/\r\n/g, '\n');
  const sec = md.split(/\n## /).find((s) => s.startsWith(t.heading + ' (') || s.startsWith(t.heading + '\n'));
  const block = sec && sec.match(/```\n([\s\S]*?)\n```/);
  if (!block) throw new Error(`no boot prompt under "## ${t.heading}" in icm/agents/boot-prompts.md`);
  return block[1].trim() + '\n' + TEAM_LINE;
}

if (process.argv[1] && (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })()) {
  const role = process.argv[2], dry = process.argv.includes('--dry');
  const t = TEAM[role]; if (!t) { console.error(`usage: node tools/team/boot.mjs <${Object.keys(TEAM).join('|')}> [--dry]`); process.exit(1); }
  const args = ['-n', t.name, '--model', t.model, '--effort', t.effort, '--permission-mode', 'bypassPermissions', bootPrompt(role)];
  if (dry) { console.log(['claude', ...args.slice(0, -1)].join(' ') + '  <boot prompt, ' + args.at(-1).length + ' chars, first line: ' + args.at(-1).split('\n')[0] + '>'); process.exit(0); }
  process.chdir(ROOT);
  const r = spawnSync('claude', args, { stdio: 'inherit', shell: false }); // no-timeout: the operator's own interactive Claude session, it ends when they close it
  if (r.error) { console.error(`could not start claude: ${r.error.message}. Is Claude Code installed and on PATH? (where claude)`); process.exit(1); }
  // A claude ended by a signal has no exit code: that is a failure, never a silent 0.
  if (r.status === null) { console.error(`claude ended without an exit code (signal ${r.signal || 'unknown'})`); process.exit(1); }
  process.exit(r.status);
}
