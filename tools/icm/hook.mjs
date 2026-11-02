// Claude Code PostToolUse hook (matcher Write|Edit): after a doc or source file is written, refresh icm/ for the repo that file
// lives in. Reads the hook JSON on stdin, finds the nearest folder above the file that has tools/icm/index.mjs (so an edit in a
// worktree refreshes that worktree's index, not the shared tree's), runs it with --quiet. Never blocks: always exits 0.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';

let file = '';
try {
  const j = JSON.parse(readFileSync(0, 'utf8'));
  file = (j.tool_input && j.tool_input.file_path) || (j.tool_response && j.tool_response.filePath) || '';
} catch { /* no input: nothing to do */ }

if (file && /\.(md|mjs|js|ts|tsx|sql)$/i.test(file)) {
  let dir = dirname(resolve(file));
  let root = '';
  for (let i = 0; i < 40; i++) {
    if (existsSync(join(dir, 'tools', 'icm', 'index.mjs'))) { root = dir; break; }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const rel = root ? relative(root, resolve(file)).replace(/\\/g, '/') : '';
  // the generated files themselves never trigger a rebuild
  if (root && rel && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('icm/')) {
    spawnSync(process.execPath, [join(root, 'tools', 'icm', 'index.mjs'), '--quiet'], { cwd: root, timeout: 30000, stdio: 'ignore' });
  }
}
process.exit(0);
