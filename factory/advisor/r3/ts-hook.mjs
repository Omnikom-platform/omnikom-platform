// Lets Node 24 import the lovable repo's advisor TypeScript sources READ-ONLY for the R3 reference run:
// extensionless relative imports resolve to .ts (Node strips the types itself). Use: node --import ./factory/advisor/r3/ts-hook.mjs <script>
// Nothing here is shipped; it exists only so the harness can run today's engine from source as the reference.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, ctx, next) {
    if ((spec.startsWith('./') || spec.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(spec)) {
      for (const ext of ['.ts', '/index.ts']) { try { return next(spec + ext, ctx); } catch {} }
    }
    return next(spec, ctx);
  },
});
