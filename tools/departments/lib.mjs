// Reads the department charters. A charter is docs/departments/<slug>.md (README.md and TEMPLATE.md are not charters).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEPT_DIR = process.env.OMNIKOM_DEPT_DIR ? resolve(process.env.OMNIKOM_DEPT_DIR) : join(ROOT, 'docs', 'departments');

export const REQUIRED_SECTIONS = ['Mission', 'Owns', 'Does not touch', 'Head session', 'Builders', 'Rules that bind this department', 'Proof', 'Decisions that shape this department', 'Open items', 'Position log'];
export const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];

export function charterFiles() {
  return readdirSync(DEPT_DIR).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'TEMPLATE.md').sort();
}

// section title -> body text (a section runs from its "## Title" line to the next "## ")
export function sections(text) {
  const out = new Map();
  const parts = text.split(/\n(?=## )/);
  for (const p of parts) {
    const m = /^## ([^\n]+)\n?([\s\S]*)$/.exec(p);
    if (m) out.set(m[1].replace(/\s*\(.*$/, '').trim(), m[2]);
  }
  return out;
}

export function parseCharter(file) {
  const text = readFileSync(join(DEPT_DIR, file), 'utf8');
  const s = sections(text);
  const owns = [...(s.get('Owns') || '').matchAll(/^- `([^`]+)`/gm)].map(m => m[1]);
  const head = /Model:\s*([a-z]+)/i.exec(s.get('Head session') || '');
  const builder = /Model:\s*([a-z]+)/i.exec(s.get('Builders') || '');
  const log = [...(s.get('Position log') || '').matchAll(/^- (\d{4}-\d{2}-\d{2})/gm)].map(m => m[1]);
  return { file, slug: file.replace(/\.md$/, ''), text, sections: s, owns, headModel: head ? head[1].toLowerCase() : null, builderModel: builder ? builder[1].toLowerCase() : null, log };
}

export const parseCharters = () => charterFiles().map(parseCharter);
