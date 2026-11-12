// The error screen is wired once, at the router's root (book row E7, work/38-dashboard-hardening/router-wiring.patch): a route with no error
// component of its own has no boundary, so an error thrown in any route reaches the root's and shows src/ErrorScreen.tsx.
import { describe, expect, it, vi } from 'vitest';
import { router } from './router';
import { ErrorScreen } from './ErrorScreen';

vi.mock('./supabase', () => ({ supabase: {} }));   // no client and no keys in a test (vi.mock runs before the imports)

describe('the router (E7)', () => {
  it('the root route carries the error screen', () => {
    expect(router.routeTree.options.errorComponent).toBe(ErrorScreen);
  });
});
