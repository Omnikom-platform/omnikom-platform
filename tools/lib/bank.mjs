// Writes NAME=value into an env file (replacing an existing NAME= line) with the same shape rules as
// save-secret-from-clipboard.ps1. Returns only the name and the length; never logs the value.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function bank(envFile, name, value, prefix, min = 20) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name || '')) return { ok: false, error: 'bad name' };
  const v = String(value ?? '').trim();
  if (v.length < min || /\s/.test(v)) return { ok: false, error: `value does not look like a key (length ${v.length})` };
  if (prefix && !v.startsWith(prefix)) return { ok: false, error: 'value does not start with the expected prefix' };
  const lines = existsSync(envFile) ? readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => !l.startsWith(name + '=')) : [];
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.push(`${name}=${v}`);
  writeFileSync(envFile, lines.join('\n') + '\n', 'utf8');
  return { ok: true, name, length: v.length };
}
