import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFolder, findLeaks, secretVariables } from './check-bundle-secrets.mjs';

const file = (path, text) => ({ path, bytes: Buffer.from(text, 'utf8') });

describe('which variables count as secrets', () => {
  it('takes names with SECRET, TOKEN, PASSWORD or DB_URL (any case), with a value of 8 or more characters', () => {
    const names = secretVariables({
      STAGING_SUPABASE_SECRET_KEY: 'sb_secret_abcdefgh',
      SUPABASE_ACCESS_TOKEN: 'sbp_abcdefghijkl',
      STAGING_DB_PASSWORD: 'correct-horse-battery',
      STAGING_DB_URL: 'postgres://u:p@h:5432/db',
      lower_case_token: 'abcdefghijkl',
    }).map(v => v.name);
    expect(names).toEqual(['STAGING_SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'STAGING_DB_PASSWORD', 'STAGING_DB_URL', 'lower_case_token']);
  });
  it('leaves out other names (the publishable key is a browser key) and values that are too short to be a secret', () => {
    expect(secretVariables({ STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abcdefgh', STAGING_SUPABASE_REF: 'abcdefghijklmnop', SHORT_SECRET: 'abc', EMPTY_TOKEN: '' })).toEqual([]);
  });
});

describe('finding a value in a bundle', () => {
  const env = { STAGING_SUPABASE_SECRET_KEY: 'sb_secret_PLANTEDVALUE1234', STAGING_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_BROWSERKEY5678' };
  it('is clean when no secret value is in any file (the publishable key may be)', () => {
    expect(findLeaks([file('dist/a.js', 'x="sb_publishable_BROWSERKEY5678"')], env)).toEqual([]);
  });
  it('finds a planted secret value, in any file, and reports the variable name and file, never the value', () => {
    const leaks = findLeaks([file('dist/a.js', 'ok'), file('dist/b.js', 'const k="sb_secret_PLANTEDVALUE1234";')], env);
    expect(leaks).toEqual([{ name: 'STAGING_SUPABASE_SECRET_KEY', file: 'dist/b.js' }]);
    expect(JSON.stringify(leaks)).not.toContain('PLANTEDVALUE');
  });
  it('finds it inside an html file and a source map just the same', () => {
    expect(findLeaks([file('dist/index.html', '<script>1;sb_secret_PLANTEDVALUE1234</script>')], env)).toHaveLength(1);
  });
});

describe('scanning a folder', () => {
  it('walks sub folders and counts the files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dash-bundle-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'index.html'), '<html></html>');
      writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("hello")');
      expect(checkFolder(dir, { X_SECRET: 'sb_secret_PLANTEDVALUE1234' })).toEqual({ scanned: 2, variables: 1, leaks: [] });
      writeFileSync(join(dir, 'assets', 'leak.js'), 'a="sb_secret_PLANTEDVALUE1234"');
      const r = checkFolder(dir, { X_SECRET: 'sb_secret_PLANTEDVALUE1234' });
      expect(r.leaks.map(l => l.name)).toEqual(['X_SECRET']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
