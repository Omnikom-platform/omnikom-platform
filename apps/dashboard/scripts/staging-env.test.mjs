import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_EMAIL, stagingBuildEnv } from './staging-env.mjs';

const input = { STAGING_SUPABASE_REF: 'abcdefghijklmnopqrst', STAGING_SUPABASE_PUBLISHABLE_KEY: 'k' };

describe('the staging build environment carries the Ask Omnikom address (B18)', () => {
  it('gives the build hello@omnikom.ai', () => {
    expect(stagingBuildEnv(input).env.VITE_ASK_EMAIL).toBe('hello@omnikom.ai');
  });
  it('control: an address already in the input does not win over the one home', () => {
    expect(stagingBuildEnv({ ...input, VITE_ASK_EMAIL: 'other@example.test' }).env.VITE_ASK_EMAIL).toBe('hello@omnikom.ai');
  });
  it('control: a missing key is still named, and no environment is given', () => {
    expect(stagingBuildEnv({ STAGING_SUPABASE_REF: input.STAGING_SUPABASE_REF })).toEqual({ missing: ['STAGING_SUPABASE_PUBLISHABLE_KEY'] });
  });
  it('exports the address as ASK_EMAIL: tests/flows.spec.ts imports it, and staging-env.d.mts only declares it', () => {
    expect(ASK_EMAIL).toBe('hello@omnikom.ai');
  });
});

// staging-env.mjs reads the file when it is imported: each case imports it again with environments.json swapped for one staging entry.
describe('staging-env.mjs refuses an environments.json whose staging.askEmail is not an address (B18)', () => {
  const load = async staging => {
    vi.resetModules();
    vi.doMock('node:fs', async importOriginal => {
      const fs = await importOriginal();
      return { ...fs, readFileSync: (path, ...rest) => (String(path).endsWith('environments.json') ? JSON.stringify({ staging }) : fs.readFileSync(path, ...rest)) };
    });
    return import('./staging-env.mjs');
  };
  afterEach(() => { vi.doUnmock('node:fs'); vi.resetModules(); });

  it.each([['missing', {}], ['empty', { askEmail: '' }], ['blank', { askEmail: '   ' }], ['a number', { askEmail: 5 }], ['a word with no @', { askEmail: 'hello.omnikom.ai' }]])(
    '%s: the import throws and names the file and the key', async (_name, staging) => {
      await expect(load(staging)).rejects.toThrow('supabase/ops/environments.json: staging.askEmail');
    });
  it('control: another address loads and is the one exported (the swapped file is the one read)', async () => {
    expect((await load({ askEmail: 'ask@example.test' })).ASK_EMAIL).toBe('ask@example.test');
  });
});
