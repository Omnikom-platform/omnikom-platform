import { describe, expect, it } from 'vitest';
import { stagingBuildEnv } from './staging-env.mjs';

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
});
