// tools ensure [--only <names>]   download the tools tools.json lists into <repo>/.tools/ (sha256 checked; refuses on a mismatch)
// tools list                      the manifest, and what is in .tools/ (read-only)
// No target. The download is the one thing here that leaves the machine; it goes to the tool's own GitHub release only (lib/tools.mjs).
import { Usage } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { ensureTools, listTools, toolsDir, platformKey } from '../lib/tools.mjs';

export async function toolsGroup(ctx) {
  const verb = ctx.positionals[1];
  if (!['ensure', 'list'].includes(verb)) throw new Usage('tools <ensure [--only a,b] | list>');
  if (ctx.positionals.length > 2) throw new Usage(`tools ${verb}: unexpected argument '${ctx.positionals[2]}'`);
  if (ctx.flags.target !== undefined) throw new Usage(`tools ${verb} takes no --target: it works on the repository's .tools folder only`);
  if (verb === 'list') {
    if (ctx.flags.only !== undefined) throw new Usage('tools list takes no --only');
    return result(true, 'ok', listTools(ctx));
  }
  let names = null;
  if (ctx.flags.only !== undefined) {
    names = String(ctx.flags.only).split(',').map(s => s.trim()).filter(Boolean);
    if (names.length === 0) throw new Usage('--only needs at least one tool name');
  }
  const tools = await ensureTools(ctx, names);
  const ok = tools.every(t => t.status === 'present' || t.status === 'downloaded');
  return result(ok, ok ? 'ok' : 'TOOLS-REFUSED', { platform: ctx.platform || platformKey(), dir: toolsDir(ctx), tools });
}
